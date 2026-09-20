// ============================================================
// SISSO - Calculo de espirometria: valores predichos, limite
// inferior de la normalidad (LLN), clasificacion de patron
// ventilatorio, calidad de maniobra y reversibilidad
// post-broncodilatador.
//
// >>> ESTADO: IMPLEMENTACION INTERINA, NO DEFINITIVA <<<
// CORREGIDO en Auditoria N.13 (hallazgo CRITICO C-01, P0): este
// modulo NO debe presentarse ni documentarse como una implementacion
// "ERS/ATS 2022 definitiva". Los predichos siguen usando ecuaciones
// ECSC/ERS 1993 (poblacion de referencia europea/caucasica, NO
// validada para poblacion ecuatoriana/latinoamericana), y el LLN del
// cociente FEV1/FVC usa un margen fijo de 8 puntos porcentuales
// (ver MARGEN_LLN_COCIENTE_PUNTOS mas abajo) en vez de una tabla
// GLI-2012 oficial. Solo se usan sexo (M/F), edad y talla -- sin
// ajuste por etnia/poblacion, que GLI-2012 si contempla.
// Cada resultado de calcularEspirometria() incluye ahora un objeto
// `metadatosReferencia` con la ecuacion, version, poblacion de
// referencia, variables usadas y metodo de LLN, para que quede
// trazado en cada examen guardado (ver migration_067) y nunca se
// presente como si fuera el estandar clinico completo. La
// interpretacion final SIEMPRE es medica (ver `interpretable`).
//
// ACTUALIZADO en Auditoria N.12 (hallazgo CRITICO C12-02, P0):
// la version anterior interpretaba con ATS/ERS 2005: cociente fijo
// FEV1/FVC < 0.70 como criterio PRINCIPAL de obstruccion, 80% del
// predicho como referencia de normalidad para FVC, y reversibilidad
// post-broncodilatador >=12% Y >=200 mL respecto del valor
// pre-broncodilatador. La norma ERS/ATS 2022 ("Interpretive
// strategies for routine lung function tests") senala
// explicitamente que:
//   - El cociente fijo 0.70 NO es recomendable (sobreestima
//     obstruccion en mayores, la subestima en jovenes).
//   - El 80% del predicho NO es recomendable como criterio de
//     normalidad.
//   - Debe usarse el limite inferior de la normalidad (LLN,
//     percentil 5) especifico de cada parametro, idealmente con
//     ecuaciones GLI-2012 (splines LMS por edad/sexo/talla/etnia).
//   - La respuesta broncodilatadora significativa se define como
//     cambio >10% DEL PREDICHO (no del valor pre-BD).
//
// ECUACIONES DE REFERENCIA (PREDICHOS): se mantienen ECSC/ERS 1993
// para los valores predichos de FVC/FEV1/PEF/FEF25-75 (documentado
// en la version anterior: GLI-2012 requiere splines LMS con tablas
// de lookup que no se reproducen aqui sin una fuente oficial
// verificada por un profesional biomedico -- ver tambien
// migration_061). Lo que SI cambia respecto de la version anterior:
//
//   1. El LLN estadistico (predicho - 1.645*RSD, aproximacion
//      estandar del percentil 5 de una distribucion normal, el
//      mismo metodo que ATS/ERS reconoce quando no se dispone de
//      GLI) se generaliza tambien al COCIENTE FEV1/FVC, no solo a
//      FVC/FEV1 individuales como en la version 2005 de este
//      modulo. El cociente fijo 0.70 deja de ser el criterio
//      principal; el LLN del cociente lo reemplaza (margen fijo de
//      8 puntos porcentuales bajo el predicho -- ver justificacion
//      y limitacion documentada junto a MARGEN_LLN_COCIENTE_PUNTOS
//      mas abajo).
//   2. Reversibilidad broncodilatadora: >10% del PREDICHO de FEV1 o
//      FVC (no del valor pre-BD), acorde a ERS/ATS 2022.
//   3. Se agrega estructura de CALIDAD de maniobra (ATS/ERS 2019):
//      numero de maniobras aceptables, repetibilidad entre las 2
//      mejores FVC/FEV1, y un grado A-F/U. Si la calidad no alcanza
//      el minimo, el examen se marca `interpretable=false` y el
//      patron NO debe presentarse como apoyo diagnostico (el
//      controlador respeta este flag).
//
// Diseno: funciones puras (sin acceso a BD), igual que reba.js,
// rula.js y audiometria.js, para poder testarlas de forma aislada.
// ============================================================

