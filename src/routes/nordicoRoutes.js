// ============================================================
// Rutas del cuestionario nordico: /api/nordico/*
// medico y sso pueden registrar/ver (es una herramienta ergonomica
// preventiva, no exclusivamente clinica, igual que REBA/RULA).
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const nordicoController = require('../controllers/nordicoController');
const { validarRegistrarNordico } = require('../middleware/validacion');

router.get('/catalogos', autenticar, autorizar('medico', 'sso'), nordicoController.obtenerCatalogos);
router.post('/trabajadores/:trabajadorId', autenticar, autorizar('medico', 'sso'), validarRegistrarNordico, nordicoController.registrarCuestionario);
router.get('/trabajadores/:trabajadorId', autenticar, autorizar('medico', 'sso'), nordicoController.listarCuestionarios);
router.get('/:cuestionarioId', autenticar, autorizar('medico', 'sso'), nordicoController.obtenerCuestionario);

module.exports = router;
