// ============================================================
// SISSO - Calculo de espirometria: valores predichos, limite
// inferior de la normalidad (LLN), clasificacion de patron
// ventilatorio y reversibilidad post-broncodilatador.
//
// ECUACIONES DE REFERENCIA: ECSC/ERS 1993 (Quanjer PH, Tammeling
// GJ, Cotes JE, Pedersen OF, Peslin R, Yernault JC. "Lung volumes
// and forced ventilatory flows". Report Working Party
// Standardization of Lung Function Tests, European Community for
// Steel and Coal. Official Statement of the European Respiratory
// Society. Eur Respir J. 1993;6(Suppl 16):5-40).
//
// DECISION DE DISENO (documentada en la auditoria previa): se usan
// las ecuaciones ECSC/ERS 1993 (lineales, sexo/edad/talla) en vez
// de GLI-2012 porque GLI-2012 requiere splines LMS (tablas de
// lookup con look-up de percentiles por edad) cuya implementacion
// directa en JS produjo resultados incorrectos en pruebas previas.
// ECSC/ERS 1993 sigue siendo ampliamente usada en espirometros
// clinicos (Vitalograph, MIR, Jaeger) y es valida para adultos
// 18-70 anios aproximadamente.
//
// INTERPRETACION: sigue el algoritmo ATS/ERS 2005 ("Interpretative
// strategies for lung function tests", Eur Respir J 2005;26:948-968):
//   1. Obstruccion: FEV1/FVC por debajo del limite de corte.
//   2. Restriccion SUGERIDA (no confirmada): FVC < LLN con
//      FEV1/FVC normal. La espirometria por si sola NO PUEDE
//      confirmar restriccion; se requiere volumen pulmonar total
//      (pletismografia) para confirmarla. Por eso el patron se
//      llama "restrictivo_sugerido", nunca "restrictivo".
//   3. Mixto SUGERIDO: FEV1/FVC bajo Y FVC < LLN. Tampoco
//      confirmable solo con espirometria (puede ser atrapamiento
//      de aire por la obstruccion, no restriccion real).
//   4. Severidad de la obstruccion: gradiente por %predicho de FEV1
//      (tabla ATS/ERS 2005): leve >=70%, moderada 60-69%,
//      moderada-severa 50-59%, severa 35-49%, muy severa <35%.
//
// LIMITE FEV1/FVC: la guia ATS/ERS 2005 recomienda usar el LLN
// especifico de la poblacion para el cociente FEV1/FVC cuando este
// disponible. Como ECSC/ERS 1993 no publica una ecuacion de LLN
// separada y confiable para el cociente, seguimos la alternativa
// que la propia guia ATS/ERS 2005 reconoce como aceptable cuando
// no se dispone de ese LLN poblacional: un corte fijo de 0.70.
// Limitacion conocida y documentada por la guia: este corte fijo
// sobreestima la obstruccion en adultos mayores y la subestima en
// personas jovenes. Se muestra igualmente el cociente predicho
// (FEV1 predicho / FVC predicho) como referencia informativa.
//
// REVERSIBILIDAD POST-BRONCODILATADOR (ATS/ERS 2005): se considera
// respuesta broncodilatadora positiva si FEV1 O FVC aumentan
// >=12% Y >=200 mL respecto del valor pre-broncodilatador.
//
// Diseno: funciones puras (sin acceso a BD), igual que reba.js,
// rula.js y audiometria.js, para poder testarlas de forma aislada.
// ============================================================

// ------------------------------------------------------------
// Coeficientes de las ecuaciones ECSC/ERS 1993.
// H = talla en metros, A = edad en anios.
// Formula general: valor = coefH * H + coefA * A + constante
// ------------------------------------------------------------
const COEFICIENTES = {
  M: {
    fvc:      { coefH: 5.76, coefA: -0.026, constante: -4.34, rsd: 0.61 },
    fev1:     { coefH: 4.30, coefA: -0.029, constante: -2.49, rsd: 0.51 },
    pef:      { coefH: 6.14, coefA: -0.043, constante:  0.15, rsd: 1.24 },
    fef2575:  { coefH: 2.79, coefA: -0.031, constante:  0.20, rsd: 1.08 },
  },
  F: {
    fvc:      { coefH: 4.43, coefA: -0.026, constante: -2.89, rsd: 0.46 },
    fev1:     { coefH: 3.95, coefA: -0.025, constante: -2.60, rsd: 0.38 },
    pef:      { coefH: 5.50, coefA: -0.030, constante: -1.11, rsd: 1.16 },
    fef2575:  { coefH: 3.01, coefA: -0.028, constante: -0.42, rsd: 0.83 },
  },
};

// Corte fijo del cociente FEV1/FVC recomendado por ATS/ERS 2005
// como alternativa cuando no hay LLN poblacional especifico.
const CORTE_FEV1_FVC = 0.70;

