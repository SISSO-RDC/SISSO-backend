// ============================================================
// Rutas de Pagos y Suscripcion:
//   GET  /api/organizacion/suscripcion  (se registra junto a
//        organizacionRoutes, ver index.js)
//   /api/pagos/payphone/*
//
// Solo 'admin' de la organizacion puede ver/gestionar su propia
// suscripcion y pagos -- es informacion de facturacion, no
// operativa de SST.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/pagosController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/payphone/iniciar', autenticar, autorizar('admin'), controller.iniciarPago);
router.post('/payphone/confirmar', autenticar, autorizar('admin'), controller.confirmarPago);

module.exports = router;
