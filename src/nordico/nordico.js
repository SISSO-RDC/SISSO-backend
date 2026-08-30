// ============================================================
// SISSO - Cuestionario Nordico Estandarizado de sintomas
// musculo-esqueleticos (Kuorinka et al., "Standardised Nordic
// questionnaires for the analysis of musculoskeletal symptoms",
// Applied Ergonomics 1987, 18.3:233-237).
//
// Es una encuesta de AUTO-REPORTE de sintomas (dolor, fatiga,
// disconfort), no una medicion objetiva ni un metodo con formula
// de puntaje como REBA/RULA. Su valor es epidemiologico/preventivo:
// detecta sintomas iniciales ANTES de que se conviertan en una
// enfermedad diagnosticada o de que el trabajador consulte al
// medico. Por eso el resultado de este modulo nunca es un
// "diagnostico" ni una "aptitud": es un conteo de zonas con
// sintomas y una senal de que zonas ameritan seguimiento prioritario
// (para orientar hacia una evaluacion ergonomica mas profunda, ej.
// REBA/RULA del puesto, o consulta medica si corresponde).
//
// Las 9 zonas corporales y las preguntas siguen el cuestionario
// estandar (version extendida de 9 segmentos, la que se usa mas
// ampliamente en estudios de salud ocupacional en Latinoamerica).
// ============================================================

const { validarContraEsquema } = require('../utils/validarEsquemaJson');

const REGIONES = [
  'cuello', 'hombro', 'columna_dorsal', 'columna_lumbar', 'codo',
  'cadera_pierna', 'rodilla', 'tobillo_pie', 'muneca_mano',
];

// Zonas bilaterales: se pregunta tambien el lado afectado.
const REGIONES_BILATERALES = ['hombro', 'codo', 'cadera_pierna', 'rodilla', 'tobillo_pie', 'muneca_mano'];

const ETIQUETAS_REGIONES = {
  cuello: 'Cuello', hombro: 'Hombro', columna_dorsal: 'Columna dorsal', columna_lumbar: 'Columna lumbar',
  codo: 'Codo o antebrazo', cadera_pierna: 'Cadera o pierna', rodilla: 'Rodilla',
  tobillo_pie: 'Tobillo o pie', muneca_mano: 'Muñeca o mano',
};

const OPCIONES_DURACION_EPISODIO = ['menos_1_hora', '1_a_24_horas', '1_a_7_dias', '1_a_4_semanas', 'mas_1_mes'];
const OPCIONES_TIEMPO_TOTAL_12_MESES = ['1_a_7_dias', '8_a_30_dias', 'mas_30_dias_no_seguidos', 'siempre'];
const OPCIONES_TIEMPO_IMPEDIMENTO = ['0_dias', '1_a_7_dias', '1_a_4_semanas', 'mas_1_mes'];
const OPCIONES_LADO = ['izquierdo', 'derecho', 'ambos'];

/**
 * Determina si una zona amerita seguimiento prioritario: molestia
 * intensa (>=4 en escala 0-5), o que ha sido persistente/recurrente
 * a lo largo del ultimo año, o que ha impedido trabajar por un
 * periodo prolongado. Esto NO es un diagnostico, es una senal para
 * orientar la revision (ver nota de cabecera).
 * @param {object} region - respuestas de una zona corporal
 * @returns {boolean}
 */
function requiereSeguimientoPrioritario(region) {
  if (!region || !region.tuvoMolestias12Meses) return false;
  const intensidadAlta = typeof region.intensidad === 'number' && region.intensidad >= 4;
  const persistente = ['mas_30_dias_no_seguidos', 'siempre'].includes(region.tiempoTotal12Meses);
  const impidioTrabajarProlongado = ['1_a_4_semanas', 'mas_1_mes'].includes(region.tiempoImpedimentoTrabajo);
  return intensidadAlta || persistente || impidioTrabajarProlongado;
}

