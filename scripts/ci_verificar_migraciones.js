// ============================================================
// CREADO en Auditoria N.14 (C14-03, P0), complemento del CI real.
//
// Verifica, contra el PostgreSQL efimero de CI, que TODAS las
// migraciones presentes en src/db/migration_*.sql quedaron
// registradas en schema_migrations tras correr `npm run migrate`.
// Esto cierra el riesgo mencionado por la Auditoria N.14 de que
// "el codigo puede estar desincronizado de la BD": si alguien
// agrega un archivo migration_XXX_*.sql pero se le olvida el
// INSERT INTO schema_migrations al final, o el nombre de archivo no
// sigue el patron esperado, este script falla el pipeline en vez de
// dejarlo pasar en silencio.
// ============================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db/pool');

const DB_DIR = path.join(__dirname, '..', 'src', 'db');

async function main() {
  const archivos = fs.readdirSync(DB_DIR)
    .filter((f) => /^migration_\d+_.*\.sql$/.test(f))
    .map((f) => f.replace(/^migration_/, '').replace(/\.sql$/, ''));

  const { rows } = await pool.query('SELECT version FROM schema_migrations');
  const aplicadas = new Set(rows.map((r) => r.version));

  const faltantes = archivos.filter((v) => !aplicadas.has(v));

  if (faltantes.length > 0) {
    console.error('FALLO: las siguientes migraciones existen en el repositorio pero NO quedaron registradas como aplicadas tras `npm run migrate`:');
    faltantes.forEach((f) => console.error('  - ' + f));
    console.error('Revise que cada archivo migration_XXX_*.sql termine con INSERT INTO schema_migrations (version) VALUES (...) y que el nombre de archivo siga el patron migration_<numero>_<descripcion>.sql.');
    await pool.end();
    process.exit(1);
  }

  console.log(`OK: ${archivos.length} migraciones del repositorio estan todas aplicadas en schema_migrations.`);
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Error verificando migraciones:', err);
  process.exit(1);
});
