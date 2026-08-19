// ============================================================
// SISSO - Cifrado simetrico para datos sensibles en reposo.
//
// Corrige el hallazgo CRITICO de la auditoria de seguridad:
// "El secreto TOTP (mfa_secret) se guarda en texto plano en la
// base de datos". Si alguien obtiene acceso de solo lectura a la
// BD (backup filtrado, dump, acceso indebido a Neon, etc.), un
// secreto en texto plano le permite generar codigos MFA validos
// y anular por completo la proteccion del segundo factor.
//
// Diseno: AES-256-GCM (cifrado autenticado: detecta manipulacion,
// no solo confidencialidad). La clave NUNCA vive en la base de
// datos, solo en la variable de entorno MFA_ENCRYPTION_KEY.
//
// Formato guardado: "<iv_base64>:<tag_base64>:<cifrado_base64>"
// ============================================================
const crypto = require('crypto');

const ALGORITMO = 'aes-256-gcm';

function obtenerClave() {
  const clave = process.env.MFA_ENCRYPTION_KEY;
  if (!clave) {
    throw new Error(
      'Falta la variable de entorno MFA_ENCRYPTION_KEY. Genere una clave de 32 bytes con: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))" ' +
      'y definala en Render (Environment) antes de operar con MFA.'
    );
  }
  const buffer = Buffer.from(clave, 'base64');
  if (buffer.length !== 32) {
    throw new Error('MFA_ENCRYPTION_KEY debe decodificar a exactamente 32 bytes (AES-256). El valor actual no tiene el largo correcto.');
  }
  return buffer;
}

/**
 * Cifra un texto (ej: secreto TOTP) para guardarlo en base de datos.
 */
function encriptar(textoPlano) {
  const iv = crypto.randomBytes(12); // 96 bits, recomendado para GCM
  const cipher = crypto.createCipheriv(ALGORITMO, obtenerClave(), iv);
  const cifrado = Buffer.concat([cipher.update(textoPlano, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${cifrado.toString('base64')}`;
}

/**
 * Descifra un valor generado por encriptar().
 *
 * Compatibilidad hacia atras: si el valor NO tiene el formato
 * "iv:tag:datos" (por ejemplo, un secreto TOTP viejo guardado en
 * texto plano antes de esta correccion), se devuelve tal cual en
 * lugar de fallar, para no romper el login de usuarios que ya
 * habian activado MFA. La siguiente vez que ese usuario reconfigure
 * MFA (iniciarConfiguracionMfa), el nuevo secreto ya se guardara
 * cifrado. Se recomienda notificar a los usuarios con MFA activo
 * antes de esta correccion para que lo reconfiguren una vez.
 */
function desencriptar(valorGuardado) {
  if (!valorGuardado) return valorGuardado;
  const partes = String(valorGuardado).split(':');
  if (partes.length !== 3) {
    // Formato legado (texto plano, version anterior a esta correccion).
    return valorGuardado;
  }
  const [ivB64, tagB64, datosB64] = partes;
  try {
    const decipher = crypto.createDecipheriv(ALGORITMO, obtenerClave(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const descifrado = Buffer.concat([decipher.update(Buffer.from(datosB64, 'base64')), decipher.final()]);
    return descifrado.toString('utf8');
  } catch (err) {
    throw new Error('No se pudo descifrar el secreto MFA. Verifique que MFA_ENCRYPTION_KEY no haya cambiado.');
  }
}

/**
 * Indica si un valor guardado en mfa_secret/mfa_secret_pendiente ya
 * esta en el formato cifrado ("iv:tag:datos" en base64) o si es un
 * secreto heredado en texto plano (de antes de la migracion 029).
 */
function esFormatoCifrado(valor) {
  return typeof valor === 'string' && valor.split(':').length === 3;
}

module.exports = { encriptar, desencriptar, esFormatoCifrado };
