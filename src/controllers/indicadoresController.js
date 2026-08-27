// ============================================================
// Controlador de Indicadores SSO — dashboard consolidado de
// KPIs de seguridad y salud ocupacional.
//
// Este endpoint no tiene tabla propia: agrega en tiempo real
// datos que ya viven en otras tablas (trabajadores, examenes
// de audiometria/espirometria/visiometria, matriz de riesgos,
// nordico, NIOSH, consentimientos). El frontend
// (indicadores/indicadores.js) ya estaba construido esperando
// exactamente esta forma de JSON; este controller es lo unico
// que faltaba para que la pagina funcione.
//
// Todos los "ultimos 12 meses" se calculan sobre la fecha del
// examen/evaluacion (no la fecha de creacion del registro), para
// que el indicador refleje la cobertura real del periodo.
//
// CORREGIDO en Auditoria N.08 (hallazgo GRAVE G-N08-01, P1): antes,
// cualquier rol autenticado recibia el JSON completo -- incluida
// la distribucion de aptitud medica y el desglose de hallazgos
// anormales de audiometria/espirometria/visiometria, que son
// agregados con relevancia clinica, no solo de gestion. Se aplica
// ahora una proyeccion por rol (`proyectarIndicadoresSegunRol`)
// sobre la MISMA respuesta ya calculada, siguiendo la matriz que
// pide la auditoria:
//   - medico: indicadores clinicos de vigilancia (aptitud,
//     cobertura y hallazgos anormales de examenes, consentimientos).
//   - sso: indicadores preventivos/SST (matriz de riesgos,
//     ergonomia, cobertura de examenes, consentimientos) SIN el
//     desglose de aptitud individual ni de hallazgos anormales
//     especificos.
//   - th: gestion de personal (total de trabajadores, cobertura de
//     EMO) -- nada clinico ni de SST operativo.
//   - admin: gestion empresarial (total, cobertura EMO, cobertura
//     de examenes como metrica de cumplimiento, matriz de riesgos y
//     consentimientos como exposicion legal/de negocio) sin
//     convertirse en lector clinico (sin aptitud ni hallazgos
//     anormales detallados).
// ============================================================
const { query } = require('../db/pool');

function pct(numerador, denominador) {
  if (!denominador || denominador === 0) return 0;
  return Math.round((numerador / denominador) * 1000) / 10; // 1 decimal
}

const MATRIZ_RIESGOS_VACIA = {
  total: 0,
  porcentajeAltoRiesgo: 0,
  porClasificacion: { trivial: 0, tolerable: 0, moderado: 0, importante: 0, intolerable: 0 },
};
const ERGONOMIA_VACIA = {
  nordico: { total: 0, prioritarios: 0, porcentaje: 0 },
  niosh: { total: 0, altoRiesgo: 0, porcentaje: 0 },
};
const APTITUD_MEDICA_VACIA = { apto: 0, conRestricciones: 0, noApto: 0, pendiente: 0, porcentajeApto: 0 };
const EXAMEN_VACIO = { trabajadores: 0, porcentaje: 0 };
const COBERTURA_EXAMENES_VACIA = { audiometria: EXAMEN_VACIO, espirometria: EXAMEN_VACIO, visiometria: EXAMEN_VACIO };
const HALLAZGO_ANORMAL_VACIO = { total: 0, anormales: 0, porcentaje: 0 };
const HALLAZGOS_ANORMALES_VACIOS = { audiometria: HALLAZGO_ANORMAL_VACIO, espirometria: HALLAZGO_ANORMAL_VACIO, visiometria: HALLAZGO_ANORMAL_VACIO };
const CONSENTIMIENTOS_VACIO = { total: 0, electronica: 0, fisica: 0, revocados: 0, porcentajeRevocados: 0 };

/**
 * Proyecta el objeto de indicadores ya calculado segun el rol de
 * quien consulta. Ver comentario de cabecera del archivo para la
 * matriz completa.
 *
 * CORREGIDO tras reporte de la persona usuaria (26/08/2026): la
 * version anterior OMITIA por completo la clave de cada seccion que
 * el rol no debia ver (ej. `matrizRiesgos` no existia en absoluto en
 * la respuesta para 'medico'). Eso es correcto desde seguridad --el
 * dato real nunca viajaba-- pero el frontend (indicadores.js) nunca
 * fue actualizado para verificar que una seccion exista antes de
 * leer sus subpropiedades (ej. `datos.matrizRiesgos.total`), asi que
 * terminaba lanzando "Cannot read properties of undefined (reading
 * 'total')" para cualquier rol distinto del que tiene la vista mas
 * completa. En vez de omitir la clave, ahora se devuelve un
 * placeholder con la MISMA forma que la seccion real pero en cero, y
 * se marca con `_restringido: true` para que el frontend (si se
 * actualiza mas adelante) pueda distinguir "sin datos" de "no
 * autorizado para tu rol". El dato real sigue sin viajar nunca: esto
 * no reabre el hallazgo G-N08-01, solo evita que la ausencia de un
 * campo tumbe la pagina.
 */
