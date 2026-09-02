// ============================================================
// Controlador de Inspecciones. Corrige el hallazgo G3 de la
// Auditoria SISSO N.06: "Debe existir ciclo completo de hallazgo y
// accion." El cierre del ciclo pasa por generarCapaDesdeHallazgo,
// que crea una fila real en capa_acciones (migration_037) enlazada
// al hallazgo, en vez de dejar el hallazgo como una nota suelta.
//
// Acceso: admin, sso gestionan (mismo criterio que accidentes).
// Lectura: cualquier usuario autenticado.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

// ------------------------------------------------------------
// POST /api/inspecciones
// ------------------------------------------------------------
async function crear(req, res) {
  const orgId = req.usuario.organizacionId;
  const { tipo, area, puestoTrabajoId, fechaProgramada, inspectorId } = req.body;

  if (!area || area.trim().length < 2) {
    return res.status(400).json({ error: 'area es obligatoria.' });
  }
  if (!inspectorId) {
    return res.status(400).json({ error: 'inspectorId es obligatorio.' });
  }

  try {
    const creadaRes = await query(
      `INSERT INTO inspecciones (organizacion_id, tipo, area, puesto_trabajo_id, fecha_programada, inspector_id, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, estado, area, fecha_programada, creado_en`,
      [orgId, tipo || 'planeada', area.trim(), puestoTrabajoId || null, fechaProgramada || null, inspectorId, req.usuario.id]
    );

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'inspeccion_creada',
      entidad: 'inspecciones', entidadId: creadaRes.rows[0].id, req,
    });

    return res.status(201).json({ inspeccion: creadaRes.rows[0] });
  } catch (err) {
    console.error('Error en crear (inspecciones):', err);
    return res.status(500).json({ error: 'Error interno al crear la inspeccion.' });
  }
}

// ------------------------------------------------------------
// GET /api/inspecciones  (filtros: estado, tipo)
// ------------------------------------------------------------
async function listar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado, tipo } = req.query;

  const condiciones = ['i.organizacion_id = $1'];
  const parametros = [orgId];
  if (estado) { parametros.push(estado); condiciones.push(`i.estado = $${parametros.length}`); }
  if (tipo) { parametros.push(tipo); condiciones.push(`i.tipo = $${parametros.length}`); }

  try {
    const resultado = await query(
      `SELECT i.id, i.tipo, i.area, i.puesto_trabajo_id, pt.nombre_puesto, i.fecha_programada, i.fecha_ejecucion,
              i.estado, i.inspector_id, u.nombre_completo AS inspector_nombre,
              (SELECT count(*)::int FROM inspecciones_hallazgos h WHERE h.inspeccion_id = i.id) AS total_hallazgos
       FROM inspecciones i
       LEFT JOIN puestos_trabajo pt ON pt.id = i.puesto_trabajo_id
       LEFT JOIN usuarios u ON u.id = i.inspector_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY COALESCE(i.fecha_programada, i.creado_en::date) DESC`,
      parametros
    );
    return res.json({ inspecciones: resultado.rows });
  } catch (err) {
    console.error('Error en listar (inspecciones):', err);
    return res.status(500).json({ error: 'Error interno al listar las inspecciones.' });
  }
}

// ------------------------------------------------------------
// GET /api/inspecciones/:id
// ------------------------------------------------------------
async function obtener(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const inspeccionRes = await query(
      `SELECT i.*, pt.nombre_puesto, u.nombre_completo AS inspector_nombre
       FROM inspecciones i
       LEFT JOIN puestos_trabajo pt ON pt.id = i.puesto_trabajo_id
       LEFT JOIN usuarios u ON u.id = i.inspector_id
       WHERE i.id = $1 AND i.organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (inspeccionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Inspeccion no encontrada.' });
    }

    const itemsRes = await query(
      `SELECT id, item, cumple, observacion, creado_en FROM inspecciones_items
       WHERE inspeccion_id = $1 AND organizacion_id = $2 ORDER BY creado_en ASC`,
      [req.params.id, orgId]
    );

    const hallazgosRes = await query(
      `SELECT id, descripcion, gravedad, capa_id, creado_en FROM inspecciones_hallazgos
       WHERE inspeccion_id = $1 AND organizacion_id = $2 ORDER BY creado_en ASC`,
      [req.params.id, orgId]
    );

    return res.json({ inspeccion: inspeccionRes.rows[0], items: itemsRes.rows, hallazgos: hallazgosRes.rows });
  } catch (err) {
    console.error('Error en obtener (inspecciones):', err);
    return res.status(500).json({ error: 'Error interno al obtener la inspeccion.' });
  }
}

// ------------------------------------------------------------
// PUT /api/inspecciones/:id
// ------------------------------------------------------------
async function actualizar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado, fechaEjecucion, observacionesGenerales } = req.body;

  if (estado && !['programada', 'en_progreso', 'completada'].includes(estado)) {
    return res.status(400).json({ error: 'estado invalido.' });
  }

  try {
    const actualizadaRes = await query(
      `UPDATE inspecciones SET
         estado = COALESCE($1, estado),
         fecha_ejecucion = COALESCE($2, fecha_ejecucion),
         observaciones_generales = COALESCE($3, observaciones_generales)
       WHERE id = $4 AND organizacion_id = $5
       RETURNING id, estado`,
      [estado || null, fechaEjecucion || null, observacionesGenerales || null, req.params.id, orgId]
    );
    if (actualizadaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Inspeccion no encontrada.' });
    }

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'inspeccion_actualizada',
      entidad: 'inspecciones', entidadId: req.params.id, detalle: { estado }, req,
    });

    return res.json({ inspeccion: actualizadaRes.rows[0] });
  } catch (err) {
    console.error('Error en actualizar (inspecciones):', err);
    return res.status(500).json({ error: 'Error interno al actualizar la inspeccion.' });
  }
}

// ------------------------------------------------------------
// POST /api/inspecciones/:id/items
// ------------------------------------------------------------
async function agregarItem(req, res) {
  const orgId = req.usuario.organizacionId;
  const { item, cumple, observacion } = req.body;

  if (!item || item.trim().length < 2) {
    return res.status(400).json({ error: 'item es obligatorio.' });
  }
  if (!['si', 'no', 'no_aplica'].includes(cumple)) {
    return res.status(400).json({ error: 'cumple debe ser si, no o no_aplica.' });
  }

  try {
    const inspeccionRes = await query(
      `SELECT id FROM inspecciones WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (inspeccionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Inspeccion no encontrada.' });
    }

    const itemRes = await query(
      `INSERT INTO inspecciones_items (inspeccion_id, organizacion_id, item, cumple, observacion)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, item, cumple, observacion, creado_en`,
      [req.params.id, orgId, item.trim(), cumple, observacion || null]
    );

    return res.status(201).json({ item: itemRes.rows[0] });
  } catch (err) {
    console.error('Error en agregarItem (inspecciones):', err);
    return res.status(500).json({ error: 'Error interno al agregar el item.' });
  }
}

