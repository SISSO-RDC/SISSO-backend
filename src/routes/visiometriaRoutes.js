// ============================================================
// Rutas de visiometria: /api/visiometria/*
// Solo medico puede registrar examenes y ver el detalle completo.
// SSO solo ve el listado resumido (fecha + clasificacion/aptitud
// ocupacional), NO agudeza visual cruda ni observaciones clinicas
// (ver hallazgo G3 de la auditoria y nota completa en
// audiometriaRoutes.js).
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const { registrarExamen, listarExamenes, obtenerExamen } = require('../controllers/visiometriaController');
const { validarRegistrarVisiometria } = require('../middleware/validacion');

router.post('/trabajadores/:trabajadorId', autenticar, autorizar('medico'), validarRegistrarVisiometria, registrarExamen);
router.get('/trabajadores/:trabajadorId', autenticar, autorizar('medico', 'sso'), listarExamenes);
router.get('/:examenId', autenticar, autorizar('medico'), obtenerExamen);

module.exports = router;
