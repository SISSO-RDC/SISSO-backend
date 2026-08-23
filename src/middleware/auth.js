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
const { ejecutarConContexto } = require('../utils/contextoSolicitud');

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
    // CORREGIDO (hallazgo GRAVE G3): propaga la identidad verificada
    // al contexto async para que db/pool.js pueda fijar las
    // variables de sesion de PostgreSQL que las politicas RLS
    // (migration_045) usan para filtrar cada consulta a nivel de
    // base de datos, ademas del filtrado que ya hace cada
    // controlador. Ver src/utils/contextoSolicitud.js.
    ejecutarConContexto(
      { organizacionId: payload.organizacionId, usuarioId: payload.sub, esSuperadmin: payload.rol === 'superadmin' },
      next
    );
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
    // Sin organizacion confirmada todavia (usuario a medio loguear),
    // pero SI con usuarioId -- la politica RLS de `usuarios` permite
    // que cualquiera vea/edite su PROPIA fila por id incluso sin
    // organizacion_id en contexto, que es exactamente lo que estas
    // 2 rutas de configuracion de MFA necesitan.
    ejecutarConContexto({ organizacionId: null, usuarioId: payload.sub, esSuperadmin: false }, next);
  } catch (err) {
    return res.status(401).json({ error: 'El token de verificacion expiro o es invalido. Inicie sesion de nuevo.' });
  }
}

// ------------------------------------------------------------
// CORREGIDO (hallazgo GRAVE G3): las rutas de PRE-sesion (login,
// segundo paso de MFA, refrescar token, logout, bootstrap y
// recuperacion de superadmin) no pasan por `autenticar` -- todavia
// no sabemos quien es el usuario ni a que organizacion pertenece
// cuando arrancan (login busca por EMAIL, refrescar busca por el
// HASH del refresh token). Sin contexto async, db/pool.js no fija
// ninguna variable de sesion, y con RLS + FORCE ROW LEVEL SECURITY
// activo (migration_045) esas consultas devolverian CERO filas
// aunque el usuario exista, rompiendo el login por completo.
//
// Este middleware marca el contexto como "superadmin" (bypassa el
// filtro de organizacion en las politicas RLS) UNICAMENTE para
// estas rutas puntuales, ANTES de que exista ninguna sesion. Cada
// controlador sigue validando credenciales/tokens exactamente
// igual que antes -- esto no otorga ningun acceso nuevo a nadie,
// solo le permite a estas rutas especificas *buscar* en toda la
// tabla antes de saber a quien encontraron.
// ------------------------------------------------------------
function contextoInterno(req, res, next) {
  ejecutarConContexto({ organizacionId: null, usuarioId: null, esSuperadmin: true }, next);
}

module.exports = { autenticar, autorizar, autenticarOMfaPendiente, contextoInterno };
