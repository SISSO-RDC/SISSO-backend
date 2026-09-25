// ============================================================
// Rutas de Indicadores SSO: /api/indicadores
// Solo lectura, cualquier usuario autenticado puede verlos
// (mismo criterio que el Dashboard general).
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar } = require('../middleware/auth');
const indicadoresController = require('../controllers/indicadoresController');

router.get('/', autenticar, indicadoresController.obtenerIndicadores);

module.exports = router;
