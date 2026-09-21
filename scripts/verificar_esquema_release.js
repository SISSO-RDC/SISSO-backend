// ============================================================
// Verificacion de esquema ANTES/DESPUES de un release (Auditoria N.19,
// hallazgo critico C19-02).
//
// Problema: la produccion (Neon) se migra a mano. En N.18 la migracion
// 016 figuraba como aplicada pero las columnas `incidentes` y
// `tiempo_puesto_actual_meses` NO existian en la copia real, y registrar
// una evaluacion periodica respondia 500. Que una version aparezca en
// `schema_migrations` NO prueba que sus columnas existan. Las pruebas
// de CI corren contra una base recien migrada, asi que nunca lo veian.
//
// Este script se corre CONTRA LA BASE DE DESTINO (la de produccion) y
// hace dos comprobaciones:
//   1. Migraciones pendientes: archivos migration_XXX_*.sql cuya
//      version no esta registrada en schema_migrations.
//   2. Columnas esperadas: reconstruye, leyendo las migraciones en
//      orden, las columnas que agregan (ALTER TABLE ... ADD COLUMN),
//      descontando las que otra migracion elimina o renombra, y
//      comprueba que cada una exista de verdad en information_schema.
//
// Sale con codigo 1 si encuentra cualquier diferencia; con 0 si el
// esquema esta al dia. Es de SOLO LECTURA: no modifica la base.
//
// Uso (con DATABASE_URL apuntando a la base de destino):
//   npm run verificar:esquema
// Antes de desplegar codigo que dependa de una migracion nueva, y
// justo despues de pegarla en el SQL Editor de Neon.
// ============================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '..', 'src', 'db');

function listarMigraciones() {
  return fs.readdirSync(DB_DIR)
    .filter((f) => /^migration_\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a.match(/^migration_(\d+)_/)[1], 10) - parseInt(b.match(/^migration_(\d+)_/)[1], 10));
}

const versionDe = (archivo) => archivo.replace(/^migration_/, '').replace(/\.sql$/, '');

// Quita comentarios SQL (-- ... y /* ... */) para no leer DDL comentado.
function sinComentariosSql(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

// Reconstruye { tabla -> Set(columnas) } que las migraciones dejan en pie.
// No es un parser SQL completo: cubre ALTER TABLE ADD/DROP/RENAME COLUMN,
// que es lo que produce el desfase observado en N.18. Las columnas de
// CREATE TABLE no se reconstruyen aqui (las cubre schema.sql y la
// comprobacion de tablas de abajo).
function columnasEsperadas(archivos) {
  const porTabla = new Map();
  const set = (t) => { if (!porTabla.has(t)) porTabla.set(t, new Set()); return porTabla.get(t); };

  for (const archivo of archivos) {
    const sql = sinComentariosSql(fs.readFileSync(path.join(DB_DIR, archivo), 'utf8'));
    // Bloques DO $$ ... $$ pueden ser condicionales: se ignoran para no
    // exigir columnas que solo se agregan bajo cierta condicion.
    const plano = sql.replace(/\bDO\s+\$\$[\s\S]*?\$\$\s*;/gi, ' ').replace(/\bDO\s+\$(\w+)\$[\s\S]*?\$\1\$\s*;/gi, ' ');
    for (const sentencia of plano.split(';')) {
      const m = sentencia.match(/\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?(\w+)"?/i);
      if (!m) continue;
      const tabla = m[1].toLowerCase();
      for (const a of sentencia.matchAll(/\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)) {
        set(tabla).add(a[1].toLowerCase());
      }
      for (const d of sentencia.matchAll(/\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi)) {
        set(tabla).delete(d[1].toLowerCase());
      }
      for (const r of sentencia.matchAll(/\bRENAME\s+COLUMN\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/gi)) {
        set(tabla).delete(r[1].toLowerCase());
        set(tabla).add(r[2].toLowerCase());
      }
    }
    // Tablas eliminadas: dejan de exigirse sus columnas.
    for (const d of plano.matchAll(/\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi)) {
      porTabla.delete(d[1].toLowerCase());
    }
  }
  return porTabla;
}

async function main() {
  const { pool } = require('../src/db/pool');
  const problemas = [];
  try {
    const archivos = listarMigraciones();

    // 1) Migraciones pendientes
    const reg = await pool.query('SELECT version FROM schema_migrations');
    const aplicadas = new Set(reg.rows.map((r) => r.version));
    const pendientes = archivos.filter((f) => !aplicadas.has(versionDe(f)));
    for (const f of pendientes) problemas.push(`Migracion pendiente (no registrada): ${f}`);

    // 2) Columnas realmente presentes
    const esperadas = columnasEsperadas(archivos);
    const real = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
    );
    const existentes = new Map();
    for (const r of real.rows) {
      const t = r.table_name.toLowerCase();
      if (!existentes.has(t)) existentes.set(t, new Set());
      existentes.get(t).add(r.column_name.toLowerCase());
    }
    for (const [tabla, cols] of [...esperadas.entries()].sort()) {
      if (!existentes.has(tabla)) {
        // Puede ser una tabla creada por otra via; solo se avisa si hay columnas esperadas.
        if (cols.size > 0) problemas.push(`Tabla ausente: ${tabla} (se esperaban ${cols.size} columna(s) agregadas por migraciones)`);
        continue;
      }
      for (const col of [...cols].sort()) {
        if (!existentes.get(tabla).has(col)) {
          problemas.push(`Columna ausente: ${tabla}.${col} (una migracion la agrega pero NO existe en esta base)`);
        }
      }
    }

    console.log(`Migraciones en el repositorio: ${archivos.length}; registradas en la base: ${aplicadas.size}.`);
  } finally {
    await pool.end();
  }

  if (problemas.length) {
    console.error('\nESQUEMA DESFASADO -- NO desplegar codigo que dependa de estos cambios:');
    for (const p of problemas) console.error('  - ' + p);
    console.error('\nAplique las migraciones pendientes (npm run migrate, o pegue cada migration_XXX en el SQL Editor de Neon; son idempotentes) y vuelva a correr este script.');
    process.exit(1);
  }
  console.log('OK: el esquema de la base coincide con las migraciones del repositorio.');
}

if (require.main === module) {
  main().catch((e) => {
    console.error('No se pudo verificar el esquema:', e.message);
    process.exit(2);
  });
}

module.exports = { columnasEsperadas, sinComentariosSql, listarMigraciones };
