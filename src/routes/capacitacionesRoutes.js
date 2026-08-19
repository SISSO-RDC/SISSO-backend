// ============================================================
// Rutas de Capacitaciones: /api/capacitaciones/*
// Dato de gestion SSO/RRHH (no clinico individual): admin, sso,
// th pueden crear/eliminar; cualquier usuario autenticado puede
// ver el listado (igual criterio que puestos_trabajo).
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const capacitacionesController = require('../controllers/capacitacionesController');

router.get('/', autenticar, capacitacionesController.listar);
router.get('/:id', autenticar, capacitacionesController.obtener);
router.post('/', autenticar, autorizar('admin', 'sso', 'th'), capacitacionesController.crear);
router.delete('/:id', autenticar, autorizar('admin', 'sso', 'th'), capacitacionesController.eliminar);

module.exports = router;
