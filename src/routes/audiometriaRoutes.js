// ============================================================
// Rutas de audiometria: /api/audiometria/*
// Solo medico puede registrar examenes y ver el detalle completo
// (todos los umbrales por frecuencia). SSO solo ve el listado
// resumido (fechas + si hay STS positivo), NO el detalle clinico.
//
// CORREGIDO tras auditoria de seguridad (hallazgo GRAVE G1): antes
// SSO tenia acceso al mismo detalle completo que medico
// (obtenerExamen devolvia TODAS las columnas, incluyendo umbrales
// crudos por frecuencia y observaciones clinicas). Para el programa
// de conservacion auditiva, SSO necesita saber SI hay un cambio de
// umbral significativo (STS) para activar medidas de proteccion,
// pero no necesita el detalle audiometrico completo — eso es
// informacion clinica que corresponde al medico ocupacional. La
// version resumida que SSO SI puede ver se filtra en el controlador
// (audiometriaController.js:listarExamenes).
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const { registrarExamen, listarExamenes, obtenerExamen, revisarBaseline, documentarDecisionRetestSts } = require('../controllers/audiometriaController');

router.post('/trabajadores/:trabajadorId', autenticar, autorizar('medico'), registrarExamen);
router.get('/trabajadores/:trabajadorId', autenticar, autorizar('medico', 'sso'), listarExamenes);
router.get('/:examenId', autenticar, autorizar('medico'), obtenerExamen);
// CREADO en Auditoria N.12 (G12-03): revisar la baseline vigente es
// una decision clinica -- reservada a 'medico', igual que registrar.
router.put('/:examenId/revisar-baseline', autenticar, autorizar('medico'), revisarBaseline);
// CREADO en Auditoria N.14 (G14-09): cierre del workflow de retest
// confirmatorio de STS -- decision clinica, reservada a 'medico'.
router.patch('/:examenId/decision-retest-sts', autenticar, autorizar('medico'), documentarDecisionRetestSts);

module.exports = router;
