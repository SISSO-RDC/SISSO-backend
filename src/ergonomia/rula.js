// ============================================================
// SISSO - Calculo RULA (Rapid Upper Limb Assessment)
//
// Corrige el error CRITICO #2 senalado en la auditoria:
//
//   "RULA tambien incompleto. La logica es simplificada y no
//    usa tablas reales. Faltan: rotacion muneca, desviacion
//    cubital/radial, fuerza, uso muscular sostenido."
//
// Esta implementacion usa las tablas A, B y C oficiales del
// metodo publicado por McAtamney, L. & Corlett, E.N. (1993).
// "RULA: a survey method for the investigation of work-related
// upper limb disorders". Applied Ergonomics, 24(2), 91-99.
//
// Las matrices numericas se transcribieron y verificaron contra
// la fuente academica de Ergonautas (Universidad Politecnica de
// Valencia, Diego-Mas 2015, https://www.ergonautas.upv.es/metodos/rula/rula-ayuda.php),
// confirmando ademas que la Tabla A tiene exactamente 144 celdas
// (6 brazo x 3 antebrazo x 4 muneca x 2 giro), numero que coincide
// con el reportado independientemente en literatura academica
// (Shafti et al. 2018, "Real-time Robot-assisted Ergonomics",
// arXiv:1805.06270: "the full RULA arm score, 144 different
// ergonomic states exist").
//
// Diseno: igual que en reba.js, cada tabla es una funcion pura
// (sin efectos secundarios, sin acceso a base de datos), para
// poder testear el calculo de forma aislada.
// ============================================================

// ------------------------------------------------------------
// TABLA A oficial: cruza Brazo(1-6) x Antebrazo(1-3) x Muneca(1-4) x GiroMuneca(1-2)
// tablaA[brazo-1][antebrazo-1][(muneca-1)*2 + (giro-1)]
// Cada fila tiene 8 columnas: [M1G1, M1G2, M2G1, M2G2, M3G1, M3G2, M4G1, M4G2]
// Fuente: McAtamney & Corlett (1993), Tabla A, verificada via Ergonautas/UPV.
// ------------------------------------------------------------
const TABLA_A = [
  // Brazo 1
  [
    [1, 2, 2, 2, 2, 3, 3, 3], // Antebrazo 1
    [2, 2, 2, 2, 3, 3, 3, 3], // Antebrazo 2
    [2, 3, 3, 3, 3, 3, 4, 4], // Antebrazo 3
  ],
  // Brazo 2
  [
    [2, 3, 3, 3, 3, 4, 4, 4],
    [3, 3, 3, 3, 3, 4, 4, 4],
    [3, 4, 4, 4, 4, 4, 5, 5],
  ],
  // Brazo 3
  [
    [3, 3, 4, 4, 4, 4, 5, 5],
    [3, 4, 4, 4, 4, 4, 5, 5],
    [4, 4, 4, 4, 4, 5, 5, 5],
  ],
  // Brazo 4
  [
    [4, 4, 4, 4, 4, 5, 5, 5],
    [4, 4, 4, 4, 4, 5, 5, 5],
    [4, 4, 4, 5, 5, 5, 6, 6],
  ],
  // Brazo 5
  [
    [5, 5, 5, 5, 5, 6, 6, 7],
    [5, 6, 6, 6, 6, 7, 7, 7],
    [6, 6, 6, 7, 7, 7, 7, 8],
  ],
  // Brazo 6
  [
    [7, 7, 7, 7, 7, 8, 8, 9],
    [8, 8, 8, 8, 8, 9, 9, 9],
    [9, 9, 9, 9, 9, 9, 9, 9],
  ],
];

// ------------------------------------------------------------
// TABLA B oficial: cruza Cuello(1-6) x Tronco(1-6) x Piernas(1-2)
// tablaB[cuello-1][(tronco-1)*2 + (piernas-1)]
// Cada fila tiene 12 columnas: [T1P1,T1P2, T2P1,T2P2, ..., T6P1,T6P2]
// Fuente: McAtamney & Corlett (1993), Tabla B, verificada via Ergonautas/UPV.
// ------------------------------------------------------------
const TABLA_B = [
  [1, 3, 2, 3, 3, 4, 5, 5, 6, 6, 7, 7], // Cuello 1
  [2, 3, 2, 3, 4, 5, 5, 5, 6, 7, 7, 7], // Cuello 2
  [3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 7], // Cuello 3
  [5, 5, 5, 6, 6, 7, 7, 7, 7, 7, 8, 8], // Cuello 4
  [7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8], // Cuello 5
  [8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9], // Cuello 6
];

