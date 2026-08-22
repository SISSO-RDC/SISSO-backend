// ============================================================
// Rutas de Alertas: /api/alertas
// Cualquier usuario autenticado puede consultar; el filtrado de
// que categorias ve (administrativas vs. clinicas) ocurre DENTRO
// del controlador segun el rol, no aqui.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar } = require('../middleware/auth');
const alertasController = require('../controllers/alertasController');

router.get('/', autenticar, alertasController.obtenerAlertas);
router.put('/:id/estado', autenticar, alertasController.actualizarEstadoAlerta);

module.exports = router;
