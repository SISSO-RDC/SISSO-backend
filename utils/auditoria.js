// ============================================================
// Utilidad de auditoria: registra quien hizo que y cuando.
// Esto es lo que el sistema original no tenia. Se llama desde
// los controladores cada vez que ocurre una accion relevante
// (login, creacion de registros, acceso a datos sensibles, etc).
// ============================================================
const { query } = require('../db/pool');

/**
 * Registra una entrada de auditoria. Nunca lanza error hacia afuera:
 * si falla el registro de auditoria, no debe tumbar la peticion
 * original, pero si se deja constancia en consola para investigarlo.
 */
async function registrarAuditoria({
  organizacionId = null,
  usuarioId = null,
  accion,
  entidad = null,
  entidadId = null,
  detalle = null,
  req = null,
}) {
  try {
    const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress) : null;
    const userAgent = req ? req.headers['user-agent'] : null;

    await query(
      `INSERT INTO auditoria
        (organizacion_id, usuario_id, accion, entidad, entidad_id, detalle, ip_origen, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [organizacionId, usuarioId, accion, entidad, entidadId, detalle ? JSON.stringify(detalle) : null, ip, userAgent]
    );
  } catch (err) {
    console.error('No se pudo registrar la auditoria:', err.message);
  }
}

module.exports = { registrarAuditoria };
