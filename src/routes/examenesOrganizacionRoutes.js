// ============================================================
// Rutas de Examenes de la Organizacion: /api/examenes-organizacion/*
// Solo lectura por ahora -- mismo patron que las demas rutas de
// catalogo materializado.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar } = require('../middleware/auth');
const examenesOrganizacionController = require('../controllers/examenesOrganizacionController');

router.get('/', autenticar, examenesOrganizacionController.listar);

module.exports = router;
