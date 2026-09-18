// ============================================================
// Controlador de Areas de la Organizacion (catalogo real, ver
// migration_084_materializacion_areas.sql).
//
// CREADO en Auditoria N.17 (C-17-03, primer tipo materializado del
// motor de propuestas sectoriales -- ver MATERIALIZADORES en
// configuracionSectorialController.js). Este catalogo hoy SOLO se
// llena aceptando/modificando una propuesta de tipo 'area' -- no
// tiene todavia creacion manual directa (columna "origen" de
// migration_084 ya reserva ese caso para un lote futuro, igual
// que "aplicado"/"aplicado_en" quedaron reservados en
// migration_083 hasta este lote).
// ============================================================
const { query } = require('../db/pool');

// ------------------------------------------------------------
// GET /api/areas-organizacion
// ------------------------------------------------------------
async function listar(req, res) {
  try {
    const resultado = await query(
      `SELECT a.id, a.nombre, a.descripcion, a.activo, a.origen, a.creado_en,
              u.nombre_completo AS creado_por_nombre
       FROM areas_organizacion a
       LEFT JOIN usuarios u ON u.id = a.creado_por
       WHERE a.organizacion_id = $1
       ORDER BY a.nombre`,
      [req.usuario.organizacionId]
    );
    return res.json({ areas: resultado.rows });
  } catch (err) {
    console.error('Error en listar (areas de la organizacion):', err);
    return res.status(500).json({ error: 'Error interno al listar las áreas de la organización.' });
  }
}

module.exports = { listar };
