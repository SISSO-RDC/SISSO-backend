// ============================================================
// Rutas de autenticacion: /api/auth/*
// ============================================================
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const authController = require('../controllers/authController');
const { autenticar, autorizar, autenticarOMfaPendiente, contextoInterno } = require('../middleware/auth');
const {
  validarRegistrarOrganizacion,
  validarRegistrarUsuario,
  validarRegistrarUsuarioInterno,
  validarLogin,
  validarResetearPassword,
  validarCambiarPassword,
} = require('../middleware/validacion');

// ------------------------------------------------------------
// Limita intentos de login para frenar ataques de fuerza bruta.
//
// AJUSTE (reportado en pruebas): el limite anterior (10 por IP
// cada 15 min, contando TODAS las peticiones) se agotaba muy
// rapido en redes compartidas (oficina, VPN) porque cualquier
// intento -exitoso o fallido, de cualquier usuario detras de esa
// IP- sumaba al mismo contador. Dos cambios:
//
// 1. skipSuccessfulRequests: true -> un login correcto ya NO
//    consume cupo del limitador; solo cuentan los fallidos, que es
//    lo que realmente indica un posible ataque.
// 2. keyGenerator combina IP + email -> el limite ahora es "por
//    cuenta intentada desde esa IP", no "por IP entera". Asi, que
//    varias personas compartan red (o que alguien pruebe cuentas
//    distintas) no agota el cupo de los demas.
//
// Esto es ADICIONAL al bloqueo por cuenta que ya existe en
// authController.js (5 intentos fallidos = cuenta bloqueada 15
// min): ese protege una cuenta puntual; este protege contra
// fuerza bruta distribuida sobre muchas cuentas desde la misma IP.
// ------------------------------------------------------------
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 20,
  message: { error: 'Demasiados intentos de inicio de sesion desde esta red. Intente de nuevo mas tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = (req.body && req.body.email ? String(req.body.email).toLowerCase().trim() : 'sin-email');
    return `${req.ip}:${email}`;
  },
});

// Limitador especifico para la verificacion del codigo MFA: un
// codigo de 6 digitos tiene "solo" 1 millon de combinaciones, asi
// que sin limite de intentos alguien podria intentar adivinarlo
// por fuerza bruta durante la ventana de 5 minutos del mfaToken.
const limitadorMfa = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Demasiados intentos de codigo MFA. Intente de nuevo mas tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Estas dos rutas eran PUBLICAS (sin autenticacion) y representaban
// un riesgo de seguridad: cualquiera podia crear una empresa o un
// usuario sin control. Se mantienen las funciones en el controlador
// por si se necesitan en el futuro, pero ya NO estan expuestas como
// rutas. La unica forma de crear una empresa nueva es a traves del
// superadmin (/api/superadmin/empresas), y la unica forma de crear
// un usuario dentro de una empresa es estando ya autenticado como
// admin de esa empresa (/api/auth/registrar-usuario-interno).
router.post('/registrar-usuario-interno', autenticar, autorizar('admin'), validarRegistrarUsuarioInterno, authController.registrarUsuarioInterno);
router.post('/bootstrap-superadmin', contextoInterno, authController.bootstrapSuperadmin);

// CORREGIDO (hallazgo GRAVE G1): via de recuperacion "break-glass"
// para el superadmin, protegida por RECOVERY_SECRET (ver comentario
// completo en authController.js:recuperarSuperadmin). Limitador
// estricto porque este endpoint prueba un secreto contra la base de
// datos: sin limite, alguien podria intentar adivinarlo por fuerza
// bruta.
const limitadorRecuperacion = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  message: { error: 'Demasiados intentos de recuperacion. Intente de nuevo mas tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
});
router.post('/recuperar-superadmin', limitadorRecuperacion, contextoInterno, authController.recuperarSuperadmin);
router.post('/login', limitadorLogin, validarLogin, contextoInterno, authController.login);
router.post('/refrescar', contextoInterno, authController.refrescar);
router.post('/logout', contextoInterno, authController.logout);
router.get('/perfil', autenticar, authController.perfil);
router.get('/usuarios', autenticar, autorizar('admin'), authController.listarUsuarios);

// Un admin resetea la contrasena de otro usuario de su misma
// organizacion (le asigna una temporal). Ver comentario completo
// en authController.js:resetearPassword.
router.put('/usuarios/:id/resetear-password', autenticar, autorizar('admin'), validarResetearPassword, authController.resetearPassword);

// Cualquier usuario autenticado cambia su propia contrasena
// (incluye el flujo forzado tras un reseteo por admin).
router.put('/cambiar-password', autenticar, validarCambiarPassword, authController.cambiarPassword);

// --- MFA (TOTP) ---
// CORREGIDO (hallazgo GRAVE G5): iniciar-configuracion y confirmar
// ahora aceptan tambien el mfaToken del flujo de "MFA obligatorio no
// configurado" (ver autenticarOMfaPendiente en middleware/auth.js),
// ademas del Bearer token normal. deshabilitar y verificar-login NO
// cambian: deshabilitar siempre requiere sesion completa + password +
// codigo TOTP, y verificar-login es el segundo paso del login normal.
router.post('/mfa/iniciar-configuracion', autenticarOMfaPendiente, limitadorMfa, authController.iniciarConfiguracionMfa);
router.post('/mfa/confirmar', autenticarOMfaPendiente, limitadorMfa, authController.confirmarMfa);
router.post('/mfa/deshabilitar', autenticar, authController.deshabilitarMfa);
router.post('/mfa/verificar-login', limitadorMfa, contextoInterno, authController.verificarCodigoMfa);

// CORREGIDO (hallazgo MODERADO de la auditoria: "crear gestion de
// sesiones activas"). Ver authController.js:listarSesiones para el
// detalle completo.
router.get('/sesiones', autenticar, authController.listarSesiones);
router.delete('/sesiones/:familiaId', autenticar, authController.revocarSesion);
router.delete('/sesiones', autenticar, authController.revocarOtrasSesiones);

module.exports = router;