// ------------------------------------------------------------
// POST /api/inspecciones/:id/hallazgos
// ------------------------------------------------------------
async function agregarHallazgo(req, res) {
  const orgId = req.usuario.organizacionId;
  const { descripcion, gravedad } = req.body;

  if (!descripcion || descripcion.trim().length < 10) {
    return res.status(400).json({ error: 'descripcion es obligatoria (minimo 10 caracteres).' });
  }
  if (gravedad && !['baja', 'media', 'alta'].includes(gravedad)) {
    return res.status(400).json({ error: 'gravedad invalida.' });
  }

  try {
    const inspeccionRes = await query(
      `SELECT id FROM inspecciones WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (inspeccionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Inspeccion no encontrada.' });
    }

    const hallazgoRes = await query(
      `INSERT INTO inspecciones_hallazgos (inspeccion_id, organizacion_id, descripcion, gravedad)
       VALUES ($1,$2,$3,$4)
       RETURNING id, descripcion, gravedad, capa_id, creado_en`,
      [req.params.id, orgId, descripcion.trim(), gravedad || 'media']
    );

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'inspeccion_hallazgo_agregado',
      entidad: 'inspecciones_hallazgos', entidadId: hallazgoRes.rows[0].id, req,
    });

    return res.status(201).json({ hallazgo: hallazgoRes.rows[0] });
  } catch (err) {
    console.error('Error en agregarHallazgo (inspecciones):', err);
    return res.status(500).json({ error: 'Error interno al agregar el hallazgo.' });
  }
}

// ------------------------------------------------------------
// POST /api/inspecciones/hallazgos/:hallazgoId/generar-capa
// CIERRA EL CICLO (corrige G3): crea una fila real en
// capa_acciones a partir del hallazgo, enlazada por origen_tipo/
// origen_id, y guarda el capa_id de vuelta en el hallazgo para que
// quede navegable en ambos sentidos.
// ------------------------------------------------------------
async function generarCapaDesdeHallazgo(req, res) {
  const orgId = req.usuario.organizacionId;
  const { responsableId, fechaLimite, tipo } = req.body;

  if (!responsableId || !fechaLimite) {
    return res.status(400).json({ error: 'responsableId y fechaLimite son obligatorios.' });
  }

  try {
    const hallazgoRes = await query(
      `SELECT h.id, h.descripcion, h.capa_id, h.inspeccion_id, i.area
       FROM inspecciones_hallazgos h
       JOIN inspecciones i ON i.id = h.inspeccion_id
       WHERE h.id = $1 AND h.organizacion_id = $2`,
      [req.params.hallazgoId, orgId]
    );
    if (hallazgoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Hallazgo no encontrado.' });
    }
    if (hallazgoRes.rows[0].capa_id) {
      return res.status(400).json({ error: 'Este hallazgo ya tiene una accion CAPA generada.' });
    }

    const hallazgo = hallazgoRes.rows[0];

    const resultado = await withTransaction(async (client) => {
      const capaRes = await client.query(
        `INSERT INTO capa_acciones
          (organizacion_id, origen_tipo, origen_id, origen_descripcion, tipo, hallazgo, descripcion_accion,
           responsable_id, fecha_limite, creado_por)
         VALUES ($1,'inspeccion',$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          orgId, hallazgo.inspeccion_id, `Inspección en ${hallazgo.area}`, tipo || 'correctiva',
          hallazgo.descripcion, `Atender el hallazgo: ${hallazgo.descripcion}`,
          responsableId, fechaLimite, req.usuario.id,
        ]
      );

      await client.query(
        `UPDATE inspecciones_hallazgos SET capa_id = $1 WHERE id = $2 AND organizacion_id = $3`,
        [capaRes.rows[0].id, req.params.hallazgoId, orgId]
      );

      return capaRes.rows[0].id;
    });

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'inspeccion_hallazgo_genero_capa',
      entidad: 'inspecciones_hallazgos', entidadId: req.params.hallazgoId, detalle: { capaId: resultado }, req,
    });

    return res.status(201).json({ capaId: resultado });
  } catch (err) {
    console.error('Error en generarCapaDesdeHallazgo:', err);
    return res.status(500).json({ error: 'Error interno al generar la accion CAPA.' });
  }
}

module.exports = { crear, listar, obtener, actualizar, agregarItem, agregarHallazgo, generarCapaDesdeHallazgo };
