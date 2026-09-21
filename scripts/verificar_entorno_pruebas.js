#!/usr/bin/env node
'use strict';
// ============================================================
// CREADO en Auditoria N.18 (C18-01, P0): "la suite completa no es
// ejecutable sin infraestructura de prueba". La suite necesita un
// PostgreSQL real y varias variables; cuando faltan, las pruebas
// fallaban de a decenas con errores oscuros (EAI_AGAIN, "falta
// JWT_ACCESS_SECRET"...) que parecian fallos de la aplicacion.
//
// Este verificador corre ANTES de `npm test` (script "pretest") y
// falla en segundos, con un mensaje accionable, si:
//   1. falta alguna variable de entorno obligatoria;
//   2. la base de datos no responde;
//   3. el rol de DATABASE_URL es superusuario o tiene BYPASSRLS
//      (PostgreSQL omite RLS para ellos: las pruebas de aislamiento
//      entre organizaciones darian resultados FALSOS -- el caso real
//      de los roles creados con el boton "Add role" de Neon);
//   4. las migraciones del repositorio no estan todas aplicadas
//      (ejecutar `npm run migrate`).
// Ver docs/ENTORNO_PRUEBAS.md.
// ============================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const OBLIGATORIAS = [
  'DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'MFA_ENCRYPTION_KEY',
  'BOOTSTRAP_SECRET', 'RECOVERY_SECRET', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
];

function fallar(titulo, detalle) {
  console.error(`\nENTORNO DE PRUEBAS NO LISTO: ${titulo}\n`);
  console.error(detalle);
  console.error('\nGuia completa: docs/ENTORNO_PRUEBAS.md\n');
  process.exit(1);
}

async function main() {
  const faltan = OBLIGATORIAS.filter((v) => !process.env[v]);
  if (faltan.length > 0) {
    fallar(`faltan variables de entorno (${faltan.length}).`,
      `Definalas en .env (copie .env.example) o en el entorno:\n  - ${faltan.join('\n  - ')}`);
  }

  const { pool } = require('../src/db/pool');
  let filaRol;
  try {
    const r = await pool.query('SELECT rolsuper, rolbypassrls, current_user AS usuario FROM pg_roles WHERE rolname = current_user');
    filaRol = r.rows[0];
  } catch (err) {
    await pool.end().catch(() => {});
    fallar('no se pudo conectar a PostgreSQL con DATABASE_URL.',
      `Error: ${err.code || ''} ${err.message}\n`
      + 'Levante un PostgreSQL 16 (ver docs/ENTORNO_PRUEBAS.md) y revise DATABASE_URL. '
      + 'Si el servidor no ofrece TLS (Postgres local/CI), defina DB_SSL_DISABLED=true SOLO para pruebas.');
  }

  if (filaRol.rolsuper || filaRol.rolbypassrls) {
    await pool.end().catch(() => {});
    fallar(`el rol "${filaRol.usuario}" de DATABASE_URL es ${filaRol.rolsuper ? 'SUPERUSUARIO' : 'un rol con BYPASSRLS'}.`,
      'PostgreSQL omite Row Level Security para ese rol: las pruebas de aislamiento entre organizaciones\n'
      + 'pasarian o fallarian por la razon equivocada. Use un rol de aplicacion SIN esos atributos, creado\n'
      + 'con SQL plano (CREATE ROLE ... LOGIN PASSWORD ...). En Neon NO use el boton "Add role": ese rol\n'
      + 'siempre hereda BYPASSRLS y no se le puede quitar.');
  }

  const dir = path.join(__dirname, '..', 'src', 'db');
  const versiones = fs.readdirSync(dir)
    .filter((f) => /^migration_\d+_.*\.sql$/.test(f))
    .map((f) => f.replace(/^migration_/, '').replace(/\.sql$/, ''));
  let aplicadas;
  try {
    aplicadas = new Set((await pool.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
  } catch (err) {
    await pool.end().catch(() => {});
    fallar('la base de datos no tiene la tabla schema_migrations (esta vacia).', 'Ejecute: npm run migrate');
  }
  const pendientes = versiones.filter((v) => !aplicadas.has(v));
  await pool.end().catch(() => {});
  if (pendientes.length > 0) {
    fallar(`hay ${pendientes.length} migracion(es) sin aplicar.`, `Ejecute: npm run migrate\nPendientes: ${pendientes.join(', ')}`);
  }

  console.log(`OK: entorno de pruebas listo (rol "${filaRol.usuario}" sin BYPASSRLS, ${versiones.length} migraciones aplicadas).`);
}

main().catch((err) => {
  console.error('Error inesperado verificando el entorno de pruebas:', err);
  process.exit(1);
});
