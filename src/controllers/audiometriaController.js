// ============================================================
// Controlador de audiometria ocupacional.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { calcularAudiometria } = require('../audiometria/audiometria');

// ------------------------------------------------------------
// POST /api/audiometria/trabajadores/:trabajadorId
// Registra un nuevo examen audiometrico, calcula STS y patron.
// ------------------------------------------------------------
async function registrarExamen(req, res) {
  const { trabajadorId } = req.params;
  const input = req.body;

  try {
    // Verificar trabajador
    const tRes = await query(
      `SELECT id, fecha_nacimiento FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (tRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    // Calcular edad aproximada
    const t = tRes.rows[0];
    const edadAnios = t.fecha_nacimiento
      ? Math.floor((Date.now() - new Date(t.fecha_nacimiento)) / (365.25 * 24 * 3600 * 1000))
      : 0;

    // Buscar la audiometria basal de este trabajador (para calcular STS)
    let basal = null;
    if (!input.esBasal) {
      const basalRes = await query(
        `SELECT ca_od_2000, ca_od_3000, ca_od_4000, ca_oi_2000, ca_oi_3000, ca_oi_4000, id
         FROM examenes_audiometria
         WHERE trabajador_id = $1 AND organizacion_id = $2 AND es_basal = true
         ORDER BY fecha_examen ASC
         LIMIT 1`,
        [trabajadorId, req.usuario.organizacionId]
      );
      if (basalRes.rows.length > 0) basal = basalRes.rows[0];
    }

    // Calcular STS y patron audiometrico
    const resultado = calcularAudiometria(input, basal, edadAnios);

    // Insertar examen
    const insertRes = await withTransaction(async (client) => {
    const filaInsertada = await client.query(
      `INSERT INTO examenes_audiometria (
        organizacion_id, trabajador_id, medico_id, fecha_examen, es_basal,
        ca_od_500, ca_od_1000, ca_od_2000, ca_od_3000, ca_od_4000, ca_od_6000, ca_od_8000,
        ca_oi_500, ca_oi_1000, ca_oi_2000, ca_oi_3000, ca_oi_4000, ca_oi_6000, ca_oi_8000,
        co_od_500, co_od_1000, co_od_2000, co_od_3000, co_od_4000,
        co_oi_500, co_oi_1000, co_oi_2000, co_oi_3000, co_oi_4000,
        pta_od, pta_oi, sts_od, sts_oi, sts_od_positivo, sts_oi_positivo,
        id_audiometria_basal, patron_od, patron_oi, observaciones
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,$11,$12,
        $13,$14,$15,$16,$17,$18,$19,
        $20,$21,$22,$23,$24,
        $25,$26,$27,$28,$29,
        $30,$31,$32,$33,$34,$35,
        $36,$37,$38,$39
      ) RETURNING id, fecha_examen, es_basal, pta_od, pta_oi,
                  sts_od, sts_oi, sts_od_positivo, sts_oi_positivo,
                  patron_od, patron_oi`,
      [
        req.usuario.organizacionId, trabajadorId, req.usuario.id,
        input.fechaExamen || null, !!input.esBasal,
        input.ca_od_500||null, input.ca_od_1000||null, input.ca_od_2000||null,
        input.ca_od_3000||null, input.ca_od_4000||null, input.ca_od_6000||null, input.ca_od_8000||null,
        input.ca_oi_500||null, input.ca_oi_1000||null, input.ca_oi_2000||null,
        input.ca_oi_3000||null, input.ca_oi_4000||null, input.ca_oi_6000||null, input.ca_oi_8000||null,
        input.co_od_500||null, input.co_od_1000||null, input.co_od_2000||null,
        input.co_od_3000||null, input.co_od_4000||null,
        input.co_oi_500||null, input.co_oi_1000||null, input.co_oi_2000||null,
        input.co_oi_3000||null, input.co_oi_4000||null,
        resultado.ptaOd, resultado.ptaOi,
        resultado.stsOd, resultado.stsOi,
        resultado.stsOdPositivo, resultado.stsOiPositivo,
        basal ? basal.id : null,
        resultado.patronOd, resultado.patronOi,
        input.observaciones || null,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'registrar_examen_audiometria',
      entidad: 'examen_audiometria',
      entidadId: filaInsertada.rows[0].id,
      detalle: {
        trabajadorId,
        esBasal: !!input.esBasal,
        stsOdPositivo: resultado.stsOdPositivo,
        stsOiPositivo: resultado.stsOiPositivo,
        patronOd: resultado.patronOd,
        patronOi: resultado.patronOi,
      },
      req,
      client,
    });

    return filaInsertada;
  });

    return res.status(201).json({
      examen: insertRes.rows[0],
      alertaSTS: resultado.stsOdPositivo || resultado.stsOiPositivo,
    });
  } catch (err) {
    console.error('Error en registrarExamen (audiometria):', err);
    return res.status(500).json({ error: 'Error interno al registrar el examen audiometrico.' });
  }
}

// ------------------------------------------------------------
// GET /api/audiometria/trabajadores/:trabajadorId
// Lista el historial de examenes audiometricos de un trabajador.
// ------------------------------------------------------------
async function listarExamenes(req, res) {
  try {
    const tRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );
    if (tRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    // CORREGIDO en Auditoria N.07 (encontrado por la nueva suite
    // RBAC de esta sesion, tests/rbac_clinico.test.js): varias
    // columnas sin calificar ('id' Y 'creado_en') eran ambiguas
    // porque tanto examenes_audiometria como usuarios las tienen --
    // Postgres rechazaba la consulta completa con "column reference
    // ... is ambiguous" (42702) cada vez que se ejecutaba, para
    // CUALQUIER rol, no solo sso. Bug preexistente, no introducido
    // en esta sesion; no habia sido detectado porque no existia
    // ninguna prueba automatizada que ejecutara este endpoint hasta
    // ahora. Se calificaron TODAS las columnas con el alias de
    // tabla para no dejar ninguna ambiguedad silenciosa mas.
    const res2 = await query(
      `SELECT e.id, e.fecha_examen, e.es_basal, e.pta_od, e.pta_oi,
              e.sts_od, e.sts_oi, e.sts_od_positivo, e.sts_oi_positivo,
              e.patron_od, e.patron_oi, e.observaciones, e.creado_en,
              u.nombre_completo AS medico_nombre
       FROM examenes_audiometria e
       JOIN usuarios u ON u.id = e.medico_id
       WHERE e.trabajador_id = $1 AND e.organizacion_id = $2
       ORDER BY e.fecha_examen DESC`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );

    // CORREGIDO tras auditoria de seguridad (hallazgo GRAVE G1): SSO
    // necesita saber si hay un cambio de umbral significativo (STS)
    // para gestionar el programa de conservacion auditiva, pero no
    // los umbrales crudos por frecuencia ni las observaciones
    // clinicas — eso es informacion medica que corresponde al
    // medico ocupacional (ver tambien audiometriaRoutes.js, donde
    // el detalle completo por examen ya quedo restringido a medico).
    const examenes = req.usuario.rol === 'sso'
      ? res2.rows.map((e) => ({
          id: e.id,
          fecha_examen: e.fecha_examen,
          es_basal: e.es_basal,
          sts_od_positivo: e.sts_od_positivo,
          sts_oi_positivo: e.sts_oi_positivo,
          creado_en: e.creado_en,
        }))
      : res2.rows;

    return res.json({ examenes });
  } catch (err) {
    console.error('Error en listarExamenes (audiometria):', err);
    return res.status(500).json({ error: 'Error interno al listar los examenes audiometricos.' });
  }
}

// ------------------------------------------------------------
// GET /api/audiometria/:examenId
// Detalle completo de un examen (incluye todos los umbrales).
// ------------------------------------------------------------
async function obtenerExamen(req, res) {
  try {
    const res2 = await query(
      `SELECT e.*, u.nombre_completo AS medico_nombre, t.nombre_completo AS trabajador_nombre
       FROM examenes_audiometria e
       JOIN usuarios u ON u.id = e.medico_id
       JOIN trabajadores t ON t.id = e.trabajador_id
       WHERE e.id = $1 AND e.organizacion_id = $2`,
      [req.params.examenId, req.usuario.organizacionId]
    );
    if (res2.rows.length === 0) {
      return res.status(404).json({ error: 'Examen no encontrado.' });
    }

    // Auditoria de acceso a datos clinicos (mismo criterio que
    // historiaClinicaController.js tras la auditoria de seguridad).
    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'ver_examen_audiometria',
      entidad: 'examen_audiometria',
      entidadId: req.params.examenId,
      req,
    });

    return res.json({ examen: res2.rows[0] });
  } catch (err) {
    console.error('Error en obtenerExamen (audiometria):', err);
    return res.status(500).json({ error: 'Error interno al obtener el examen.' });
  }
}

module.exports = { registrarExamen, listarExamenes, obtenerExamen };
