// ============================================================
// SISSO - Motor de deteccion de contraindicaciones clinicas.
//
// Corrige el error CRITICO #3 de la auditoria:
//
//   "Aptitud medica automatizable sin razonamiento clinico...
//    No veo motor de validacion clinica... Debe existir
//    'justificacion clinica obligatoria'."
//
// IMPORTANTE - lo que este modulo NO hace:
//   - NO decide la aptitud del trabajador.
//   - NO bloquea al medico de registrar la aptitud que considere
//     correcta, incluso si hay una alerta "absoluta".
//   - NO reemplaza el juicio clinico.
//
// Lo que SI hace:
//   - Cruza los diagnosticos CIE-10 del trabajador contra las
//     exposiciones del puesto evaluado, usando las reglas
//     definidas en la tabla reglas_contraindicacion.
//   - Devuelve una lista de alertas (absolutas y relativas) que
//     el medico debe ver ANTES de escribir su justificacion
//     clinica. El controlador exige que exista una justificacion
//     de al menos 20 caracteres independientemente de si hubo
//     alertas o no (eso ya lo garantiza el CHECK de la tabla
//     historial_aptitud_medica).
//
// Diseno: funcion pura que recibe los diagnosticos del trabajador,
// las exposiciones del puesto, y la lista de reglas activas
// (ya leida de la base de datos por el controlador), y devuelve
// las alertas. No hace queries por si mismo, para poder testearlo
// sin base de datos.
// ============================================================

/**
 * Determina si un codigo CIE-10 del trabajador coincide con el
 * patron de una regla.
 *
 * @param {string} codigoDiagnostico - ej: 'G40' o 'G401'
 * @param {string} patron - ej: 'G40' (si tipoCoincidencia='exacto')
 *        o 'F1' (si tipoCoincidencia='prefijo', cubre F10-F19 etc.)
 * @param {'exacto'|'prefijo'} tipoCoincidencia
 */
function coincideConPatron(codigoDiagnostico, patron, tipoCoincidencia) {
  const codigo = codigoDiagnostico.trim().toUpperCase();
  const pat = patron.trim().toUpperCase();

  if (tipoCoincidencia === 'prefijo') {
    return codigo.startsWith(pat);
  }
  // 'exacto': coincide el codigo exacto, o cualquier subcategoria
  // mas especifica del mismo (ej: regla 'G40' coincide con 'G40'
  // Y con 'G401' Epilepsia y sindromes epilepticos sintomaticos,
  // porque G401 ES un tipo de epilepsia). Esto evita que una regla
  // sobre epilepsia en general deje de aplicar solo porque el
  // medico registro la subcategoria especifica en vez del codigo
  // de 3 caracteres.
  return codigo === pat || codigo.startsWith(pat);
}

/**
 * Cruza los diagnosticos de un trabajador y las exposiciones de
 * un puesto contra el catalogo de reglas activas, y devuelve las
 * alertas detectadas.
 *
 * @param {string[]} diagnosticosCie10 - codigos CIE-10 del trabajador
 * @param {string[]} exposicionesPuesto - codigos de catalogo_exposiciones del puesto
 * @param {Array} reglas - filas de reglas_contraindicacion (ya filtradas por activa=true
 *        y por organizacion en el controlador)
 * @returns {Array} alertas: [{ reglaId, nombre, severidad, diagnosticoCoincidente,
 *           exposicionCoincidente, descripcionRiesgo, sugerenciaAccion, fuenteReferencia }]
 */
function detectarContraindicaciones(diagnosticosCie10, exposicionesPuesto, reglas) {
  const alertas = [];

  for (const regla of reglas) {
    if (!exposicionesPuesto.includes(regla.exposicion_codigo)) continue;

    const diagnosticoCoincidente = diagnosticosCie10.find((dx) =>
      coincideConPatron(dx, regla.codigo_cie10_patron, regla.tipo_coincidencia)
    );
    if (!diagnosticoCoincidente) continue;

    alertas.push({
      reglaId: regla.id,
      nombre: regla.nombre,
      severidad: regla.severidad,
      diagnosticoCoincidente,
      exposicionCoincidente: regla.exposicion_codigo,
      descripcionRiesgo: regla.descripcion_riesgo,
      sugerenciaAccion: regla.sugerencia_accion,
      fuenteReferencia: regla.fuente_referencia,
    });
  }

  // Alertas absolutas primero, para que el medico las vea de inmediato.
  alertas.sort((a, b) => (a.severidad === b.severidad ? 0 : a.severidad === 'absoluta' ? -1 : 1));

  return alertas;
}

module.exports = { detectarContraindicaciones, coincideConPatron };
