// ============================================================
// Rutas de Inspecciones: /api/inspecciones/*
// Gestion: admin, sso. Lectura: cualquier usuario autenticado.
// Corrige el hallazgo G3 de la Auditoria SISSO N.06.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/inspeccionesController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/', autenticar, autorizar('admin', 'sso'), controller.crear);
router.get('/', autenticar, controller.listar);
router.get('/:id', autenticar, controller.obtener);
router.put('/:id', autenticar, autorizar('admin', 'sso'), controller.actualizar);

router.post('/:id/items', autenticar, autorizar('admin', 'sso'), controller.agregarItem);
router.post('/:id/hallazgos', autenticar, autorizar('admin', 'sso'), controller.agregarHallazgo);
router.post('/hallazgos/:hallazgoId/generar-capa', autenticar, autorizar('admin', 'sso'), controller.generarCapaDesdeHallazgo);

module.exports = router;
