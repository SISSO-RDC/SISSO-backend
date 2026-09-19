// ============================================================
// Controlador de Riesgos de la Organizacion (catalogo real, ver
// migration_086_materializacion_riesgos.sql).
//
// CREADO en Auditoria N.17 (C-17-03, cuarto tipo materializado del
// motor de propuestas sectoriales). Es el catalogo INFORMATIVO de
// "que riesgos reconoce la organizacion como aplicables" -- NO es
// la evaluacion IPER real (esa sigue siendo /api/matriz-riesgos,
// con juicio humano de probabilidad x consecuencia).
// ============================================================
const { query } = require('../db/pool');

// ------------------------------------------------------------
// GET /api/riesgos-organizacion
// ------------------------------------------------------------
async function listar(req, res) {
  try {
    const resultado = await query(
      `SELECT r.id, r.nombre, r.nivel, r.descripcion, r.activo, r.origen, r.creado_en,
              u.nombre_completo AS creado_por_nombre
       FROM riesgos_organizacion r
       LEFT JOIN usuarios u ON u.id = r.creado_por
       WHERE r.organizacion_id = $1
       ORDER BY
         CASE r.nivel WHEN 'alto' THEN 1 WHEN 'medio' THEN 2 WHEN 'bajo' THEN 3 ELSE 4 END,
         r.nombre`,
      [req.usuario.organizacionId]
    );
    return res.json({ riesgos: resultado.rows });
  } catch (err) {
    console.error('Error en listar (riesgos de la organizacion):', err);
    return res.status(500).json({ error: 'Error interno al listar los riesgos de la organización.' });
  }
}

module.exports = { listar };
