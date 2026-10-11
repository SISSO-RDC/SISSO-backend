// ============================================================
// SISSO - Calculo de visiometria ocupacional: clasificacion de
// agudeza visual, vision de colores (Ishihara) y aptitud visual.
//
// NATURALEZA DE ESTA PRUEBA: la visiometria ocupacional es una
// PRUEBA TAMIZ (screening), no un examen oftalmologico completo.
// Su proposito es identificar quienes podrian tener una alteracion
// visual relevante para su puesto de trabajo y necesitan una
// evaluacion oftalmologica formal, no dar un diagnostico definitivo.
// Por eso, igual que en espirometria.js (patrones "_sugerido") y
// audiometria.js (deteccion de STS como alerta, no diagnostico),
// aqui las clasificaciones anormales se enmarcan como necesidad de
// "evaluacion complementaria", nunca como diagnostico cerrado.
//
// AGUDEZA VISUAL: se registra en notacion decimal (0.1 a 1.2),
// equivalente a la notacion Snellen mas comun en Latinoamerica
// (1.0 = 20/20, 0.5 = 20/40, 0.1 = 20/200). Se toma por separado
// ojo derecho (OD), ojo izquierdo (OI) y ambos ojos (AO), y con/sin
// correccion optica si el trabajador la usa.
//
// UMBRAL usado (referencia amplia de la practica de medicina
// ocupacional, no una norma legal especifica de un solo pais):
//   - >= 0.5 (20/40) en ambos ojos: umbral general usado con
//     frecuencia en el mundo laboral (aparece explicitamente en
//     requisitos de certificacion de aptitud para trabajo en
//     alturas, por ejemplo).
//   - < 0.1 (20/200) en un ojo, con o sin correccion: se considera
//     "vision monocular o severamente disminuida" y amerita
//     evaluacion oftalmologica antes de definir aptitud para
//     tareas que dependen de vision binocular (conduccion,
//     maquinaria pesada, alturas).
// Estos umbrales son ajustables: si la organizacion sigue una
// norma nacional o interna mas especifica, se puede modificar aqui
// sin tocar el resto del modulo.
//
// VISION DE COLORES (Ishihara): se registra cuantas laminas
// identifico correctamente el trabajador sobre el total de laminas
// usadas (comunmente 14 o 24). Un resultado por debajo del 93% (13
// de 14 aprox.) sugiere una posible discromatopsia (la mas comun,
// rojo-verde) y amerita evaluacion complementaria, especialmente
// relevante para tareas que dependen del reconocimiento de
// senalizacion por colores (electricidad, quimicos, senales de
// seguridad).
// ============================================================

const UMBRAL_AGUDEZA_NORMAL = 0.5; // equivalente aprox. a 20/40
const UMBRAL_AGUDEZA_MONOCULAR_SEVERA = 0.1; // equivalente aprox. a 20/200
const UMBRAL_ISHIHARA_NORMAL_RATIO = 0.93; // ~13/14 laminas correctas

/**
 * Clasifica la agudeza visual de un ojo (o de ambos ojos) segun el
 * mejor valor disponible (con correccion si el trabajador la usa,
 * sin correccion si no la usa).
 * @param {number|null} valor - notacion decimal, 0.1 a 1.2
 * @returns {'normal'|'disminucion_leve'|'disminucion_significativa'|'no_evaluado'}
 */
function clasificarAgudezaOjo(valor) {
  if (valor === null || valor === undefined) return 'no_evaluado';
  if (valor >= UMBRAL_AGUDEZA_NORMAL) return 'normal';
  if (valor >= 0.3) return 'disminucion_leve';
  return 'disminucion_significativa';
}

/**
 * Clasifica el resultado de la prueba de Ishihara.
 * @param {number|null} laminasCorrectas
 * @param {number|null} laminasTotales
 * @returns {'normal'|'sugiere_discromatopsia'|'no_evaluado'}
 */
function clasificarVisionColores(laminasCorrectas, laminasTotales) {
  if (!laminasTotales || laminasCorrectas === null || laminasCorrectas === undefined) return 'no_evaluado';
  const ratio = laminasCorrectas / laminasTotales;
  return ratio >= UMBRAL_ISHIHARA_NORMAL_RATIO ? 'normal' : 'sugiere_discromatopsia';
}

