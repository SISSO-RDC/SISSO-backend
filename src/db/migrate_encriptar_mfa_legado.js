// ============================================================
// SISSO - Migracion de datos (no de esquema): cifrar los secretos
// MFA heredados que todavia estan en texto plano.
//
// Corrige el hallazgo CRITICO C2 de la auditoria comparativa:
// "La compatibilidad con secretos MFA antiguos en texto plano
// mantiene una debilidad historica en la base de datos." La
// migracion 029 (mfa_cifrado) agrego el cifrado AES-256-GCM para
// los secretos MFA NUEVOS (los que se crean/reconfiguran de ahi en
// adelante), y desencriptar() en src/utils/crypto.js quedo con
// compatibilidad hacia atras para no romper el login de cuentas
// que ya tenian MFA activo ANTES de esa migracion (su secreto
// seguia en texto plano en la base de datos). Ese texto plano
// nunca se limpio: es exactamente lo que este script hace.
//
// A diferencia de las migraciones de esquema (migration_XXX_*.sql),
// esto NO es SQL puro: hay que leer cada secreto, cifrarlo con la
// funcion encriptar() (que usa MFA_ENCRYPTION_KEY, una variable de
// entorno que Postgres no puede leer por si solo) y escribir el
// resultado. Por eso es un script de Node, no un archivo .sql.
//
// CÓMO EJECUTARLO (SISSO no tiene Node local, pero Render si):
//   1. Ir al servicio backend en Render -> pestaña "Shell".
//   2. Ejecutar:  node src/db/migrate_encriptar_mfa_legado.js
//   3. Revisar el resumen que imprime al final (cuantas cuentas se
//      migraron). Es seguro volver a correrlo: las que ya estaban
//      cifradas se saltan automaticamente (operacion idempotente).
//
// Uso: node src/db/migrate_encriptar_mfa_legado.js
// ============================================================
require('dotenv').config();
const { pool, query } = require('./pool');
const { encriptar, esFormatoCifrado } = require('../utils/crypto');

async function migrarSecretosMfaLegados() {
  console.log('Buscando secretos MFA heredados en texto plano...');

  const resultado = await query(
    `SELECT id, email, mfa_secret, mfa_secret_pendiente
     FROM usuarios
     WHERE mfa_secret IS NOT NULL OR mfa_secret_pendiente IS NOT NULL`
  );

  let migrados = 0;
  let yaCifrados = 0;

  for (const fila of resultado.rows) {
    const actualizaciones = {};

    if (fila.mfa_secret && !esFormatoCifrado(fila.mfa_secret)) {
      actualizaciones.mfa_secret = encriptar(fila.mfa_secret);
    }
    if (fila.mfa_secret_pendiente && !esFormatoCifrado(fila.mfa_secret_pendiente)) {
      actualizaciones.mfa_secret_pendiente = encriptar(fila.mfa_secret_pendiente);
    }

    if (Object.keys(actualizaciones).length === 0) {
      yaCifrados++;
      continue;
    }

    const campos = Object.keys(actualizaciones);
    const set = campos.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const valores = campos.map((c) => actualizaciones[c]);
    await query(`UPDATE usuarios SET ${set} WHERE id = $1`, [fila.id, ...valores]);

    console.log(`  -> Migrado: ${fila.email} (${campos.join(', ')})`);
    migrados++;
  }

  console.log('');
  console.log(`Migracion completada. Cuentas migradas: ${migrados}. Ya estaban cifradas: ${yaCifrados}.`);
  if (migrados === 0 && yaCifrados === 0) {
    console.log('No hay ninguna cuenta con MFA configurado todavia.');
  }
}

migrarSecretosMfaLegados()
  .catch((err) => {
    console.error('Error durante la migracion de secretos MFA:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
