// ============================================================
// SISSO - Catalogo de finalidades de tratamiento de datos.
//
// CREADO en Auditoria N.10 (hallazgo CRITICO C10-02, P0): expone de
// forma consultable (para cualquier usuario autenticado de la
// organizacion, y no solo para quien programa el sistema) para que
// finalidad y bajo que base juridica se trata cada categoria de
// datos que SISSO recolecta. Es de solo lectura: el catalogo se
// mantiene via migraciones (ver migration_051), no por API, porque
// cambiar la base juridica de un tratamiento es una decision legal,
// no un dato operativo que cualquier admin deba poder editar desde
// la interfaz.
// ============================================================
const { query } = require('../db/pool');

async function listar(req, res) {
  try {
    const resultado = await query(
      `SELECT codigo, nombre, descripcion, base_juridica, categoria_datos, plazo_conservacion_meses
       FROM finalidades_tratamiento
       WHERE activo = true
       ORDER BY nombre`
    );
    return res.json({ finalidades: resultado.rows });
  } catch (err) {
    console.error('Error en listar (finalidades de tratamiento):', err);
    return res.status(500).json({ error: 'Error interno al obtener el catalogo de finalidades de tratamiento.' });
  }
}

module.exports = { listar };
