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
// CORREGIDO en Auditoria N.09 (hallazgo GRAVE G-N09-07, P1):
// registrarAuditoria() sin `client` era best-effort para TODO,
// incluidas lecturas de datos clinicos sensibles (historia clinica,
// aptitud, restricciones): si el INSERT fallaba, se perdia toda
// evidencia de que la lectura ocurrio. Se agrega el modo
// `lecturaSensible: true`, pensado especificamente para llamadas de
// auditoria en endpoints GET (que nunca tienen `client` porque no
// abren una transaccion de escritura):
//   1. Intenta el INSERT normal en `auditoria`.
//   2. Si falla, intenta un INSERT de respaldo en la cola durable
//      `auditoria_pendiente` (migration_049) con el error original.
//   3. Si ese respaldo TAMBIEN falla, recien ahi se relanza el
//      error -- fail-closed real: si no quedo evidencia en NINGUN
//      lado, la funcion no debe devolver exito silenciosamente.
//   4. Si el respaldo tuvo exito, no se relanza nada: hay cola
//      durable, no hace falta tumbar la respuesta al usuario por una
//      caida transitoria de la tabla `auditoria` (tal como pide la
//      auditoria: "no bloquear la respuesta por una caida transitoria
//      si existe una cola durable").
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
  lecturaSensible = false,
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
    return;
  } catch (err) {
    console.error(`No se pudo registrar la auditoria (accion: ${accion}, critico: ${critico}, lecturaSensible: ${lecturaSensible}):`, err.message);

    if (lecturaSensible) {
      try {
        await query(
          `INSERT INTO auditoria_pendiente
             (organizacion_id, usuario_id, accion, entidad, entidad_id, detalle, ip_origen, user_agent, error_original)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [organizacionId, usuarioId, accion, entidad, entidadId, detalle ? JSON.stringify(detalle) : null, ip, userAgent, err.message]
        );
        // Se guardo en la cola durable: no hace falta tumbar la
        // respuesta, pero SI queda rastro (a diferencia del
        // comportamiento anterior).
        return;
      } catch (errCola) {
        console.error(`FALLO TOTAL DE AUDITORIA (ni auditoria ni auditoria_pendiente) para accion "${accion}". Fail-closed.`, errCola.message);
        throw errCola;
      }
    }

    if (critico) throw err;
  }
}

module.exports = { registrarAuditoria };

// ------------------------------------------------------------
// CREADO en Auditoria N.11 (hallazgo GRAVE G11-06, P1): la
// migracion 049 creo la cola durable auditoria_pendiente, pero la
// propia auditoria N.09 ya dejaba anotado que faltaba el "proceso
// periodico que drene auditoria_pendiente hacia auditoria y alerte
// si el backlog crece" -- este entorno (Render, sin infraestructura
// de cron propia mas alla de "Render Cron Jobs", que es un producto
// de pago separado) no tiene un scheduler disponible desde el
// codigo de la aplicacion. Se implementa el DRENAJE en si (la parte
// que si depende de este codebase) como funcion reutilizable, y se
// expone via endpoint de superadmin para poder dispararlo
// manualmente o desde un cron externo (ej. un GitHub Action
// programado que haga un POST autenticado a este endpoint, o
// Render Cron Jobs si se contrata).
// ------------------------------------------------------------

/**
 * Intenta mover cada entrada sin drenar de auditoria_pendiente hacia
 * la tabla auditoria real. Si el INSERT en auditoria tiene exito,
 * marca la entrada como drenada (no la borra: queda como evidencia
 * de que hubo una caida transitoria). Si vuelve a fallar, incrementa
 * intentos_drenaje para poder distinguir "recien llegada" de
 * "lleva varios intentos fallidos" (esto ultimo si amerita alerta
 * humana).
 *
 * @param {number} limite - maximo de filas a procesar en una corrida (evita corridas gigantes accidentales)
 * @returns {Promise<{procesadas: number, drenadas: number, fallidas: number}>}
 */
async function drenarAuditoriaPendiente(limite = 200) {
  const pendientesRes = await query(
    `SELECT id, organizacion_id, usuario_id, accion, entidad, entidad_id, detalle, ip_origen, user_agent
     FROM auditoria_pendiente
     WHERE drenado_en IS NULL
     ORDER BY creado_en ASC
     LIMIT $1`,
    [limite]
  );

  let drenadas = 0;
  let fallidas = 0;

  for (const fila of pendientesRes.rows) {
    try {
      await query(
        `INSERT INTO auditoria (organizacion_id, usuario_id, accion, entidad, entidad_id, detalle, ip_origen, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [fila.organizacion_id, fila.usuario_id, fila.accion, fila.entidad, fila.entidad_id, fila.detalle, fila.ip_origen, fila.user_agent]
      );
      await query(`UPDATE auditoria_pendiente SET drenado_en = now() WHERE id = $1`, [fila.id]);
      drenadas++;
    } catch (err) {
      console.error(`No se pudo drenar auditoria_pendiente id=${fila.id}:`, err.message);
      await query(`UPDATE auditoria_pendiente SET intentos_drenaje = intentos_drenaje + 1 WHERE id = $1`, [fila.id]).catch(() => {});
      fallidas++;
    }
  }

  return { procesadas: pendientesRes.rows.length, drenadas, fallidas };
}

/**
 * @returns {Promise<{sinDrenar: number, conMultiplesIntentos: number}>}
 */
async function backlogAuditoriaPendiente() {
  const resultado = await query(
    `SELECT
       COUNT(*) FILTER (WHERE drenado_en IS NULL)::int AS sin_drenar,
       COUNT(*) FILTER (WHERE drenado_en IS NULL AND intentos_drenaje >= 3)::int AS con_multiples_intentos
     FROM auditoria_pendiente`
  );
  return { sinDrenar: resultado.rows[0].sin_drenar, conMultiplesIntentos: resultado.rows[0].con_multiples_intentos };
}

module.exports.drenarAuditoriaPendiente = drenarAuditoriaPendiente;
module.exports.backlogAuditoriaPendiente = backlogAuditoriaPendiente;
