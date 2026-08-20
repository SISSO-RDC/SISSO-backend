// ============================================================
// Rutas de Riesgo Psicosocial: /api/riesgo-psicosocial/*
// Gestion: admin, sso. Lectura: admin, sso, medico (TH queda fuera
// -- no es informacion operativa de TH). Corrige el punto 7.6 /
// hallazgo G6 de la Auditoria SISSO N.06.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/riesgoPsicosocialController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/evaluaciones', autenticar, autorizar('admin', 'sso'), controller.crearEvaluacion);
router.get('/evaluaciones', autenticar, autorizar('admin', 'sso', 'medico'), controller.listarEvaluaciones);
router.get('/evaluaciones/:id', autenticar, autorizar('admin', 'sso', 'medico'), controller.obtenerEvaluacion);
router.put('/evaluaciones/:id', autenticar, autorizar('admin', 'sso'), controller.actualizarEvaluacion);
router.post('/evaluaciones/:id/generar-capa', autenticar, autorizar('admin', 'sso'), controller.generarCapaDesdeEvaluacion);

module.exports = router;
