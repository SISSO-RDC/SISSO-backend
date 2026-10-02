// ============================================================
// Rutas de Matriz Medico-Ocupacional por Puesto:
// /api/matriz-medico-puesto/*
//
// SOLO 'medico' (corrige punto 15 / CRITICO 2 de la Auditoria
// SISSO N.06). Es la relacion que decide la vigilancia clinica de
// cada trabajador; no es informacion operativa de SSO.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/matrizMedicoPuestoController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/', autenticar, autorizar('medico'), controller.crearRequisito);

router.get(
  '/puestos/:puestoId',
  autenticar,
  autorizar('medico'),
  controller.listarRequisitosPuesto
);

router.get(
  '/puestos/:puestoId/cobertura',
  autenticar,
  autorizar('medico'),
  controller.obtenerCobertura
);

router.put('/:requisitoId', autenticar, autorizar('medico'), controller.actualizarRequisito);

module.exports = router;
