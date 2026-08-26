// ============================================================
// Utilidad de auditoria: registra quien hizo que y cuando.
// Esto es lo que el sistema original no tenia. Se llama desde
// los controladores cada vez que ocurre una accion relevante
// (login, creacion de registros, acceso a datos sensibles, etc).
//
// CORREGIDO en Auditoria N.07 (hallazgo GRAVE C6): la version
// anterior atrapaba SIEMPRE el error del INSERT y solo lo dejaba en
// consola, sin importar la accion. Se agrego el parametro `critico`:
// con critico:true, un fallo al registrar la auditoria SI se
// relanza hacia arriba.
//
// CORREGIDO en Auditoria N.08 (hallazgo CRITICO/P0 C-N08-01): esa
// correccion, por si sola, no bastaba. registrarAuditoria() seguia
// llamando a query() -- y query() (src/db/pool.js) abre su PROPIA
// transaccion (BEGIN...COMMIT) por cada sentencia. En la practica,
// dentro de por ejemplo aptitudController.js, el INSERT del
// historial de aptitud se confirmaba en una transaccion, el UPDATE
// de trabajadores.aptitud en otra, y el INSERT de auditoria en una
// tercera. Si esa tercera fallaba, critico:true relanzaba el error
// y la API respondia 500 -- pero los dos cambios clinicos ya
// estaban confirmados en la base. El usuario veia "fallo" cuando en
// realidad la operacion SI habia surtido efecto, y podia reintentar
// generando duplicados.
//
// La correccion real es que la escritura clinica y su auditoria
// vivan en la MISMA transaccion. Para eso, registrarAuditoria()
// ahora acepta un `client` opcional (el mismo client de Postgres
// que ya esta usando withTransaction() en el controlador). Cuando
// se pasa `client`, el INSERT de auditoria se ejecuta con
// client.query(...) en vez de con la funcion query() independiente
// -- queda dentro de la transaccion del llamador, asi que:
//   - Si la escritura clinica tiene exito Y la auditoria tiene
//     exito, ambas se confirman juntas en el COMMIT final.
//   - Si la auditoria falla, el error se propaga (con o sin
//     critico:true -- ya no hay eleccion posible: una vez dentro de
//     una transaccion compartida, un INSERT fallido dentro de ella
//     deja la transaccion entera en estado "aborted" en Postgres
//     hasta el ROLLBACK, asi que intentar seguir la peticion como
//     si nada hubiera pasado ya no es una opcion tecnica, es
//     forzoso). withTransaction() captura ese error y hace ROLLBACK
//     de TODO (la escritura clinica incluida), asi que no puede
//     quedar un dato clinico parcial sin su auditoria.
//
// Los controladores de historia clinica, aptitud, restricciones
// medicas, enfermedad profesional, consentimientos, audiometria,
// espirometria y visiometria fueron migrados a este patron (ver
// cada uno para el `withTransaction(async (client) => {...})` que
// envuelve la escritura clinica + su auditoria).
// ============================================================
const { query } = require('../db/pool');

/**
 * Registra una entrada de auditoria.
 *
 * Sin `client`: comportamiento historico -- usa la funcion query()
 * independiente. Con `critico: false` (default) nunca lanza error
 * hacia afuera (best-effort, no tumba la peticion). Con
 * `critico: true`, un fallo de INSERT SI se relanza.
 *
 * Con `client`: se asume que el llamador ya esta dentro de una
 * transaccion (withTransaction()). El INSERT se ejecuta con ese
 * mismo client, y CUALQUIER fallo se relanza siempre (el parametro
 * `critico` se ignora en este modo porque la atomicidad ya no es
 * opcional: forma parte de la transaccion completa del llamador).
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
  client = null,
}) {
  const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress) : null;
  const userAgent = req ? req.headers['user-agent'] : null;
  const sentencia = `INSERT INTO auditoria
      (organizacion_id, usuario_id, accion, entidad, entidad_id, detalle, ip_origen, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;
  const valores = [organizacionId, usuarioId, accion, entidad, entidadId, detalle ? JSON.stringify(detalle) : null, ip, userAgent];

  if (client) {
    // Dentro de una transaccion compartida: si esto falla, DEBE
    // propagarse siempre para que withTransaction() haga ROLLBACK
    // de la escritura clinica tambien. No hay try/catch que
    // silencie nada aqui a proposito.
    await client.query(sentencia, valores);
    return;
  }

  try {
    await query(sentencia, valores);
  } catch (err) {
    console.error(`No se pudo registrar la auditoria (accion: ${accion}, critico: ${critico}):`, err.message);
    if (critico) throw err;
  }
}

module.exports = { registrarAuditoria };
