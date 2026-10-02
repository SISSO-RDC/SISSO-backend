// ============================================================
// Rutas de la Ecuacion NIOSH: /api/niosh/*
// medico y sso (mismo patron que REBA/RULA/nordico: herramienta
// ergonomica preventiva, no exclusivamente clinica).
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const nioshController = require('../controllers/nioshController');
const { validarRegistrarNiosh } = require('../middleware/validacion');

router.post('/trabajadores/:trabajadorId', autenticar, autorizar('medico', 'sso'), validarRegistrarNiosh, nioshController.registrarEvaluacion);
router.get('/trabajadores/:trabajadorId', autenticar, autorizar('medico', 'sso'), nioshController.listarEvaluaciones);
router.get('/:evaluacionId', autenticar, autorizar('medico', 'sso'), nioshController.obtenerEvaluacion);

module.exports = router;
