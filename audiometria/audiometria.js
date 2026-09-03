// ============================================================
// SISSO - Calculo audiometrico: STS y clasificacion de patron.
//
// Corrige los errores GRAVES #6 y #7 de la auditoria:
//
//   "#6: Falta comparacion con audiometria basal, cambio >=10 dB
//    promedio 2k-3k-4k, alerta OSHA/NIOSH."
//    -> calcularSTS(): detecta Standard Threshold Shift segun
//       el criterio OSHA (29 CFR 1910.95): cambio en el promedio
//       de 2000, 3000 y 4000 Hz de >=10 dB comparado con la
//       audiometria basal del mismo trabajador y oido.
//
//   "#7: Falta identificar: notch ocupacional 3-4-6k, presbiacusia,
//    conductiva, mixta, neurosensorial."
//    -> clasificarPatron(): clasifica el patron audiometrico usando
//       los criterios clinicos estandar internacionales (NIOSH,
//       AAO-HNS, consenso clinico de medicina ocupacional).
//
// Diseno: funciones puras (sin acceso a BD), para poder testarlas
// de forma aislada igual que reba.js y rula.js.
// ============================================================

/**
 * Calcula el Pure Tone Average (PTA) de las frecuencias
 * conversacionales: promedio de 500, 1000 y 2000 Hz.
 * Si alguna frecuencia es null, se calcula con las disponibles.
 * @param {number|null} hz500
 * @param {number|null} hz1000
 * @param {number|null} hz2000
 * @returns {number|null} PTA en dB, o null si no hay ningun valor.
 */
function calcularPTA(hz500, hz1000, hz2000) {
  const valores = [hz500, hz1000, hz2000].filter(v => v !== null && v !== undefined);
  if (valores.length === 0) return null;
  return Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 10) / 10;
}

/**
 * Calcula el promedio de agudos (2000, 3000, 4000 Hz) usado
 * por OSHA para la deteccion de STS.
 *
 * CORREGIDO en Auditoria N.12 (hallazgo GRAVE G12-01, P1): el
 * criterio OSHA 29 CFR 1910.95 define el STS sobre el promedio de
 * EXACTAMENTE 2000, 3000 y 4000 Hz. La version anterior aceptaba
 * un promedio con solo 2 de las 3 frecuencias -- eso no es un STS
 * mas "aproximado", es un numero clinicamente distinto que puede
 * producir un falso positivo o falso negativo. Si falta cualquiera
 * de las tres, el resultado correcto es "no calculable", nunca un
 * promedio con las que haya.
 *
 * @returns {number|null} null si falta cualquiera de las 3 frecuencias.
 */
function calcularPromedioAgudos(hz2000, hz3000, hz4000) {
  const valores = [hz2000, hz3000, hz4000];
  if (valores.some(v => v === null || v === undefined)) return null; // exige las 3, sin excepcion
  return Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 10) / 10;
}

/**
 * Calcula el Standard Threshold Shift (STS) segun OSHA 29 CFR 1910.95.
 *
 * El STS es el cambio en el promedio de 2000, 3000 y 4000 Hz comparado
 * con la audiometria basal del mismo trabajador. Un STS >= +10 dB
 * en cualquiera de los dos oidos constituye una "perdida auditiva
 * relacionada con el trabajo" reportable segun OSHA.
 *
 * Nota sobre la correccion por edad (OSHA permite aplicar factores de
 * correccion por presbiacusia para determinar si el STS es reportable):
 * esta implementacion calcula el STS "crudo" sin correccion por edad,
 * que es el valor clinicamente relevante para vigilancia en salud
 * ocupacional; la correccion es opcional y se puede aplicar en el
 * informe si el medico lo considera pertinente.
 *
 * @param {{ hz2000, hz3000, hz4000 }} actual - umbrales del examen actual
 * @param {{ hz2000, hz3000, hz4000 }} basal - umbrales de la audiometria basal
 * @returns {{ cambio: number|null, esPositivo: boolean, datosInsuficientes: boolean }}
 */
