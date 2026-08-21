// ============================================================
// Controlador de Equipo de Proteccion Personal (EPP).
// Catalogo por organizacion + entregas individuales con firma de
// recibido y vencimiento calculado automaticamente.
//
// Acceso: admin, sso gestionan (catalogo y entregas). Lectura:
// cualquier usuario autenticado (dato operativo, no clinico).
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { subirEvidencia, generarUrlFirmada } = require('../servicios/cloudinaryService');

const CARPETA_FIRMAS_EPP = 'sisso/firmas-epp';

// ------------------------------------------------------------
// POST /api/epp/catalogo
// ------------------------------------------------------------
async function crearItemCatalogo(req, res) {
  const orgId = req.usuario.organizacionId;
  const { nombre, tipo, vidaUtilMeses, normaReferencia } = req.body;

  if (!nombre || nombre.trim().length < 2 || !tipo) {
    return res.status(400).json({ error: 'nombre y tipo son obligatorios.' });
  }

  try {
    const creadoRes = await query(
      `INSERT INTO catalogo_epp (organizacion_id, nombre, tipo, vida_util_meses, norma_referencia, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, nombre, tipo, vida_util_meses, creado_en`,
      [orgId, nombre.trim(), tipo.trim(), vidaUtilMeses || null, normaReferencia || null, req.usuario.id]
    );

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'epp_catalogo_item_creado',
      entidad: 'catalogo_epp', entidadId: creadoRes.rows[0].id, req,
    });

    return res.status(201).json({ item: creadoRes.rows[0] });
  } catch (err) {
    console.error('Error en crearItemCatalogo (EPP):', err);
    return res.status(500).json({ error: 'Error interno al crear el item del catálogo.' });
  }
}

// ------------------------------------------------------------
// GET /api/epp/catalogo
// ------------------------------------------------------------
async function listarCatalogo(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const resultado = await query(
      `SELECT id, nombre, tipo, vida_util_meses, norma_referencia, activo
       FROM catalogo_epp WHERE organizacion_id = $1 AND activo = true ORDER BY tipo ASC, nombre ASC`,
      [orgId]
    );
    return res.json({ catalogo: resultado.rows });
  } catch (err) {
    console.error('Error en listarCatalogo (EPP):', err);
    return res.status(500).json({ error: 'Error interno al listar el catálogo.' });
  }
}

// ------------------------------------------------------------
// POST /api/epp/entregas
// Calcula fecha_vencimiento_estimada a partir de la vida util del
// EPP en el catalogo (no se confia en el valor del cliente).
// ------------------------------------------------------------
async function crearEntrega(req, res) {
  const orgId = req.usuario.organizacionId;
  const { trabajadorId, eppId, puestoTrabajoId, fechaEntrega, cantidad, motivo, firmaBase64 } = req.body;

  if (!trabajadorId || !eppId || !fechaEntrega) {
    return res.status(400).json({ error: 'trabajadorId, eppId y fechaEntrega son obligatorios.' });
  }
  if (motivo && !['entrega_inicial', 'reposicion', 'dano', 'vencimiento'].includes(motivo)) {
    return res.status(400).json({ error: 'motivo invalido.' });
  }

  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, orgId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    const eppRes = await query(
      `SELECT id, vida_util_meses FROM catalogo_epp WHERE id = $1 AND organizacion_id = $2`,
      [eppId, orgId]
    );
    if (eppRes.rows.length === 0) {
      return res.status(404).json({ error: 'Item de EPP no encontrado en el catálogo.' });
    }

    let fechaVencimiento = null;
    if (eppRes.rows[0].vida_util_meses) {
      const fecha = new Date(fechaEntrega);
      fecha.setMonth(fecha.getMonth() + eppRes.rows[0].vida_util_meses);
      fechaVencimiento = fecha.toISOString().slice(0, 10);
    }

    let firmaUrl = null;
    let firmaPublicId = null;
    if (firmaBase64 && typeof firmaBase64 === 'string' && firmaBase64.startsWith('data:image')) {
      const firma = await subirEvidencia(firmaBase64, orgId, CARPETA_FIRMAS_EPP);
      firmaUrl = firma.url;
      firmaPublicId = firma.publicId;
    }

    const entregaRes = await query(
      `INSERT INTO entregas_epp
        (organizacion_id, trabajador_id, epp_id, puesto_trabajo_id, fecha_entrega, cantidad, motivo,
         fecha_vencimiento_estimada, firma_imagen_url, firma_imagen_public_id, entregado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, fecha_entrega, fecha_vencimiento_estimada, estado, creado_en`,
      [
        orgId, trabajadorId, eppId, puestoTrabajoId || null, fechaEntrega, cantidad || 1,
        motivo || 'entrega_inicial', fechaVencimiento, firmaUrl, firmaPublicId, req.usuario.id,
      ]
    );

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'epp_entrega_creada',
      entidad: 'entregas_epp', entidadId: entregaRes.rows[0].id, detalle: { trabajadorId, eppId }, req,
    });

    return res.status(201).json({ entrega: entregaRes.rows[0] });
  } catch (err) {
    console.error('Error en crearEntrega (EPP):', err);
    return res.status(500).json({ error: 'Error interno al registrar la entrega.' });
  }
}

