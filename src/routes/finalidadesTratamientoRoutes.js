const express = require('express');
const router = express.Router();
const { autenticar } = require('../middleware/auth');
const finalidadesController = require('../controllers/finalidadesTratamientoController');

// Cualquier rol autenticado puede consultar el catalogo: es
// informacion sobre COMO se tratan sus propios datos y los de la
// organizacion, no un dato operativo restringido.
router.get('/', autenticar, finalidadesController.listar);

module.exports = router;
