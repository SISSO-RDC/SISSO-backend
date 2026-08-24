// ============================================================
// Utilidad de auditoria: registra quien hizo que y cuando.
// Esto es lo que el sistema original no tenia. Se llama desde
// los controladores cada vez que ocurre una accion relevante
// (login, creacion de registros, acceso a datos sensibles, etc).
//
// CORREGIDO en Auditoria N.07 (hallazgo GRAVE C6): la version
// anterior atrapaba SIEMPRE el error del INSERT y solo lo dejaba en
// consola, sin importar la accion. En un sistema que maneja
// historias clinicas, restricciones, enfermedad profesional y
// aptitud, la trazabilidad es en si misma un control de seguridad:
// que la operacion clinica "tenga exito" mientras su registro de
// auditoria se pierde en silencio es un riesgo de gobernanza, no
// solo un detalle tecnico.
//
// Se agrega el parametro `critico` (por defecto false, para no
// romper ninguna llamada existente). Cuando un llamador marca una
// accion como critico:true, un fallo al registrar la auditoria SI
// se propaga hacia arriba -- el controlador debe entonces decidir
// si la peticion completa falla (recomendado para altas/cambios de
// historia clinica, aptitud, restricciones medicas y enfermedad
// profesional) en vez de completarse sin dejar rastro. Las acciones
// no marcadas como criticas conservan el comportamiento anterior
// (best-effort, nunca tumban la peticion original).
// ============================================================
const { query } = require('../db/pool');

/**
 * Registra una entrada de auditoria.
 *
 * Por defecto (`critico: false`) nunca lanza error hacia afuera: si
 * falla el registro, no debe tumbar la peticion original, pero si se
 * deja constancia en consola para investigarlo.
 *
 * Con `critico: true`, un fallo de INSERT SI se relanza -- pensado
 * para acciones donde perder la trazabilidad es inaceptable
 * (historia clinica, aptitud, restricciones medicas, enfermedad
 * profesional). El controlador que llama con critico:true debe
 * capturar ese error y responder con un fallo claro al usuario en
 * vez de continuar como si la operacion hubiese quedado registrada.
 */
async function registrarAuditoria({
  organizacionId = null,
  usuarioId = null,
  accion,
  entidad = null,
  entidadId = null,
  detalle = null,
  req = null,
  critico = false,
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
    console.error(`No se pudo registrar la auditoria (accion: ${accion}, critico: ${critico}):`, err.message);
    if (critico) throw err;
  }
}

module.exports = { registrarAuditoria };