function proyectarIndicadoresSegunRol(indicadores, rol) {
  const { totalTrabajadores, coberturaEmo, aptitudMedica, coberturaExamenes, hallazgosAnormales, matrizRiesgos, ergonomia, consentimientos } = indicadores;

  if (rol === 'medico') {
    return {
      totalTrabajadores, coberturaEmo, aptitudMedica, coberturaExamenes, hallazgosAnormales, consentimientos,
      matrizRiesgos: { ...MATRIZ_RIESGOS_VACIA, _restringido: true },
      ergonomia: { ...ERGONOMIA_VACIA, _restringido: true },
    };
  }
  if (rol === 'sso') {
    return {
      totalTrabajadores, coberturaEmo, coberturaExamenes, matrizRiesgos, ergonomia, consentimientos,
      aptitudMedica: { ...APTITUD_MEDICA_VACIA, _restringido: true },
      hallazgosAnormales: { ...HALLAZGOS_ANORMALES_VACIOS, _restringido: true },
    };
  }
  if (rol === 'th') {
    return {
      totalTrabajadores, coberturaEmo,
      aptitudMedica: { ...APTITUD_MEDICA_VACIA, _restringido: true },
      coberturaExamenes: { ...COBERTURA_EXAMENES_VACIA, _restringido: true },
      hallazgosAnormales: { ...HALLAZGOS_ANORMALES_VACIOS, _restringido: true },
      matrizRiesgos: { ...MATRIZ_RIESGOS_VACIA, _restringido: true },
      ergonomia: { ...ERGONOMIA_VACIA, _restringido: true },
      consentimientos: { ...CONSENTIMIENTOS_VACIO, _restringido: true },
    };
  }
  // admin: gestion empresarial, sin convertirse en lector clinico.
  return {
    totalTrabajadores, coberturaEmo, coberturaExamenes, matrizRiesgos, consentimientos,
    aptitudMedica: { ...APTITUD_MEDICA_VACIA, _restringido: true },
    hallazgosAnormales: { ...HALLAZGOS_ANORMALES_VACIOS, _restringido: true },
    ergonomia: { ...ERGONOMIA_VACIA, _restringido: true },
  };
}

