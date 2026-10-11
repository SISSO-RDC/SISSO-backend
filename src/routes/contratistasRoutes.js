// ============================================================
// Rutas de Contratistas: /api/contratistas/*
// Gestion: admin, sso. Lote 3 del plan de cierre de brechas
// frente a plataformas EHS globales (ver analisis Sep 2026).
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/contratistasController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/', autenticar, autorizar('admin', 'sso'), controller.crear);
router.get('/', autenticar, autorizar('admin', 'sso'), controller.listar);
router.get('/:id', autenticar, autorizar('admin', 'sso'), controller.obtener);
router.patch('/:id/estado', autenticar, autorizar('admin', 'sso'), controller.cambiarEstado);
router.post('/:id/documentos', autenticar, autorizar('admin', 'sso'), controller.agregarDocumento);
router.post('/:id/trabajadores', autenticar, autorizar('admin', 'sso'), controller.agregarTrabajador);

module.exports = router;
