// ============================================================
// Controlador de KPIs de la Organizacion (catalogo real, ver
// migration_089_materializacion_kpis.sql).
//
// CREADO en Auditoria N.17 (C-17-03, septimo y ultimo tipo
// materializado). Es el catalogo de METAS adoptadas -- NO calcula
// ni compara el valor real, eso sigue siendo
// /api/indicadores (indicadoresController.js), en tiempo real.
// ============================================================
const { query } = require('../db/pool');

// ------------------------------------------------------------
// GET /api/kpis-organizacion
// ------------------------------------------------------------
async function listar(req, res) {
  try {
    const resultado = await query(
      `SELECT k.id, k.nombre, k.meta, k.descripcion, k.activo, k.origen, k.creado_en,
              u.nombre_completo AS creado_por_nombre
       FROM kpis_organizacion k
       LEFT JOIN usuarios u ON u.id = k.creado_por
       WHERE k.organizacion_id = $1
       ORDER BY k.nombre`,
      [req.usuario.organizacionId]
    );
    return res.json({ kpis: resultado.rows });
  } catch (err) {
    console.error('Error en listar (kpis de la organizacion):', err);
    return res.status(500).json({ error: 'Error interno al listar los KPIs de la organización.' });
  }
}

module.exports = { listar };