// ------------------------------------------------------------
// GET /api/epp/entregas  (filtros: trabajadorId, estado)
// Actualiza automaticamente a 'vencido' las entregas cuya fecha de
// vencimiento estimada ya paso, antes de devolver la lista, para
// que el estado mostrado siempre este al dia.
// ------------------------------------------------------------
async function listarEntregas(req, res) {
  const orgId = req.usuario.organizacionId;
  const { trabajadorId, estado } = req.query;

  try {
    await query(
      `UPDATE entregas_epp SET estado = 'vencido'
       WHERE organizacion_id = $1 AND estado = 'vigente' AND fecha_vencimiento_estimada < CURRENT_DATE`,
      [orgId]
    );

    const condiciones = ['e.organizacion_id = $1'];
    const parametros = [orgId];
    if (trabajadorId) { parametros.push(trabajadorId); condiciones.push(`e.trabajador_id = $${parametros.length}`); }
    if (estado) { parametros.push(estado); condiciones.push(`e.estado = $${parametros.length}`); }

    const resultado = await query(
      `SELECT e.id, e.trabajador_id, t.nombre_completo AS trabajador_nombre, e.epp_id, c.nombre AS epp_nombre, c.tipo AS epp_tipo,
              e.fecha_entrega, e.cantidad, e.motivo, e.fecha_vencimiento_estimada, e.estado,
              (e.firma_imagen_public_id IS NOT NULL) AS tiene_firma
       FROM entregas_epp e
       JOIN catalogo_epp c ON c.id = e.epp_id
       LEFT JOIN trabajadores t ON t.id = e.trabajador_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY e.fecha_entrega DESC`,
      parametros
    );
    return res.json({ entregas: resultado.rows });
  } catch (err) {
    console.error('Error en listarEntregas (EPP):', err);
    return res.status(500).json({ error: 'Error interno al listar las entregas.' });
  }
}

// ------------------------------------------------------------
// GET /api/epp/entregas/:id/firma
// URL firmada de corta duracion para ver la firma (recurso privado).
// ------------------------------------------------------------
async function obtenerUrlFirma(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const entregaRes = await query(
      `SELECT firma_imagen_public_id FROM entregas_epp WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (entregaRes.rows.length === 0 || !entregaRes.rows[0].firma_imagen_public_id) {
      return res.status(404).json({ error: 'Esta entrega no tiene firma registrada.' });
    }

    return res.json({ url: generarUrlFirmada(entregaRes.rows[0].firma_imagen_public_id, 'imagen') });
  } catch (err) {
    console.error('Error en obtenerUrlFirma (EPP):', err);
    return res.status(500).json({ error: 'Error interno al generar el enlace de la firma.' });
  }
}

// ------------------------------------------------------------
// PUT /api/epp/entregas/:id/marcar-repuesto
// ------------------------------------------------------------
async function marcarRepuesto(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const actualizadaRes = await query(
      `UPDATE entregas_epp SET estado = 'repuesto' WHERE id = $1 AND organizacion_id = $2 RETURNING id, estado`,
      [req.params.id, orgId]
    );
    if (actualizadaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Entrega no encontrada.' });
    }

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'epp_entrega_marcada_repuesta',
      entidad: 'entregas_epp', entidadId: req.params.id, req,
    });

    return res.json({ entrega: actualizadaRes.rows[0] });
  } catch (err) {
    console.error('Error en marcarRepuesto (EPP):', err);
    return res.status(500).json({ error: 'Error interno al actualizar la entrega.' });
  }
}

module.exports = { crearItemCatalogo, listarCatalogo, crearEntrega, listarEntregas, obtenerUrlFirma, marcarRepuesto };
