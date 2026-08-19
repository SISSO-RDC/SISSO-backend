// ============================================================
// Controlador de CAPA (Acciones Correctivas y Preventivas).
// Corrige el punto 19 / hallazgo G1 de la Auditoria SISSO N.06:
// seguimiento hasta VERIFICACION DE EFICACIA y cierre, no solo
// hasta que alguien marque "completado".
//
// Acceso: admin, sso, medico pueden crear/gestionar (un hallazgo de
// CAPA puede originarse en cualquiera de sus dominios: accidentes,
// matriz de riesgos, o enfermedad profesional). Lectura: cualquier
// usuario autenticado, igual que accidentes.
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

const ORIGENES_VALIDOS = ['accidente', 'casi_accidente', 'matriz_riesgo', 'inspeccion', 'enfermedad_profesional', 'auditoria', 'manual'];

// ------------------------------------------------------------
// POST /api/capa
// ------------------------------------------------------------
async function crear(req, res) {
  const orgId = req.usuario.organizacionId;
  const { origenTipo, origenId, origenDescripcion, tipo, hallazgo, descripcionAccion, responsableId, fechaLimite, fechaRevisionEficacia } = req.body;

  if (origenTipo && !ORIGENES_VALIDOS.includes(origenTipo)) {
    return res.status(400).json({ error: 'origenTipo invalido.' });
  }
  if (tipo && !['correctiva', 'preventiva'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo invalido.' });
  }
  if (!hallazgo || hallazgo.trim().length < 10) {
    return res.status(400).json({ error: 'hallazgo es obligatorio (minimo 10 caracteres).' });
  }
  if (!descripcionAccion || descripcionAccion.trim().length < 5) {
    return res.status(400).json({ error: 'descripcionAccion es obligatoria (minimo 5 caracteres).' });
  }
  if (!responsableId || !fechaLimite) {
    return res.status(400).json({ error: 'responsableId y fechaLimite son obligatorios.' });
  }

  try {
    const creadaRes = await query(
      `INSERT INTO capa_acciones
        (organizacion_id, origen_tipo, origen_id, origen_descripcion, tipo, hallazgo, descripcion_accion,
         responsable_id, fecha_limite, fecha_revision_eficacia, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, estado, fecha_limite, creado_en`,
      [
        orgId, origenTipo || 'manual', origenId || null, origenDescripcion || null,
        tipo || 'correctiva', hallazgo.trim(), descripcionAccion.trim(),
        responsableId, fechaLimite, fechaRevisionEficacia || null, req.usuario.id,
      ]
    );

    await registrarAuditoria({
      organizacionId: orgId,
      usuarioId: req.usuario.id,
      accion: 'capa_creada',
      entidad: 'capa_acciones',
      entidadId: creadaRes.rows[0].id,
      detalle: { origenTipo: origenTipo || 'manual' },
      req,
    });

    return res.status(201).json({ capa: creadaRes.rows[0] });
  } catch (err) {
    console.error('Error en crear (CAPA):', err);
    return res.status(500).json({ error: 'Error interno al crear la accion CAPA.' });
  }
}

// ------------------------------------------------------------
// GET /api/capa  (filtros: estado, origenTipo, responsableId, vencidas=true)
// ------------------------------------------------------------
async function listar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado, origenTipo, responsableId, vencidas } = req.query;

  const condiciones = ['c.organizacion_id = $1'];
  const parametros = [orgId];

  if (estado) { parametros.push(estado); condiciones.push(`c.estado = $${parametros.length}`); }
  if (origenTipo) { parametros.push(origenTipo); condiciones.push(`c.origen_tipo = $${parametros.length}`); }
  if (responsableId) { parametros.push(responsableId); condiciones.push(`c.responsable_id = $${parametros.length}`); }
  if (vencidas === 'true') {
    condiciones.push(`c.fecha_limite < CURRENT_DATE AND c.estado NOT IN ('cerrada', 'eficaz')`);
  }

  try {
    const resultado = await query(
      `SELECT c.id, c.origen_tipo, c.origen_descripcion, c.tipo, c.hallazgo, c.descripcion_accion,
              c.responsable_id, u.nombre_completo AS responsable_nombre, c.fecha_limite, c.estado,
              c.fecha_implementacion, c.fecha_revision_eficacia, c.creado_en,
              (c.fecha_limite < CURRENT_DATE AND c.estado NOT IN ('cerrada', 'eficaz')) AS esta_vencida
       FROM capa_acciones c
       LEFT JOIN usuarios u ON u.id = c.responsable_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY c.fecha_limite ASC`,
      parametros
    );
    return res.json({ acciones: resultado.rows });
  } catch (err) {
    console.error('Error en listar (CAPA):', err);
    return res.status(500).json({ error: 'Error interno al listar las acciones CAPA.' });
  }
}