/**
 * Calcula el resultado completo de la visiometria: clasificacion
 * de cada ojo (usando el mejor valor entre con/sin correccion),
 * vision de colores, y una sugerencia de aptitud visual global.
 *
 * @param {object} medidos
 * @param {number|null} medidos.odLejanaSinCorreccion
 * @param {number|null} medidos.odLejanaConCorreccion
 * @param {number|null} medidos.oiLejanaSinCorreccion
 * @param {number|null} medidos.oiLejanaConCorreccion
 * @param {number|null} medidos.aoLejanaSinCorreccion
 * @param {number|null} medidos.aoLejanaConCorreccion
 * @param {boolean} medidos.usaCorreccionOptica
 * @param {number|null} medidos.ishiharaLaminasCorrectas
 * @param {number|null} medidos.ishiharaLaminasTotales
 * @param {string|null} medidos.percepcionProfundidad - 'normal'|'alterada'|'no_evaluado'
 * @returns {object}
 */
function calcularVisiometria(medidos) {
  // El "mejor valor" es el que se usa funcionalmente en el trabajo:
  // si el trabajador usa correccion, es el valor CON correccion; si
  // no la usa, es el valor SIN correccion (no tiene sentido evaluar
  // "sin correccion" a alguien que trabaja siempre con sus lentes).
  const mejorOD = medidos.usaCorreccionOptica
    ? (medidos.odLejanaConCorreccion ?? medidos.odLejanaSinCorreccion)
    : medidos.odLejanaSinCorreccion;
  const mejorOI = medidos.usaCorreccionOptica
    ? (medidos.oiLejanaConCorreccion ?? medidos.oiLejanaSinCorreccion)
    : medidos.oiLejanaSinCorreccion;
  const mejorAO = medidos.usaCorreccionOptica
    ? (medidos.aoLejanaConCorreccion ?? medidos.aoLejanaSinCorreccion)
    : medidos.aoLejanaSinCorreccion;

  const clasificacionOD = clasificarAgudezaOjo(mejorOD);
  const clasificacionOI = clasificarAgudezaOjo(mejorOI);
  const clasificacionAO = clasificarAgudezaOjo(mejorAO);
  const clasificacionColores = clasificarVisionColores(medidos.ishiharaLaminasCorrectas, medidos.ishiharaLaminasTotales);

  const visionMonocularSevera =
    (mejorOD !== null && mejorOD !== undefined && mejorOD < UMBRAL_AGUDEZA_MONOCULAR_SEVERA) ||
    (mejorOI !== null && mejorOI !== undefined && mejorOI < UMBRAL_AGUDEZA_MONOCULAR_SEVERA);

  // Sugerencia de aptitud visual (screening, no diagnostico -- ver
  // nota de cabecera). El medico siempre puede anular este valor
  // sugerido al registrar el examen.
  let aptitudSugerida;
  if (visionMonocularSevera) {
    aptitudSugerida = 'requiere_evaluacion_oftalmologica';
  } else if (clasificacionAO === 'disminucion_significativa' || clasificacionOD === 'disminucion_significativa' || clasificacionOI === 'disminucion_significativa') {
    aptitudSugerida = 'requiere_evaluacion_oftalmologica';
  } else if (clasificacionColores === 'sugiere_discromatopsia' || clasificacionAO === 'disminucion_leve') {
    aptitudSugerida = 'apto_con_restricciones';
  } else if (medidos.usaCorreccionOptica) {
    aptitudSugerida = 'apto_con_correccion_obligatoria';
  } else {
    aptitudSugerida = 'apto';
  }

  return {
    clasificacionOD, clasificacionOI, clasificacionAO, clasificacionColores,
    visionMonocularSevera, aptitudSugerida,
  };
}

module.exports = {
  calcularVisiometria,
  clasificarAgudezaOjo,
  clasificarVisionColores,
  UMBRAL_AGUDEZA_NORMAL,
  UMBRAL_AGUDEZA_MONOCULAR_SEVERA,
  UMBRAL_ISHIHARA_NORMAL_RATIO,
};
