// ============================================================
// Rutas de Emergencias: /api/emergencias/*
// Gestion: admin, sso. Lote 4 del plan de cierre de brechas
// frente a plataformas EHS globales (ver analisis Sep 2026).
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/emergenciasController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/planes', autenticar, autorizar('admin', 'sso'), controller.crearPlan);
router.get('/planes', autenticar, autorizar('admin', 'sso'), controller.listarPlanes);
router.get('/planes/:id', autenticar, autorizar('admin', 'sso'), controller.obtenerPlan);
router.post('/planes/:id/simulacros', autenticar, autorizar('admin', 'sso'), controller.registrarSimulacro);
router.post('/simulacros/:simulacroId/generar-capa', autenticar, autorizar('admin', 'sso'), controller.generarCapaDesdeSimulacro);

router.post('/equipos', autenticar, autorizar('admin', 'sso'), controller.crearEquipo);
router.get('/equipos', autenticar, autorizar('admin', 'sso'), controller.listarEquipos);
router.patch('/equipos/:id/inspeccion', autenticar, autorizar('admin', 'sso'), controller.registrarInspeccionEquipo);

module.exports = router;
