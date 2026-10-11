// ============================================================
// Rutas de ergonomia RULA: /api/ergonomia/rula/*
//
// Mismos roles que REBA: medico y sso pueden crear evaluaciones;
// th solo puede consultar resultados. "admin" excluido (ver
// comentario completo en ergonomiaRoutes.js).
// ============================================================
const express = require('express');
const router = express.Router();

const rulaController = require('../controllers/rulaController');
const { autenticar, autorizar } = require('../middleware/auth');
const { validarCrearSesionRula, validarCrearEvaluacionRula } = require('../middleware/validacion');

router.post(
  '/sesiones',
  autenticar,
  autorizar('medico', 'sso'),
  validarCrearSesionRula,
  rulaController.crearSesion
);

router.get(
  '/sesiones/trabajador/:trabajadorId',
  autenticar,
  autorizar('medico', 'sso', 'th'),
  rulaController.listarSesionesPorTrabajador
);

router.get(
  '/sesiones/:sesionId',
  autenticar,
  autorizar('medico', 'sso', 'th'),
  rulaController.obtenerSesion
);

// URL firmada y temporal de la evidencia (hallazgo G12, ver
// ergonomiaRoutes.js para la nota completa).
router.get(
  '/evaluaciones/:evaluacionId/evidencia-url',
  autenticar,
  autorizar('medico', 'sso', 'th'),
  rulaController.obtenerUrlEvidencia
);

router.post(
  '/sesiones/:sesionId/evaluaciones',
  autenticar,
  autorizar('medico', 'sso'),
  validarCrearEvaluacionRula,
  rulaController.crearEvaluacionRula
);

module.exports = router;
