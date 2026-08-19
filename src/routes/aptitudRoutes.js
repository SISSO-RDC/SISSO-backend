// ============================================================
// Rutas del motor de aptitud medica: /api/aptitud/*
//
// SEPARACION DE ROLES DELIBERADA (corrige el punto CRITICO #4 de
// la auditoria: "el rol admin tiene acceso completo a historia
// clinica, eso es problematico"):
//
//   - Catalogos y gestion de reglas (configuracion del sistema,
//     NO datos clinicos de un trabajador especifico):
//     admin, medico.
//
//   - Datos clinicos de un trabajador especifico (diagnosticos,
//     evaluacion de contraindicaciones, registro de aptitud,
//     historial): SOLO medico. admin, sso y th quedan
//     explicitamente fuera de estas rutas.
// ============================================================
const express = require('express');
const router = express.Router();

const aptitudController = require('../controllers/aptitudController');
const { autenticar, autorizar } = require('../middleware/auth');
const { validarCrearRegla, validarRegistrarAptitud } = require('../middleware/validacion');

// --- Catalogos y configuracion (admin + medico) ---
router.get('/reglas', autenticar, autorizar('admin', 'medico'), aptitudController.listarReglas);
router.post('/reglas', autenticar, autorizar('admin', 'medico'), validarCrearRegla, aptitudController.crearRegla);
router.get('/cie10/buscar', autenticar, autorizar('admin', 'medico'), aptitudController.buscarCie10);
router.get('/exposiciones', autenticar, autorizar('admin', 'medico'), aptitudController.listarExposiciones);

// --- Datos clinicos de un trabajador especifico (SOLO medico) ---
router.post(
  '/trabajadores/:trabajadorId/evaluar',
  autenticar,
  autorizar('medico'),
  aptitudController.evaluarContraindicaciones
);

router.post(
  '/trabajadores/:trabajadorId/registrar',
  autenticar,
  autorizar('medico'),
  validarRegistrarAptitud,
  aptitudController.registrarAptitud
);

router.get(
  '/trabajadores/:trabajadorId/historial',
  autenticar,
  autorizar('medico'),
  aptitudController.obtenerHistorial
);

module.exports = router;
