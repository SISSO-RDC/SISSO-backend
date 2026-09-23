// ============================================================
// Controlador de Auditorias internas/externas y hallazgos
// (Lote 2, Sep 2026). 'auditoria' ya era un origen valido de
// capa_acciones desde migration_037 -- estaba reservado pero
// nunca tuvo una tabla que lo alimentara; este modulo la
// construye. Gestion: admin, sso.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { columnas } = require('../db/columnasExplicitas');
const { registrarAuditoria } = require('../utils/auditoria');

const TIPOS_AUDITORIA = ['interna', 'externa'];
const ESTADOS_AUDITORIA = ['programada', 'en_progreso', 'completada'];
const TIPOS_HALLAZGO = ['no_conformidad', 'observacion', 'oportunidad_mejora'];

// ------------------------------------------------------------
// POST /api/auditorias
// ------------------------------------------------------------
async function crear(req, res) {
  const orgId = req.usuario.organizacionId;
  const { tipo, normaReferencia, alcance, auditorNombre, fechaProgramada } = req.body;

  if (!TIPOS_AUDITORIA.includes(tipo)) return res.status(400).json({ error: `tipo invalido. Valores permitidos: ${TIPOS_AUDITORIA.join(', ')}.` });
  if (!fechaProgramada) return res.status(400).json({ error: 'fechaProgramada es obligatoria.' });

  try {
    const resultado = await withTransaction(async (client) => {
      const insertRes = await client.query(
        `INSERT INTO auditorias (organizacion_id, tipo, norma_referencia, alcance, auditor_nombre, fecha_programada, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, tipo, norma_referencia, fecha_programada, estado, creado_en`,
        [orgId, tipo, normaReferencia || null, alcance || null, auditorNombre || null, fechaProgramada, req.usuario.id]
      );

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'auditoria_creada',
        entidad: 'auditorias', entidadId: insertRes.rows[0].id, detalle: { tipo, normaReferencia }, req, client,
      });

      return insertRes;
    });

    return res.status(201).json({ auditoria: resultado.rows[0] });
  } catch (err) {
    console.error('Error en crear (auditorias):', err);
    return res.status(500).json({ error: 'Error interno al crear la auditoria.' });
  }
}

// ------------------------------------------------------------
// GET /api/auditorias  (filtro: estado)
// ------------------------------------------------------------
async function listar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado } = req.query;

  const condiciones = ['a.organizacion_id = $1'];
  const parametros = [orgId];
  if (estado) { parametros.push(estado); condiciones.push(`a.estado = $${parametros.length}`); }

  try {
    const resultado = await query(
      `SELECT a.id, a.tipo, a.norma_referencia, a.auditor_nombre, a.fecha_programada, a.fecha_ejecucion, a.estado,
              (SELECT count(*)::int FROM auditoria_hallazgos h WHERE h.auditoria_id = a.id) AS total_hallazgos,
              (SELECT count(*)::int FROM auditoria_hallazgos h WHERE h.auditoria_id = a.id AND h.capa_id IS NULL) AS hallazgos_sin_capa
       FROM auditorias a WHERE ${condiciones.join(' AND ')} ORDER BY a.fecha_programada DESC`,
      parametros
    );
    return res.json({ auditorias: resultado.rows });
  } catch (err) {
    console.error('Error en listar (auditorias):', err);
    return res.status(500).json({ error: 'Error interno al listar las auditorias.' });
  }
}

