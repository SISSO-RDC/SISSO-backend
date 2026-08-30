// ============================================================
// Script de migracion.
//
// CORREGIDO tras auditoria de seguridad (hallazgo CRITICO C2):
// antes este script SOLO ejecutaba schema.sql (el esquema base) y
// las migraciones 002 en adelante se aplicaban a mano, una por una,
// en el SQL Editor de Neon, sin ningun registro de cuales ya
// corrieron en cada base de datos. Eso podia producir instalaciones
// inconsistentes entre entornos (una migracion aplicada dos veces,
// o salteada por error).
//
// Ahora el script:
//   1. Si la base de datos esta VACIA (no existe la tabla
//      "organizaciones"): corre schema.sql completo, que ya incluye
//      el esquema base + la tabla schema_migrations + el registro
//      de la version '001_schema_base'.
//   2. Si la base de datos YA existe (instalacion previa): se
//      asegura de que exista schema_migrations (por si esta base es
//      anterior a esta correccion) y aplica, EN ORDEN NUMERICO,
//      cualquier archivo migration_XXX_*.sql cuya version todavia
//      no este registrada en schema_migrations. Cada migracion se
//      corre dentro de su propia transaccion: si una falla, no dana
//      el resto y el script se detiene ahi.
//
// Sigue siendo compatible con el flujo manual que usa SISSO
// (Windows, sin Node local, migraciones pegadas a mano en el SQL
// Editor de Neon): cada migration_XXX_*.sql de esta carpeta puede
// seguir ejecutandose asi, siempre que termine con el
// "INSERT INTO schema_migrations ..." correspondiente (ver
// migration_030 en adelante como ejemplo). Este script (migrate.js)
// es simplemente la forma automatizada de hacer lo mismo.
//
// Uso: npm run migrate
// ============================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

const DB_DIR = __dirname;

function extraerVersion(nombreArchivo) {
  // "migration_030_schema_migrations.sql" -> "030_schema_migrations"
  return nombreArchivo.replace(/^migration_/, '').replace(/\.sql$/, '');
}

function listarMigracionesOrdenadas() {
  return fs.readdirSync(DB_DIR)
    .filter((f) => /^migration_\d+_.*\.sql$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/^migration_(\d+)_/)[1], 10);
      const nb = parseInt(b.match(/^migration_(\d+)_/)[1], 10);
      return na - nb;
    });
}

async function baseDeDatosVacia(client) {
  const res = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'organizaciones'
     ) AS existe`
  );
  return !res.rows[0].existe;
}

async function asegurarTablaMigraciones(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(100) PRIMARY KEY,
      aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function migracionesAplicadas(client) {
  const res = await client.query('SELECT version FROM schema_migrations');
  return new Set(res.rows.map((r) => r.version));
}

async function migrate() {
  const client = await pool.connect();
  try {
    const vacia = await baseDeDatosVacia(client);

    if (vacia) {
      console.log('Base de datos vacia: ejecutando schema.sql (esquema base + registro de migraciones)...');
      const schemaSql = fs.readFileSync(path.join(DB_DIR, 'schema.sql'), 'utf8');
      await client.query(schemaSql);
      console.log('Esquema base creado con exito.');
    }

    await asegurarTablaMigraciones(client);
    const aplicadas = await migracionesAplicadas(client);

    const archivos = listarMigracionesOrdenadas();
    let pendientes = 0;

    for (const archivo of archivos) {
      const version = extraerVersion(archivo);
      if (aplicadas.has(version)) continue;

      pendientes++;
      console.log(`Aplicando migracion pendiente: ${archivo} ...`);
      const sql = fs.readFileSync(path.join(DB_DIR, archivo), 'utf8');

      try {
        await client.query('BEGIN');
        // CORREGIDO (hallazgo GRAVE G3): con RLS + FORCE ROW LEVEL
        // SECURITY activas desde la migracion 045, cualquier
        // migracion FUTURA que modifique datos existentes entre
        // organizaciones (como ya hizo la 042) necesita bypassear el
        // filtro de organizacion explicitamente. migrate.js corre
        // fuera de una peticion HTTP (no hay contexto async), asi
        // que se fija aqui mismo, LOCAL a esta transaccion.
        await client.query(
          `SELECT set_config('app.es_superadmin', 'true', true)`
        );
        await client.query(sql);
        // Idempotente aunque el archivo ya se haya auto-registrado.
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
          [version]
        );
        await client.query('COMMIT');
        console.log(`  -> OK (${version})`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  -> ERROR en ${archivo}:`, err.message);
        throw err;
      }
    }

    if (pendientes === 0 && !vacia) {
      console.log('No habia migraciones pendientes. La base de datos ya esta al dia.');
    } else if (pendientes > 0) {
      console.log(`Migracion completada con exito. ${pendientes} migracion(es) aplicada(s).`);
    }
  } catch (err) {
    console.error('Error durante la migracion:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
