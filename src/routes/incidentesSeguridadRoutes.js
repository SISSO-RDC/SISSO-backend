// ============================================================
// Rutas de incidentes de seguridad de datos: /api/incidentes-seguridad/*
// CREADO en Auditoria N.12 (C12-03, punto 3). Ver comentario de
// cabecera de incidentesSeguridadController.js para el criterio de
// autorizacion.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const controller = require('../controllers/incidentesSeguridadController');

router.post('/', autenticar, autorizar('admin', 'sso'), controller.crear);
router.get('/', autenticar, autorizar('admin', 'sso'), controller.listar);
router.get('/:id', autenticar, autorizar('admin', 'sso'), controller.obtenerDetalle);
router.patch('/:id', autenticar, autorizar('admin'), controller.actualizar);

module.exports = router;
