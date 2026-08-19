// ============================================================
// SISSO - Calculo REBA (Rapid Entire Body Assessment)
//
// Corrige el error CRITICO #1 senalado en la auditoria:
//
//   "El calculo REBA usa una formula simplificada:
//    score = Math.min(Math.round((A+B)/2)+1, 15)
//    REBA real NO se calcula asi. Usa matrices A/B/C con
//    factores cruzados: carga, acoplamiento, actividad,
//    posturas combinadas."
//
// Esta implementacion usa las tablas A, B y C oficiales del
// metodo publicado por Hignett, S. & McAtamney, L. (2000).
// "Rapid Entire Body Assessment (REBA)". Applied Ergonomics,
// 31(2), 201-205.
//
// Diseno: cada tabla es una funcion pura (sin efectos
// secundarios, sin acceso a base de datos). Esto permite
// testear el calculo de forma aislada y reutilizarlo tanto
// desde el controlador HTTP como desde un futuro script de
// validacion/test.
// ============================================================

// ------------------------------------------------------------
// TABLA A oficial: cruza Tronco (1-5) x Cuello (1-3) x Piernas (1-4)
// Filas = piernas, Columnas = [cuello1, cuello2, cuello3] por cada tronco
// Fuente: Hignett & McAtamney (2000), Tabla A.
// tablaA[tronco-1][piernas-1][cuello-1]
// ------------------------------------------------------------
const TABLA_A = [
  // Tronco 1
  [
    [1, 2, 3],
    [2, 3, 4],
    [3, 4, 5],
    [4, 5, 6],
  ],
  // Tronco 2
  [
    [2, 3, 4],
    [3, 4, 5],
    [4, 5, 6],
    [5, 6, 7],
  ],
  // Tronco 3
  [
    [2, 4, 5],
    [4, 5, 6],
    [5, 6, 7],
    [6, 7, 8],
  ],
  // Tronco 4
  [
    [3, 5, 6],
    [5, 6, 7],
    [6, 7, 8],
    [7, 8, 9],
  ],
  // Tronco 5
  [
    [4, 6, 7],
    [6, 7, 8],
    [7, 8, 9],
    [8, 9, 9],
  ],
];

// ------------------------------------------------------------
// TABLA B oficial: cruza Brazo (1-6) x Antebrazo (1-2) x Muneca (1-3)
// tablaB[brazo-1][antebrazo-1][muneca-1]
// Fuente: Hignett & McAtamney (2000), Tabla B.
// ------------------------------------------------------------
const TABLA_B = [
  // Brazo 1
  [
    [1, 2, 2],
    [1, 2, 3],
  ],
  // Brazo 2
  [
    [1, 2, 3],
    [2, 3, 4],
  ],
  // Brazo 3
  [
    [3, 4, 5],
    [4, 5, 5],
  ],
  // Brazo 4
  [
    [4, 5, 5],
    [5, 6, 7],
  ],
  // Brazo 5
  [
    [6, 7, 8],
    [7, 8, 8],
  ],
  // Brazo 6
  [
    [7, 8, 8],
    [8, 9, 9],
  ],
];

// ------------------------------------------------------------
// TABLA C oficial: cruza puntuacion A (1-12) x puntuacion B (1-12)
// tablaC[A-1][B-1]
// Fuente: Hignett & McAtamney (2000), Tabla C.
// ------------------------------------------------------------
const TABLA_C = [
  [1, 1, 1, 2, 3, 3, 4, 5, 6, 7, 7, 7],
  [1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 7, 8],
  [2, 3, 3, 3, 4, 5, 6, 7, 7, 8, 8, 8],
  [3, 4, 4, 4, 5, 6, 7, 8, 8, 9, 9, 9],
  [4, 4, 4, 5, 6, 7, 8, 8, 9, 9, 9, 9],
  [6, 6, 6, 7, 8, 8, 9, 9, 10, 10, 10, 10],
  [7, 7, 7, 8, 9, 9, 9, 10, 10, 11, 11, 11],
  [8, 8, 8, 9, 10, 10, 10, 10, 10, 11, 11, 11],
  [9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12, 12],
  [10, 10, 10, 11, 11, 11, 11, 12, 12, 12, 12, 12],
  [11, 11, 11, 11, 12, 12, 12, 12, 12, 12, 12, 12],
  [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12],
];

// ------------------------------------------------------------
// Mapeo de los niveles legibles (los que guarda la BD) a las
// puntuaciones base de cada tabla oficial.
// ------------------------------------------------------------
const PUNTUACION_TRONCO = {
  erguido: 1,
  flexion_0_20: 2, // incluye extension 0-20 tambien, segun el metodo original
  extension_mayor_20: 3,
  flexion_20_60: 3,
  flexion_mayor_60: 4,
};

