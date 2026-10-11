// ============================================================
// Rutas de Enfermedad Profesional: /api/enfermedad-profesional/*
//
// SEPARACION DE ROLES DELIBERADA (corrige punto 3.1 / G2 de la
// Auditoria SISSO N.06):
//
//   - Detalle clinico de un caso (crear, ver, modificar, cerrar,
//     agregar seguimiento): SOLO medico. admin, sso y th quedan
//     explicitamente fuera.
//
//   - Vista preventiva agregada (sin diagnostico ni nombre del
//     trabajador): SOLO sso, y es una ruta EXPLICITAMENTE distinta
//     (/vista-preventiva-sso), nunca la misma ruta que expone el
//     detalle clinico.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/enfermedadProfesionalController');
const { autenticar, autorizar } = require('../middleware/auth');

// --- Vista preventiva agregada (SOLO sso) ---
router.get(
  '/vista-preventiva-sso',
  autenticar,
  autorizar('sso'),
  controller.listarVistaPreventivaSso
);

// --- Detalle clinico (SOLO medico) ---
router.post(
  '/trabajadores/:trabajadorId',
  autenticar,
  autorizar('medico'),
  controller.crearCaso
);

router.get(
  '/trabajadores/:trabajadorId',
  autenticar,
  autorizar('medico'),
  controller.listarCasosTrabajador
);

router.get(
  '/casos/:casoId',
  autenticar,
  autorizar('medico'),
  controller.obtenerCaso
);

router.put(
  '/casos/:casoId',
  autenticar,
  autorizar('medico'),
  controller.actualizarCaso
);

router.post(
  '/casos/:casoId/seguimientos',
  autenticar,
  autorizar('medico'),
  controller.agregarSeguimiento
);

module.exports = router;
