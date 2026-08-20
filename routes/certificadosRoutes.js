// ============================================================
// Rutas de Certificados PDF: /api/certificados/*
//
// El certificado HCU 081 NO esta aqui: se sigue generando desde
// GET /api/historia-clinica/:id/certificado (solo medico, porque
// es un documento derivado de una evaluacion clinica). Los 2
// certificados de este archivo son de gestion (capacitacion,
// aptitud independiente), accesibles a admin/sso/th igual que el
// resto del modulo de gestion.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const certificadosController = require('../controllers/certificadosController');

router.get(
  '/capacitacion/:capacitacionId/trabajador/:trabajadorId',
  autenticar, autorizar('admin', 'sso', 'th'),
  certificadosController.certificadoCapacitacion
);
router.get(
  '/aptitud/:trabajadorId',
  autenticar, autorizar('admin', 'sso', 'th'),
  certificadosController.certificadoAptitud
);

module.exports = router;
