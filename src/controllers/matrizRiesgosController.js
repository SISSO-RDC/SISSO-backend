// ============================================================
// Controlador de la Matriz de Riesgos (metodologia IPER). Ver
// src/matrizRiesgos/matrizRiesgos.js para el detalle completo.
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { clasificarRiesgo, TIPOS_PELIGRO, ETIQUETAS_PROBABILIDAD, ETIQUETAS_CONSECUENCIA } = require('../matrizRiesgos/matrizRiesgos');

// ------------------------------------------------------------
// GET /api/matriz-riesgos/catalogos
// ------------------------------------------------------------
async function obtenerCatalogos(req, res) {
  return res.json({ catalogos: { TIPOS_PELIGRO, ETIQUETAS_PROBABILIDAD, ETIQUETAS_CONSECUENCIA } });
}

// ------------------------------------------------------------
// POST /api/matriz-riesgos
// ------------------------------------------------------------
async function crear(req, res) {
  const b = req.body;

  const { nivelRiesgo, clasificacion } = clasificarRiesgo(b.probabilidad, b.consecuencia);
  if (nivelRiesgo === null) {
    return res.status(400).json({ error: 'probabilidad y consecuencia son obligatorios, cada uno entre 1 y 5.' });
  }

  try {
    const resultado = await query(
      `INSERT INTO matriz_riesgos (
        organizacion_id, puesto_trabajo_id, puesto_texto_libre, proceso, actividad,
        tipo_peligro, peligro_especifico, riesgo_potencial, trabajadores_expuestos,
        probabilidad, consecuencia, nivel_riesgo, clasificacion,
        controles_existentes, controles_adicionales, responsable_control, plazo_control, creado_por
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING id, tipo_peligro, peligro_especifico, nivel_riesgo, clasificacion, creado_en`,
      [
        req.usuario.organizacionId, b.puestoTrabajoId || null, b.puestoTextoLibre || null, b.proceso || null, b.actividad || null,
        b.tipoPeligro, b.peligroEspecifico, b.riesgoPotencial || null, b.trabajadoresExpuestos || null,
        b.probabilidad, b.consecuencia, nivelRiesgo, clasificacion,
        b.controlesExistentes || null, b.controlesAdicionales || null, b.responsableControl || null, b.plazoControl || null,
        req.usuario.id,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'crear_item_matriz_riesgos',
      entidad: 'matriz_riesgos',
      entidadId: resultado.rows[0].id,
      detalle: { clasificacion },
      req,
    });

    return res.status(201).json({ item: resultado.rows[0] });
  } catch (err) {
    console.error('Error en crear (matriz de riesgos):', err);
    return res.status(500).json({ error: 'Error interno al crear el item de la matriz de riesgos.' });
  }
}

// ------------------------------------------------------------
// GET /api/matriz-riesgos
// Devuelve todos los items activos + un resumen por clasificacion,
// util para pintar la matriz 5x5 y los conteos en el frontend.
// ------------------------------------------------------------
async function listar(req, res) {
  try {
    const resultado = await query(
      `SELECT m.id, m.puesto_trabajo_id, m.puesto_texto_libre, p.nombre_puesto,
              m.proceso, m.actividad, m.tipo_peligro, m.peligro_especifico, m.riesgo_potencial,
              m.trabajadores_expuestos, m.probabilidad, m.consecuencia, m.nivel_riesgo, m.clasificacion,
              m.responsable_control, m.plazo_control, m.creado_en
       FROM matriz_riesgos m
       LEFT JOIN puestos_trabajo p ON p.id = m.puesto_trabajo_id
       WHERE m.organizacion_id = $1 AND m.activo = true
       ORDER BY m.nivel_riesgo DESC NULLS LAST, m.creado_en DESC`,
      [req.usuario.organizacionId]
    );

    const resumen = resultado.rows.reduce((acc, item) => {
      acc[item.clasificacion] = (acc[item.clasificacion] || 0) + 1;
      return acc;
    }, {});

    return res.json({ items: resultado.rows, resumen });
  } catch (err) {
    console.error('Error en listar (matriz de riesgos):', err);
    return res.status(500).json({ error: 'Error interno al listar la matriz de riesgos.' });
  }
}

