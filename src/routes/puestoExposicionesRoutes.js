// ============================================================
// Rutas de puesto_exposiciones: /api/puesto-exposiciones/*
// CREADO en Auditoria N.13 (C-03). Ver controlador para el criterio
// de autorizacion ('sso' y 'medico', no 'admin').
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const controller = require('../controllers/puestoExposicionesController');

router.get('/:puestoTrabajoId', autenticar, autorizar('sso', 'medico'), controller.listar);
router.put('/:puestoTrabajoId', autenticar, autorizar('sso', 'medico'), controller.reemplazar);

module.exports = router;
