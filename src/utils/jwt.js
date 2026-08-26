// ============================================================
// Utilidades para generar y verificar tokens JWT.
//
// Usamos DOS tokens:
// - accessToken: vida corta (15 min), va en cada peticion, NO se
//   guarda en base de datos. Si se filtra, expira rapido.
// - refreshToken: vida larga (7 dias), se guarda (hasheado) en la
//   tabla refresh_tokens para poder revocarlo si es necesario
//   (ej: si el usuario cierra sesion o si se detecta un robo).
// ============================================================
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  console.error('ERROR: faltan JWT_ACCESS_SECRET o JWT_REFRESH_SECRET en .env');
  process.exit(1);
}

/**
 * Genera un access token de corta duracion con la info minima
 * necesaria para autorizar peticiones: quien es, de que empresa,
 * y que rol tiene.
 */
function generarAccessToken(usuario) {
  return jwt.sign(
    {
      sub: usuario.id,
      organizacionId: usuario.organizacion_id,
      rol: usuario.rol,
      tipo: 'access',
    },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRES }
  );
}

/**
 * Genera un refresh token de larga duracion. Solo contiene el id
 * del usuario; todo lo demas se vuelve a consultar en base de datos
 * cuando se usa para renovar el access token (asi si el rol cambia,
 * se refleja de inmediato).
 *
 * CORREGIDO durante la verificacion manual de la Auditoria N.08
 * (hallazgo CRITICO no catalogado previamente, encontrado al probar
 * end-to-end la correccion de G-N08-03): sin un campo con entropia
 * propia, el payload de un refresh token es enteramente
 * predecible/repetible: `sub` y `tipo` son fijos, y `iat` (que
 * jsonwebtoken agrega automaticamente) solo tiene granularidad de
 * SEGUNDOS. Si el mismo usuario recibe dos refresh tokens distintos
 * (ej. login y luego una rotacion) dentro del mismo segundo de
 * reloj, la firma HMAC produce el MISMO string de token para ambos
 * -- y por lo tanto el MISMO hashToken(). Esto rompe por completo el
 * mecanismo de deteccion de reuso (C-N07/G8): el UPDATE atomico
 * "WHERE token_hash = $1 AND usado_en IS NULL" ya no puede
 * distinguir el token padre (ya usado) del hijo recien emitido (sin
 * usar) porque comparten el mismo hash -- el servidor no tiene forma
 * de saber cual de los dos esta presentando el cliente. En la
 * practica, esto se disparo de verdad en una prueba manual (login
 * seguido de un refresh a los pocos milisegundos, ambos dentro del
 * mismo segundo), y volvio a aceptar como valido un token que ya
 * deberia haber sido rechazado como reuso.
 *
 * La correccion es agregar `jti` (JWT ID), un identificador aleatorio
 * de 16 bytes generado con crypto.randomBytes en cada llamada. Esto
 * garantiza que DOS refresh tokens jamas sean el mismo string, sin
 * importar que tan rapido se emitan, eliminando la colision de raiz
 * (no es un parche al sintoma: quita la causa, que era la falta de
 * entropia propia del token).
 */
function generarRefreshToken(usuario) {
  return jwt.sign(
    { sub: usuario.id, tipo: 'refresh', jti: crypto.randomBytes(16).toString('hex') },
    REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES }
  );
}

/**
 * Token de vida MUY corta (5 min) que se emite tras validar la
 * contrasena de un usuario con MFA habilitado, ANTES de completar
 * el login. Su unico proposito es demostrar "ya probé mi
 * contrasena" al endpoint que verifica el codigo TOTP, sin haber
 * emitido todavia un accessToken/refreshToken reales. No sirve
 * para nada mas (tipo: 'mfa_pendiente', un middleware que solo
 * acepta tipo 'access' lo rechaza automaticamente).
 */
function generarTokenMfaPendiente(usuario) {
  return jwt.sign(
    { sub: usuario.id, tipo: 'mfa_pendiente' },
    ACCESS_SECRET,
    { expiresIn: '5m' }
  );
}

function verificarTokenMfaPendiente(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

function verificarAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

function verificarRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

/**
 * Convierte un string como "7d" o "15m" a milisegundos, para poder
 * calcular la fecha de expiracion que guardamos en base de datos.
 */
function expiresInMs(expr) {
  const match = /^(\d+)([smhd])$/.exec(expr);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default: 7 dias
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const unidades = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * unidades[unit];
}

/**
 * Genera un hash de un refresh token para guardarlo en base de datos.
 * Nunca guardamos el token en texto plano: si alguien accede a la
 * base de datos, no debe poder usar los tokens directamente.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  generarAccessToken,
  generarRefreshToken,
  generarTokenMfaPendiente,
  verificarTokenMfaPendiente,
  verificarAccessToken,
  verificarRefreshToken,
  expiresInMs,
  hashToken,
  REFRESH_EXPIRES,
};
