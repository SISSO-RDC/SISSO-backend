// ============================================================
// SISSO - Ecuacion NIOSH revisada (Waters, Putz-Anderson, Garg,
// Fine, 1994; "Applications Manual for the Revised NIOSH Lifting
// Equation", NIOSH Publication 94-110) para evaluar el riesgo de
// levantamiento manual de cargas.
//
// RWL = LC x HM x VM x DM x AM x FM x CM
// LI  = Peso de la carga / RWL
//
// Unidades metricas (cm, kg), version usada en Latinoamerica:
//   LC = 23 kg (constante de carga)
//   HM = 25/H                          (H = distancia horizontal, cm)
//   VM = 1 - 0.003*|V-75|              (V = altura de manos al origen, cm)
//   DM = 0.82 + 4.5/D                  (D = distancia vertical recorrida, cm)
//   AM = 1 - 0.0032*A                  (A = angulo de asimetria/giro, grados)
//   FM = tabla (frecuencia, duracion, V)
//   CM = tabla (calidad del agarre, V)
//
// HM, VM, DM, AM se calculan con las FORMULAS CONTINUAS (no con las
// tablas discretizadas en incrementos de 5cm/15 grados que aparecen
// en el manual original de NIOSH para uso en papel sin calculadora).
// Esto es lo que hace cualquier calculadora NIOSH digital seria (la
// version discretizada en papel es una aproximacion de las formulas
// continuas, pensada para quien no tiene una calculadora a mano; el
// sistema SI la tiene, asi que se usa la formula exacta). Puede
// haber diferencias menores (decimas) respecto a un calculo hecho a
// mano con las tablas de papel, especialmente en los limites entre
// filas de esas tablas -esto es un efecto esperado y documentado de
// esa discretizacion, no un error de este modulo.
//
// FM y CM SI son estrictamente tablas (no existe formula continua
// para ellas en la ecuacion original), tomadas del "Applications
// Manual for the Revised NIOSH Lifting Equation" (Tablas 5 y 7).
// ============================================================

const LC = 23; // kg

// ------------------------------------------------------------
// Multiplicadores continuos
// ------------------------------------------------------------

/** HM: Horizontal Multiplier. H en cm, valido 25<=H<=63. */
function calcularHM(H) {
  if (H === null || H === undefined) return null;
  if (H < 25) H = 25; // no se penaliza mas alla del minimo practico
  if (H > 63) return 0; // fuera de alcance razonable: RWL = 0
  return Math.round((25 / H) * 1000) / 1000;
}

/** VM: Vertical Multiplier. V en cm (altura de las manos al piso), valido 0<=V<=175. */
function calcularVM(V) {
  if (V === null || V === undefined) return null;
  if (V < 0) V = 0;
  if (V > 175) return 0;
  return Math.round((1 - 0.003 * Math.abs(V - 75)) * 1000) / 1000;
}

/** DM: Distance Multiplier. D en cm (recorrido vertical), valido 25<=D<=175. */
function calcularDM(D) {
  if (D === null || D === undefined) return null;
  if (D < 25) D = 25; // desplazamientos menores a 25cm se tratan como 25cm
  if (D > 175) return 0;
  return Math.round((0.82 + 4.5 / D) * 1000) / 1000;
}

/** AM: Asymmetric Multiplier. A en grados, valido 0<=A<=135. */
function calcularAM(A) {
  if (A === null || A === undefined) return null;
  if (A < 0) A = 0;
  if (A > 135) return 0;
  return Math.round((1 - 0.0032 * A) * 1000) / 1000;
}

// ------------------------------------------------------------
// FM: Frequency Multiplier (Tabla 5 del Applications Manual).
// Claves de frecuencia: se usa la fila de F (lifts/min) igual o
// inmediatamente superior a la indicada (aproximacion estandar
// cuando F no calza exacto con las filas publicadas).
// ------------------------------------------------------------
const TABLA_FM = [
  // F(lifts/min), [V<75: <=1h, >1-2h, >2-8h], [V>=75: <=1h, >1-2h, >2-8h]
  { f: 0.2, menor75: [1.00, 0.95, 0.85], mayorIgual75: [1.00, 0.95, 0.85] },
  { f: 0.5, menor75: [0.97, 0.92, 0.81], mayorIgual75: [0.97, 0.92, 0.81] },
  { f: 1,   menor75: [0.94, 0.88, 0.75], mayorIgual75: [0.94, 0.88, 0.75] },
  { f: 2,   menor75: [0.91, 0.84, 0.65], mayorIgual75: [0.91, 0.84, 0.65] },
  { f: 3,   menor75: [0.88, 0.79, 0.55], mayorIgual75: [0.88, 0.79, 0.55] },
  { f: 4,   menor75: [0.84, 0.72, 0.45], mayorIgual75: [0.84, 0.72, 0.45] },
  { f: 5,   menor75: [0.80, 0.60, 0.35], mayorIgual75: [0.80, 0.60, 0.35] },
  { f: 6,   menor75: [0.75, 0.50, 0.27], mayorIgual75: [0.75, 0.50, 0.27] },
  { f: 7,   menor75: [0.70, 0.42, 0.22], mayorIgual75: [0.70, 0.42, 0.22] },
  { f: 8,   menor75: [0.60, 0.35, 0.18], mayorIgual75: [0.60, 0.35, 0.18] },
  { f: 9,   menor75: [0.52, 0.30, 0.00], mayorIgual75: [0.52, 0.30, 0.15] },
  { f: 10,  menor75: [0.45, 0.26, 0.00], mayorIgual75: [0.45, 0.26, 0.13] },
  { f: 11,  menor75: [0.41, 0.00, 0.00], mayorIgual75: [0.41, 0.23, 0.00] },
  { f: 12,  menor75: [0.37, 0.00, 0.00], mayorIgual75: [0.37, 0.21, 0.00] },
  { f: 13,  menor75: [0.00, 0.00, 0.00], mayorIgual75: [0.34, 0.00, 0.00] },
  { f: 14,  menor75: [0.00, 0.00, 0.00], mayorIgual75: [0.31, 0.00, 0.00] },
  { f: 15,  menor75: [0.00, 0.00, 0.00], mayorIgual75: [0.28, 0.00, 0.00] },
];

