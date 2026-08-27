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
const { queryComoSuperadmin } = require('../db/pool');

// ------------------------------------------------------------
// CORREGIDO en Auditoria N.09 (hallazgo GRAVE/MODERADO G-N09-11):
// cuando el superadmin suspende una organizacion (o vence su
// suscripcion), se revocan los refresh tokens de inmediato -- pero
// un access token YA EMITIDO antes de la suspension seguia siendo
// valido hasta su propia expiracion (hasta 15 minutos), porque
// `autenticar` solo verificaba la firma/expiracion del JWT, sin
// volver a consultar el estado de la organizacion en cada peticion.
//
// La auditoria sugiere tres alternativas ("consultar estado en
// middleware", "session_version", "lista de revocacion con cache").
// Se implementa una variante de la primera con cache corto en
// memoria: en vez de una consulta a BD en CADA peticion (costoso) o
// dejar el hueco de 15 minutos completo (lo que se queria corregir),
// se cachea el estado activa/suspendida de cada organizacion por
// ORGANIZACION_CACHE_TTL_MS y se revalida despues de ese tiempo. El
// hueco de "acceso valido tras suspension" pasa de hasta 15 minutos
// a, como maximo, la duracion del cache (20 segundos) -- una mejora
// de dos ordenes de magnitud sin agregar una consulta a BD por
// cada peticion autenticada.
//
// NOTA: esto es una cache EN MEMORIA del proceso Node. En un
// despliegue con varias instancias/replicas detras de un balanceador
// (no es el caso actual de SISSO en Render con un solo dyno), cada
// instancia tendria su propia cache -- seguiria acotando el hueco a
// ORGANIZACION_CACHE_TTL_MS por instancia, pero para una garantia
// estricta multi-instancia se necesitaria una cache compartida
// (Redis) o el enfoque de `session_version` que tambien menciona la
// auditoria. Se deja documentado como siguiente paso si SISSO
// escala a mas de una instancia.
// ------------------------------------------------------------
const ORGANIZACION_CACHE_TTL_MS = 20 * 1000;
const cacheEstadoOrganizacion = new Map(); // organizacionId -> { activa, suspendidaManualmente, expiraEn }

async function organizacionEstaBloqueada(organizacionId) {
  const ahora = Date.now();
  const cacheada = cacheEstadoOrganizacion.get(organizacionId);
  if (cacheada && cacheada.expiraEn > ahora) {
    return !cacheada.activa || cacheada.suspendidaManualmente;
  }

  // IMPORTANTE: en este punto de `autenticar` todavia NO se llamo a
  // ejecutarConContexto() (eso pasa mas abajo, envolviendo `next`).
  // Sin contexto async, query() normal caeria en RLS con
  // app.organizacion_actual/es_superadmin sin fijar y, con FORCE ROW
  // LEVEL SECURITY (migration_045), la politica de `organizaciones`
  // devolveria CERO filas para cualquier organizacion -- lo que
  // haria que este chequeo bloqueara a TODO el mundo por error. Por
  // eso se usa queryComoSuperadmin(), que fija el contexto de
  // superadmin explicitamente para esta consulta puntual (el mismo
  // mecanismo que ya usan login()/refrescar() antes de saber a que
  // organizacion pertenece el usuario).
  const orgRes = await queryComoSuperadmin(
    `SELECT activa, suspendida_manualmente FROM organizaciones WHERE id = $1`,
    [organizacionId]
  );
  const activa = orgRes.rows.length > 0 && orgRes.rows[0].activa;
  const suspendidaManualmente = orgRes.rows.length > 0 && orgRes.rows[0].suspendida_manualmente;

  cacheEstadoOrganizacion.set(organizacionId, { activa, suspendidaManualmente, expiraEn: ahora + ORGANIZACION_CACHE_TTL_MS });

  return !activa || suspendidaManualmente;
}

