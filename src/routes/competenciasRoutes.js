// ============================================================
// Rutas de Competencias: /api/competencias/*
// Gestion: admin, sso. Lote 3 del plan de cierre de brechas
// frente a plataformas EHS globales (ver analisis Sep 2026).
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/competenciasController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/catalogo', autenticar, autorizar('admin', 'sso'), controller.crearEnCatalogo);
router.get('/catalogo', autenticar, autorizar('admin', 'sso'), controller.listarCatalogo);
router.post('/asignar', autenticar, autorizar('admin', 'sso'), controller.asignar);
router.get('/asignadas', autenticar, autorizar('admin', 'sso'), controller.listarAsignadas);

module.exports = router;
