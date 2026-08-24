// ============================================================
// Rutas de Certificados PDF: /api/certificados/*
//
// El certificado HCU 081 NO esta aqui: se sigue generando desde
// GET /api/historia-clinica/:id/certificado (solo medico, porque
// es un documento derivado de una evaluacion clinica).
//
// CORREGIDO (Auditoria N.07, hallazgo GRAVE C3): el certificado de
// capacitacion es un documento de gestion (asistencia), por lo que
// se mantiene abierto a admin/sso/th. El certificado de APTITUD,
// en cambio, revela el estado de aptitud individual del
// trabajador -- exactamente el mismo dato que el sistema oculta a
// admin/th en Historia Clinica y Aptitud. Permitir que ese mismo
// dato se obtuviera via este endpoint era una ruta alternativa de
// acceso clinico. Se restringe ahora al rol medico, unico
// autorizado a emitir/consultar la aptitud de un trabajador.
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
  autenticar, autorizar('medico'),
  certificadosController.certificadoAptitud
);

module.exports = router;
