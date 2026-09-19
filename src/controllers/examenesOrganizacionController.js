// ============================================================
// Controlador de Examenes de la Organizacion (catalogo real, ver
// migration_087_materializacion_examenes.sql).
//
// CREADO en Auditoria N.17 (C-17-03, quinto tipo materializado).
// Es el catalogo del PROTOCOLO de examenes periodicos que la
// organizacion reconoce como aplicables -- NO son registros
// clinicos de examenes ya realizados (eso sigue siendo
// audiometria/espirometria/visiometria/historia_clinica).
// ============================================================
const { query } = require('../db/pool');

// ------------------------------------------------------------
// GET /api/examenes-organizacion
// ------------------------------------------------------------
async function listar(req, res) {
  try {
    const resultado = await query(
      `SELECT e.id, e.nombre, e.tipo, e.frecuencia, e.norma_referencia, e.activo, e.origen, e.creado_en,
              u.nombre_completo AS creado_por_nombre
       FROM examenes_organizacion e
       LEFT JOIN usuarios u ON u.id = e.creado_por
       WHERE e.organizacion_id = $1
       ORDER BY e.nombre`,
      [req.usuario.organizacionId]
    );
    return res.json({ examenes: resultado.rows });
  } catch (err) {
    console.error('Error en listar (examenes de la organizacion):', err);
    return res.status(500).json({ error: 'Error interno al listar los exámenes de la organización.' });
  }
}

module.exports = { listar };