const PUNTUACION_CUELLO = {
  flexion_0_20: 1,
  flexion_mayor_20_o_extension: 2,
};

const PUNTUACION_PIERNAS_BASE = {
  soporte_bilateral_estable: 1,
  soporte_unilateral_inestable: 2,
};

const PUNTUACION_FLEXION_RODILLA = {
  ninguna: 0,
  flexion_30_60: 1,
  flexion_mayor_60: 2,
};

const PUNTUACION_CARGA_FUERZA = {
  menor_5kg: 0,
  entre_5_10kg: 1,
  mayor_10kg: 2,
};

const PUNTUACION_BRAZO = {
  extension_20_o_flexion_0_20: 1,
  extension_mayor_20_o_flexion_20_45: 2,
  flexion_45_90: 3,
  flexion_mayor_90: 4,
};

const PUNTUACION_ANTEBRAZO = {
  flexion_60_100: 1,
  flexion_menor_60_o_mayor_100: 2,
};

const PUNTUACION_MUNECA = {
  flexion_0_15: 1,
  flexion_mayor_15: 2,
};

const PUNTUACION_AGARRE = {
  bueno: 0,
  regular: 1,
  malo: 2,
  inaceptable: 3,
};

// ------------------------------------------------------------
// Calcula la puntuacion del GRUPO A: tronco + cuello + piernas,
// ya con los modificadores de torsion/inclinacion y el
// modificador de carga/fuerza aplicado.
// ------------------------------------------------------------
function calcularPuntuacionA(input) {
  let tronco = PUNTUACION_TRONCO[input.tronco];
  if (input.tronco_torsion_lateral) tronco += 1;

  let cuello = PUNTUACION_CUELLO[input.cuello];
  if (input.cuello_torsion_lateral) cuello += 1;

  let piernas = PUNTUACION_PIERNAS_BASE[input.piernas] + PUNTUACION_FLEXION_RODILLA[input.piernas_flexion_rodilla];

  // Las tablas A oficiales solo cubren tronco 1-5, cuello 1-3, piernas 1-4.
  // Los modificadores de torsion pueden empujar el valor fuera de rango;
  // se acota (clamp) al maximo de la tabla, tal como se hace en la
  // practica clinica con el metodo en papel.
  tronco = Math.min(tronco, 5);
  cuello = Math.min(cuello, 3);
  piernas = Math.min(piernas, 4);

  const baseA = TABLA_A[tronco - 1][piernas - 1][cuello - 1];

  let fuerza = PUNTUACION_CARGA_FUERZA[input.carga_fuerza];
  if (input.carga_brusca_o_rapida) fuerza += 1;

  return {
    puntuacionA: baseA + fuerza,
    detalle: { tronco, cuello, piernas, baseA, fuerza },
  };
}

// ------------------------------------------------------------
// Calcula la puntuacion del GRUPO B para UN lado (brazo +
// antebrazo + muneca), con sus modificadores y el modificador
// de agarre/acoplamiento aplicado.
// ------------------------------------------------------------
function calcularPuntuacionBLado(input, lado) {
  const sufijo = lado === 'derecho' ? '_derecho' : '_izquierdo';

  let brazo = PUNTUACION_BRAZO[input[`brazo${sufijo}`]];
  if (input[`brazo${sufijo}_abduccion_o_rotacion`]) brazo += 1;
  if (input[`brazo${sufijo}_apoyado`]) brazo -= 1;
  brazo = Math.max(1, Math.min(brazo, 6));

  const antebrazo = PUNTUACION_ANTEBRAZO[input[`antebrazo${sufijo}`]];

  let muneca = PUNTUACION_MUNECA[input[`muneca${lado === 'derecho' ? '_derecha' : '_izquierda'}`]];
  if (input[`muneca${lado === 'derecho' ? '_derecha' : '_izquierda'}_torsion_o_desviacion`]) muneca += 1;
  muneca = Math.min(muneca, 3);

  const baseB = TABLA_B[brazo - 1][antebrazo - 1][muneca - 1];

  const agarre = PUNTUACION_AGARRE[input.agarre];

  return {
    puntuacionB: baseB + agarre,
    detalle: { brazo, antebrazo, muneca, baseB, agarre },
  };
}

