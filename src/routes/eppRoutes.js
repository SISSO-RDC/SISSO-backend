// ============================================================
// Rutas de EPP: /api/epp/*
// Gestion: admin, sso. Lectura: cualquier usuario autenticado.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/eppController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/catalogo', autenticar, autorizar('admin', 'sso'), controller.crearItemCatalogo);
router.get('/catalogo', autenticar, controller.listarCatalogo);

router.post('/entregas', autenticar, autorizar('admin', 'sso'), controller.crearEntrega);
router.get('/entregas', autenticar, controller.listarEntregas);
router.get('/entregas/:id/firma', autenticar, controller.obtenerUrlFirma);
router.put('/entregas/:id/marcar-repuesto', autenticar, autorizar('admin', 'sso'), controller.marcarRepuesto);

module.exports = router;
