// ============================================================
// Rutas de Accidentes/Incidentes: /api/accidentes/*
//
// Gestion (crear/investigar/accionar/verificar/evidencias): admin,
// sso -- mismo criterio que puestos_trabajo/ausentismo (dato de
// gestion SST, no clinico individual). Lectura: cualquier usuario
// autenticado. Corrige el punto 18 / CRITICO 1 de la Auditoria
// SISSO N.06.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/accidentesController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/', autenticar, autorizar('admin', 'sso'), controller.crear);
router.get('/', autenticar, controller.listar);
router.get('/:id', autenticar, controller.obtener);
router.put('/:id', autenticar, autorizar('admin', 'sso'), controller.actualizar);

router.post('/:id/investigacion', autenticar, autorizar('admin', 'sso'), controller.registrarInvestigacion);

router.post('/:id/acciones', autenticar, autorizar('admin', 'sso'), controller.crearAccion);
router.put('/acciones/:accionId/completar', autenticar, autorizar('admin', 'sso'), controller.completarAccion);
router.put('/acciones/:accionId/verificar', autenticar, autorizar('admin', 'sso'), controller.verificarAccion);

router.post('/:id/evidencias', autenticar, autorizar('admin', 'sso'), controller.subirEvidenciaCaso);
router.get('/evidencias/:evidenciaId/url', autenticar, controller.obtenerUrlEvidencia);
router.delete('/evidencias/:evidenciaId', autenticar, autorizar('admin', 'sso'), controller.eliminarEvidencia);

module.exports = router;