// Criterio ATS/ERS 2005 de reversibilidad post-broncodilatador.
const REVERSIBILIDAD_PCT_MINIMO = 12; // % de cambio respecto al valor pre-BD
const REVERSIBILIDAD_ML_MINIMO = 0.200; // Litros (200 mL)

/**
 * Redondea a 2 decimales.
 */
function r2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Calcula el valor predicho (media poblacional) y el LLN (limite
 * inferior de la normalidad, percentil 5) de un parametro
 * espirometrico segun ECSC/ERS 1993.
 *
 * LLN = predicho - 1.645 * RSD (aproximacion estandar del
 * percentil 5 de una distribucion normal).
 *
 * @param {'M'|'F'} sexo
 * @param {number} edadAnios
 * @param {number} tallaM - talla en metros
 * @param {'fvc'|'fev1'|'pef'|'fef2575'} parametro
 * @returns {{ predicho: number, lln: number }}
 */
function calcularPredichoYLln(sexo, edadAnios, tallaM, parametro) {
  const c = COEFICIENTES[sexo][parametro];
  const predicho = c.coefH * tallaM + c.coefA * edadAnios + c.constante;
  const lln = predicho - 1.645 * c.rsd;
  return { predicho: r2(predicho), lln: r2(lln) };
}

/**
 * Calcula todos los valores predichos y LLN para un trabajador,
 * dado su sexo, edad y talla.
 *
 * @param {'M'|'F'} sexo
 * @param {number} edadAnios
 * @param {number} tallaCm - talla en centimetros
 * @returns {object} predichos y LLN de fvc, fev1, pef, fef2575,
 *   mas el cociente fev1/fvc predicho (informativo).
 */
function calcularValoresPredichos(sexo, edadAnios, tallaCm) {
  const s = (sexo === 'F') ? 'F' : 'M'; // por defecto M si llega un valor invalido (no deberia pasar, validado antes)
  const tallaM = tallaCm / 100;

  const fvc = calcularPredichoYLln(s, edadAnios, tallaM, 'fvc');
  const fev1 = calcularPredichoYLln(s, edadAnios, tallaM, 'fev1');
  const pef = calcularPredichoYLln(s, edadAnios, tallaM, 'pef');
  const fef2575 = calcularPredichoYLln(s, edadAnios, tallaM, 'fef2575');

  // Cociente FEV1/FVC predicho: informativo, derivado de los dos
  // predichos (ver nota de diseno arriba sobre por que no usamos
  // una ecuacion de LLN separada para el cociente).
  const fev1FvcPredicho = fvc.predicho > 0
    ? r2((fev1.predicho / fvc.predicho) * 100)
    : null;

  return {
    fvcPredicho: fvc.predicho, fvcLln: fvc.lln,
    fev1Predicho: fev1.predicho, fev1Lln: fev1.lln,
    pefPredicho: pef.predicho, pefLln: pef.lln,
    fef2575Predicho: fef2575.predicho, fef2575Lln: fef2575.lln,
    fev1FvcPredicho,
  };
}

/**
 * Calcula el porcentaje del predicho de un valor medido.
 * @returns {number|null}
 */
function calcularPorcentajePredicho(medido, predicho) {
  if (medido === null || medido === undefined || !predicho || predicho <= 0) return null;
  return r2((medido / predicho) * 100);
}

/**
 * Clasifica la severidad de una obstruccion segun el %predicho de
 * FEV1, usando la tabla estandar ATS/ERS 2005.
 * @param {number} fev1PctPredicho
 * @returns {string}
 */
function clasificarSeveridadObstruccion(fev1PctPredicho) {
  if (fev1PctPredicho >= 70) return 'obstructivo_leve';
  if (fev1PctPredicho >= 60) return 'obstructivo_moderado';
  if (fev1PctPredicho >= 50) return 'obstructivo_moderado_severo';
  if (fev1PctPredicho >= 35) return 'obstructivo_severo';
  return 'obstructivo_muy_severo';
}

/**
 * Clasifica el patron ventilatorio segun el algoritmo ATS/ERS 2005,
 * a partir de los valores PRE-broncodilatador.
 *
 * @param {object} p - { fev1FvcMedido (ratio en %, ej 68.5),
 *   fvcPctPredicho, fev1PctPredicho }
 * @returns {string} codigo del patron
 */
function clasificarPatron({ fev1FvcMedido, fvcPctPredicho, fev1PctPredicho }) {
  if (fev1FvcMedido === null || fvcPctPredicho === null || fev1PctPredicho === null) {
    return 'no_clasificable';
  }

  const cocienteBajo = (fev1FvcMedido / 100) < CORTE_FEV1_FVC;
  const fvcBaja = fvcPctPredicho < 80; // uso practico de 80% como referencia visual;
  // la clasificacion real de "FVC baja" para el patron restrictivo
  // sugerido se basa en el LLN (ver espirometriaController.js, que
  // pasa fvcPctPredicho ya evaluado contra su LLN via fvcBajoLln).

  if (cocienteBajo) {
    // Obstruccion presente. Si ademas la FVC esta baja, es un
    // patron MIXTO SUGERIDO (no confirmable solo con espirometria).
    if (fvcBaja) return 'mixto_sugerido';
    return clasificarSeveridadObstruccion(fev1PctPredicho);
  }

  // Cociente normal: sin obstruccion.
  if (fvcBaja) return 'restrictivo_sugerido';

  return 'normal';
}

