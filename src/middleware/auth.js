// ============================================================
// Middleware de autenticacion: verifica el access token en cada
// peticion protegida y adjunta la info del usuario a req.usuario.
//
// Esto es lo que reemplaza el sistema anterior donde el "rol"
// era una variable de JavaScript en el navegador que cualquiera
// podia modificar. Ahora el rol viene firmado dentro de un JWT
// que el servidor verifica con una clave secreta que el cliente
// nunca ve.
// ============================================================
const { verificarAccessToken, verificarTokenMfaPendiente } = require('../utils/jwt');

function autenticar(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No se proporciono un token de autenticacion.' });
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    const payload = verificarAccessToken(token);
    if (payload.tipo !== 'access') {
      return res.status(401).json({ error: 'Tipo de token invalido.' });
    }
    // Adjuntamos la info verificada del usuario a la peticion.
    // Los controladores usaran esto, NUNCA datos que vengan del body o query.
    req.usuario = {
      id: payload.sub,
      organizacionId: payload.organizacionId,
      rol: payload.rol,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'El token ha expirado.', codigo: 'TOKEN_EXPIRADO' });
    }
    return res.status(401).json({ error: 'Token invalido.' });
  }
}

/**
 * Middleware de autorizacion: solo permite continuar si el rol
 * del usuario autenticado esta en la lista de roles permitidos.
 *
 * Uso: router.get('/admin/algo', autenticar, autorizar('admin'), handler)
 */
function autorizar(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: 'No autenticado.' });
    }
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tiene permisos para realizar esta accion.' });
    }
    next();
  };
}

// ------------------------------------------------------------
// CORREGIDO tras auditoria de seguridad (hallazgo GRAVE G5):
// variante especial de `autenticar`, usada UNICAMENTE en las rutas
// de configuracion de MFA, para soportar el flujo de "MFA
// obligatorio no configurado" (ver login() en authController.js).
// En ese caso el usuario todavia NO tiene una sesion completa (no
// hay accessToken): solo tiene el mfaToken corto de 5 minutos que
// el login le devolvio junto con el error
// MFA_OBLIGATORIO_NO_CONFIGURADO. Este middleware acepta CUALQUIERA
// de los dos:
//   - Bearer access token normal (flujo de siempre: un usuario ya
//     logueado que decide configurar/activar MFA por su cuenta).
//   - mfaToken en el body (flujo nuevo: alguien que quedo bloqueado
//     en login porque su rol exige MFA y todavia no lo configuro).
// El mfaToken NUNCA sirve para nada mas que estas 2 rutas de
// configuracion de MFA: no abre sesion, no da acceso a ningun otro
// endpoint protegido (un middleware que exige tipo 'access' lo
// rechaza automaticamente).
// ------------------------------------------------------------
function autenticarOMfaPendiente(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return autenticar(req, res, next);
  }

  const mfaToken = req.body && req.body.mfaToken;
  if (!mfaToken) {
    return res.status(401).json({ error: 'No se proporciono un token de autenticacion.' });
  }
  try {
    const payload = verificarTokenMfaPendiente(mfaToken);
    if (payload.tipo !== 'mfa_pendiente') {
      return res.status(401).json({ error: 'Token invalido.' });
    }
    req.usuario = { id: payload.sub, organizacionId: null, rol: null };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'El token de verificacion expiro o es invalido. Inicie sesion de nuevo.' });
  }
}

module.exports = { autenticar, autorizar, autenticarOMfaPendiente };