function calcularSTS(actual, basal) {
  const promedioActual = calcularPromedioAgudos(actual.hz2000, actual.hz3000, actual.hz4000);
  const promedioBasal = calcularPromedioAgudos(basal.hz2000, basal.hz3000, basal.hz4000);

  // CORREGIDO en Auditoria N.12 (G12-01): datosInsuficientes queda
  // explicito en el resultado (no solo cambio=null) para que el
  // controlador/frontend puedan distinguir "no hay STS porque esta
  // dentro de rango normal" de "no se pudo calcular por falta de
  // una frecuencia critica" -- son situaciones clinicas distintas.
  if (promedioActual === null || promedioBasal === null) {
    return { cambio: null, esPositivo: false, datosInsuficientes: true };
  }

  const cambio = Math.round((promedioActual - promedioBasal) * 10) / 10;
  return {
    cambio,
    esPositivo: cambio >= 10, // alerta OSHA: cambio >= 10 dB
    datosInsuficientes: false,
  };
}

/**
 * Detecta un patron de tamizaje compatible con notch ocupacional en
 * 3000-4000-6000 Hz (hallazgo de TAMIZAJE, no diagnostico de
 * hipoacusia inducida por ruido -- ver nota extendida mas abajo).
 *
 * CORREGIDO en Auditoria N.12 (hallazgo GRAVE G12-04, P1): la
 * geometria exacta del notch (profundidad, recuperacion en 8 kHz,
 * distincion con presbiacusia/perdida conductiva) es mas compleja
 * que "maximo de 3-4-6k supera en 15 dB a la referencia baja", y esa
 * simplificacion puede generar falsos positivos (ej. presbiacusia
 * temprana con caida gradual, sin verdadera geometria en V). Por
 * eso:
 *   1. Esta funcion se mantiene como TAMIZAJE explicito, nunca como
 *      diagnostico -- ver el codigo de patron devuelto por
 *      clasificarPatron(), renombrado a 'notch_ocupacional_tamizaje'.
 *   2. La condicion de "recuperacion" en 8000 Hz ahora es
 *      obligatoria cuando el dato existe (antes solo se usaba para
 *      DESCARTAR, nunca exigia una recuperacion minima real).
 *   3. Debe complementarse con revision del medico ocupacional y,
 *      quedo pendiente como trabajo futuro (no bloqueante para esta
 *      correccion): banco de pruebas con curvas normales,
 *      presbiacusia, ruido puro y perdida conductiva/mixta (ver
 *      CAPA-06 y tests/audiometria del plan de correccion).
 *
 * @param {{ hz1000, hz2000, hz3000, hz4000, hz6000, hz8000 }} umbrales
 * @returns {boolean}
 */
function tieneNotchOcupacional(umbrales) {
  const { hz1000, hz2000, hz3000, hz4000, hz6000, hz8000 } = umbrales;

  if (hz3000 === null && hz4000 === null && hz6000 === null) return false;

  // Referencia: la pendiente normal a partir de 1000 Hz
  // Un notch existe si alguna de las frecuencias criticas supera
  // significativamente la media entre las frecuencias flanqueantes.
  const frecsCriticas = [hz3000, hz4000, hz6000].filter(v => v !== null);
  if (frecsCriticas.length === 0) return false;

  const maxCritica = Math.max(...frecsCriticas);
  const refBaja = hz1000 ?? hz2000;     // frecuencia baja de referencia
  const refAlta = hz8000;               // frecuencia alta de referencia

  // El notch existe si la perdida en la zona critica supera en al
  // menos 15 dB la frecuencia baja de referencia, Y la perdida se
  // recupera parcialmente a 8000 Hz (o no tenemos dato de 8000).
  if (refBaja === null) return false;

  const hayNotch = maxCritica >= refBaja + 15;
  if (!hayNotch) return false;

  // CORREGIDO en Auditoria N.12 (G12-04): antes, la ausencia de dato
  // en 8000 Hz simplemente omitia la verificacion de recuperacion
  // (dejaba pasar el notch sin comprobar la "V"). Ahora, si NO hay
  // dato de 8000 Hz, se exige recuperacion respecto de 6000 Hz como
  // sustituto minimo -- un notch verdadero por ruido tipicamente no
  // seguiria empeorando de forma monotona hacia agudos.
  if (refAlta !== null) {
    if (refAlta >= maxCritica) return false; // no hay V, es pendiente plana/descendente continua
    return true;
  }

  const hz6000Valor = hz6000;
  if (hz6000Valor !== null && hz6000Valor !== undefined && hz6000Valor >= maxCritica + 5) {
    // 6000 Hz sigue empeorando en vez de recuperar: patron mas
    // compatible con perdida progresiva que con notch verdadero.
    return false;
  }

  return true;
}

