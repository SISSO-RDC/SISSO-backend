// ============================================================
// Rutas de KPIs de la Organizacion: /api/kpis-organizacion/*
// Solo lectura por ahora -- mismo patron que las demas rutas de
// catalogo materializado.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar } = require('../middleware/auth');
const kpisOrganizacionController = require('../controllers/kpisOrganizacionController');

router.get('/', autenticar, kpisOrganizacionController.listar);

module.exports = router;
