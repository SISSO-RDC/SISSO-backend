// ============================================================
// Rutas de Permisos de Trabajo: /api/permisos-trabajo/*
// Gestion: admin, sso. Lote 3 del plan de cierre de brechas
// frente a plataformas EHS globales (ver analisis Sep 2026).
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/permisosTrabajoController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/', autenticar, autorizar('admin', 'sso'), controller.crear);
router.get('/', autenticar, autorizar('admin', 'sso'), controller.listar);
router.get('/:id', autenticar, autorizar('admin', 'sso'), controller.obtener);
router.patch('/:id/aprobar', autenticar, autorizar('admin', 'sso'), controller.aprobar);
router.patch('/:id/iniciar-ejecucion', autenticar, autorizar('admin', 'sso'), controller.iniciarEjecucion);
router.patch('/:id/cerrar', autenticar, autorizar('admin', 'sso'), controller.cerrar);
router.patch('/:id/cancelar', autenticar, autorizar('admin', 'sso'), controller.cancelar);
router.post('/:id/firmas', autenticar, autorizar('admin', 'sso'), controller.firmar);

module.exports = router;
