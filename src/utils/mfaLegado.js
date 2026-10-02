// ============================================================
// Utilidad compartida: rotacion forzada de secretos MFA heredados.
//
// CORRIGE el hallazgo CRITICO C-N07-01 de la Auditoria Integral
// SISSO N.07: "los secretos TOTP heredados (guardados en texto
// plano antes de la migracion 029) pueden seguir existiendo en la
// base de datos". Re-cifrar un secreto heredado EN EL LUGAR (lo que
// hacia la version anterior de verificarCodigoMfa) no remedia una
// fuga que ya pudo haber ocurrido -- solo la ROTACION (invalidar el
// secreto viejo y generar uno nuevo que nunca existio en texto
// plano) cierra el riesgo de verdad.
//
// authController.js ya fuerza esta rotacion de forma automatica e
// individual la proxima vez que cada cuenta afectada inicia sesion
// (ver verificarCodigoMfa). Esta utilidad cubre el caso que esa
// correccion por si sola NO cubre: cuentas con un secreto heredado
// que NO vuelven a iniciar sesion pronto (o nunca), y que de otro
// modo quedarian con el secreto expuesto en la base de datos
// indefinidamente. Se usa desde 2 lugares:
//   - scripts/mfa_forzar_rotacion_legado.js (linea de comandos).
//   - POST /api/superadmin/mfa/rotar-legado (HTTP, para operar
//     desde Render sin necesitar una terminal local -- ver nota en
//     package.json sobre el entorno de despliegue del equipo).
// ============================================================
const { query } = require('../db/pool');
const { esFormatoCifrado } = require('./crypto');
const { registrarAuditoria } = require('./auditoria');

/**
 * Busca todas las cuentas con MFA habilitado cuyo mfa_secret NO esta
 * en formato cifrado (iv:tag:datos), y fuerza su rotacion:
 *   - mfa_habilitado = false
 *   - mfa_secret = NULL, mfa_secret_pendiente = NULL
 * Esto hace que, la proxima vez que ese usuario inicie sesion, como
 * todos los roles de SISSO exigen MFA (ROLES_MFA_OBLIGATORIO),
 * automaticamente caiga en el flujo ya existente
 * 'MFA_OBLIGATORIO_NO_CONFIGURADO' y deba escanear un QR nuevo antes
 * de poder entrar -- sin necesitar ningun cambio de frontend, es el
 * mismo contrato que ya usa 'rol exige MFA y todavia no lo
 * configuro'.
 *
 * Devuelve la lista de cuentas afectadas (id, email, organizacion_id,
 * rol) para que quien ejecuta el proceso pueda notificarles fuera de
 * banda que deben reconfigurar su segundo factor.
 */
async function rotarSecretosMfaLegados({ actorUsuarioId = null, req = null } = {}) {
  const candidatas = await query(
    `SELECT id, email, organizacion_id, rol, mfa_secret
     FROM usuarios
     WHERE mfa_habilitado = true AND mfa_secret IS NOT NULL`
  );

  const afectadas = candidatas.rows.filter((u) => !esFormatoCifrado(u.mfa_secret));
  if (afectadas.length === 0) {
    return { totalRevisadas: candidatas.rows.length, afectadas: [] };
  }

  const ids = afectadas.map((u) => u.id);
  await query(
    `UPDATE usuarios
     SET mfa_habilitado = false, mfa_secret = NULL, mfa_secret_pendiente = NULL
     WHERE id = ANY($1::uuid[])`,
    [ids]
  );

  for (const u of afectadas) {
    await registrarAuditoria({
      organizacionId: u.organizacion_id,
      usuarioId: actorUsuarioId || u.id,
      accion: 'mfa_secreto_legado_rotacion_forzada_masiva',
      entidad: 'usuarios',
      entidadId: u.id,
      detalle: { email: u.email, rol: u.rol, motivo: 'secreto_totp_heredado_en_texto_plano' },
      critico: true,
      req,
    });
  }

  return {
    totalRevisadas: candidatas.rows.length,
    afectadas: afectadas.map((u) => ({ id: u.id, email: u.email, organizacionId: u.organizacion_id, rol: u.rol })),
  };
}

module.exports = { rotarSecretosMfaLegados };
