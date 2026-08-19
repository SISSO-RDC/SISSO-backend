// ============================================================
// SISSO - Calculos y validaciones del formulario preocupacional
// (HCU 077). Funciones puras, igual patron que reba.js, rula.js,
// audiometria.js y espirometria.js.
// ============================================================
const {
  RIESGOS_FISICOS, RIESGOS_MECANICOS, RIESGOS_QUIMICOS,
  RIESGOS_BIOLOGICOS, RIESGOS_ERGONOMICOS, RIESGOS_PSICOSOCIALES,
} = require('./catalogosRiesgo');

const CATALOGOS_RIESGO_POR_CATEGORIA = {
  riesgosFisicos: RIESGOS_FISICOS,
  riesgosMecanicos: RIESGOS_MECANICOS,
  riesgosQuimicos: RIESGOS_QUIMICOS,
  riesgosBiologicos: RIESGOS_BIOLOGICOS,
  riesgosErgonomicos: RIESGOS_ERGONOMICOS,
  riesgosPsicosociales: RIESGOS_PSICOSOCIALES,
};

/**
 * Calcula el Indice de Masa Corporal.
 * @param {number} pesoKg
 * @param {number} tallaCm
 * @returns {number|null} redondeado a 1 decimal
 */
function calcularImc(pesoKg, tallaCm) {
  if (!pesoKg || !tallaCm) return null;
  const tallaM = tallaCm / 100;
  const imc = pesoKg / (tallaM * tallaM);
  return Math.round(imc * 10) / 10;
}

/**
 * Valida que el objeto factoresRiesgoActual (Bloque F) solo
 * contenga valores permitidos en cada categoria de riesgo, segun
 * la taxonomia fija del formulario oficial MSP. Devuelve un
 * mensaje de error (string) o null si todo esta bien.
 *
 * @param {object} factoresRiesgo - { riesgosFisicos: [...], riesgosMecanicos: [...], ... }
 * @returns {string|null}
 */
function validarFactoresRiesgo(factoresRiesgo) {
  if (!factoresRiesgo || typeof factoresRiesgo !== 'object') return null; // bloque opcional

  for (const [campo, catalogoValido] of Object.entries(CATALOGOS_RIESGO_POR_CATEGORIA)) {
    const valores = factoresRiesgo[campo];
    if (valores === undefined || valores === null) continue;
    if (!Array.isArray(valores)) {
      return `${campo} debe ser una lista de valores.`;
    }
    for (const valor of valores) {
      // "otros" siempre se acepta con texto libre, ej "otros:sustancia_x"
      if (typeof valor === 'string' && valor.startsWith('otros')) continue;
      if (!catalogoValido.includes(valor)) {
        return `${campo} contiene un valor no reconocido: "${valor}".`;
      }
    }
  }
  return null;
}

module.exports = { calcularImc, validarFactoresRiesgo };