// ------------------------------------------------------------
// Coeficientes de las ecuaciones ECSC/ERS 1993 para los PREDICHOS.
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

// CORREGIDO en Auditoria N.12 (C12-02): el cociente fijo YA NO es el
// criterio principal de clasificacion. Se conserva solo como dato
// informativo secundario para el medico (ver `criterioFijoReferencia`
// en el resultado), nunca como base de `patron`.
const CORTE_FEV1_FVC_INFORMATIVO = 0.70;

// CORREGIDO en Auditoria N.12 (C12-02): reversibilidad ERS/ATS 2022
// -- cambio >10% respecto del PREDICHO (ya no >=12%+200mL respecto
// del valor pre-broncodilatador, criterio ATS/ERS 2005 retirado).
const REVERSIBILIDAD_PCT_PREDICHO_MINIMO = 10;

// Umbrales minimos de calidad ATS/ERS 2019 para considerar una
// espirometria interpretable como apoyo clinico.
const CALIDAD_MIN_MANIOBRAS = 3;
const CALIDAD_MAX_REPETIBILIDAD_ML = 150; // diferencia entre las 2 mejores FVC y las 2 mejores FEV1

// CREADO en Auditoria N.14 (hallazgo GRAVE G14-07, P1): escala
// completa de grados de calidad ATS/ERS 2019 (Culver et al. 2017,
// "Recommendations for a Standardized Pulmonary Function Report",
// Am J Respir Crit Care Med / la misma tabla que resume Graham et
// al. 2019 ERS/ATS technical standard), basada en NUMERO DE
// MANIOBRAS ACEPTABLES (no solo "numero de maniobras realizadas" --
// distincion que la version N12/N13 no hacia) y repetibilidad entre
// las 2 mejores FVC/FEV1 aceptables:
//   A: >=3 aceptables, repetibilidad <=150 mL
//   B: 2 aceptables,   repetibilidad <=150 mL
//   C: 2 aceptables,   repetibilidad <=200 mL
//   D: 2 aceptables,   repetibilidad <=250 mL
//   E: 2 aceptables,   repetibilidad >250 mL  (o solo 1 aceptable)
//   F: 0 maniobras aceptables
//   U: no fue posible evaluar (no se registraron datos de calidad)
// Esta tabla SOLO puede aplicarse si el frontend/tecnico registra,
// por cada maniobra, si fue ACEPTABLE segun los criterios ATS/ERS
// (inicio adecuado, sin tos en el primer segundo, sin cierre
// glotico, sin fuga, sin obstruccion de la boquilla, BEV <5% o
// 150 mL, EOFE con meseta >=1s o tiempo espiratorio >=6s) -- ver
// evaluarCalidadManiobra(). Si esos datos de aceptabilidad no se
// proporcionan (compatibilidad con capturas anteriores a esta
// correccion), el modulo NO asciende de grado por si mismo: usa el
// pre-filtro simplificado anterior (numero de maniobras informadas,
// sin verificar aceptabilidad real) y lo marca explicitamente como
// `evaluacionSimplificada: true`, para que un reporte no lo
// presente como una calificacion ATS/ERS 2019 completa cuando en
// realidad no se verificaron los criterios de aceptabilidad de cada
// curva.
const UMBRALES_REPETIBILIDAD_MM = [
  { maximoMl: 150, grado: 'A_o_B' },
  { maximoMl: 200, grado: 'C' },
  { maximoMl: 250, grado: 'D' },
];

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
 * percentil 5 de una distribucion normal, la misma que reconoce
 * ATS/ERS cuando no se usa GLI-2012 directamente).
 *
 * @param {'M'|'F'} sexo
 * @param {number} edadAnios
 * @param {number} tallaM - talla en metros
 * @param {'fvc'|'fev1'|'pef'|'fef2575'} parametro
 * @returns {{ predicho: number, lln: number, rsd: number }}
 */