/**
 * Calcula el resumen de un cuestionario completo (las 9 zonas).
 * @param {object} regiones - { cuello: {...}, hombro: {...}, ... }
 * @returns {{ regionesConMolestia12Meses: number, regionesConMolestia7Dias: number,
 *   regionesPrioritarias: string[], requiereAtencionPrioritaria: boolean }}
 */
function calcularResumenNordico(regiones) {
  let con12Meses = 0;
  let con7Dias = 0;
  const prioritarias = [];

  REGIONES.forEach((clave) => {
    const r = regiones ? regiones[clave] : null;
    if (!r) return;
    if (r.tuvoMolestias12Meses) con12Meses++;
    if (r.molestiasUltimos7Dias) con7Dias++;
    if (requiereSeguimientoPrioritario(r)) prioritarias.push(clave);
  });

  return {
    regionesConMolestia12Meses: con12Meses,
    regionesConMolestia7Dias: con7Dias,
    regionesPrioritarias: prioritarias,
    requiereAtencionPrioritaria: prioritarias.length > 0,
  };
}

// CREADO en Auditoria N.12 (hallazgo GRAVE G12-10, P1): esquema tipo
// JSON Schema de una zona del cuestionario (ver
// src/utils/validarEsquemaJson.js). Antes solo se validaba que las
// CLAVES del objeto `regiones` fueran zonas conocidas; el CONTENIDO
// de cada zona (intensidad fuera de 0-5, "lado" con un valor
// arbitrario, etc.) no se validaba y podia corromper en silencio el
// calculo de calcularResumenNordico().
const ESQUEMA_ZONA = {
  type: 'object',
  additionalProperties: false,
  required: ['tuvoMolestias12Meses'],
  properties: {
    tuvoMolestias12Meses: { type: 'boolean' },
    lado: { type: 'string', enum: OPCIONES_LADO },
    duracionEpisodio: { type: 'string', enum: OPCIONES_DURACION_EPISODIO },
    tiempoTotal12Meses: { type: 'string', enum: OPCIONES_TIEMPO_TOTAL_12_MESES },
    tiempoImpedimentoTrabajo: { type: 'string', enum: OPCIONES_TIEMPO_IMPEDIMENTO },
    cambioPuestoTrabajo: { type: 'boolean' },
    recibioTratamiento: { type: 'boolean' },
    molestiasUltimos7Dias: { type: 'boolean' },
    intensidad: { type: 'integer', minimum: 0, maximum: 5 },
    atribucion: { type: 'string' },
  },
};

/**
 * Valida el objeto `regiones` completo (todas las zonas presentes)
 * contra ESQUEMA_ZONA. Solo valida las zonas que el trabajador
 * respondio (no exige las 9 -- un cuestionario puede aplicarse de
 * forma parcial/incremental).
 *
 * @param {object} regiones
 * @returns {string[]} errores (vacio si es valido)
 */
function validarRegionesNordico(regiones) {
  if (!regiones || typeof regiones !== 'object' || Array.isArray(regiones)) {
    return ['regiones: se esperaba un objeto.'];
  }
  const errores = [];
  Object.keys(regiones).forEach((clave) => {
    if (!REGIONES.includes(clave)) {
      errores.push(`regiones.${clave}: zona corporal no reconocida.`);
      return;
    }
    errores.push(...validarContraEsquema(regiones[clave], ESQUEMA_ZONA, `regiones.${clave}`));
  });
  return errores;
}

module.exports = {
  REGIONES, REGIONES_BILATERALES, ETIQUETAS_REGIONES,
  OPCIONES_DURACION_EPISODIO, OPCIONES_TIEMPO_TOTAL_12_MESES, OPCIONES_TIEMPO_IMPEDIMENTO, OPCIONES_LADO,
  requiereSeguimientoPrioritario, calcularResumenNordico,
  validarRegionesNordico,
};
