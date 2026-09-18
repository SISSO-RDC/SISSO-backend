// ============================================================
// Rutas de Areas de la Organizacion: /api/areas-organizacion/*
// Solo lectura por ahora (ver areasOrganizacionController.js) --
// listar/ver: cualquier usuario autenticado, mismo patron que
// puestosTrabajoRoutes.js.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar } = require('../middleware/auth');
const areasOrganizacionController = require('../controllers/areasOrganizacionController');

router.get('/', autenticar, areasOrganizacionController.listar);

module.exports = router;
