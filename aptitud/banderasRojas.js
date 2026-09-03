// ============================================================
// SISSO - Motor de banderas rojas de signos vitales.
//
// CREADO en Auditoria N.13 (hallazgo GRAVE G-05, P1): la plataforma
// almacenaba presion arterial, saturacion, frecuencia cardiaca y
// frecuencia respiratoria sin ninguna capa que sinalizara
// combinaciones/valores potencialmente peligrosos -- un valor
// critico podia quedar guardado en la historia clinica sin generar
// ninguna alerta, incluso si la evaluacion terminaba en una aptitud
// laboral.
//
// DISEÑO IMPORTANTE: este motor es DELIBERADAMENTE independiente del
// motor de aptitud (motorContraindicaciones.js). Su unica salida es
// "requiere revision medica" mas el detalle de que umbral se
// disparo -- NUNCA un diagnostico, NUNCA una recomendacion de
// aptitud. Los umbrales usados son puntos de corte de emergencia
// ampliamente reconocidos en la practica clinica general (crisis
// hipertensiva, hipoxemia significativa, taquicardia/bradicardia
// marcadas, taquipnea/bradipnea marcadas) -- no son un calculo de
// referencia poblacional como el LLN de espirometria (ver C-01), por
// lo que no llevan la misma advertencia de "aproximacion interina".
// Aun asi, estos umbrales son de alerta temprana, no criterios
// diagnosticos: la decision clinica sigue siendo siempre del medico.
// ============================================================

const UMBRALES = {
  paSistolicaCritAlta: 180, paSistolicaCritBaja: 90,
  paDiastolicaCritAlta: 110,
  fcTaquicardia: 120, fcBradicardia: 50,
  spo2Critico: 90,
  frTaquipnea: 24, frBradipnea: 10,
};

/**
 * Evalua los signos vitales de una evaluacion y devuelve las
 * banderas rojas detectadas.
 *
 * @param {object} signos - { presionArterialSistolica, presionArterialDiastolica,
 *   frecuenciaCardiaca, saturacionOxigeno, frecuenciaRespiratoria }
 * @returns {{ banderas: Array<{codigo, descripcion, valor}>, requiereRevisionPrioritaria: boolean }}
 */
function detectarBanderasRojasSignosVitales(signos) {
  const banderas = [];
  const s = signos || {};

  if (typeof s.presionArterialSistolica === 'number' && typeof s.presionArterialDiastolica === 'number') {
    if (s.presionArterialSistolica >= UMBRALES.paSistolicaCritAlta || s.presionArterialDiastolica >= UMBRALES.paDiastolicaCritAlta) {
      banderas.push({ codigo: 'crisis_hipertensiva', descripcion: `Presion arterial ${s.presionArterialSistolica}/${s.presionArterialDiastolica} mmHg en rango de crisis hipertensiva.`, valor: `${s.presionArterialSistolica}/${s.presionArterialDiastolica}` });
    }
  }
  if (typeof s.presionArterialSistolica === 'number' && s.presionArterialSistolica < UMBRALES.paSistolicaCritBaja) {
    banderas.push({ codigo: 'hipotension_severa', descripcion: `Presion arterial sistolica ${s.presionArterialSistolica} mmHg, por debajo de ${UMBRALES.paSistolicaCritBaja}.`, valor: s.presionArterialSistolica });
  }
  if (typeof s.frecuenciaCardiaca === 'number') {
    if (s.frecuenciaCardiaca >= UMBRALES.fcTaquicardia) {
      banderas.push({ codigo: 'taquicardia_marcada', descripcion: `Frecuencia cardiaca ${s.frecuenciaCardiaca} lat/min, >= ${UMBRALES.fcTaquicardia}.`, valor: s.frecuenciaCardiaca });
    } else if (s.frecuenciaCardiaca <= UMBRALES.fcBradicardia) {
      banderas.push({ codigo: 'bradicardia_marcada', descripcion: `Frecuencia cardiaca ${s.frecuenciaCardiaca} lat/min, <= ${UMBRALES.fcBradicardia}.`, valor: s.frecuenciaCardiaca });
    }
  }
  if (typeof s.saturacionOxigeno === 'number' && s.saturacionOxigeno < UMBRALES.spo2Critico) {
    banderas.push({ codigo: 'hipoxemia_significativa', descripcion: `Saturacion de oxigeno ${s.saturacionOxigeno}%, por debajo de ${UMBRALES.spo2Critico}%.`, valor: s.saturacionOxigeno });
  }
  if (typeof s.frecuenciaRespiratoria === 'number') {
    if (s.frecuenciaRespiratoria >= UMBRALES.frTaquipnea) {
      banderas.push({ codigo: 'taquipnea_marcada', descripcion: `Frecuencia respiratoria ${s.frecuenciaRespiratoria} resp/min, >= ${UMBRALES.frTaquipnea}.`, valor: s.frecuenciaRespiratoria });
    } else if (s.frecuenciaRespiratoria <= UMBRALES.frBradipnea) {
      banderas.push({ codigo: 'bradipnea_marcada', descripcion: `Frecuencia respiratoria ${s.frecuenciaRespiratoria} resp/min, <= ${UMBRALES.frBradipnea}.`, valor: s.frecuenciaRespiratoria });
    }
  }

  return { banderas, requiereRevisionPrioritaria: banderas.length > 0 };
}

module.exports = { detectarBanderasRojasSignosVitales, UMBRALES };
