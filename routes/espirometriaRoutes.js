// ============================================================
// Rutas de espirometria: /api/espirometria/*
// Solo medico puede registrar examenes y ver el detalle completo.
// SSO solo ve el listado resumido (fecha + patron general), NO
// valores medidos ni interpretacion clinica (ver hallazgo G2 de la
// auditoria y nota completa en audiometriaRoutes.js).
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const { registrarExamen, listarExamenes, obtenerExamen } = require('../controllers/espirometriaController');
const { validarRegistrarEspirometria } = require('../middleware/validacion');

router.post('/trabajadores/:trabajadorId', autenticar, autorizar('medico'), validarRegistrarEspirometria, registrarExamen);
router.get('/trabajadores/:trabajadorId', autenticar, autorizar('medico', 'sso'), listarExamenes);
router.get('/:examenId', autenticar, autorizar('medico'), obtenerExamen);

module.exports = router;