const INDICE_DURACION = { corta: 0, media: 1, larga: 2 }; // <=1h, >1-2h, >2-8h

/**
 * FM: Frequency Multiplier.
 * @param {number} F - frecuencia de levantamientos por minuto
 * @param {'corta'|'media'|'larga'} duracion - <=1h, >1-2h(moderada), >2-8h(larga)
 * @param {number} V - altura de manos al origen (cm), para saber si V<75 o V>=75
 * @returns {number}
 */
function obtenerFM(F, duracion, V) {
  if (F === null || F === undefined) return null;
  if (F > 15) return 0;
  const idxDuracion = INDICE_DURACION[duracion];
  if (idxDuracion === undefined) return null;

  // Se toma la primera fila cuyo F de tabla sea >= F solicitado
  // (aproximacion conservadora estandar para frecuencias intermedias).
  const fila = TABLA_FM.find(r => F <= r.f) || TABLA_FM[TABLA_FM.length - 1];
  const columna = (V !== null && V !== undefined && V >= 75) ? fila.mayorIgual75 : fila.menor75;
  return columna[idxDuracion];
}

// ------------------------------------------------------------
// CM: Coupling Multiplier (Tabla 7 del Applications Manual).
// ------------------------------------------------------------
const TABLA_CM = {
  bueno:   { menor75: 1.00, mayorIgual75: 1.00 },
  regular: { menor75: 1.00, mayorIgual75: 0.95 },
  malo:    { menor75: 0.90, mayorIgual75: 0.90 },
};

/**
 * CM: Coupling Multiplier.
 * @param {'bueno'|'regular'|'malo'} calidad
 * @param {number} V
 * @returns {number}
 */
function obtenerCM(calidad, V) {
  const fila = TABLA_CM[calidad];
  if (!fila) return null;
  return (V !== null && V !== undefined && V >= 75) ? fila.mayorIgual75 : fila.menor75;
}

// ------------------------------------------------------------
// Interpretacion del Indice de Levantamiento (LI = Peso/RWL).
// Criterio ampliamente usado en la practica de ergonomia (Waters
// et al. 1993 establecen LI<=1 como el umbral principal de
// referencia; la graduacion en mas bandas -moderado/alto/muy alto-
// es una convencion posterior comun en software y guias de
// entrenamiento, no una segunda formula NIOSH distinta).
// ------------------------------------------------------------
function clasificarLI(li) {
  if (li === null || li === undefined) return 'no_calculable';
  if (li <= 1.0) return 'aceptable';
  if (li <= 2.0) return 'riesgo_moderado';
  if (li <= 3.0) return 'riesgo_alto';
  return 'riesgo_muy_alto';
}

/**
 * Calcula el resultado completo de la ecuacion NIOSH para una tarea
 * de levantamiento (origen). Si se proporcionan datos de destino
 * (opcional), se puede calcular tambien el LI de destino, aunque en
 * esta primera version solo se implementa el analisis de tarea
 * simple (single-task), el mas comun en la practica.
 *
 * @param {object} datos
 * @param {number} datos.horizontal - H, cm
 * @param {number} datos.vertical - V, cm
 * @param {number} datos.distanciaVertical - D, cm
 * @param {number} datos.anguloAsimetria - A, grados
 * @param {number} datos.frecuencia - F, levantamientos/min
 * @param {'corta'|'media'|'larga'} datos.duracion
 * @param {'bueno'|'regular'|'malo'} datos.calidadAgarre
 * @param {number} datos.pesoCarga - kg
 * @returns {object}
 */
function calcularNiosh(datos) {
  const HM = calcularHM(datos.horizontal);
  const VM = calcularVM(datos.vertical);
  const DM = calcularDM(datos.distanciaVertical);
  const AM = calcularAM(datos.anguloAsimetria);
  const FM = obtenerFM(datos.frecuencia, datos.duracion, datos.vertical);
  const CM = obtenerCM(datos.calidadAgarre, datos.vertical);

  const factores = [HM, VM, DM, AM, FM, CM];
  const algunoInvalido = factores.some(f => f === null || f === undefined);

  if (algunoInvalido) {
    return { HM, VM, DM, AM, FM, CM, RWL: null, LI: null, clasificacion: 'no_calculable' };
  }

  const RWL = Math.round(LC * HM * VM * DM * AM * FM * CM * 100) / 100;
  const LI = (datos.pesoCarga && RWL > 0) ? Math.round((datos.pesoCarga / RWL) * 100) / 100 : null;

  return { HM, VM, DM, AM, FM, CM, RWL, LI, clasificacion: clasificarLI(LI) };
}

module.exports = {
  LC, calcularHM, calcularVM, calcularDM, calcularAM, obtenerFM, obtenerCM,
  clasificarLI, calcularNiosh,
};
