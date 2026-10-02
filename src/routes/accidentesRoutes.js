// ============================================================
// Rutas de Accidentes/Incidentes: /api/accidentes/*
//
// Gestion (crear/investigar/accionar/verificar/evidencias): admin,
// sso.
//
// CORREGIDO en Auditoria N.08 (hallazgo CRITICO/P0 C-N08-02): la
// lectura ya NO es "cualquier autenticado" sin mas. Sigue abierta a
// los 4 roles (admin/sso/medico/th tienen alguna necesidad
// operativa de saber que un caso existe), pero el CONTENIDO se
// proyecta por rol dentro del controlador (ver
// proyectarCasoSegunRol en accidentesController.js) -- TH ya no
// recibe tipo_lesion, descripcion libre, investigacion, acciones ni
// evidencias.
//
// La URL firmada de evidencia (fotos/documentos del caso) se
// restringe ademas a nivel de ruta a admin/sso/medico: no hay
// necesidad operativa documentada para que TH abra archivos
// adjuntos de un accidente.
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
router.get('/evidencias/:evidenciaId/url', autenticar, autorizar('admin', 'sso', 'medico'), controller.obtenerUrlEvidencia);
router.delete('/evidencias/:evidenciaId', autenticar, autorizar('admin', 'sso'), controller.eliminarEvidencia);

module.exports = router;
