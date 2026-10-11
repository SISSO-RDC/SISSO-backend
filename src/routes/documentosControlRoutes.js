// ============================================================
// Rutas de Control Documental: /api/documentos-control/*
// Gestion (crear nueva version): admin, sso. Lectura y acuse:
// cualquier usuario autenticado de la organizacion.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/documentosControlController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/', autenticar, autorizar('admin', 'sso'), controller.crear);
router.get('/', autenticar, controller.listar);
router.get('/:id', autenticar, controller.obtener);
router.get('/:id/url', autenticar, controller.obtenerUrl);
router.post('/:id/acuse', autenticar, controller.registrarAcuse);

module.exports = router;