/**
 * Evalua si hubo respuesta broncodilatadora positiva segun el
 * criterio ATS/ERS 2005: aumento >=12% Y >=200 mL en FEV1 o FVC.
 *
 * @param {number|null} valorPre - en litros
 * @param {number|null} valorPost - en litros
 * @returns {{ cambioPct: number|null, cambioMl: number|null, esPositiva: boolean }}
 */
function calcularReversibilidad(valorPre, valorPost) {
  if (valorPre === null || valorPre === undefined || valorPre <= 0 ||
      valorPost === null || valorPost === undefined) {
    return { cambioPct: null, cambioMl: null, esPositiva: false };
  }
  const cambioL = valorPost - valorPre;
  const cambioPct = r2((cambioL / valorPre) * 100);
  const cambioMl = Math.round(cambioL * 1000);
  const esPositiva = cambioPct >= REVERSIBILIDAD_PCT_MINIMO && cambioL >= REVERSIBILIDAD_ML_MINIMO;
  return { cambioPct, cambioMl, esPositiva };
}

/**
 * Calcula el resultado completo de una espirometria: predichos,
 * LLN, %predicho, patron ventilatorio y reversibilidad post-BD
 * (si se proporcionaron valores post-broncodilatador).
 *
 * @param {object} medidos - fvcPre, fev1Pre, pefPre, fef2575Pre,
 *   fvcPost, fev1Post, pefPost, fef2575Post (los "Post" son opcionales)
 * @param {'M'|'F'} sexo
 * @param {number} edadAnios
 * @param {number} tallaCm
 * @returns {object} resultado completo
 */
function calcularEspirometria(medidos, sexo, edadAnios, tallaCm) {
  const predichos = calcularValoresPredichos(sexo, edadAnios, tallaCm);

  const fvcPctPredicho = calcularPorcentajePredicho(medidos.fvcPre, predichos.fvcPredicho);
  const fev1PctPredicho = calcularPorcentajePredicho(medidos.fev1Pre, predichos.fev1Predicho);
  const pefPctPredicho = calcularPorcentajePredicho(medidos.pefPre, predichos.pefPredicho);
  const fef2575PctPredicho = calcularPorcentajePredicho(medidos.fef2575Pre, predichos.fef2575Predicho);

  const fev1FvcMedido = (medidos.fvcPre && medidos.fev1Pre)
    ? r2((medidos.fev1Pre / medidos.fvcPre) * 100)
    : null;

  // FVC baja respecto a su propio LLN (mas preciso que el 80% fijo
  // que usa clasificarPatron() como respaldo cuando falta el LLN).
  const fvcBajoLln = (medidos.fvcPre !== null && medidos.fvcPre !== undefined)
    ? medidos.fvcPre < predichos.fvcLln
    : null;

  let patron = 'no_clasificable';
  if (fev1FvcMedido !== null && fvcPctPredicho !== null && fev1PctPredicho !== null) {
    const cocienteBajo = (fev1FvcMedido / 100) < CORTE_FEV1_FVC;
    if (cocienteBajo) {
      patron = fvcBajoLln ? 'mixto_sugerido' : clasificarSeveridadObstruccion(fev1PctPredicho);
    } else {
      patron = fvcBajoLln ? 'restrictivo_sugerido' : 'normal';
    }
  }

  // Reversibilidad post-broncodilatador (solo si hay datos post-BD)
  const tieneValoresPost = medidos.fev1Post !== undefined && medidos.fev1Post !== null;
  let reversibilidad = { cambioPct: null, cambioMl: null, esPositiva: false };
  if (tieneValoresPost) {
    const revFev1 = calcularReversibilidad(medidos.fev1Pre, medidos.fev1Post);
    const revFvc = calcularReversibilidad(medidos.fvcPre, medidos.fvcPost);
    // Positiva si CUALQUIERA de los dos (FEV1 o FVC) cumple el criterio.
    reversibilidad = {
      cambioPct: revFev1.cambioPct,
      cambioMl: revFev1.cambioMl,
      cambioPctFvc: revFvc.cambioPct,
      cambioMlFvc: revFvc.cambioMl,
      esPositiva: revFev1.esPositiva || revFvc.esPositiva,
    };
  }

  return {
    ...predichos,
    fvcPctPredicho, fev1PctPredicho, pefPctPredicho, fef2575PctPredicho,
    fev1FvcMedido,
    patron,
    reversibilidad,
  };
}

module.exports = {
  calcularValoresPredichos,
  calcularPorcentajePredicho,
  clasificarSeveridadObstruccion,
  clasificarPatron,
  calcularReversibilidad,
  calcularEspirometria,
  CORTE_FEV1_FVC,
};