// ------------------------------------------------------------
// TABLA C oficial: cruza Puntuacion C (Grupo A modificado, 1-8+) x
// Puntuacion D (Grupo B modificado, 1-7+)
// tablaC[C-1][D-1]. Si C u D exceden el rango, se usa la ultima fila/columna.
// Fuente: McAtamney & Corlett (1993), Tabla C, confirmada de forma idéntica
// por 3 fuentes independientes (ergo.human.cornell.edu, scribd, studocu).
// ------------------------------------------------------------
const TABLA_C = [
  [1, 2, 3, 3, 4, 5, 5], // C=1
  [2, 2, 3, 4, 4, 5, 5], // C=2
  [3, 3, 3, 4, 4, 5, 6], // C=3
  [3, 3, 3, 4, 5, 6, 6], // C=4
  [4, 4, 4, 5, 6, 7, 7], // C=5
  [4, 4, 5, 6, 6, 7, 7], // C=6
  [5, 5, 6, 6, 7, 7, 7], // C=7
  [5, 5, 6, 7, 7, 7, 7], // C=8 (8+)
];

// ------------------------------------------------------------
// Mapeo de los niveles legibles (los que guarda la BD) a las
// puntuaciones base de cada tabla oficial.
// ------------------------------------------------------------
const PUNTUACION_BRAZO = {
  extension_20_a_flexion_20: 1,
  extension_mayor_20_o_flexion_20_45: 2,
  flexion_45_90: 3,
  flexion_mayor_90: 4,
};

const PUNTUACION_ANTEBRAZO = {
  flexion_60_100: 1,
  flexion_menor_60_o_mayor_100: 2,
};

const PUNTUACION_MUNECA = {
  posicion_neutra: 1,
  flexion_o_extension_0_15: 2,
  flexion_o_extension_mayor_15: 3,
};

const PUNTUACION_GIRO_MUNECA = {
  rango_medio: 1,
  rango_extremo: 2,
};

const PUNTUACION_CUELLO = {
  flexion_0_10: 1,
  flexion_10_20: 2,
  flexion_mayor_20: 3,
  extension: 4,
};

const PUNTUACION_TRONCO = {
  erguido_o_sentado_apoyado: 1,
  flexion_0_20: 2,
  flexion_20_60: 3,
  flexion_mayor_60: 4,
};

// Tabla 16 del metodo: incremento por carga/fuerza ejercida.
// Idéntica estructura para Grupo A y Grupo B.
const PUNTUACION_FUERZA_CARGA = {
  menor_2kg_intermitente: 0,
  entre_2_10kg_intermitente: 1,
  entre_2_10kg_estatico_o_repetido: 2,
  mayor_10kg_o_repetido_o_brusco: 3,
};

// ------------------------------------------------------------
// Calcula la puntuacion del GRUPO A para UN lado: brazo +
// antebrazo + muneca + giro de muneca, consultando la Tabla A,
// y luego sumando el modificador de musculo y fuerza/carga
// (que es el MISMO para ambos lados, segun el metodo).
// ------------------------------------------------------------
function calcularPuntuacionALado(input, lado) {
  const sufijoBrazo = lado === 'derecho' ? '_derecho' : '_izquierdo';
  const sufijoMuneca = lado === 'derecho' ? '_derecha' : '_izquierda';

  let brazo = PUNTUACION_BRAZO[input[`brazo${sufijoBrazo}`]];
  if (input[`brazo${sufijoBrazo}_hombro_elevado`]) brazo += 1;
  if (input[`brazo${sufijoBrazo}_abducido`]) brazo += 1;
  if (input[`brazo${sufijoBrazo}_apoyado`]) brazo -= 1;
  brazo = Math.max(1, Math.min(brazo, 6));

  let antebrazo = PUNTUACION_ANTEBRAZO[input[`antebrazo${sufijoBrazo}`]];
  if (input[`antebrazo${sufijoBrazo}_cruza_linea_media`]) antebrazo += 1;
  antebrazo = Math.min(antebrazo, 3);

  let muneca = PUNTUACION_MUNECA[input[`muneca${sufijoMuneca}`]];
  if (input[`muneca${sufijoMuneca}_desviacion_radial_cubital`]) muneca += 1;
  muneca = Math.min(muneca, 4);

  const giro = PUNTUACION_GIRO_MUNECA[input[`muneca${sufijoMuneca}_rotacion`]];

  // Indice de columna: (muneca-1)*2 + (giro-1), rango 0-7 (8 columnas)
  const columnaIndex = (muneca - 1) * 2 + (giro - 1);
  const baseA = TABLA_A[brazo - 1][antebrazo - 1][columnaIndex];

  const musculo = input.grupo_a_musculo_estatico_o_repetido ? 1 : 0;
  const fuerza = PUNTUACION_FUERZA_CARGA[input.grupo_a_fuerza_carga];

  return {
    puntuacionA: baseA + musculo + fuerza,
    detalle: { brazo, antebrazo, muneca, giro, baseA, musculo, fuerza },
  };
}

