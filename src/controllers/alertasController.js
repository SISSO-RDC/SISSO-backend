// ============================================================
// Controlador de Alertas: panel consolidado de senales de
// atencion agregadas de los modulos existentes. NO es un sistema
// de notificaciones persistente (no hay tabla de alertas, no hay
// estado leido/no-leido): es una vista calculada en tiempo real
// sobre los datos que ya existen en cada modulo, mismo enfoque que
// "Proximos examenes" (trabajadoresController.js).
//
// IMPORTANTE - separacion de roles: el sistema ya establece en
// otros modulos (aptitud, historia clinica) que admin NUNCA ve
// datos clinicos individuales de un trabajador. Alertas mezcla
// señales administrativas (EMOs vencidos) con señales clinicas
// (aptitud no apta, patrones anormales, STS, etc.), asi que este
// controlador filtra en el BACKEND segun el rol de quien consulta
// -no solo se oculta en el frontend-: admin y th solo reciben las
// categorias administrativas; medico y sso reciben todo.
// ============================================================
const { query } = require('../db/pool');

const LIMITE_POR_CATEGORIA = 30;
const DIAS_RECIENTE = 180; // ventana para considerar "reciente" un hallazgo clinico

// ------------------------------------------------------------
// Categorias ADMINISTRATIVAS: visibles para cualquier rol.
// ------------------------------------------------------------
async function obtenerAlertasAdministrativas(organizacionId) {
  const emosRes = await query(
    `SELECT id, nombre_completo, documento,
            (fecha_vencimiento - CURRENT_DATE) AS dias_restantes, fecha_vencimiento
     FROM trabajadores
     WHERE organizacion_id = $1 AND activo = true
       AND fecha_vencimiento IS NOT NULL
       AND fecha_vencimiento <= CURRENT_DATE + INTERVAL '15 days'
     ORDER BY fecha_vencimiento ASC
     LIMIT $2`,
    [organizacionId, LIMITE_POR_CATEGORIA]
  );

  const consentimientosRes = await query(
    `SELECT c.id, c.trabajador_id, t.nombre_completo, t.documento, tc.nombre AS tipo_consentimiento_nombre, c.revocado_en
     FROM consentimientos_firmados c
     JOIN trabajadores t ON t.id = c.trabajador_id
     JOIN tipos_consentimiento tc ON tc.codigo = c.tipo_consentimiento_codigo
     WHERE c.organizacion_id = $1 AND c.revocado = true
       AND c.revocado_en >= CURRENT_DATE - INTERVAL '${DIAS_RECIENTE} days'
     ORDER BY c.revocado_en DESC
     LIMIT $2`,
    [organizacionId, LIMITE_POR_CATEGORIA]
  );

  return {
    emos_vencidos_o_criticos: emosRes.rows,
    consentimientos_revocados: consentimientosRes.rows,
  };
}

