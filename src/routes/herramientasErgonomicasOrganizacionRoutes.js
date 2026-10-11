// ============================================================
// Rutas de Herramientas Ergonomicas de la Organizacion:
// /api/herramientas-ergonomicas-organizacion/*
// Solo lectura por ahora -- mismo patron que las demas rutas de
// catalogo materializado.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar } = require('../middleware/auth');
const herramientasErgonomicasOrganizacionController = require('../controllers/herramientasErgonomicasOrganizacionController');

router.get('/', autenticar, herramientasErgonomicasOrganizacionController.listar);

module.exports = router;
