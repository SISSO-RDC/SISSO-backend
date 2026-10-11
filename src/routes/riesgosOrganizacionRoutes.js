// ============================================================
// Rutas de Riesgos de la Organizacion: /api/riesgos-organizacion/*
// Solo lectura por ahora -- mismo patron que areasOrganizacionRoutes.js.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar } = require('../middleware/auth');
const riesgosOrganizacionController = require('../controllers/riesgosOrganizacionController');

router.get('/', autenticar, riesgosOrganizacionController.listar);

module.exports = router;
