// ============================================================
// Conexion a PostgreSQL usando un "pool" de conexiones.
// Un pool reutiliza conexiones en vez de abrir una nueva en
// cada consulta, lo cual es mucho mas eficiente.
// ============================================================
require('dotenv').config();
const { Pool } = require('pg');
const { obtenerContexto } = require('../utils/contextoSolicitud');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: falta la variable de entorno DATABASE_URL.');
  console.error('Copia .env.example a .env y completa los valores.');
  process.exit(1);
}

// CORREGIDO en Auditoria N.11 (hallazgo GRAVE G11-11, P1): con
// `rejectUnauthorized: false` la conexion se cifra pero NO se
// verifica que el certificado del servidor sea el de Neon --un
// atacante en posicion de intermediario (DNS envenenado, red
// comprometida, etc.) podria presentar cualquier certificado y la
// conexion lo aceptaria igual. Para una aplicacion que mueve datos
// clinicos, eso reduce una garantia de seguridad que SI esta
// disponible sin costo adicional: Neon usa certificados firmados
// por una autoridad publica reconocida (no autofirmados), asi que
// el bundle de CAs raiz que ya trae Node de fabrica alcanza para
// verificarlo con `rejectUnauthorized: true` -- no hace falta
// distribuir ni mantener un archivo de CA propio.
//
// Se deja una valvula de escape via variable de entorno
// (DB_SSL_REJECT_UNAUTHORIZED=false) unicamente para el caso de
// desarrollo local contra un Postgres con certificado autofirmado;
// en produccion NO debe definirse esa variable.
const sslRejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
if (!sslRejectUnauthorized) {
  console.warn(
    'ADVERTENCIA: DB_SSL_REJECT_UNAUTHORIZED=false -- la conexion a PostgreSQL no verifica el certificado '
    + 'del servidor. Esto NUNCA debe usarse en produccion (ver hallazgo G11-11).'
  );
}

// CORREGIDO (02/09/2026): el PostgreSQL EFIMERO que usa el CI
// (.github/workflows/ci.yml, servicio "postgres:16" de Docker) no
// soporta SSL en absoluto -- ni siquiera sin verificar certificado,
// como si intentaba `ssl: { rejectUnauthorized: false }`. Antes de
// esta correccion, `ssl` SIEMPRE era un objeto (nunca `false`), asi
// que node-postgres intentaba negociar TLS igual contra ese
// contenedor y fallaba con "The server does not support SSL
// connections", tumbando el job de migraciones del CI recien creado
// en la Auditoria N.14 (C14-03).
//
// DB_SSL_DISABLED=true desactiva SSL por completo (no solo la
// verificacion del certificado) -- SOLO debe usarse contra un
// Postgres efimero/local que ni siquiera ofrece TLS (el servicio de
// CI, o un Postgres local sin configurar). Nunca debe definirse en
// Render/produccion contra Neon, que exige SSL.
const sslDisabled = process.env.DB_SSL_DISABLED === 'true';
if (sslDisabled) {
  console.warn(
    'ADVERTENCIA: DB_SSL_DISABLED=true -- la conexion a PostgreSQL no usa SSL/TLS en absoluto. '
    + 'Solo valido para un Postgres efimero de pruebas (CI/local) que no ofrece TLS. NUNCA en produccion.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon y la mayoria de proveedores cloud de Postgres requieren SSL.
  ssl: sslDisabled ? false : { rejectUnauthorized: sslRejectUnauthorized },
  max: 10, // maximo de conexiones simultaneas, suficiente para empezar
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  // Esto captura errores de conexiones inactivas para que no tumben el servidor
  console.error('Error inesperado en el pool de PostgreSQL:', err);
});

// ============================================================
// CORREGIDO (hallazgo GRAVE G3 de la Auditoria Integral 2026-08-22):
// Row-Level Security como segunda barrera de aislamiento a nivel de
// base de datos (migration_045_rls_multitenant.sql), ademas del
// filtrado que cada controlador ya hace con "WHERE organizacion_id
// = $N". Esta funcion fija, DENTRO de una transaccion y con
// set_config(..., true) [el 'true' final = LOCAL, se revierte solo
// al hacer COMMIT/ROLLBACK], las variables de sesion que las
// politicas RLS usan para filtrar.
//
// USAR SIEMPRE set_config() PARAMETRIZADO, NUNCA "SET LOCAL x = "
// + interpolacion de string: SET no admite placeholders $1 de
// Postgres, y concatenar un UUID a mano (aunque venga de un JWT ya
// verificado) es un habito peligroso de replicar en otro lado del
// codigo. set_config() si acepta parametros normales.
//
// USAR SIEMPRE UNA TRANSACCION (BEGIN...COMMIT) PROPIA, NUNCA "SET"
// simple sobre una conexion que vuelve al pool compartido: Postgres
// resetea las variables definidas con set_config(..., true) al
// terminar la transaccion, así que aunque esta conexion se reutilice
// para la siguiente peticion de OTRO usuario, jamas hereda estas
// variables. Esto es exactamente lo que evita la fuga entre
// peticiones que advertia el archivo OPCIONAL_rls_multitenant_g3.sql
// original.
// ============================================================
async function fijarContextoSesion(client, contexto) {
  await client.query(
    `SELECT set_config('app.organizacion_actual', $1, true),
            set_config('app.usuario_actual_id', $2, true),
            set_config('app.es_superadmin', $3, true)`,
    [
      contexto.organizacionId || '',
      contexto.usuarioId || '',
      contexto.esSuperadmin ? 'true' : 'false',
    ]
  );
}

/**
 * Ejecuta una consulta SQL usando una conexion del pool.
 * @param {string} text - la consulta SQL con placeholders $1, $2, etc.
 * @param {Array} params - los valores para los placeholders.
 */
async function query(text, params) {
  const start = Date.now();
  const contexto = obtenerContexto();

  // Sin contexto de peticion (scripts de migracion, seeds de
  // prueba, tareas internas que no pasan por Express): se ejecuta
  // tal cual sobre el pool, exactamente como antes de esta
  // correccion. Estos casos corren fuera de una peticion HTTP, no
  // hay ningun usuario ni organizacion cuya identidad este en
  // juego.
  if (!contexto) {
    const res = await pool.query(text, params);
    if (process.env.NODE_ENV !== 'production') {
      console.log('SQL ejecutado', { text, duration: Date.now() - start, filas: res.rowCount });
    }
    return res;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fijarContextoSesion(client, contexto);
    const res = await client.query(text, params);
    await client.query('COMMIT');
    if (process.env.NODE_ENV !== 'production') {
      console.log('SQL ejecutado', { text, duration: Date.now() - start, filas: res.rowCount });
    }
    return res;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Para operaciones que requieren varias consultas atomicas (transacciones),
 * por ejemplo: crear un usuario Y registrar la auditoria a la vez.
 */
async function withTransaction(callback) {
  const contexto = obtenerContexto();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (contexto) {
      await fijarContextoSesion(client, contexto);
    }
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Para scripts internos/administrativos que necesitan operar a
 * traves de TODAS las organizaciones (seeds de prueba, tareas de
 * mantenimiento puntuales) fuera de una peticion HTTP real. Hace
 * explicito, en el propio nombre de la funcion, que esta consulta
 * bypassa el filtro de organizacion de las politicas RLS -- a
 * diferencia de que ocurra implicitamente por no tener contexto.
 */
async function queryComoSuperadmin(text, params) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fijarContextoSesion(client, { organizacionId: null, usuarioId: null, esSuperadmin: true });
    const res = await client.query(text, params);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { query, withTransaction, queryComoSuperadmin, pool };
