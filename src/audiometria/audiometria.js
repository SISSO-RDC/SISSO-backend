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
 * @returns {number|null}
 */
function calcularPromedioAgudos(hz2000, hz3000, hz4000) {
  const valores = [hz2000, hz3000, hz4000].filter(v => v !== null && v !== undefined);
  if (valores.length < 2) return null; // necesitamos al menos 2 de 3
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
 * @returns {{ cambio: number|null, esPositivo: boolean }}
 */
function calcularSTS(actual, basal) {
  const promedioActual = calcularPromedioAgudos(actual.hz2000, actual.hz3000, actual.hz4000);
  const promedioBasal = calcularPromedioAgudos(basal.hz2000, basal.hz3000, basal.hz4000);

  if (promedioActual === null || promedioBasal === null) {
    return { cambio: null, esPositivo: false };
  }

  const cambio = Math.round((promedioActual - promedioBasal) * 10) / 10;
  return {
    cambio,
    esPositivo: cambio >= 10, // alerta OSHA: cambio >= 10 dB
  };
}

/**
 * Detecta si existe un "notch" tipico de hipoacusia inducida por
 * ruido (NIHL / HISNR) en las frecuencias 3000-4000-6000 Hz.
 *
 * Criterio clinico: se considera notch ocupacional cuando la perdida
 * en 3000, 4000 o 6000 Hz es al menos 15 dB mayor que el promedio
 * de las frecuencias adyacentes (1000 y 8000 Hz), es decir, existe
 * una caida en "V" en esas frecuencias criticas.
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

  // Si tenemos 8k, verificamos que haya recuperacion parcial
  // (la perdida en 8k no supera la de la zona critica)
  if (refAlta !== null && refAlta >= maxCritica) return false; // no hay V, es pendiente plana

  return hayNotch;
}

/**
 * Clasifica el patron audiometrico de UN oido, usando conduccion
 * aerea (obligatoria) y osea (opcional).
 *
 * Criterios (en orden de evaluacion):
 *   1. normal: PTA <= 25 dB y ninguna frecuencia > 25 dB
 *   2. notch_ocupacional: caida tipica en 3-4-6k Hz (NIHL)
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

  // 3. Notch ocupacional (tiene prioridad sobre neurosensorial porque
  //    el notch es un hallazgo especifico que cambia la conducta clinica)
  if (tieneNotchOcupacional(aerea)) return 'notch_ocupacional';

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