// ------------------------------------------------------------
// Calcula la puntuacion del GRUPO B: cuello + tronco + piernas,
// consultando la Tabla B, mas el modificador de musculo y
// fuerza/carga del Grupo B.
// ------------------------------------------------------------
function calcularPuntuacionB(input) {
  let cuello = PUNTUACION_CUELLO[input.cuello];
  if (input.cuello_torsion) cuello += 1;
  if (input.cuello_inclinacion_lateral) cuello += 1;
  cuello = Math.min(cuello, 6);

  let tronco = PUNTUACION_TRONCO[input.tronco];
  if (input.tronco_torsion) tronco += 1;
  if (input.tronco_inclinacion_lateral) tronco += 1;
  tronco = Math.min(tronco, 6);

  const piernas = input.piernas_bien_apoyadas ? 1 : 2;

  // Indice de columna: (tronco-1)*2 + (piernas-1), rango 0-11 (12 columnas)
  const columnaIndex = (tronco - 1) * 2 + (piernas - 1);
  const baseB = TABLA_B[cuello - 1][columnaIndex];

  const musculo = input.grupo_b_musculo_estatico_o_repetido ? 1 : 0;
  const fuerza = PUNTUACION_FUERZA_CARGA[input.grupo_b_fuerza_carga];

  return {
    puntuacionB: baseB + musculo + fuerza,
    detalle: { cuello, tronco, piernas, baseB, musculo, fuerza },
  };
}

// ------------------------------------------------------------
// Tabla 18 del metodo: niveles de actuacion segun puntuacion final.
// ------------------------------------------------------------
function nivelDeRiesgo(puntuacionFinal) {
  if (puntuacionFinal <= 2) {
    return { nivel: 'aceptable', accion: 'Riesgo aceptable. No son necesarios cambios.' };
  }
  if (puntuacionFinal <= 4) {
    return {
      nivel: 'puede_requerir_cambios',
      accion: 'Pueden requerirse cambios en la tarea; es conveniente profundizar en el estudio.',
    };
  }
  if (puntuacionFinal <= 6) {
    return { nivel: 'requiere_cambios_pronto', accion: 'Se requiere el rediseño de la tarea.' };
  }
  // 7 o mas (la escala original llega hasta 7 como maximo)
  return { nivel: 'requiere_cambios_ya', accion: 'Se requieren cambios urgentes en la tarea.' };
}

/**
 * Calcula el resultado RULA completo a partir de los inputs de
 * postura observados por el evaluador.
 *
 * @param {object} input - campos de postura en snake_case (ver
 *                          migration_005 / validacion.js).
 * @returns {object} resultado con puntuacionADerecha, puntuacionAIzquierda,
 *                    puntuacionB, puntuacionC (final), nivelRiesgo,
 *                    accionRequerida, ladoEvaluado, y detalle para trazabilidad.
 */
function calcularRula(input) {
  const resultadoADerecho = calcularPuntuacionALado(input, 'derecho');
  const resultadoAIzquierdo = calcularPuntuacionALado(input, 'izquierdo');
  const resultadoB = calcularPuntuacionB(input);

  // El metodo exige usar, para la Tabla C, el lado con la
  // puntuacion A MAS DESFAVORABLE (mas alta), igual que en REBA.
  const ladoEvaluado =
    resultadoADerecho.puntuacionA === resultadoAIzquierdo.puntuacionA
      ? 'ambos_iguales'
      : resultadoADerecho.puntuacionA > resultadoAIzquierdo.puntuacionA
        ? 'derecho'
        : 'izquierdo';

  const puntuacionAMasAlta = Math.max(resultadoADerecho.puntuacionA, resultadoAIzquierdo.puntuacionA);

  // Tabla C: filas = Puntuacion C (Grupo A modificado), columnas = Puntuacion D
  // (Grupo B modificado). Ambas se acotan a 1-8 y 1-7 respectivamente, usando
  // la ultima fila/columna para cualquier valor mayor (regla "8+" / "7+" del
  // metodo original).
  const cParaTablaC = Math.max(1, Math.min(puntuacionAMasAlta, 8));
  const dParaTablaC = Math.max(1, Math.min(resultadoB.puntuacionB, 7));

  const puntuacionFinal = TABLA_C[cParaTablaC - 1][dParaTablaC - 1];

  const { nivel, accion } = nivelDeRiesgo(puntuacionFinal);

  return {
    puntuacionADerecha: resultadoADerecho.puntuacionA,
    puntuacionAIzquierda: resultadoAIzquierdo.puntuacionA,
    puntuacionB: resultadoB.puntuacionB,
    puntuacionC: puntuacionFinal,
    nivelRiesgo: nivel,
    accionRequerida: accion,
    ladoEvaluado,
    detalle: {
      grupoADerecho: resultadoADerecho.detalle,
      grupoAIzquierdo: resultadoAIzquierdo.detalle,
      grupoB: resultadoB.detalle,
    },
  };
}

module.exports = {
  calcularRula,
  TABLA_A,
  TABLA_B,
  TABLA_C,
  calcularPuntuacionALado,
  calcularPuntuacionB,
  nivelDeRiesgo,
};
