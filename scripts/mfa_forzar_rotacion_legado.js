// ============================================================
// Script: fuerza la rotacion de secretos MFA heredados (texto
// plano) que quedaron pendientes de migracion. Corrige el
// hallazgo CRITICO C-N07-01 de la Auditoria Integral SISSO N.07.
//
// Uso: node scripts/mfa_forzar_rotacion_legado.js
// Requiere DATABASE_URL configurada.
//
// Si el equipo no tiene una terminal con Node contra la base de
// produccion (ej. Render Free sin Shell), usar en su lugar
// POST /api/superadmin/mfa/rotar-legado con una sesion de
// superadmin -- misma logica, expuesta por HTTP.
//
// Que hace: cada cuenta con MFA habilitado cuyo secreto NO esta en
// formato cifrado queda con mfa_habilitado=false y su secreto
// borrado. Como todos los roles de SISSO exigen MFA, esas cuentas
// deberan reconfigurar su segundo factor (QR nuevo) la proxima vez
// que inicien sesion -- ver src/utils/mfaLegado.js para el detalle
// completo de por que esto es lo correcto (rotacion real, no solo
// re-cifrado del mismo secreto potencialmente ya expuesto).
//
// IMPORTANTE: notificar a cada cuenta listada en la salida (fuera
// de banda: email, Slack, etc.) que su MFA quedo invalidado y debe
// reconfigurarlo antes de su proximo login.
// ============================================================
require('dotenv').config();
const { pool } = require('../src/db/pool');
const { rotarSecretosMfaLegados } = require('../src/utils/mfaLegado');

rotarSecretosMfaLegados()
  .then(({ totalRevisadas, afectadas }) => {
    console.log(`Cuentas con MFA habilitado revisadas: ${totalRevisadas}`);
    if (afectadas.length === 0) {
      console.log('No se encontraron secretos MFA heredados en texto plano. Nada que rotar.');
      return;
    }
    console.log(`Se forzo la rotacion de ${afectadas.length} cuenta(s). Notificar a cada una que debe reconfigurar su MFA:`);
    for (const u of afectadas) {
      console.log(`  - ${u.email} (rol: ${u.rol}, organizacion: ${u.organizacionId})`);
    }
  })
  .catch((err) => {
    console.error('Error durante la rotacion de secretos MFA heredados:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
