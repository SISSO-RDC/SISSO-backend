// ============================================================
// Rutas de Capacitaciones: /api/capacitaciones/*
// Dato de gestion SSO/RRHH (no clinico individual). Cualquier
// usuario autenticado puede ver el listado.
//
// CORREGIDO a pedido de la persona usuaria (02/09/2026): crear ya
// no esta restringido a admin/sso/th -- cualquier usuario
// autenticado puede registrar una capacitacion, pero si no es
// admin/sso/th, el controlador (crear) exige que se auto-asigne
// como instructor ("el acceso a las capacitaciones tambien se da
// por la persona que hace la capacitacion"). Eliminar sigue
// reservado a admin/sso/th.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const capacitacionesController = require('../controllers/capacitacionesController');

router.get('/', autenticar, capacitacionesController.listar);
router.get('/:id', autenticar, capacitacionesController.obtener);
router.post('/', autenticar, capacitacionesController.crear);
router.delete('/:id', autenticar, autorizar('admin', 'sso', 'th'), capacitacionesController.eliminar);

module.exports = router;