// ------------------------------------------------------------
// GET /api/capa/:id
// ------------------------------------------------------------
async function obtener(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const resultado = await query(
      `SELECT c.*, ur.nombre_completo AS responsable_nombre, uv.nombre_completo AS verificado_por_nombre,
              ue.nombre_completo AS evaluado_por_nombre, uc.nombre_completo AS creado_por_nombre
       FROM capa_acciones c
       LEFT JOIN usuarios ur ON ur.id = c.responsable_id
       LEFT JOIN usuarios uv ON uv.id = c.verificado_por
       LEFT JOIN usuarios ue ON ue.id = c.evaluado_por
       LEFT JOIN usuarios uc ON uc.id = c.creado_por
       WHERE c.id = $1 AND c.organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Accion CAPA no encontrada.' });
    }
    return res.json({ capa: resultado.rows[0] });
  } catch (err) {
    console.error('Error en obtener (CAPA):', err);
    return res.status(500).json({ error: 'Error interno al obtener la accion CAPA.' });
  }
}

// ------------------------------------------------------------
// PUT /api/capa/:id
// Ediciones generales (no de estado -- eso pasa por los endpoints
// de transicion especificos, para no saltarse el flujo).
// ------------------------------------------------------------
async function actualizar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { hallazgo, descripcionAccion, responsableId, fechaLimite, fechaRevisionEficacia } = req.body;

  try {
    const actualizadaRes = await query(
      `UPDATE capa_acciones SET
         hallazgo = COALESCE($1, hallazgo),
         descripcion_accion = COALESCE($2, descripcion_accion),
         responsable_id = COALESCE($3, responsable_id),
         fecha_limite = COALESCE($4, fecha_limite),
         fecha_revision_eficacia = COALESCE($5, fecha_revision_eficacia)
       WHERE id = $6 AND organizacion_id = $7
       RETURNING id, estado`,
      [
        hallazgo ? hallazgo.trim() : null, descripcionAccion ? descripcionAccion.trim() : null,
        responsableId || null, fechaLimite || null, fechaRevisionEficacia || null,
        req.params.id, orgId,
      ]
    );
    if (actualizadaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Accion CAPA no encontrada.' });
    }

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'capa_actualizada',
      entidad: 'capa_acciones', entidadId: req.params.id, req,
    });

    return res.json({ capa: actualizadaRes.rows[0] });
  } catch (err) {
    console.error('Error en actualizar (CAPA):', err);
    return res.status(500).json({ error: 'Error interno al actualizar la accion CAPA.' });
  }
}

// ------------------------------------------------------------
// PUT /api/capa/:id/implementar
// El responsable marca que ya ejecuto la accion.
// ------------------------------------------------------------
async function implementar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { fechaImplementacion } = req.body;
  try {
    const actualizadaRes = await query(
      `UPDATE capa_acciones SET estado = 'implementada', fecha_implementacion = $1
       WHERE id = $2 AND organizacion_id = $3 AND estado IN ('pendiente', 'en_progreso')
       RETURNING id, estado, fecha_implementacion`,
      [fechaImplementacion || new Date().toISOString().slice(0, 10), req.params.id, orgId]
    );
    if (actualizadaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Accion no encontrada o ya fue implementada/verificada.' });
    }

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'capa_implementada',
      entidad: 'capa_acciones', entidadId: req.params.id, req,
    });

    return res.json({ capa: actualizadaRes.rows[0] });
  } catch (err) {
    console.error('Error en implementar (CAPA):', err);
    return res.status(500).json({ error: 'Error interno al marcar como implementada.' });
  }
}

// ------------------------------------------------------------
// PUT /api/capa/:id/verificar
// Paso 2: OTRA persona confirma que la accion se ejecuto de verdad.
// ------------------------------------------------------------
async function verificar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { notaVerificacion } = req.body;
  try {
    const capaRes = await query(
      `SELECT id, estado, responsable_id FROM capa_acciones WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (capaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Accion CAPA no encontrada.' });
    }
    if (capaRes.rows[0].estado !== 'implementada') {
      return res.status(400).json({ error: 'Solo se puede verificar una accion que ya fue marcada como implementada.' });
    }

    const actualizadaRes = await query(
      `UPDATE capa_acciones SET estado = 'verificada', verificado_por = $1, fecha_verificacion = CURRENT_DATE, nota_verificacion = $2
       WHERE id = $3 AND organizacion_id = $4
       RETURNING id, estado`,
      [req.usuario.id, notaVerificacion || null, req.params.id, orgId]
    );

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'capa_verificada',
      entidad: 'capa_acciones', entidadId: req.params.id, req,
    });

    return res.json({ capa: actualizadaRes.rows[0] });
  } catch (err) {
    console.error('Error en verificar (CAPA):', err);
    return res.status(500).json({ error: 'Error interno al verificar la accion.' });
  }
}

