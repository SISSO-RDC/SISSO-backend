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

// CREADO (firma electronica criptografica, Oct 2026): encriptar/desencriptar
// ahora aceptan QUE variable de entorno usar como clave, en vez de asumir
// siempre MFA_ENCRYPTION_KEY. Esto permite que un secreto nuevo e
// igual de sensible (el .p12 + passphrase de la firma electronica de un
// profesional) se cifre con SU PROPIA clave (FIRMA_ELECTRONICA_ENCRYPTION_KEY),
// separada de la de MFA -- si una de las dos claves se filtra alguna vez,
// la otra categoria de secretos sigue protegida. El parametro es opcional
// y por defecto sigue siendo MFA_ENCRYPTION_KEY: ningun llamado existente
// (los de MFA) cambia de comportamiento.
function obtenerClave(nombreVariableEntorno = 'MFA_ENCRYPTION_KEY') {
  const clave = process.env[nombreVariableEntorno];
  if (!clave) {
    throw new Error(
      `Falta la variable de entorno ${nombreVariableEntorno}. Genere una clave de 32 bytes con: ` +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))" ' +
      `y definala en Render (Environment) antes de operar con ${nombreVariableEntorno === 'MFA_ENCRYPTION_KEY' ? 'MFA' : 'esta funcion'}.`
    );
  }
  const buffer = Buffer.from(clave, 'base64');
  if (buffer.length !== 32) {
    throw new Error(`${nombreVariableEntorno} debe decodificar a exactamente 32 bytes (AES-256). El valor actual no tiene el largo correcto.`);
  }
  return buffer;
}

/**
 * Cifra un texto (ej: secreto TOTP, o el .p12/passphrase de una firma
 * electronica) para guardarlo en base de datos.
 */
function encriptar(textoPlano, nombreVariableEntorno = 'MFA_ENCRYPTION_KEY') {
  const iv = crypto.randomBytes(12); // 96 bits, recomendado para GCM
  const cipher = crypto.createCipheriv(ALGORITMO, obtenerClave(nombreVariableEntorno), iv);
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
function desencriptar(valorGuardado, nombreVariableEntorno = 'MFA_ENCRYPTION_KEY') {
  if (!valorGuardado) return valorGuardado;
  const partes = String(valorGuardado).split(':');
  if (partes.length !== 3) {
    // Formato legado (texto plano, version anterior a esta correccion).
    return valorGuardado;
  }
  const [ivB64, tagB64, datosB64] = partes;
  try {
    const decipher = crypto.createDecipheriv(ALGORITMO, obtenerClave(nombreVariableEntorno), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const descifrado = Buffer.concat([decipher.update(Buffer.from(datosB64, 'base64')), decipher.final()]);
    return descifrado.toString('utf8');
  } catch (err) {
    throw new Error(`No se pudo descifrar el secreto. Verifique que ${nombreVariableEntorno} no haya cambiado.`);
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