async function obtenerIndicadores(req, res) {
  const orgId = req.usuario.organizacionId;

  try {
    const [
      totalTrabajadoresRes,
      coberturaEmoRes,
      aptitudRes,
      audiometriaCoberturaRes,
      espirometriaCoberturaRes,
      visiometriaCoberturaRes,
      audiometriaAnormalRes,
      espirometriaAnormalRes,
      visiometriaAnormalRes,
      matrizRiesgosRes,
      nordicoRes,
      nioshRes,
      consentimientosRes,
    ] = await Promise.all([

      // ---- Total de trabajadores activos ----
      query(
        `SELECT COUNT(*) AS total FROM trabajadores WHERE organizacion_id = $1 AND activo = true`,
        [orgId]
      ),

      // ---- Cobertura EMO: vigente / vencido / sin fecha ----
      query(
        `SELECT
           COUNT(*) FILTER (WHERE fecha_vencimiento IS NOT NULL AND fecha_vencimiento >= CURRENT_DATE) AS vigente,
           COUNT(*) FILTER (WHERE fecha_vencimiento IS NOT NULL AND fecha_vencimiento < CURRENT_DATE) AS vencido,
           COUNT(*) FILTER (WHERE fecha_vencimiento IS NULL) AS sin_fecha
         FROM trabajadores
         WHERE organizacion_id = $1 AND activo = true`,
        [orgId]
      ),

      // ---- Distribucion de aptitud (columna cache en trabajadores) ----
      query(
        `SELECT
           COUNT(*) FILTER (WHERE aptitud = 'apto') AS apto,
           COUNT(*) FILTER (WHERE aptitud = 'con_restricciones') AS con_restricciones,
           COUNT(*) FILTER (WHERE aptitud = 'no_apto') AS no_apto,
           COUNT(*) FILTER (WHERE aptitud = 'pendiente') AS pendiente
         FROM trabajadores
         WHERE organizacion_id = $1 AND activo = true`,
        [orgId]
      ),

      // ---- Cobertura audiometria (trabajadores distintos, ultimos 12 meses) ----
      query(
        `SELECT COUNT(DISTINCT trabajador_id) AS trabajadores
         FROM examenes_audiometria
         WHERE organizacion_id = $1 AND fecha_examen >= CURRENT_DATE - INTERVAL '12 months'`,
        [orgId]
      ),

      // ---- Cobertura espirometria ----
      query(
        `SELECT COUNT(DISTINCT trabajador_id) AS trabajadores
         FROM examenes_espirometria
         WHERE organizacion_id = $1 AND fecha_examen >= CURRENT_DATE - INTERVAL '12 months'`,
        [orgId]
      ),

      // ---- Cobertura visiometria ----
      query(
        `SELECT COUNT(DISTINCT trabajador_id) AS trabajadores
         FROM examenes_visiometria
         WHERE organizacion_id = $1 AND fecha_examen >= CURRENT_DATE - INTERVAL '12 months'`,
        [orgId]
      ),

      // ---- Hallazgos anormales: audiometria (STS positivo en cualquier oido) ----
      query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE sts_od_positivo = true OR sts_oi_positivo = true) AS anormales
         FROM examenes_audiometria
         WHERE organizacion_id = $1 AND fecha_examen >= CURRENT_DATE - INTERVAL '12 months'`,
        [orgId]
      ),

      // ---- Hallazgos anormales: espirometria (patron distinto de normal/no_clasificable) ----
      query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE patron IS NOT NULL AND patron NOT IN ('normal', 'no_clasificable')) AS anormales
         FROM examenes_espirometria
         WHERE organizacion_id = $1 AND fecha_examen >= CURRENT_DATE - INTERVAL '12 months'`,
        [orgId]
      ),

      // ---- Hallazgos anormales: visiometria (requiere evaluacion oftalmologica o no apto) ----
      query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE aptitud_definida IN ('requiere_evaluacion_oftalmologica', 'no_apto')
                               OR vision_monocular_severa = true) AS anormales
         FROM examenes_visiometria
         WHERE organizacion_id = $1 AND fecha_examen >= CURRENT_DATE - INTERVAL '12 months'`,
        [orgId]
      ),

      // ---- Matriz de riesgos: total y distribucion por clasificacion ----
      query(
        `SELECT clasificacion, COUNT(*) AS cantidad
         FROM matriz_riesgos
         WHERE organizacion_id = $1 AND activo = true
         GROUP BY clasificacion`,
        [orgId]
      ),

      // ---- Cuestionario Nordico: zonas prioritarias, ultimos 12 meses ----
      query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE requiere_atencion_prioritaria = true) AS prioritarios
         FROM cuestionarios_nordicos
         WHERE organizacion_id = $1 AND fecha_aplicacion >= CURRENT_DATE - INTERVAL '12 months'`,
        [orgId]
      ),

      // ---- NIOSH: riesgo alto/muy alto, ultimos 12 meses ----
      query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE clasificacion IN ('riesgo_alto', 'riesgo_muy_alto')) AS alto_riesgo
         FROM evaluaciones_niosh
         WHERE organizacion_id = $1 AND fecha_evaluacion >= CURRENT_DATE - INTERVAL '12 months'`,
        [orgId]
      ),

      // ---- Consentimientos: total, metodo de firma, revocados ----
      query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE metodo_firma = 'electronica') AS electronica,
           COUNT(*) FILTER (WHERE metodo_firma = 'fisica_escaneada') AS fisica,
           COUNT(*) FILTER (WHERE revocado = true) AS revocados
         FROM consentimientos_firmados
         WHERE organizacion_id = $1`,
        [orgId]
      ),
    ]);

    const totalTrabajadores = parseInt(totalTrabajadoresRes.rows[0].total, 10);

    const emo = coberturaEmoRes.rows[0];
    const vigente = parseInt(emo.vigente, 10);
    const vencido = parseInt(emo.vencido, 10);
    const sinFecha = parseInt(emo.sin_fecha, 10);

    const apt = aptitudRes.rows[0];
    const aptoCount = parseInt(apt.apto, 10);

    const audCobertura = parseInt(audiometriaCoberturaRes.rows[0].trabajadores, 10);
    const espCobertura = parseInt(espirometriaCoberturaRes.rows[0].trabajadores, 10);
    const visCobertura = parseInt(visiometriaCoberturaRes.rows[0].trabajadores, 10);

    const audAnormal = audiometriaAnormalRes.rows[0];
    const espAnormal = espirometriaAnormalRes.rows[0];
    const visAnormal = visiometriaAnormalRes.rows[0];

    const clasificacionesMatriz = ['trivial', 'tolerable', 'moderado', 'importante', 'intolerable'];
    const porClasificacion = {};
    let totalMatriz = 0;
    let altoRiesgoMatriz = 0;
    for (const fila of matrizRiesgosRes.rows) {
      const cantidad = parseInt(fila.cantidad, 10);
      const clave = fila.clasificacion || 'sin_clasificar';
      porClasificacion[clave] = cantidad;
      totalMatriz += cantidad;
      if (clave === 'importante' || clave === 'intolerable') altoRiesgoMatriz += cantidad;
    }
    // Aseguramos que las 5 clasificaciones aparezcan aunque tengan 0, para que el frontend siempre las muestre.
    for (const c of clasificacionesMatriz) {
      if (!(c in porClasificacion)) porClasificacion[c] = 0;
    }

    const nordico = nordicoRes.rows[0];
    const niosh = nioshRes.rows[0];
    const cons = consentimientosRes.rows[0];
    const totalConsentimientos = parseInt(cons.total, 10);

    return res.json(proyectarIndicadoresSegunRol({
      totalTrabajadores,

      coberturaEmo: {
        vigente,
        vencido,
        sinFecha,
        porcentajeVigente: pct(vigente, totalTrabajadores),
      },

      aptitudMedica: {
        apto: aptoCount,
        conRestricciones: parseInt(apt.con_restricciones, 10),
        noApto: parseInt(apt.no_apto, 10),
        pendiente: parseInt(apt.pendiente, 10),
        porcentajeApto: pct(aptoCount, totalTrabajadores),
      },

      coberturaExamenes: {
        audiometria: { trabajadores: audCobertura, porcentaje: pct(audCobertura, totalTrabajadores) },
        espirometria: { trabajadores: espCobertura, porcentaje: pct(espCobertura, totalTrabajadores) },
        visiometria: { trabajadores: visCobertura, porcentaje: pct(visCobertura, totalTrabajadores) },
      },

      hallazgosAnormales: {
        audiometria: {
          total: parseInt(audAnormal.total, 10),
          anormales: parseInt(audAnormal.anormales, 10),
          porcentaje: pct(parseInt(audAnormal.anormales, 10), parseInt(audAnormal.total, 10)),
        },
        espirometria: {
          total: parseInt(espAnormal.total, 10),
          anormales: parseInt(espAnormal.anormales, 10),
          porcentaje: pct(parseInt(espAnormal.anormales, 10), parseInt(espAnormal.total, 10)),
        },
        visiometria: {
          total: parseInt(visAnormal.total, 10),
          anormales: parseInt(visAnormal.anormales, 10),
          porcentaje: pct(parseInt(visAnormal.anormales, 10), parseInt(visAnormal.total, 10)),
        },
      },

      matrizRiesgos: {
        total: totalMatriz,
        porcentajeAltoRiesgo: pct(altoRiesgoMatriz, totalMatriz),
        porClasificacion,
      },

      ergonomia: {
        nordico: {
          total: parseInt(nordico.total, 10),
          prioritarios: parseInt(nordico.prioritarios, 10),
          porcentaje: pct(parseInt(nordico.prioritarios, 10), parseInt(nordico.total, 10)),
        },
        niosh: {
          total: parseInt(niosh.total, 10),
          altoRiesgo: parseInt(niosh.alto_riesgo, 10),
          porcentaje: pct(parseInt(niosh.alto_riesgo, 10), parseInt(niosh.total, 10)),
        },
      },

      consentimientos: {
        total: totalConsentimientos,
        electronica: parseInt(cons.electronica, 10),
        fisica: parseInt(cons.fisica, 10),
        revocados: parseInt(cons.revocados, 10),
        porcentajeRevocados: pct(parseInt(cons.revocados, 10), totalConsentimientos),
      },
    }, req.usuario.rol));

  } catch (err) {
    console.error('Error en obtenerIndicadores:', err);
    return res.status(500).json({ error: 'Error interno al calcular los indicadores SSO.' });
  }
}

module.exports = { obtenerIndicadores };