// ------------------------------------------------------------
// Categorias CLINICAS: solo medico y sso.
// ------------------------------------------------------------
async function obtenerAlertasClinicas(organizacionId) {
  const aptitudRes = await query(
    `SELECT id, nombre_completo, documento, aptitud
     FROM trabajadores
     WHERE organizacion_id = $1 AND activo = true AND aptitud = 'no_apto'
     ORDER BY nombre_completo ASC
     LIMIT $2`,
    [organizacionId, LIMITE_POR_CATEGORIA]
  );

  const historiaClinicaRes = await query(
    `SELECT e.id, e.trabajador_id, t.nombre_completo, t.documento, e.tipo_evaluacion, e.aptitud_msp, e.fecha_atencion
     FROM evaluaciones_ocupacionales e
     JOIN trabajadores t ON t.id = e.trabajador_id
     WHERE e.organizacion_id = $1 AND e.aptitud_msp IN ('no_apto', 'apto_con_limitaciones')
       AND e.fecha_atencion >= CURRENT_DATE - INTERVAL '${DIAS_RECIENTE} days'
     ORDER BY e.fecha_atencion DESC
     LIMIT $2`,
    [organizacionId, LIMITE_POR_CATEGORIA]
  );

  const audiometriaRes = await query(
    `SELECT id, trabajador_id,
            (SELECT nombre_completo FROM trabajadores WHERE id = examenes_audiometria.trabajador_id) AS nombre_completo,
            (SELECT documento FROM trabajadores WHERE id = examenes_audiometria.trabajador_id) AS documento,
            fecha_examen, sts_od_positivo, sts_oi_positivo
     FROM examenes_audiometria
     WHERE organizacion_id = $1 AND (sts_od_positivo = true OR sts_oi_positivo = true)
       AND fecha_examen >= CURRENT_DATE - INTERVAL '${DIAS_RECIENTE} days'
     ORDER BY fecha_examen DESC
     LIMIT $2`,
    [organizacionId, LIMITE_POR_CATEGORIA]
  );

  const espirometriaRes = await query(
    `SELECT e.id, e.trabajador_id, t.nombre_completo, t.documento, e.fecha_examen, e.patron
     FROM examenes_espirometria e
     JOIN trabajadores t ON t.id = e.trabajador_id
     WHERE e.organizacion_id = $1 AND e.patron IS NOT NULL AND e.patron != 'normal'
       AND e.fecha_examen >= CURRENT_DATE - INTERVAL '${DIAS_RECIENTE} days'
     ORDER BY e.fecha_examen DESC
     LIMIT $2`,
    [organizacionId, LIMITE_POR_CATEGORIA]
  );

  const visiometriaRes = await query(
    `SELECT e.id, e.trabajador_id, t.nombre_completo, t.documento, e.fecha_examen, e.aptitud_definida
     FROM examenes_visiometria e
     JOIN trabajadores t ON t.id = e.trabajador_id
     WHERE e.organizacion_id = $1 AND e.aptitud_definida IN ('requiere_evaluacion_oftalmologica', 'no_apto')
       AND e.fecha_examen >= CURRENT_DATE - INTERVAL '${DIAS_RECIENTE} days'
     ORDER BY e.fecha_examen DESC
     LIMIT $2`,
    [organizacionId, LIMITE_POR_CATEGORIA]
  );

  const nordicoRes = await query(
    `SELECT c.id, c.trabajador_id, t.nombre_completo, t.documento, c.fecha_aplicacion, c.regiones_prioritarias
     FROM cuestionarios_nordicos c
     JOIN trabajadores t ON t.id = c.trabajador_id
     WHERE c.organizacion_id = $1 AND c.requiere_atencion_prioritaria = true
       AND c.fecha_aplicacion >= CURRENT_DATE - INTERVAL '${DIAS_RECIENTE} days'
     ORDER BY c.fecha_aplicacion DESC
     LIMIT $2`,
    [organizacionId, LIMITE_POR_CATEGORIA]
  );

  const nioshRes = await query(
    `SELECT e.id, e.trabajador_id, t.nombre_completo, t.documento, e.fecha_evaluacion, e.nombre_tarea, e.li, e.clasificacion
     FROM evaluaciones_niosh e
     JOIN trabajadores t ON t.id = e.trabajador_id
     WHERE e.organizacion_id = $1 AND e.clasificacion IN ('riesgo_alto', 'riesgo_muy_alto')
       AND e.fecha_evaluacion >= CURRENT_DATE - INTERVAL '${DIAS_RECIENTE} days'
     ORDER BY e.fecha_evaluacion DESC
     LIMIT $2`,
    [organizacionId, LIMITE_POR_CATEGORIA]
  );

  return {
    aptitud_no_apto: aptitudRes.rows,
    historia_clinica_aptitud_limitada: historiaClinicaRes.rows,
    audiometria_sts: audiometriaRes.rows,
    espirometria_patron_anormal: espirometriaRes.rows,
    visiometria_requiere_evaluacion: visiometriaRes.rows,
    nordico_prioritario: nordicoRes.rows,
    niosh_riesgo_alto: nioshRes.rows,
  };
}

// ------------------------------------------------------------
// GET /api/alertas
// ------------------------------------------------------------
async function obtenerAlertas(req, res) {
  try {
    const esClinico = ['medico', 'sso'].includes(req.usuario.rol);

    const administrativas = await obtenerAlertasAdministrativas(req.usuario.organizacionId);
    const clinicas = esClinico ? await obtenerAlertasClinicas(req.usuario.organizacionId) : null;

    const alertas = { ...administrativas, ...(clinicas || {}) };
    const total = Object.values(alertas).reduce((acc, lista) => acc + lista.length, 0);

    return res.json({ alertas, total, incluyeClinicas: esClinico });
  } catch (err) {
    console.error('Error en obtenerAlertas:', err);
    return res.status(500).json({ error: 'Error interno al obtener las alertas.' });
  }
}

module.exports = { obtenerAlertas };