/**
 * Clasifica el patron audiometrico de UN oido, usando conduccion
 * aerea (obligatoria) y osea (opcional).
 *
 * Criterios (en orden de evaluacion):
 *   1. normal: PTA <= 25 dB y ninguna frecuencia > 25 dB
 *   2. notch_ocupacional_tamizaje: caida compatible con NIHL en
 *      3-4-6k Hz -- HALLAZGO DE TAMIZAJE, no diagnostico (ver
 *      tieneNotchOcupacional() y G12-04). Requiere confirmacion del
 *      medico ocupacional antes de comunicarse como hipoacusia
 *      inducida por ruido.
 *   3. conductiva: gap aereo-oseo > 10 dB en >= 2 frecuencias
 *   4. mixta: perdida en via aerea y osea, CON gap > 10 dB
 *   5. neurosensorial: perdida aerea, SIN gap significativo (osea similar)
 *   6. presbiacusia: perdida progresiva en agudos, bilateral, sin notch
 *   7. no_clasificable: datos insuficientes
 *
 * @param {{ hz500, hz1000, hz2000, hz3000, hz4000, hz6000, hz8000 }} aerea
 * @param {{ hz500, hz1000, hz2000, hz3000, hz4000 }|null} osea - puede ser null
 * @param {number} edadAnios - para ayudar a distinguir presbiacusia
 * @returns {string} - codigo del patron
 */
function clasificarPatron(aerea, osea, edadAnios = 0) {
  // 1. Verificar datos minimos
  const valoresAereos = Object.values(aerea).filter(v => v !== null && v !== undefined);
  if (valoresAereos.length < 3) return 'no_clasificable';

  // 2. Normal
  const pta = calcularPTA(aerea.hz500, aerea.hz1000, aerea.hz2000);
  const todasNormales = valoresAereos.every(v => v <= 25);
  if (todasNormales && (pta === null || pta <= 25)) return 'normal';

  // 3. Notch ocupacional -- HALLAZGO DE TAMIZAJE (tiene prioridad de
  //    evaluacion sobre neurosensorial porque cambia la conducta
  //    clinica), nunca se comunica como diagnostico confirmado.
  if (tieneNotchOcupacional(aerea)) return 'notch_ocupacional_tamizaje';

  // 4. Evaluar gap aereo-oseo si hay datos de conduccion osea
  if (osea) {
    const frecuenciasConGap = [500, 1000, 2000, 3000, 4000].filter(freq => {
      const ca = aerea[`hz${freq}`];
      const co = osea[`hz${freq}`];
      return ca !== null && ca !== undefined && co !== null && co !== undefined && (ca - co) > 10;
    });

    const hayGap = frecuenciasConGap.length >= 2;

    if (hayGap) {
      // Hay gap: determinar si es conductiva pura o mixta
      const frecuenciasConPerdidaOsea = [500, 1000, 2000, 3000, 4000].filter(freq => {
        const co = osea[`hz${freq}`];
        return co !== null && co !== undefined && co > 25;
      });
      return frecuenciasConPerdidaOsea.length >= 2 ? 'mixta' : 'conductiva';
    }

    // Sin gap significativo pero con perdida aerea: neurosensorial
    if (pta !== null && pta > 25) return 'neurosensorial';
  }

  // 5. Sin datos de conduccion osea, evaluar patron de la curva aerea
  // Presbiacusia: perdida progresiva en agudos, edad > 45 anios,
  // sin notch (ya descartado arriba).
  if (edadAnios > 45) {
    const perdidaEnAgudos = (aerea.hz4000 ?? 0) > 25 || (aerea.hz6000 ?? 0) > 25 || (aerea.hz8000 ?? 0) > 25;
    const audiccionConversacionalRelativamenteBien = pta !== null && pta <= 35;
    if (perdidaEnAgudos && audiccionConversacionalRelativamenteBien) return 'presbiacusia';
  }

  // 6. Neurosensorial presumible (perdida sin conduccion osea disponible)
  if (pta !== null && pta > 25) return 'neurosensorial';

  return 'no_clasificable';
}

