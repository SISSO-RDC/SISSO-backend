// ============================================================
// Rutas del Dashboard: /api/dashboard/*
//
// Todos los roles autenticados pueden ver el dashboard —
// devuelve datos agregados (conteos, promedios) sin exponer
// datos clinicos individuales de ningun trabajador especifico.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar } = require('../middleware/auth');
const { obtenerResumen } = require('../controllers/dashboardController');

router.get('/resumen', autenticar, obtenerResumen);

module.exports = router;
