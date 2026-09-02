// ============================================================
// Rutas de Puestos de Trabajo: /api/puestos-trabajo/*
// Crear/editar/desactivar: admin, sso, th (dato organizacional,
// mismo patron que trabajadoresRoutes.js). Listar/ver: cualquier
// usuario autenticado.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const puestosTrabajoController = require('../controllers/puestosTrabajoController');
const { validarCrearPuestoTrabajo } = require('../middleware/validacion');

router.get('/catalogos', autenticar, puestosTrabajoController.obtenerCatalogos);
router.get('/', autenticar, puestosTrabajoController.listar);
router.get('/:id', autenticar, puestosTrabajoController.obtener);
router.post('/', autenticar, autorizar('admin', 'sso', 'th'), validarCrearPuestoTrabajo, puestosTrabajoController.crear);
router.put('/:id', autenticar, autorizar('admin', 'sso', 'th'), validarCrearPuestoTrabajo, puestosTrabajoController.actualizar);
router.delete('/:id', autenticar, autorizar('admin', 'sso', 'th'), puestosTrabajoController.desactivar);
// CREADO en Auditoria N.14 (C14-02): confirmacion explicita de
// "puesto sin exposiciones", nunca el 'th' (no es competencia de
// talento humano decidir sobre exposicion ocupacional).
router.patch('/:id/confirmar-sin-exposiciones', autenticar, autorizar('admin', 'sso', 'medico'), puestosTrabajoController.confirmarSinExposiciones);

module.exports = router;
