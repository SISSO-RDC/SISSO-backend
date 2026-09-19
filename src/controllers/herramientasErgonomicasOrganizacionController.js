// ============================================================
// Controlador de Herramientas Ergonomicas de la Organizacion
// (catalogo real, ver
// migration_088_materializacion_herramientas_ergonomicas.sql).
//
// CREADO en Auditoria N.17 (C-17-03, sexto tipo materializado). Es
// el catalogo de METODOS de evaluacion ergonomica que el programa
// preventivo de la organizacion incluye (REBA, RULA, Cuestionario
// Nordico, etc.) -- NO son evaluaciones ya realizadas (eso sigue
// siendo /api/reba, /api/rula, /api/niosh, con datos reales de
// postura y carga).
// ============================================================
const { query } = require('../db/pool');

// ------------------------------------------------------------
// GET /api/herramientas-ergonomicas-organizacion
// ------------------------------------------------------------
async function listar(req, res) {
  try {
    const resultado = await query(
      `SELECT h.id, h.nombre, h.descripcion, h.activo, h.origen, h.creado_en,
              u.nombre_completo AS creado_por_nombre
       FROM herramientas_ergonomicas_organizacion h
       LEFT JOIN usuarios u ON u.id = h.creado_por
       WHERE h.organizacion_id = $1
       ORDER BY h.nombre`,
      [req.usuario.organizacionId]
    );
    return res.json({ herramientas: resultado.rows });
  } catch (err) {
    console.error('Error en listar (herramientas ergonomicas de la organizacion):', err);
    return res.status(500).json({ error: 'Error interno al listar las herramientas ergonómicas de la organización.' });
  }
}

module.exports = { listar };
