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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon y la mayoria de proveedores cloud de Postgres requieren SSL.
  ssl: { rejectUnauthorized: false },
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
