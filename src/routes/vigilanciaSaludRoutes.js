// ============================================================
// Rutas de Vigilancia de la Salud: /api/vigilancia-salud/*
//
// medico: gestion completa. sso: solo lectura (los datos ya son
// agregados por diseno de tabla, ver migration_035). admin y th
// quedan fuera (corrige punto 16 / CRITICO 4 de la Auditoria SISSO N.06).
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/vigilanciaSaludController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/programas', autenticar, autorizar('medico'), controller.crearPrograma);

router.get(
  '/programas',
  autenticar,
  autorizar('medico', 'sso'),
  controller.listarProgramas
);

router.put('/programas/:programaId', autenticar, autorizar('medico'), controller.actualizarPrograma);

router.post(
  '/programas/:programaId/observaciones',
  autenticar,
  autorizar('medico'),
  controller.registrarObservacion
);

router.get(
  '/programas/:programaId/observaciones',
  autenticar,
  autorizar('medico', 'sso'),
  controller.listarObservaciones
);

module.exports = router;
