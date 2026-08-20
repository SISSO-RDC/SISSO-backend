// ============================================================
// Rutas de Higiene Industrial: /api/higiene-industrial/*
// Gestion: admin, sso. Lectura: cualquier usuario autenticado.
// Corrige el hallazgo G4 de la Auditoria SISSO N.06.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/higieneIndustrialController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/mediciones', autenticar, autorizar('admin', 'sso'), controller.crear);
router.get('/mediciones', autenticar, controller.listar);
router.get('/mediciones/:id', autenticar, controller.obtener);
router.post('/mediciones/:id/generar-capa', autenticar, autorizar('admin', 'sso'), controller.generarCapaDesdeMedicion);

module.exports = router;
