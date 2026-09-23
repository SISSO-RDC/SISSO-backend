// ============================================================
// Rutas de Matriz de Obligaciones Legales: /api/obligaciones-legales/*
// Gestion completa: admin, sso.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/obligacionesLegalesController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/', autenticar, autorizar('admin', 'sso'), controller.crear);
router.get('/', autenticar, autorizar('admin', 'sso'), controller.listar);
router.get('/:id', autenticar, autorizar('admin', 'sso'), controller.obtener);
router.patch('/:id/verificar', autenticar, autorizar('admin', 'sso'), controller.verificar);
router.post('/:id/cumplir', autenticar, autorizar('admin', 'sso'), controller.marcarCumplida);
router.post('/:id/generar-capa', autenticar, autorizar('admin', 'sso'), controller.generarCapaDesdeObligacion);

module.exports = router;
