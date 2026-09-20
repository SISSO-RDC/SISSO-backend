// ============================================================
// Rutas de Reportes BI: /api/reportes/*
// Lectura para cualquier usuario autenticado (mismo criterio que
// Indicadores SSO: es informacion de gestion, no datos clinicos
// individuales).
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar } = require('../middleware/auth');
const reportesController = require('../controllers/reportesController');

router.get('/areas', autenticar, reportesController.obtenerAreas);
router.get('/resumen', autenticar, reportesController.obtenerResumen);
router.get('/pdf', autenticar, reportesController.exportarPdf);

module.exports = router;
