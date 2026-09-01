// ============================================================
// SISSO - Calculos y validaciones del formulario preocupacional
// (HCU 077). Funciones puras, igual patron que reba.js, rula.js,
// audiometria.js y espirometria.js.
// ============================================================
const {
  RIESGOS_FISICOS, RIESGOS_MECANICOS, RIESGOS_QUIMICOS,
  RIESGOS_BIOLOGICOS, RIESGOS_ERGONOMICOS, RIESGOS_PSICOSOCIALES,
} = require('./catalogosRiesgo');
const { validarContraEsquema } = require('../utils/validarEsquemaJson');

const CATALOGOS_RIESGO_POR_CATEGORIA = {
  riesgosFisicos: RIESGOS_FISICOS,
  riesgosMecanicos: RIESGOS_MECANICOS,
  riesgosQuimicos: RIESGOS_QUIMICOS,
  riesgosBiologicos: RIESGOS_BIOLOGICOS,
  riesgosErgonomicos: RIESGOS_ERGONOMICOS,
  riesgosPsicosociales: RIESGOS_PSICOSOCIALES,
};

// ------------------------------------------------------------
// CREADO en Auditoria N.13 (hallazgo CRITICO C-05, P0): esquemas
// JSON Schema (ver src/utils/validarEsquemaJson.js) para los
// bloques JSONB clinicos de Historia Clinica Ocupacional que
// llegaban al INSERT "tal cual", sin ninguna validacion de forma.
//
// ALCANCE DE ESTA CORRECCION: se cubren los bloques de estructura
// finita y bien documentada (D, L, M y los antecedentes de bloque
// D/E) que ademas alimentan directamente otros modulos (M.
// `diagnosticos` es la fuente que C-03 usa para derivar
// automaticamente el motor de aptitud). Los bloques I (revision de
// organos y sistemas) y K (examen fisico regional, 13 regiones con
// sub-objetos anidados) quedan documentados como pendientes: son
// estructuras mucho mas profundas y su validacion merece revisarse
// con un medico antes de fijar un esquema que podria rechazar
// hallazgos clinicos legitimos por un formato no previsto. No
// implementarlos ahora es preferible a fijar un esquema incorrecto
// que bloquee documentacion clinica real.
// ------------------------------------------------------------

const ESQUEMA_DIAGNOSTICO = {
  type: 'object',
  additionalProperties: false,
  required: ['descripcion', 'tipo', 'condicion'],
  properties: {
    descripcion: { type: 'string' },
    codigoCie10: { type: 'string', nullable: true },
    tipo: { type: 'string', enum: ['enfermedad_profesional', 'enfermedad_comun'] },
    condicion: { type: 'string', enum: ['presuntivo', 'definitivo'] },
  },
};
const ESQUEMA_DIAGNOSTICOS = { type: 'array', items: ESQUEMA_DIAGNOSTICO };

const ESQUEMA_RESULTADO_EXAMEN = {
  type: 'object',
  additionalProperties: false,
  required: ['examen'],
  properties: {
    examen: { type: 'string' },
    fecha: { type: 'string', nullable: true },
    resultado: { type: 'string', nullable: true },
  },
};
const ESQUEMA_RESULTADOS_EXAMENES = { type: 'array', items: ESQUEMA_RESULTADO_EXAMEN };

const ESQUEMA_ANTECEDENTE_LABORAL = {
  type: 'object',
  additionalProperties: false,
  required: ['empresa'],
  properties: {
    empresa: { type: 'string' },
    puestoTrabajo: { type: 'string', nullable: true },
    actividades: { type: 'string', nullable: true },
    tiempoMeses: { type: 'integer', minimum: 0, nullable: true },
    riesgos: { type: 'array', items: { type: 'string' } },
    observaciones: { type: 'string', nullable: true },
  },
};
const ESQUEMA_ANTECEDENTES_LABORALES_PREVIOS = { type: 'array', items: ESQUEMA_ANTECEDENTE_LABORAL };

// accidentes_trabajo_previos y enfermedades_profesionales_previas
// comparten la misma forma documentada en migration_014.
const ESQUEMA_ANTECEDENTE_EVENTO_PREVIO = {
  type: 'object',
  additionalProperties: false,
  required: ['fueCalificado'],
  properties: {
    fueCalificado: { type: 'boolean' },
    especificarEntidad: { type: 'string', nullable: true },
    fecha: { type: 'string', nullable: true },
    observaciones: { type: 'string', nullable: true },
  },
};

const ESQUEMA_ANTECEDENTES_FAMILIARES = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cardiovascular: { type: 'string', nullable: true },
    metabolica: { type: 'string', nullable: true },
    neurologica: { type: 'string', nullable: true },
    oncologica: { type: 'string', nullable: true },
    infecciosa: { type: 'string', nullable: true },
    hereditariaCongenita: { type: 'string', nullable: true },
    discapacidades: { type: 'string', nullable: true },
    otros: { type: 'string', nullable: true },
  },
};

/**
 * Valida los bloques JSONB de Historia Clinica Ocupacional que
 * tienen esquema definido (ver comentario arriba sobre alcance).
 * Cada bloque es opcional (puede venir null/undefined); si viene,
 * debe cumplir su esquema.
 *
 * @param {object} b - el body de la peticion (registrarInicio/registrarPeriodica/etc.)
 * @returns {string[]} errores (vacio si todo es valido)
 */
function validarBloquesJsonbHistoriaClinica(b) {
  const errores = [];
  if (b.diagnosticos !== undefined && b.diagnosticos !== null) {
    errores.push(...validarContraEsquema(b.diagnosticos, ESQUEMA_DIAGNOSTICOS, 'diagnosticos'));
  }
  if (b.resultadosExamenes !== undefined && b.resultadosExamenes !== null) {
    errores.push(...validarContraEsquema(b.resultadosExamenes, ESQUEMA_RESULTADOS_EXAMENES, 'resultadosExamenes'));
  }
  if (b.antecedentesLaboralesPrevios !== undefined && b.antecedentesLaboralesPrevios !== null) {
    errores.push(...validarContraEsquema(b.antecedentesLaboralesPrevios, ESQUEMA_ANTECEDENTES_LABORALES_PREVIOS, 'antecedentesLaboralesPrevios'));
  }
  if (b.accidentesTrabajoPrevios !== undefined && b.accidentesTrabajoPrevios !== null) {
    errores.push(...validarContraEsquema(b.accidentesTrabajoPrevios, ESQUEMA_ANTECEDENTE_EVENTO_PREVIO, 'accidentesTrabajoPrevios'));
  }
  if (b.enfermedadesProfesionalesPrevias !== undefined && b.enfermedadesProfesionalesPrevias !== null) {
    errores.push(...validarContraEsquema(b.enfermedadesProfesionalesPrevias, ESQUEMA_ANTECEDENTE_EVENTO_PREVIO, 'enfermedadesProfesionalesPrevias'));
  }
  if (b.antecedentesFamiliares !== undefined && b.antecedentesFamiliares !== null) {
    errores.push(...validarContraEsquema(b.antecedentesFamiliares, ESQUEMA_ANTECEDENTES_FAMILIARES, 'antecedentesFamiliares'));
  }
  return errores;
}

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

module.exports = { calcularImc, validarFactoresRiesgo, validarBloquesJsonbHistoriaClinica };
