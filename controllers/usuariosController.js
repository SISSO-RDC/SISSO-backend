// ============================================================
// Controlador de Usuarios de la organizacion (listado minimo).
//
// CORRIGE un vacio real detectado al construir Accidentes/
// Incidentes: no existia NINGUN endpoint para listar los usuarios
// de la organizacion actual (necesario, por ejemplo, para asignar
// "responsable" a una accion correctiva). La gestion completa de
// usuarios (crear/editar/desactivar) sigue viviendo exclusivamente
// en el panel de superadmin, como establece la arquitectura del
// sistema -- este endpoint es de SOLO LECTURA y NUNCA expone
// password_hash, intentos_fallidos ni ningun otro campo sensible.
// ============================================================
const { query } = require('../db/pool');

// ------------------------------------------------------------
// GET /api/usuarios
// admin, sso: pueden ver la lista completa (la necesitan para
// asignar responsables en accidentes, acciones, matriz medico-
// puesto, etc.). Devuelve solo id, nombre, rol -- nada sensible.
// ------------------------------------------------------------
async function listar(req, res) {
  try {
    const resultado = await query(
      `SELECT id, nombre_completo, rol
       FROM usuarios
       WHERE organizacion_id = $1 AND activo = true
       ORDER BY nombre_completo ASC`,
      [req.usuario.organizacionId]
    );
    return res.json({ usuarios: resultado.rows });
  } catch (err) {
    console.error('Error en listar (usuarios):', err);
    return res.status(500).json({ error: 'Error interno al listar los usuarios.' });
  }
}

module.exports = { listar };