// ------------------------------------------------------------
// PUT /api/capa/:id/evaluar-eficacia
// Paso 3, el que corrige directamente el hallazgo G1: tiempo
// despues de verificada, se revisa si el problema realmente dejo
// de ocurrir. Solo con eficaz=true se puede cerrar el caso.
// ------------------------------------------------------------
async function evaluarEficacia(req, res) {
  const orgId = req.usuario.organizacionId;
  const { eficaz, notaEficacia } = req.body;

  if (typeof eficaz !== 'boolean') {
    return res.status(400).json({ error: 'eficaz (true/false) es obligatorio.' });
  }
  if (!notaEficacia || notaEficacia.trim().length < 5) {
    return res.status(400).json({ error: 'notaEficacia es obligatoria (minimo 5 caracteres): explica en que te basas para esa conclusion.' });
  }

  try {
    const capaRes = await query(
      `SELECT id, estado FROM capa_acciones WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (capaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Accion CAPA no encontrada.' });
    }
    if (capaRes.rows[0].estado !== 'verificada') {
      return res.status(400).json({ error: 'Solo se puede evaluar la eficacia de una accion ya verificada.' });
    }

    const nuevoEstado = eficaz ? 'eficaz' : 'no_eficaz';
    const actualizadaRes = await query(
      `UPDATE capa_acciones SET
         estado = $1, evaluado_por = $2, fecha_evaluacion_eficacia = CURRENT_DATE, nota_eficacia = $3
       WHERE id = $4 AND organizacion_id = $5
       RETURNING id, estado`,
      [nuevoEstado, req.usuario.id, notaEficacia.trim(), req.params.id, orgId]
    );

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'capa_eficacia_evaluada',
      entidad: 'capa_acciones', entidadId: req.params.id, detalle: { eficaz }, req,
    });

    return res.json({ capa: actualizadaRes.rows[0] });
  } catch (err) {
    console.error('Error en evaluarEficacia (CAPA):', err);
    return res.status(500).json({ error: 'Error interno al evaluar la eficacia.' });
  }
}

// ------------------------------------------------------------
// PUT /api/capa/:id/cerrar
// Solo se puede cerrar si el estado es 'eficaz'. Si resulto
// 'no_eficaz', el flujo correcto es abrir una NUEVA accion CAPA
// (no reabrir la vieja), para mantener trazabilidad de que la
// primera medida no funciono.
// ------------------------------------------------------------
async function cerrar(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const capaRes = await query(
      `SELECT id, estado FROM capa_acciones WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (capaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Accion CAPA no encontrada.' });
    }
    if (capaRes.rows[0].estado !== 'eficaz') {
      return res.status(400).json({ error: 'Solo se puede cerrar una accion cuya eficacia fue confirmada. Si no fue eficaz, abre una nueva accion CAPA.' });
    }

    const actualizadaRes = await query(
      `UPDATE capa_acciones SET estado = 'cerrada' WHERE id = $1 AND organizacion_id = $2 RETURNING id, estado`,
      [req.params.id, orgId]
    );

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'capa_cerrada',
      entidad: 'capa_acciones', entidadId: req.params.id, req,
    });

    return res.json({ capa: actualizadaRes.rows[0] });
  } catch (err) {
    console.error('Error en cerrar (CAPA):', err);
    return res.status(500).json({ error: 'Error interno al cerrar la accion CAPA.' });
  }
}

module.exports = { crear, listar, obtener, actualizar, implementar, verificar, evaluarEficacia, cerrar };