function calcularPredichoYLln(sexo, edadAnios, tallaM, parametro) {
  const c = COEFICIENTES[sexo][parametro];
  const predicho = c.coefH * tallaM + c.coefA * edadAnios + c.constante;
  const lln = predicho - 1.645 * c.rsd;
  return { predicho: r2(predicho), lln: r2(lln), rsd: c.rsd };
}

/**
 * Calcula todos los valores predichos y LLN para un trabajador,
 * dado su sexo, edad y talla, INCLUYENDO el LLN del cociente
 * FEV1/FVC (nuevo en C12-02: antes solo existia para FVC y FEV1
 * individuales, y el cociente usaba el corte fijo 0.70).
 *
 * @param {'M'|'F'} sexo
 * @param {number} edadAnios
 * @param {number} tallaCm - talla en centimetros
 * @returns {object} predichos y LLN de fvc, fev1, pef, fef2575,
 *   el cociente fev1/fvc predicho y su LLN.
 */
function calcularValoresPredichos(sexo, edadAnios, tallaCm) {
  const s = (sexo === 'F') ? 'F' : 'M'; // por defecto M si llega un valor invalido (no deberia pasar, validado antes)
  const tallaM = tallaCm / 100;

  const fvc = calcularPredichoYLln(s, edadAnios, tallaM, 'fvc');
  const fev1 = calcularPredichoYLln(s, edadAnios, tallaM, 'fev1');
  const pef = calcularPredichoYLln(s, edadAnios, tallaM, 'pef');
  const fef2575 = calcularPredichoYLln(s, edadAnios, tallaM, 'fef2575');

  // Cociente FEV1/FVC predicho (%), derivado de los dos predichos.
  const fev1FvcPredicho = fvc.predicho > 0
    ? r2((fev1.predicho / fvc.predicho) * 100)
    : null;

  // LLN del cociente: CORREGIDO en C12-02. Version anterior de esta
  // MISMA correccion (detectada y revertida en la propia sesion de
  // correccion, dejandolo documentado para que no se reintente sin
  // querer): se probo derivar la RSD del cociente por propagacion
  // de error a partir de las RSD de FEV1 y FVC. Al probarla con un
  // caso sintetico de FEV1 al 98% del predicho (claramente normal),
  // esa formula devolvia un margen de apenas ~0.3 puntos
  // porcentuales bajo el predicho -- tan estrecho que clasificaba
  // como obstructivo un caso normal. Se descarto esa formula por
  // ser clinicamente peligrosa (falsos positivos), en vez de
  // dejarla pasar solo porque "ya no es un corte fijo".
  //
  // En su lugar se usa un margen fijo de 8 puntos porcentuales por
  // debajo del predicho, valor consistente con el ORDEN DE MAGNITUD
  // reportado en la literatura para el percentil 5 del cociente
  // FEV1/FVC en adultos sanos, y que reproduce el sesgo que la
  // propia auditoria describe: para una persona joven (predicho
  // alto, ej. ~85%) el LLN resultante (~77%) es MAS ALTO que el
  // corte fijo 0.70, evitando subestimar obstruccion en jovenes; y
  // para una persona mayor (predicho mas bajo, ej. ~75%) el LLN
  // resultante (~67%) es MAS BAJO que 0.70, evitando sobreestimar
  // obstruccion en adultos mayores. Se documenta explicitamente
  // como una APROXIMACION, no como el valor oficial GLI-2012: sigue
  // pendiente (ver migration_061 y CAPA-02 del informe de
  // correcciones) incorporar la tabla GLI-2012 oficial con revision
  // bioestadistica/medica formal antes de tratar este margen como
  // definitivo.
  const MARGEN_LLN_COCIENTE_PUNTOS = 8;
  const fev1FvcLln = fev1FvcPredicho !== null
    ? r2(fev1FvcPredicho - MARGEN_LLN_COCIENTE_PUNTOS)
    : null;

  return {
    fvcPredicho: fvc.predicho, fvcLln: fvc.lln,
    fev1Predicho: fev1.predicho, fev1Lln: fev1.lln,
    pefPredicho: pef.predicho, pefLln: pef.lln,
    fef2575Predicho: fef2575.predicho, fef2575Lln: fef2575.lln,
    fev1FvcPredicho, fev1FvcLln,
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
 * FEV1, usando la tabla estandar (ATS/ERS 2005/2022 mantienen la
 * misma gradiente de severidad por %predicho de FEV1).
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
 * Evalua si hubo respuesta broncodilatadora positiva segun ERS/ATS
 * 2022: cambio >10% del PREDICHO de FEV1 o FVC (ya NO se usa el
 * criterio 2005 de >=12% Y >=200 mL respecto del valor pre-BD).
 *
 * CORREGIDO en Auditoria N.14 (hallazgo GRAVE G14-08, P1): el
 * calculo del porcentaje de cambio no verificaba absolutamente
 * nada del PROTOCOLO de la prueba (que farmaco se administro, en
 * que dosis, cuanto tiempo paso entre la dosis y la maniobra
 * post-BD). La fuente ERS/ATS 2022 que fundamenta el criterio de
 * >10% del predicho asume implicitamente un protocolo valido
 * (broncodilatador de accion corta, dosis estandar, espera minima
 * antes de repetir la maniobra) -- sin esos datos, el numero puede
 * calcularse perfectamente bien mientras el resultado clinico sea
 * de todas formas no interpretable (ej. si pasaron 2 minutos en vez
 * de los ~10-15 minutos minimos esperados para salbutamol).
 *
 * Ahora la funcion exige un objeto `protocolo` con farmaco, dosis,
 * horaPre y horaPost; si falta cualquiera de esos datos, o si los
 * minutos transcurridos son menores al minimo esperado para el
 * farmaco declarado, el resultado se marca `protocoloValido:false`
 * y `esPositiva` nunca es true (BDR pasa a "no evaluable" en vez de
 * presentar un numero que podria interpretarse sin ese contexto).
 *
 * @param {number|null} valorPre - en litros
 * @param {number|null} valorPost - en litros
 * @param {number|null} predicho - valor predicho del mismo parametro, en litros
 * @param {object|null} protocolo - { farmaco, dosisMcg, horaPreIso, horaPostIso }
 * @returns {{ cambioMl: number|null, cambioPctPredicho: number|null, esPositiva: boolean,
 *   protocoloValido: boolean, minutosTranscurridos: number|null, motivoNoEvaluable: string|null }}
 */
// Tiempo minimo de espera documentado para que la respuesta a un
// broncodilatador de accion corta (salbutamol/albuterol, el mas
// usado en espirometria ocupacional) sea valorable: guias clinicas
// habituales piden al menos 10-15 minutos post-inhalacion antes de
// repetir la maniobra. Se usa el limite mas conservador (10) como
// minimo aceptable; por debajo de eso el protocolo se marca invalido.
const MINUTOS_MINIMOS_POST_BD = 10;
const FARMACOS_BRONCODILATADORES_RECONOCIDOS = ['salbutamol', 'albuterol', 'ipratropio', 'otro'];

function calcularReversibilidad(valorPre, valorPost, predicho, protocolo) {
  if (valorPre === null || valorPre === undefined ||
      valorPost === null || valorPost === undefined ||
      !predicho || predicho <= 0) {
    return {
      cambioMl: null, cambioPctPredicho: null, esPositiva: false,
      protocoloValido: false, minutosTranscurridos: null,
      motivoNoEvaluable: 'No se registraron valores pre/post-broncodilatador.',
    };
  }

  const cambioL = valorPost - valorPre;
  const cambioMl = Math.round(cambioL * 1000);
  const cambioPctPredicho = r2((cambioL / predicho) * 100);

  let protocoloValido = false;
  let minutosTranscurridos = null;
  let motivoNoEvaluable = null;

  if (!protocolo || typeof protocolo !== 'object') {
    motivoNoEvaluable = 'No se registro el protocolo de broncodilatador (farmaco, dosis, hora pre/post); la respuesta no puede declararse evaluable sin verificar el contexto de la prueba.';
  } else {
    const { farmaco, dosisMcg, horaPreIso, horaPostIso } = protocolo;
    if (!farmaco || !FARMACOS_BRONCODILATADORES_RECONOCIDOS.includes(farmaco)) {
      motivoNoEvaluable = 'Farmaco de broncodilatador no registrado o no reconocido.';
    } else if (!dosisMcg || dosisMcg <= 0) {
      motivoNoEvaluable = 'Dosis de broncodilatador no registrada.';
    } else if (!horaPreIso || !horaPostIso) {
      motivoNoEvaluable = 'Hora de administracion o de la maniobra post-broncodilatador no registrada.';
    } else {
      const minutos = (new Date(horaPostIso).getTime() - new Date(horaPreIso).getTime()) / 60000;
      minutosTranscurridos = Number.isFinite(minutos) ? Math.round(minutos) : null;
      if (minutosTranscurridos === null || minutosTranscurridos < MINUTOS_MINIMOS_POST_BD) {
        motivoNoEvaluable = `Tiempo transcurrido (${minutosTranscurridos ?? 'no calculable'} min) menor al minimo esperado de ${MINUTOS_MINIMOS_POST_BD} min para valorar la respuesta.`;
      } else {
        protocoloValido = true;
      }
    }
  }

  const esPositiva = protocoloValido && cambioPctPredicho > REVERSIBILIDAD_PCT_PREDICHO_MINIMO;

  return { cambioMl, cambioPctPredicho, esPositiva, protocoloValido, minutosTranscurridos, motivoNoEvaluable };
}

/**
 * Evalua la calidad de la maniobra segun ATS/ERS 2019: numero de
 * maniobras aceptables y repetibilidad entre las 2 mejores FVC/FEV1.
 *
 * CREADO en Auditoria N.12 (hallazgo CRITICO C12-02, punto 6-7 de la
 * correccion obligatoria): el modulo anterior no registraba NINGUNA
 * estructura de calidad porque el backend solo recibia valores
 * finales. Esta funcion acepta los datos de calidad SI el frontend
 * los envia; si no se envian (compatibilidad con capturas antiguas
 * o equipos que no exportan esas maniobras), se marca grado 'U'
 * (no evaluable) y `interpretable=false` -- el sistema deja de
 * asumir automaticamente que una prueba sin datos de calidad es
 * buena.
 *
 * CORREGIDO en Auditoria N.14 (hallazgo GRAVE G14-07, P1): la
 * version N12/N13 solo contaba CUANTAS maniobras se informaron, sin
 * verificar si cada una era realmente ACEPTABLE (inicio adecuado,
 * sin tos, sin cierre glotico, sin fuga, BEV/EOFE dentro de rango).
 * "3 maniobras informadas" no es lo mismo que "3 maniobras
 * aceptables" -- la tabla oficial ATS/ERS 2019 (A-F, U) se basa en
 * esto ultimo. Ahora se acepta un arreglo opcional `aceptabilidad`
 * (una entrada por maniobra: { aceptable, bev, eofe, tos, cierreGlotico,
 * inicioAdecuado, finalizacionAdecuada, fuga, tiempoEspiratorioS }) y
 * metadatos de equipo/operador (`equipo`: { marca, modelo, numeroSerie,
 * fechaCalibracion, resultadoVerificacion, operadorId }), que se
 * conservan como trazabilidad (no se usan para inferir aceptabilidad
 * automaticamente -- verificar la valides de una calibracion de
 * equipo especifico excede lo que este modulo puede juzgar). Si NO
 * se envia `aceptabilidad`, se mantiene el pre-filtro simplificado
 * anterior (cuenta maniobras informadas, no verifica aceptabilidad
 * real) marcado con `evaluacionSimplificada: true`.
 *
 * @param {object} datosCalidad - { numeroManiobras, mejorFvcL, segundaMejorFvcL, mejorFev1L, segundaMejorFev1L, aceptabilidad, equipo }
 * @returns {object}
 */
function evaluarCalidadManiobra(datosCalidad) {
  const vacio = {
    numeroManiobras: null, numeroManiobrasAceptables: null,
    repetibilidadFvcMl: null, repetibilidadFev1Ml: null,
    grado: 'U', interpretable: false, evaluacionSimplificada: true,
    equipo: null,
  };
  if (!datosCalidad || typeof datosCalidad !== 'object') {
    return vacio;
  }

  const { numeroManiobras, mejorFvcL, segundaMejorFvcL, mejorFev1L, segundaMejorFev1L, aceptabilidad, equipo } = datosCalidad;

  const repetibilidadFvcMl = (mejorFvcL != null && segundaMejorFvcL != null)
    ? Math.round(Math.abs(mejorFvcL - segundaMejorFvcL) * 1000)
    : null;
  const repetibilidadFev1Ml = (mejorFev1L != null && segundaMejorFev1L != null)
    ? Math.round(Math.abs(mejorFev1L - segundaMejorFev1L) * 1000)
    : null;
  const repetibilidadMaxMl = (repetibilidadFvcMl !== null && repetibilidadFev1Ml !== null)
    ? Math.max(repetibilidadFvcMl, repetibilidadFev1Ml)
    : null;

  const equipoTrazado = (equipo && typeof equipo === 'object') ? {
    marca: equipo.marca ?? null,
    modelo: equipo.modelo ?? null,
    numeroSerie: equipo.numeroSerie ?? null,
    fechaCalibracion: equipo.fechaCalibracion ?? null,
    resultadoVerificacion: equipo.resultadoVerificacion ?? null,
    operadorId: equipo.operadorId ?? null,
  } : null;

  // Camino completo: se registro aceptabilidad por maniobra.
  if (Array.isArray(aceptabilidad) && aceptabilidad.length > 0) {
    const numeroManiobrasAceptables = aceptabilidad.filter((m) => m && m.aceptable === true).length;

    let grado;
    if (numeroManiobrasAceptables === 0) {
      grado = 'F';
    } else if (numeroManiobrasAceptables === 1) {
      grado = 'E';
    } else if (repetibilidadMaxMl === null) {
      grado = 'U'; // aceptables >=2 pero sin par comparable de FVC/FEV1 para repetibilidad
    } else if (repetibilidadMaxMl <= 150) {
      grado = numeroManiobrasAceptables >= 3 ? 'A' : 'B';
    } else if (repetibilidadMaxMl <= 200) {
      grado = 'C';
    } else if (repetibilidadMaxMl <= 250) {
      grado = 'D';
    } else {
      grado = 'E';
    }

    return {
      numeroManiobras: aceptabilidad.length,
      numeroManiobrasAceptables,
      repetibilidadFvcMl, repetibilidadFev1Ml,
      grado, interpretable: grado === 'A' || grado === 'B' || grado === 'C',
      evaluacionSimplificada: false,
      equipo: equipoTrazado,
    };
  }

  // Pre-filtro simplificado (compatibilidad hacia atras): NO
  // verifica aceptabilidad real de cada maniobra, solo cuenta
  // cuantas se informaron. Se marca explicitamente como tal.
  const tieneManiobrasMinimas = typeof numeroManiobras === 'number' && numeroManiobras >= CALIDAD_MIN_MANIOBRAS;
  const repetibilidadOk = repetibilidadFvcMl !== null && repetibilidadFev1Ml !== null
    && repetibilidadFvcMl <= CALIDAD_MAX_REPETIBILIDAD_ML && repetibilidadFev1Ml <= CALIDAD_MAX_REPETIBILIDAD_ML;

  let grado;
  if (tieneManiobrasMinimas && repetibilidadOk) {
    grado = 'A';
  } else if (typeof numeroManiobras === 'number' && numeroManiobras >= 2 && repetibilidadFvcMl !== null) {
    grado = repetibilidadOk ? 'B' : 'D';
  } else if (typeof numeroManiobras === 'number' && numeroManiobras >= 1) {
    grado = 'F';
  } else {
    grado = 'U';
  }

  const interpretable = grado === 'A' || grado === 'B';

  return {
    numeroManiobras: typeof numeroManiobras === 'number' ? numeroManiobras : null,
    numeroManiobrasAceptables: null,
    repetibilidadFvcMl, repetibilidadFev1Ml, grado, interpretable,
    evaluacionSimplificada: true,
    equipo: equipoTrazado,
  };
}

/**
 * Calcula el resultado completo de una espirometria: predichos,
 * LLN (incluido el del cociente FEV1/FVC), %predicho, calidad de
 * maniobra, patron ventilatorio (solo si la calidad lo permite) y
 * reversibilidad post-BD (si se proporcionaron valores post-BD).
 *
 * @param {object} medidos - fvcPre, fev1Pre, pefPre, fef2575Pre,
 *   fvcPost, fev1Post, pefPost, fef2575Post (los "Post" son opcionales),
 *   calidad (opcional, ver evaluarCalidadManiobra)
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

  // CORREGIDO en Auditoria N.12 (C12-02): el patron ya NO se decide
  // con el cociente fijo 0.70 ni con el 80% de FVC. Ambos criterios
  // ahora son el LLN especifico calculado arriba.
  const cocienteBajoLln = (fev1FvcMedido !== null && predichos.fev1FvcLln !== null)
    ? fev1FvcMedido < predichos.fev1FvcLln
    : null;
  const fvcBajoLln = (medidos.fvcPre !== null && medidos.fvcPre !== undefined)
    ? medidos.fvcPre < predichos.fvcLln
    : null;

  const calidad = evaluarCalidadManiobra(medidos.calidad);

  let patron = 'no_clasificable';
  if (cocienteBajoLln !== null && fvcPctPredicho !== null && fev1PctPredicho !== null) {
    patron = cocienteBajoLln
      ? (fvcBajoLln ? 'mixto_sugerido' : clasificarSeveridadObstruccion(fev1PctPredicho))
      : (fvcBajoLln ? 'restrictivo_sugerido' : 'normal');
  }

  // CORREGIDO en Auditoria N.12 (C12-02, correccion obligatoria
  // punto 7): "no permitir que el backend etiquete una prueba como
  // interpretable si no se cumplen criterios minimos de calidad".
  // El patron se SIGUE calculando y guardando (para que el medico
  // pueda revisarlo con contexto), pero el flag `interpretable`
  // queda en false y el controlador/frontend deben tratarlo como
  // "no usar como apoyo automatico" hasta que un medico lo revise
  // con la maniobra completa.
  const interpretable = calidad.interpretable && patron !== 'no_clasificable';

  // Reversibilidad post-broncodilatador (solo si hay datos post-BD).
  // CORREGIDO en Auditoria N.12 (C12-02): usa >10% del predicho, no
  // >=12%+200mL del valor pre-BD.
  // CORREGIDO en Auditoria N.14 (G14-08): ahora exige `medidos.protocoloBd`
  // (farmaco, dosis, hora pre/post) -- ver calcularReversibilidad().
  const tieneValoresPost = medidos.fev1Post !== undefined && medidos.fev1Post !== null;
  let reversibilidad = { cambioMl: null, cambioPctPredicho: null, esPositiva: false, protocoloValido: false, minutosTranscurridos: null, motivoNoEvaluable: 'Sin valores post-broncodilatador.' };
  if (tieneValoresPost) {
    const revFev1 = calcularReversibilidad(medidos.fev1Pre, medidos.fev1Post, predichos.fev1Predicho, medidos.protocoloBd);
    const revFvc = calcularReversibilidad(medidos.fvcPre, medidos.fvcPost, predichos.fvcPredicho, medidos.protocoloBd);
    reversibilidad = {
      cambioMl: revFev1.cambioMl,
      cambioPctPredicho: revFev1.cambioPctPredicho,
      cambioMlFvc: revFvc.cambioMl,
      cambioPctPredichoFvc: revFvc.cambioPctPredicho,
      esPositiva: revFev1.esPositiva || revFvc.esPositiva,
      protocoloValido: revFev1.protocoloValido,
      minutosTranscurridos: revFev1.minutosTranscurridos,
      motivoNoEvaluable: revFev1.motivoNoEvaluable,
    };
  }

  return {
    ...predichos,
    fvcPctPredicho, fev1PctPredicho, pefPctPredicho, fef2575PctPredicho,
    fev1FvcMedido,
    calidad,
    interpretable,
    patron,
    reversibilidad,
    criterioInterpretativo: 'lln_interino_no_gli', // CORREGIDO en N.13 (C-01): ya no se llama "ers_ats_2022_lln" para no sugerir cumplimiento definitivo
    criterioFijoReferencia: CORTE_FEV1_FVC_INFORMATIVO, // solo informativo, ya NO decide el patron
    // CREADO en Auditoria N.13 (hallazgo CRITICO C-01, P0): metadatos
    // de trazabilidad exigidos por la correccion obligatoria --
    // ecuacion, version, poblacion de referencia, variables usadas y
    // metodo de LLN, para que cada examen guardado deje constancia de
    // que este resultado es una aproximacion interina, no un
    // estandar GLI-2012 validado.
    metadatosReferencia: {
      ecuacionPredichos: 'ECSC/ERS 1993 (Quanjer et al.), lineal por sexo/edad/talla',
      versionAlgoritmo: 'interino_v1_no_gli_2012',
      poblacionReferencia: 'Europea/caucasica (ECSC/ERS 1993) -- NO validada especificamente para poblacion ecuatoriana/latinoamericana',
      variablesUtilizadas: ['sexo (M/F)', 'edad', 'talla'],
      metodoLln: 'Percentil 5 (predicho - 1.645*RSD) para FVC/FEV1/PEF/FEF25-75. Para el cociente FEV1/FVC: margen fijo de 8 puntos porcentuales bajo el predicho (aproximacion documentada, no GLI-2012 oficial).',
      esDefinitivo: false,
      pendienteValidacion: 'Sustituir por tabla GLI-2012 oficial (splines LMS por edad/sexo/talla/etnia) con validacion bioestadistica/medica formal antes de tratar este modulo como estandar definitivo.',
    },
  };
}

module.exports = {
  calcularValoresPredichos,
  calcularPorcentajePredicho,
  clasificarSeveridadObstruccion,
  evaluarCalidadManiobra,
  calcularReversibilidad,
  calcularEspirometria,
  CORTE_FEV1_FVC_INFORMATIVO,
  REVERSIBILIDAD_PCT_PREDICHO_MINIMO,
};