// ------------------------------------------------------------
// Calcula el modificador de actividad (0 a 3), sumando cada
// condicion que aplique. No son mutuamente excluyentes.
// ------------------------------------------------------------
function calcularPuntuacionActividad(input) {
  let total = 0;
  if (input.actividad_posturas_estaticas) total += 1;
  if (input.actividad_movimientos_repetidos) total += 1;
  if (input.actividad_cambios_posturales_rapidos) total += 1;
  return total;
}

// ------------------------------------------------------------
// Tabla de niveles de riesgo y accion requerida, segun el
// metodo original (rangos oficiales de puntuacion final REBA).
// ------------------------------------------------------------
function nivelDeRiesgo(puntuacionFinal) {
  if (puntuacionFinal === 1) {
    return { nivel: 'inapreciable', accion: 'Riesgo inapreciable. No se requiere actuacion.' };
  }
  if (puntuacionFinal >= 2 && puntuacionFinal <= 3) {
    return { nivel: 'bajo', accion: 'Riesgo bajo. Puede ser necesaria una actuacion.' };
  }
  if (puntuacionFinal >= 4 && puntuacionFinal <= 7) {
    return { nivel: 'medio', accion: 'Riesgo medio. Es necesaria una actuacion.' };
  }
  if (puntuacionFinal >= 8 && puntuacionFinal <= 10) {
    return { nivel: 'alto', accion: 'Riesgo alto. Es necesaria una actuacion pronto.' };
  }
  // 11 a 15
  return { nivel: 'muy_alto', accion: 'Riesgo muy alto. Es necesaria la actuacion de inmediato.' };
}

/**
 * Calcula el resultado REBA completo a partir de los inputs de
 * postura observados por el evaluador.
 *
 * @param {object} input - campos de postura (ver migration_004 / validacion.js
 *                          para la lista completa de campos esperados).
 * @returns {object} resultado con puntuacionA, puntuacionB (ambos lados),
 *                    puntuacionC, puntuacionActividad, puntuacionFinal,
 *                    nivelRiesgo, accionRequerida, ladoUsadoParaCalculo,
 *                    y un objeto `detalle` para trazabilidad/depuracion.
 */
function calcularReba(input) {
  const resultadoA = calcularPuntuacionA(input);

  const resultadoBDerecho = calcularPuntuacionBLado(input, 'derecho');
  const resultadoBIzquierdo = calcularPuntuacionBLado(input, 'izquierdo');

  // El metodo exige usar, para la Tabla C, el lado con la
  // puntuacion B MAS DESFAVORABLE (mas alta), no un promedio.
  const ladoUsadoParaCalculo =
    resultadoBDerecho.puntuacionB === resultadoBIzquierdo.puntuacionB
      ? 'ambos_iguales'
      : resultadoBDerecho.puntuacionB > resultadoBIzquierdo.puntuacionB
        ? 'derecho'
        : 'izquierdo';

  const puntuacionBMasAlta = Math.max(resultadoBDerecho.puntuacionB, resultadoBIzquierdo.puntuacionB);

  // Las tablas oficiales A y B se acotan en 1-12 antes de entrar a la Tabla C.
  const aParaTablaC = Math.max(1, Math.min(resultadoA.puntuacionA, 12));
  const bParaTablaC = Math.max(1, Math.min(puntuacionBMasAlta, 12));

  const puntuacionC = TABLA_C[aParaTablaC - 1][bParaTablaC - 1];

  const puntuacionActividad = calcularPuntuacionActividad(input);

  const puntuacionFinal = Math.min(puntuacionC + puntuacionActividad, 15);

  const { nivel, accion } = nivelDeRiesgo(puntuacionFinal);

  return {
    puntuacionA: resultadoA.puntuacionA,
    puntuacionBDerecho: resultadoBDerecho.puntuacionB,
    puntuacionBIzquierdo: resultadoBIzquierdo.puntuacionB,
    puntuacionC,
    puntuacionActividad,
    puntuacionFinal,
    nivelRiesgo: nivel,
    accionRequerida: accion,
    ladoEvaluado: ladoUsadoParaCalculo,
    detalle: {
      grupoA: resultadoA.detalle,
      grupoBDerecho: resultadoBDerecho.detalle,
      grupoBIzquierdo: resultadoBIzquierdo.detalle,
    },
  };
}

module.exports = {
  calcularReba,
  // se exportan tambien las tablas y funciones internas para
  // poder escribir tests unitarios contra casos conocidos del
  // metodo original sin tener que pasar por toda la funcion.
  TABLA_A,
  TABLA_B,
  TABLA_C,
  calcularPuntuacionA,
  calcularPuntuacionBLado,
  calcularPuntuacionActividad,
  nivelDeRiesgo,
};
