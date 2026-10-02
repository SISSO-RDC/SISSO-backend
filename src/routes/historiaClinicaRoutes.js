// ============================================================
// Rutas de Historia Clinica Ocupacional: /api/historia-clinica/*
//
// Mismo criterio de separacion de roles que aptitudRoutes.js: los
// datos clinicos de un trabajador especifico (antecedentes,
// examen fisico, diagnosticos) son SOLO para medico. admin, sso y
// th quedan explicitamente fuera. Los catalogos fijos (matriz de
// riesgos, sistemas, regiones) no son datos clinicos de nadie en
// particular, asi que se dejan accesibles a medico solamente por
// consistencia (son de uso exclusivo de este formulario).
// ============================================================
const express = require('express');
const router = express.Router();

const historiaClinicaController = require('../controllers/historiaClinicaController');
const inmunizacionesController = require('../controllers/inmunizacionesController');
const { autenticar, autorizar } = require('../middleware/auth');
const {
  validarRegistrarPreocupacional, validarRegistrarRetiro, validarRegistrarPeriodica,
  validarRegistrarReintegro, validarRegistrarInmunizacion,
} = require('../middleware/validacion');

router.get('/catalogos', autenticar, autorizar('medico'), historiaClinicaController.obtenerCatalogos);

router.post(
  '/trabajadores/:trabajadorId/preocupacional',
  autenticar,
  autorizar('medico'),
  validarRegistrarPreocupacional,
  historiaClinicaController.registrarPreocupacional
);

router.post(
  '/trabajadores/:trabajadorId/retiro',
  autenticar,
  autorizar('medico'),
  validarRegistrarRetiro,
  historiaClinicaController.registrarRetiro
);

router.post(
  '/trabajadores/:trabajadorId/periodica',
  autenticar,
  autorizar('medico'),
  validarRegistrarPeriodica,
  historiaClinicaController.registrarPeriodica
);

router.post(
  '/trabajadores/:trabajadorId/reintegro',
  autenticar,
  autorizar('medico'),
  validarRegistrarReintegro,
  historiaClinicaController.registrarReintegro
);

// Registro de inmunizaciones (HCU 083): acumulativo, no es una
// evaluacion puntual (ver migration_018_inmunizaciones.sql).
router.post(
  '/trabajadores/:trabajadorId/inmunizaciones',
  autenticar,
  autorizar('medico'),
  validarRegistrarInmunizacion,
  inmunizacionesController.registrarInmunizacion
);
router.get(
  '/trabajadores/:trabajadorId/inmunizaciones',
  autenticar,
  autorizar('medico'),
  inmunizacionesController.listarInmunizaciones
);

router.get(
  '/trabajadores/:trabajadorId',
  autenticar,
  autorizar('medico'),
  historiaClinicaController.listarPorTrabajador
);

router.get('/:id', autenticar, autorizar('medico'), historiaClinicaController.obtenerEvaluacion);
router.get('/:id/pdf', autenticar, autorizar('medico'), historiaClinicaController.descargarPdf);

// Certificado de salud en el trabajo (HCU 081): documento derivado
// de una evaluacion ya registrada, no tiene endpoint de creacion
// propio (ver pdfCertificado.js).
router.get('/:id/certificado', autenticar, autorizar('medico'), historiaClinicaController.descargarCertificado);

module.exports = router;
