// ============================================================
// Rutas de Quimicos/SDS: /api/quimicos/*
// Gestion: admin, sso. Lote 4 del plan de cierre de brechas
// frente a plataformas EHS globales (ver analisis Sep 2026).
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/quimicosController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/', autenticar, autorizar('admin', 'sso'), controller.crear);
router.get('/', autenticar, autorizar('admin', 'sso'), controller.listar);
router.get('/:id', autenticar, autorizar('admin', 'sso'), controller.obtener);
router.patch('/:id/sds', autenticar, autorizar('admin', 'sso'), controller.actualizarSds);
router.patch('/:id/estado', autenticar, autorizar('admin', 'sso'), controller.cambiarEstado);

module.exports = router;
