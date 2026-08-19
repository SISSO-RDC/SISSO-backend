// ============================================================
// Conexion a PostgreSQL usando un "pool" de conexiones.
// Un pool reutiliza conexiones en vez de abrir una nueva en
// cada consulta, lo cual es mucho mas eficiente.
// ============================================================
require('dotenv').config();
const { Pool } = require('pg');

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

/**
 * Ejecuta una consulta SQL usando una conexion del pool.
 * @param {string} text - la consulta SQL con placeholders $1, $2, etc.
 * @param {Array} params - los valores para los placeholders.
 */
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  if (process.env.NODE_ENV !== 'production') {
    const duration = Date.now() - start;
    console.log('SQL ejecutado', { text, duration, filas: res.rowCount });
  }
  return res;
}

/**
 * Para operaciones que requieren varias consultas atomicas (transacciones),
 * por ejemplo: crear un usuario Y registrar la auditoria a la vez.
 */
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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

module.exports = { query, withTransaction, pool };