// ------------------------------------------------------------
// GET /api/auditorias/:id  (incluye hallazgos)
// ------------------------------------------------------------
async function obtener(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const auditoriaRes = await query(
      `SELECT ${columnas('auditorias', 'a')} FROM auditorias a WHERE a.id = $1 AND a.organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (auditoriaRes.rows.length === 0) return res.status(404).json({ error: 'Auditoria no encontrada.' });

    const hallazgosRes = await query(
      `SELECT id, tipo, descripcion, capa_id, creado_en FROM auditoria_hallazgos
       WHERE auditoria_id = $1 AND organizacion_id = $2 ORDER BY creado_en ASC`,
      [req.params.id, orgId]
    );

    return res.json({ auditoria: auditoriaRes.rows[0], hallazgos: hallazgosRes.rows });
  } catch (err) {
    console.error('Error en obtener (auditorias):', err);
    return res.status(500).json({ error: 'Error interno al obtener la auditoria.' });
  }
}

// ------------------------------------------------------------
// PATCH /api/auditorias/:id/estado
// ------------------------------------------------------------
async function actualizarEstado(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado, fechaEjecucion } = req.body;

  if (!ESTADOS_AUDITORIA.includes(estado)) return res.status(400).json({ error: `estado invalido. Valores permitidos: ${ESTADOS_AUDITORIA.join(', ')}.` });

  try {
    const resultado = await withTransaction(async (client) => {
      const updateRes = await client.query(
        `UPDATE auditorias SET estado = $1, fecha_ejecucion = COALESCE($2, fecha_ejecucion)
         WHERE id = $3 AND organizacion_id = $4 RETURNING id, estado, fecha_ejecucion`,
        [estado, fechaEjecucion || null, req.params.id, orgId]
      );
      if (updateRes.rows.length === 0) return null;

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'auditoria_actualizada',
        entidad: 'auditorias', entidadId: req.params.id, detalle: { estado }, req, client,
      });

      return updateRes;
    });

    if (!resultado) return res.status(404).json({ error: 'Auditoria no encontrada.' });
    return res.json({ auditoria: resultado.rows[0] });
  } catch (err) {
    console.error('Error en actualizarEstado (auditorias):', err);
    return res.status(500).json({ error: 'Error interno al actualizar la auditoria.' });
  }
}

// ------------------------------------------------------------
// POST /api/auditorias/:id/hallazgos
// ------------------------------------------------------------
async function agregarHallazgo(req, res) {
  const orgId = req.usuario.organizacionId;
  const { tipo, descripcion } = req.body;

  if (!TIPOS_HALLAZGO.includes(tipo)) return res.status(400).json({ error: `tipo invalido. Valores permitidos: ${TIPOS_HALLAZGO.join(', ')}.` });
  if (!descripcion || descripcion.trim().length < 5) return res.status(400).json({ error: 'descripcion es obligatoria (minimo 5 caracteres).' });

  try {
    const auditoriaRes = await query(`SELECT id FROM auditorias WHERE id = $1 AND organizacion_id = $2`, [req.params.id, orgId]);
    if (auditoriaRes.rows.length === 0) return res.status(404).json({ error: 'Auditoria no encontrada.' });

    const resultado = await withTransaction(async (client) => {
      const insertRes = await client.query(
        `INSERT INTO auditoria_hallazgos (auditoria_id, organizacion_id, tipo, descripcion)
         VALUES ($1,$2,$3,$4) RETURNING id, tipo, descripcion, creado_en`,
        [req.params.id, orgId, tipo, descripcion.trim()]
      );

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'auditoria_hallazgo_agregado',
        entidad: 'auditoria_hallazgos', entidadId: insertRes.rows[0].id, detalle: { tipo }, req, client,
      });

      return insertRes;
    });

    return res.status(201).json({ hallazgo: resultado.rows[0] });
  } catch (err) {
    console.error('Error en agregarHallazgo (auditorias):', err);
    return res.status(500).json({ error: 'Error interno al agregar el hallazgo.' });
  }
}

// ------------------------------------------------------------
// POST /api/auditorias/hallazgos/:hallazgoId/generar-capa
// Mismo patron que inspeccionesController.js:generarCapaDesdeHallazgo.
// ------------------------------------------------------------
async function generarCapaDesdeHallazgo(req, res) {
  const orgId = req.usuario.organizacionId;
  const { responsableId, fechaLimite } = req.body;

  if (!responsableId || !fechaLimite) return res.status(400).json({ error: 'responsableId y fechaLimite son obligatorios.' });

  try {
    const hallazgoRes = await query(
      `SELECT h.id, h.tipo, h.descripcion, h.capa_id, a.norma_referencia
       FROM auditoria_hallazgos h JOIN auditorias a ON a.id = h.auditoria_id
       WHERE h.id = $1 AND h.organizacion_id = $2`,
      [req.params.hallazgoId, orgId]
    );
    if (hallazgoRes.rows.length === 0) return res.status(404).json({ error: 'Hallazgo no encontrado.' });
    if (hallazgoRes.rows[0].capa_id) return res.status(400).json({ error: 'Este hallazgo ya tiene una accion CAPA generada.' });

    const hallazgo = hallazgoRes.rows[0];

    const capaId = await withTransaction(async (client) => {
      const capaRes = await client.query(
        `INSERT INTO capa_acciones
          (organizacion_id, origen_tipo, origen_id, origen_descripcion, tipo, hallazgo, descripcion_accion,
           responsable_id, fecha_limite, creado_por)
         VALUES ($1,'auditoria',$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          orgId, hallazgo.id, hallazgo.norma_referencia ? `Auditoria ${hallazgo.norma_referencia}` : 'Auditoria',
          hallazgo.tipo === 'no_conformidad' ? 'correctiva' : 'preventiva',
          hallazgo.descripcion, `Atender el hallazgo de auditoria: ${hallazgo.descripcion}`,
          responsableId, fechaLimite, req.usuario.id,
        ]
      );

      await client.query(`UPDATE auditoria_hallazgos SET capa_id = $1 WHERE id = $2 AND organizacion_id = $3`, [capaRes.rows[0].id, req.params.hallazgoId, orgId]);

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'auditoria_hallazgo_genero_capa',
        entidad: 'auditoria_hallazgos', entidadId: req.params.hallazgoId, detalle: { capaId: capaRes.rows[0].id }, req, client,
      });

      return capaRes.rows[0].id;
    });

    return res.status(201).json({ capaId });
  } catch (err) {
    console.error('Error en generarCapaDesdeHallazgo (auditorias):', err);
    return res.status(500).json({ error: 'Error interno al generar la accion CAPA.' });
  }
}

module.exports = { crear, listar, obtener, actualizarEstado, agregarHallazgo, generarCapaDesdeHallazgo };
