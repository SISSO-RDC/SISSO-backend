// ============================================================
// Rutas de ergonomia: /api/ergonomia/*
//
// Quien puede CREAR evaluaciones ergonomicas: medico, sso
// (seguridad y salud ocupacional / industrial), que son los roles
// que realmente hacen este tipo de evaluacion en campo. El rol
// "th" (talento humano) puede VER resultados, pero no crear
// evaluaciones, porque no tiene la competencia tecnica para
// observar y puntuar posturas.
//
// "admin" se excluye deliberadamente de TODAS las rutas de este
// archivo (decision explicita del cliente, mas estricta que el
// minimo de la auditoria): aunque REBA/RULA describen el puesto
// de trabajo y no un diagnostico clinico, se opto por que admin
// no acceda a ningun dato a nivel de trabajador individual,
// limitandolo a configuracion pura del sistema.
// ============================================================
const express = require('express');
const router = express.Router();

const ergonomiaController = require('../controllers/ergonomiaController');
const { autenticar, autorizar } = require('../middleware/auth');
const { validarCrearSesionErgonomica, validarCrearEvaluacionReba } = require('../middleware/validacion');

router.post(
  '/sesiones',
  autenticar,
  autorizar('medico', 'sso'),
  validarCrearSesionErgonomica,
  ergonomiaController.crearSesion
);

router.get(
  '/sesiones/trabajador/:trabajadorId',
  autenticar,
  autorizar('medico', 'sso', 'th'),
  ergonomiaController.listarSesionesPorTrabajador
);

router.get(
  '/sesiones/:sesionId',
  autenticar,
  autorizar('medico', 'sso', 'th'),
  ergonomiaController.obtenerSesion
);

// URL firmada y temporal de la evidencia (foto/video), hallazgo G12
// (ver obtenerUrlEvidencia en el controlador). Mismos roles que
// pueden ver la sesion (obtenerSesion).
router.get(
  '/evaluaciones/:evaluacionId/evidencia-url',
  autenticar,
  autorizar('medico', 'sso', 'th'),
  ergonomiaController.obtenerUrlEvidencia
);

router.post(
  '/sesiones/:sesionId/reba',
  autenticar,
  autorizar('medico', 'sso'),
  validarCrearEvaluacionReba,
  ergonomiaController.crearEvaluacionReba
);

module.exports = router;
