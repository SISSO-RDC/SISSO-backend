// ============================================================
// SISSO - Politica tecnica central de minimizacion por campo.
//
// CREADO en Auditoria N.11 (hallazgo CRITICO C11-03, P0): hasta
// ahora, que un campo fuera "clinico y por lo tanto reservado a
// medico" era una decision que cada controlador implementaba a
// mano (a veces con un allowlist -objeto literal explicito-, a
// veces con un denylist -destructuring/delete de 1-2 campos
// conocidos-, a veces sin ningun control). La auditoria senala,
// con razon, que una futura columna sensible agregada a una tabla
// puede terminar viajando por accidente si el controlador usa
// `SELECT *` o `tabla.*` y nadie actualiza el filtro a mano.
//
// Este modulo es una RED DE SEGURIDAD DE ULTIMA LINEA, no el
// mecanismo primario de minimizacion (los controladores deben
// seguir proyectando explicitamente lo que corresponda a cada rol
// -ver nordicoController.js, visiometriaController.js,
// audiometriaController.js, espirometriaController.js para el
// patron de allowlist recomendado). Lo que aporta este modulo es
// una segunda pasada, centralizada y declarativa, que se puede
// invocar sobre CUALQUIER fila antes de responder: si alguien
// agrega una columna nueva a CAMPOS_SIEMPRE_BLOQUEADOS aqui, se
// bloquea en todos los controladores que llamen a
// aplicarBloqueoUniversal() para esa tabla, sin tener que ir a
// editar cada controlador uno por uno.
//
// No sustituye la clasificacion D0-D4 completa ni los DTOs/
// serializadores por rol que pide la auditoria como correccion
// definitiva -- eso es un trabajo mayor de refactor transversal.
// Este modulo es el paso intermedio concreto que se pudo entregar
// en esta ronda: nombra explicitamente los campos mas sensibles
// conocidos, tabla por tabla, y dice para que roles NUNCA deben
// viajar, sin importar que controlador arme la respuesta.
// ============================================================

// tabla -> { rolesQueVenTodo: [...], camposBloqueadosParaElResto: [...], camposBloqueadosSiempre: [...] }
// camposBloqueadosSiempre: se eliminan para CUALQUIER rol, incluidos
// los que "ven todo" -- son campos retirados del uso normal de la
// aplicacion (ej. orientacion_sexual/identidad_genero tras C10-01),
// no una minimizacion por rol clinico/no-clinico.
const POLITICA_POR_TABLA = {
  evaluaciones_ocupacionales: {
    rolesQueVenTodo: ['medico'],
    // CORREGIDO en Auditoria N.13 (hallazgo CRITICO C-02, P0): se
    // agregan religion, antecedentes_ginecobstetricos,
    // antecedentes_ginecologicos_examenes,
    // antecedentes_reproductivos_masculinos y habitos_toxicos a la
    // lista de bloqueo universal. La captura NUEVA de estos campos
    // ya se detuvo en historiaClinicaController.js (ver comentarios
    // ahi), pero registros anteriores a esta correccion pueden
    // tener valores guardados; bloquearlos tambien en LECTURA evita
    // que ese dato historico se siga exponiendo mientras no exista
    // una decision juridica formal sobre su conservacion (ver
    // migration_064 y docs/DPIA_SISSO.md).
    camposBloqueadosSiempre: [
      'orientacion_sexual', 'identidad_genero', // ver migration_050 / C10-01
      'religion', 'antecedentes_ginecobstetricos', 'antecedentes_ginecologicos_examenes',
      'antecedentes_reproductivos_masculinos', 'habitos_toxicos', // ver migration_064 / C-02 (N.13)
    ],
    camposBloqueadosParaElResto: [
      'antecedentes_personales', 'antecedentes_familiares', 'antecedentes_gineco_obstetricos',
      'antecedentes_laborales', 'revision_sistemas', 'examen_fisico_regional',
      'resultados_examenes', 'diagnosticos', 'recomendaciones_tratamiento',
    ],
  },
  cuestionarios_nordicos: {
    rolesQueVenTodo: ['medico'],
    camposBloqueadosSiempre: [],
    camposBloqueadosParaElResto: [
      'regiones', 'observaciones_generales',
      'regiones_con_molestia_12_meses', 'regiones_con_molestia_7_dias', 'regiones_prioritarias', // G11-01
    ],
  },
  examenes_visiometria: {
    rolesQueVenTodo: ['medico'],
    camposBloqueadosSiempre: [],
    camposBloqueadosParaElResto: [
      'ao_lejana_sin_correccion', 'ao_lejana_con_correccion', 'clasificacion_od', 'clasificacion_oi',
      'clasificacion_ao', 'clasificacion_colores', 'aptitud_sugerida', 'aptitud_definida', // G11-02
      'observaciones',
    ],
  },
  examenes_audiometria: {
    rolesQueVenTodo: ['medico'],
    camposBloqueadosSiempre: [],
    camposBloqueadosParaElResto: [
      'pta_od', 'pta_oi', 'sts_od', 'sts_oi', 'sts_od_positivo', 'sts_oi_positivo', // G11-03
      'patron_od', 'patron_oi', 'observaciones',
    ],
  },
  examenes_espirometria: {
    rolesQueVenTodo: ['medico'],
    camposBloqueadosSiempre: [],
    camposBloqueadosParaElResto: ['patron', 'fvc', 'fev1', 'fev1_fvc', 'observaciones'], // G11-04
  },
  consentimientos_firmados: {
    rolesQueVenTodo: ['medico'],
    camposBloqueadosSiempre: [],
    camposBloqueadosParaElResto: ['texto_legal_firmado', 'firma_imagen_url', 'firma_imagen_public_id'],
  },
};

/**
 * Segunda pasada de minimizacion: dado el nombre de tabla logica y
 * el rol de quien consulta, elimina de `fila` cualquier campo listado
 * como bloqueado para ese rol, INDEPENDIENTEMENTE de lo que el
 * controlador ya haya hecho. Es idempotente y segura de llamar
 * varias veces o sobre una fila ya minimizada (los `delete` sobre
 * claves inexistentes no hacen nada).
 *
 * @param {object} fila
 * @param {string} tabla - clave de POLITICA_POR_TABLA
 * @param {string} rol
 * @returns {object} la misma fila, mutada
 */
function aplicarBloqueoUniversal(fila, tabla, rol) {
  if (!fila) return fila;
  const politica = POLITICA_POR_TABLA[tabla];
  if (!politica) return fila; // tabla sin politica registrada: no-op, no bloquea de mas por error de config

  for (const campo of politica.camposBloqueadosSiempre) {
    delete fila[campo];
  }
  if (politica.rolesQueVenTodo.includes(rol)) return fila;

  for (const campo of politica.camposBloqueadosParaElResto) {
    delete fila[campo];
  }
  return fila;
}

module.exports = { aplicarBloqueoUniversal, POLITICA_POR_TABLA };
