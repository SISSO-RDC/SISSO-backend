// ============================================================
// Siembra de datos para el suite de pruebas automatizadas.
//
// Crea DOS organizaciones (A y B) con un usuario de cada rol en
// la organizacion A (admin, medico, sso, th) + un trabajador y un
// registro clinico en A, y un trabajador en B -- el minimo
// necesario para poder probar de verdad:
//   - Aislamiento multi-tenant (C1): que un usuario de A jamas
//     pueda leer un ID que pertenece a B.
//   - Autorizacion/IDOR entre roles (G4): que SSO/TH no puedan leer
//     datos clinicos, aunque conozcan el ID exacto.
//   - Rate limiting de MFA (G1): usa un secreto TOTP real (cifrado
//     igual que en produccion) para poder generar codigos validos Y
//     codigos invalidos deliberadamente durante las pruebas.
//
// Los usuarios se siembran con MFA_HABILITADO=true y un secreto
// real, para forzar que las pruebas pasen por el flujo COMPLETO de
// login + MFA (no un atajo), tal como lo exige la auditoria:
// "Faltan pruebas de integracion: login; MFA; refresh; roles".
// ============================================================
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const { pool } = require('../../src/db/pool');
const { encriptar } = require('../../src/utils/crypto');

const PASSWORD_PRUEBA = 'ClaveDePrueba#2026';

async function sembrar() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Limpieza de corridas anteriores (idempotente).
    await client.query(`DELETE FROM organizaciones WHERE codigo IN ('TEST-ORG-A', 'TEST-ORG-B')`);

    const orgARes = await client.query(
      `INSERT INTO organizaciones (nombre, codigo, plan, estado_suscripcion) VALUES ('Organizacion Prueba A', 'TEST-ORG-A', 'inicial', 'activa') RETURNING id`
    );
    const orgBRes = await client.query(
      `INSERT INTO organizaciones (nombre, codigo, plan, estado_suscripcion) VALUES ('Organizacion Prueba B', 'TEST-ORG-B', 'inicial', 'activa') RETURNING id`
    );
    const orgAId = orgARes.rows[0].id;
    const orgBId = orgBRes.rows[0].id;

    const passwordHash = await bcrypt.hash(PASSWORD_PRUEBA, 10);
    const secretoTotp = authenticator.generateSecret();
    const secretoCifrado = encriptar(secretoTotp);

    const usuarios = {};
    for (const rol of ['admin', 'medico', 'sso', 'th']) {
      const res = await client.query(
        `INSERT INTO usuarios (organizacion_id, email, password_hash, nombre_completo, rol, mfa_habilitado, mfa_secret)
         VALUES ($1, $2, $3, $4, $5, true, $6)
         RETURNING id`,
        [orgAId, `${rol}.prueba@sisso-test.com`, passwordHash, `Usuario Prueba ${rol}`, rol, secretoCifrado]
      );
      usuarios[rol] = { id: res.rows[0].id, email: `${rol}.prueba@sisso-test.com`, rol };
    }

    // Un segundo admin en la organizacion B, para probar aislamiento.
    const adminBRes = await client.query(
      `INSERT INTO usuarios (organizacion_id, email, password_hash, nombre_completo, rol, mfa_habilitado, mfa_secret)
       VALUES ($1, $2, $3, $4, 'admin', true, $5) RETURNING id`,
      [orgBId, 'admin.b.prueba@sisso-test.com', passwordHash, 'Usuario Prueba Admin B', secretoCifrado]
    );
    usuarios.adminB = { id: adminBRes.rows[0].id, email: 'admin.b.prueba@sisso-test.com', rol: 'admin' };

    // Trabajador + registro clinico en la organizacion A.
    const trabajadorARes = await client.query(
      `INSERT INTO trabajadores (organizacion_id, nombre_completo, documento, aptitud)
       VALUES ($1, 'Trabajador Prueba A', 'DOC-TEST-A-001', 'apto') RETURNING id`,
      [orgAId]
    );
    const trabajadorAId = trabajadorARes.rows[0].id;

    // Trabajador en la organizacion B (para probar que A no puede leerlo).
    const trabajadorBRes = await client.query(
      `INSERT INTO trabajadores (organizacion_id, nombre_completo, documento, aptitud)
       VALUES ($1, 'Trabajador Prueba B', 'DOC-TEST-B-001', 'apto') RETURNING id`,
      [orgBId]
    );
    const trabajadorBId = trabajadorBRes.rows[0].id;

    await client.query('COMMIT');

    return {
      orgAId, orgBId, trabajadorAId, trabajadorBId, usuarios,
      passwordPrueba: PASSWORD_PRUEBA, secretoTotp,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function limpiar() {
  await pool.query(`DELETE FROM organizaciones WHERE codigo IN ('TEST-ORG-A', 'TEST-ORG-B')`);
}

module.exports = { sembrar, limpiar };
