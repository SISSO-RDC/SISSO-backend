const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { autenticar, autorizar } = require('../middleware/auth');
const controller = require('../controllers/solicitudesTitularController');

// CREADO en Auditoria N.12 (C12-03): el canal directo del titular no
// tiene autenticacion (el titular no tiene cuenta SISSO), asi que
// necesita su propio limitador contra spam/DoS -- mismo patron que
// limitadorLogin en authRoutes.js.
const limitadorCanalDirectoTitular = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10,
  message: { error: 'Demasiadas solicitudes desde esta red. Intente de nuevo mas tarde o contacte directamente a la organizacion.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// CREADO en Auditoria N.12 (C12-03, punto 2): el propio titular
// puede registrar su solicitud sin necesitar que RRHH/SSO lo haga
// por el. Sin autenticacion por diseno.
router.post('/publico', limitadorCanalDirectoTitular, controller.crearPublico);

// CREADO en Auditoria N.11 (C11-04): admin y sso pueden recibir/
// avanzar una solicitud del titular; solo admin puede cerrarla
// (responder/rechazar), porque es quien responde legalmente por la
// organizacion. Ver comentario de cabecera del controlador.
router.post('/', autenticar, autorizar('admin', 'sso'), controller.crear);
router.get('/', autenticar, autorizar('admin', 'sso'), controller.listar);
router.get('/:id', autenticar, autorizar('admin', 'sso'), controller.obtenerDetalle);
router.patch('/:id/asignar', autenticar, autorizar('admin', 'sso'), controller.asignarResponsable);
router.patch('/:id/verificar-identidad', autenticar, autorizar('admin', 'sso'), controller.marcarIdentidadVerificada);
router.patch('/:id/responder', autenticar, autorizar('admin'), controller.responder);

module.exports = router;