// ------------------------------------------------------------
// GET /api/matriz-riesgos/:id
// ------------------------------------------------------------
async function obtener(req, res) {
  try {
    const resultado = await query(
      `SELECT m.*, p.nombre_puesto, u.nombre_completo AS creado_por_nombre
       FROM matriz_riesgos m
       LEFT JOIN puestos_trabajo p ON p.id = m.puesto_trabajo_id
       JOIN usuarios u ON u.id = m.creado_por
       WHERE m.id = $1 AND m.organizacion_id = $2`,
      [req.params.id, req.usuario.organizacionId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Item de la matriz de riesgos no encontrado.' });
    }
    return res.json({ item: resultado.rows[0] });
  } catch (err) {
    console.error('Error en obtener (matriz de riesgos):', err);
    return res.status(500).json({ error: 'Error interno al obtener el item.' });
  }
}

// ------------------------------------------------------------
// PUT /api/matriz-riesgos/:id
// ------------------------------------------------------------
async function actualizar(req, res) {
  const b = req.body;

  const { nivelRiesgo, clasificacion } = clasificarRiesgo(b.probabilidad, b.consecuencia);
  if (nivelRiesgo === null) {
    return res.status(400).json({ error: 'probabilidad y consecuencia son obligatorios, cada uno entre 1 y 5.' });
  }

  try {
    const resultado = await query(
      `UPDATE matriz_riesgos
       SET puesto_trabajo_id = $1, puesto_texto_libre = $2, proceso = $3, actividad = $4,
           tipo_peligro = $5, peligro_especifico = $6, riesgo_potencial = $7, trabajadores_expuestos = $8,
           probabilidad = $9, consecuencia = $10, nivel_riesgo = $11, clasificacion = $12,
           controles_existentes = $13, controles_adicionales = $14, responsable_control = $15, plazo_control = $16
       WHERE id = $17 AND organizacion_id = $18
       RETURNING id, nivel_riesgo, clasificacion`,
      [
        b.puestoTrabajoId || null, b.puestoTextoLibre || null, b.proceso || null, b.actividad || null,
        b.tipoPeligro, b.peligroEspecifico, b.riesgoPotencial || null, b.trabajadoresExpuestos || null,
        b.probabilidad, b.consecuencia, nivelRiesgo, clasificacion,
        b.controlesExistentes || null, b.controlesAdicionales || null, b.responsableControl || null, b.plazoControl || null,
        req.params.id, req.usuario.organizacionId,
      ]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Item de la matriz de riesgos no encontrado.' });
    }

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'actualizar_item_matriz_riesgos',
      entidad: 'matriz_riesgos',
      entidadId: req.params.id,
      req,
    });

    return res.json({ item: resultado.rows[0] });
  } catch (err) {
    console.error('Error en actualizar (matriz de riesgos):', err);
    return res.status(500).json({ error: 'Error interno al actualizar el item.' });
  }
}

// ------------------------------------------------------------
// DELETE /api/matriz-riesgos/:id
// ------------------------------------------------------------
async function desactivar(req, res) {
  try {
    const resultado = await query(
      `UPDATE matriz_riesgos SET activo = false WHERE id = $1 AND organizacion_id = $2 RETURNING id`,
      [req.params.id, req.usuario.organizacionId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Item de la matriz de riesgos no encontrado.' });
    }

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'desactivar_item_matriz_riesgos',
      entidad: 'matriz_riesgos',
      entidadId: req.params.id,
      req,
    });

    return res.json({ mensaje: 'Item eliminado de la matriz de riesgos.' });
  } catch (err) {
    console.error('Error en desactivar (matriz de riesgos):', err);
    return res.status(500).json({ error: 'Error interno al eliminar el item.' });
  }
}

module.exports = { obtenerCatalogos, crear, listar, obtener, actualizar, desactivar };