/**
 * Calcula el resultado completo de un examen audiometrico:
 * PTAs, STS (si hay basal disponible), y patron de cada oido.
 *
 * @param {object} actual - umbrales del examen actual (ca_od_*, ca_oi_*, co_od_*, co_oi_*)
 * @param {object|null} basal - umbrales de la audiometria basal (misma estructura), o null
 * @param {number} edadAnios
 * @returns {object} resultado con pta_od, pta_oi, sts_od, sts_oi, sts_od_positivo,
 *                    sts_oi_positivo, patron_od, patron_oi
 */
function calcularAudiometria(actual, basal, edadAnios = 0) {
  const ptaOd = calcularPTA(actual.ca_od_500, actual.ca_od_1000, actual.ca_od_2000);
  const ptaOi = calcularPTA(actual.ca_oi_500, actual.ca_oi_1000, actual.ca_oi_2000);

  let stsOd = null, stsOi = null, stsOdPositivo = false, stsOiPositivo = false;

  if (basal) {
    const resultOd = calcularSTS(
      { hz2000: actual.ca_od_2000, hz3000: actual.ca_od_3000, hz4000: actual.ca_od_4000 },
      { hz2000: basal.ca_od_2000, hz3000: basal.ca_od_3000, hz4000: basal.ca_od_4000 }
    );
    stsOd = resultOd.cambio;
    stsOdPositivo = resultOd.esPositivo;

    const resultOi = calcularSTS(
      { hz2000: actual.ca_oi_2000, hz3000: actual.ca_oi_3000, hz4000: actual.ca_oi_4000 },
      { hz2000: basal.ca_oi_2000, hz3000: basal.ca_oi_3000, hz4000: basal.ca_oi_4000 }
    );
    stsOi = resultOi.cambio;
    stsOiPositivo = resultOi.esPositivo;
  }

  const patronOd = clasificarPatron(
    { hz500: actual.ca_od_500, hz1000: actual.ca_od_1000, hz2000: actual.ca_od_2000,
      hz3000: actual.ca_od_3000, hz4000: actual.ca_od_4000, hz6000: actual.ca_od_6000, hz8000: actual.ca_od_8000 },
    actual.co_od_500 !== undefined ? {
      hz500: actual.co_od_500, hz1000: actual.co_od_1000, hz2000: actual.co_od_2000,
      hz3000: actual.co_od_3000, hz4000: actual.co_od_4000
    } : null,
    edadAnios
  );

  const patronOi = clasificarPatron(
    { hz500: actual.ca_oi_500, hz1000: actual.ca_oi_1000, hz2000: actual.ca_oi_2000,
      hz3000: actual.ca_oi_3000, hz4000: actual.ca_oi_4000, hz6000: actual.ca_oi_6000, hz8000: actual.ca_oi_8000 },
    actual.co_oi_500 !== undefined ? {
      hz500: actual.co_oi_500, hz1000: actual.co_oi_1000, hz2000: actual.co_oi_2000,
      hz3000: actual.co_oi_3000, hz4000: actual.co_oi_4000
    } : null,
    edadAnios
  );

  return { ptaOd, ptaOi, stsOd, stsOi, stsOdPositivo, stsOiPositivo, patronOd, patronOi };
}

module.exports = {
  calcularAudiometria,
  calcularPTA,
  calcularPromedioAgudos,
  calcularSTS,
  tieneNotchOcupacional,
  clasificarPatron,
};
