// ============================================================
// Rutas de Restricciones Medicas: /api/restricciones-medicas/*
//
// SEPARACION DE ROLES DELIBERADA (corrige punto 3.3 / G8 de la
// Auditoria SISSO N.06): el Medico emite/modifica/prorroga/levanta;
// SSO y TH solo LEEN (proyeccion operativa sin motivo clinico,
// aplicada dentro del controlador). admin queda fuera por completo,
// igual que en aptitud e historia clinica.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/restriccionesMedicasController');
const { autenticar, autorizar } = require('../middleware/auth');

// --- Emision y cambios de criterio medico: SOLO medico ---
router.post(
  '/trabajadores/:trabajadorId',
  autenticar,
  autorizar('medico'),
  controller.emitirRestriccion
);

router.put(
  '/:restriccionId/prorrogar',
  autenticar,
  autorizar('medico'),
  controller.prorrogarRestriccion
);

router.put(
  '/:restriccionId/modificar',
  autenticar,
  autorizar('medico'),
  controller.modificarRestriccion
);

router.put(
  '/:restriccionId/levantar',
  autenticar,
  autorizar('medico'),
  controller.levantarRestriccion
);

// --- Lectura (medico ve todo; sso/th ven proyeccion operativa) ---
router.get(
  '/trabajadores/:trabajadorId',
  autenticar,
  autorizar('medico', 'sso', 'th'),
  controller.listarRestriccionesTrabajador
);

router.get(
  '/:restriccionId/historial',
  autenticar,
  autorizar('medico', 'sso', 'th'),
  controller.obtenerHistorial
);

module.exports = router;