async function autenticar(req, res, next) {
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

    // CORREGIDO en Auditoria N.09 (G-N09-11): ver comentario arriba.
    // El superadmin no pertenece a ninguna organizacion de cliente,
    // asi que este chequeo no le aplica. Se separa en su propio
    // try/catch para no confundir un fallo de BD con un token
    // invalido (mensajes de error distintos, ver catch de abajo).
    if (payload.rol !== 'superadmin') {
      let bloqueada;
      try {
        bloqueada = await organizacionEstaBloqueada(payload.organizacionId);
      } catch (errConsulta) {
        console.error('Error al verificar estado de organizacion en autenticar():', errConsulta);
        return res.status(500).json({ error: 'Error interno al verificar el estado de la cuenta.' });
      }
      if (bloqueada) {
        return res.status(403).json({
          error: 'La organizacion asociada a esta cuenta esta inactiva o suspendida.',
          codigo: 'ORGANIZACION_BLOQUEADA',
        });
      }
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

// ------------------------------------------------------------
// CORREGIDO en Auditoria N.09 (hallazgo GRAVE/MODERADO G-N09-10,
// P1/P2): el refresh token vive en una cookie HttpOnly con
// `sameSite: 'none'` (necesario porque frontend y backend estan en
// dominios distintos: GitHub Pages y Render). sameSite=None hace
// que el navegador SI envie esa cookie en peticiones cross-site.
// El middleware `cors()` de index.js NO alcanza a proteger esto:
// cors() controla si el NAVEGADOR deja que el JS de otro sitio LEA
// la respuesta, pero no impide que el navegador ENVIE la cookie ni
// que el servidor PROCESE la peticion -- un <form> o un
// fetch(..., {mode:'no-cors', credentials:'include'}) desde un
// sitio malicioso puede disparar POST /api/auth/refrescar o
// POST /api/auth/logout con la cookie del usuario puesta, sin que
// el atacante necesite leer la respuesta para causar dano (rotar/
// quemar el refresh token de la victima, cerrarle la sesion, etc).
// Eso es CSRF classico contra endpoints cookie-authenticated.
//
// Esta funcion valida el header Origin (o, si el navegador no lo
// mando, Referer como respaldo) contra la misma lista blanca
// CORS_ORIGINS que ya usa cors() en index.js -- si no coincide, se
// rechaza ANTES de tocar la cookie o la base de datos. Peticiones
// sin Origin ni Referer (Postman, apps moviles via HTTPS directo)
// se siguen permitiendo, igual que ya hace cors(), porque no son
// peticiones de navegador y no estan expuestas al vector CSRF via
// cookie de navegador.
// ------------------------------------------------------------
function verificarOrigenCookie(req, res, next) {
  const esProduccion = process.env.NODE_ENV === 'production';
  const origenesPermitidos = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

  // En desarrollo, igual que cors() en index.js, se mantiene
  // permisivo para no trabar el flujo local del equipo.
  if (!esProduccion) return next();

  // Sin CORS_ORIGINS configurada en produccion, cors() ya rechaza
  // todo origen con header; aqui se aplica el mismo criterio
  // fail-closed para no dejar un vacio si alguien desactivara cors()
  // pero no este middleware.
  const origin = req.headers.origin;
  const referer = req.headers.referer || req.headers.referrer;

  if (!origin && !referer) {
    // Sin ninguno de los dos headers: no es una peticion tipica de
    // navegador (Postman, apps moviles, health checks). Se permite,
    // igual que hace cors() para peticiones sin Origin.
    return next();
  }

  const origenAValidar = origin || (() => {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  })();

  if (origenAValidar && origenesPermitidos.includes(origenAValidar)) {
    return next();
  }

  return res.status(403).json({ error: 'Origen no permitido para esta operacion.' });
}

module.exports = { autenticar, autorizar, autenticarOMfaPendiente, contextoInterno, verificarOrigenCookie };
