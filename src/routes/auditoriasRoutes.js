// ============================================================
// Rutas de Auditorias: /api/auditorias/*
// Gestion completa: admin, sso.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/auditoriasController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/', autenticar, autorizar('admin', 'sso'), controller.crear);
router.get('/', autenticar, autorizar('admin', 'sso'), controller.listar);
router.get('/:id', autenticar, autorizar('admin', 'sso'), controller.obtener);
router.patch('/:id/estado', autenticar, autorizar('admin', 'sso'), controller.actualizarEstado);
router.post('/:id/hallazgos', autenticar, autorizar('admin', 'sso'), controller.agregarHallazgo);
router.post('/hallazgos/:hallazgoId/generar-capa', autenticar, autorizar('admin', 'sso'), controller.generarCapaDesdeHallazgo);

module.exports = router;
