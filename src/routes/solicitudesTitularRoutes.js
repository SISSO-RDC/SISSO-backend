const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const controller = require('../controllers/solicitudesTitularController');

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
