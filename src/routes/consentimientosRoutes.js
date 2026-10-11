// ============================================================
// Rutas de consentimientos informados: /api/consentimientos/*
//
// Roles: medico, sso, th pueden registrar/ver/revocar
// consentimientos (son quienes acompañan al trabajador durante
// los procedimientos). "admin" se excluye deliberadamente, igual
// criterio aplicado en ergonomiaRoutes.js y rulaRoutes.js: ningun
// dato a nivel de trabajador individual pasa por admin.
// ============================================================
const express = require('express');
const router = express.Router();

const consentimientosController = require('../controllers/consentimientosController');
const { autenticar, autorizar } = require('../middleware/auth');
const { validarFirmarConsentimiento, validarRevocarConsentimiento, validarFirmarFisico } = require('../middleware/validacion');

router.get('/tipos', autenticar, consentimientosController.listarTipos);

// PDF en blanco para imprimir y firmar a mano (primer paso del flujo fisico).
router.get(
  '/tipos/:codigo/pdf-blanco',
  autenticar,
  autorizar('medico', 'sso', 'th'),
  consentimientosController.descargarPdfEnBlanco
);

router.post(
  '/trabajadores/:trabajadorId/firmar',
  autenticar,
  autorizar('medico', 'sso', 'th'),
  validarFirmarConsentimiento,
  consentimientosController.firmarConsentimiento
);

// Segundo paso del flujo fisico: subir la foto/escaneo ya firmado.
router.post(
  '/trabajadores/:trabajadorId/firmar-fisico',
  autenticar,
  autorizar('medico', 'sso', 'th'),
  validarFirmarFisico,
  consentimientosController.firmarFisico
);

router.get(
  '/trabajadores/:trabajadorId',
  autenticar,
  autorizar('medico', 'sso', 'th'),
  consentimientosController.listarPorTrabajador
);

router.post(
  '/:id/revocar',
  autenticar,
  autorizar('medico', 'sso', 'th'),
  validarRevocarConsentimiento,
  consentimientosController.revocarConsentimiento
);

// URL firmada y temporal de la imagen de firma (hallazgo G12, ver
// obtenerUrlFirma en el controlador).
router.get(
  '/:id/firma-url',
  autenticar,
  autorizar('medico', 'sso', 'th'),
  consentimientosController.obtenerUrlFirma
);

// PDF de un consentimiento ya firmado (respaldo/archivo descargable).
router.get(
  '/:id/pdf',
  autenticar,
  autorizar('medico', 'sso', 'th'),
  consentimientosController.descargarPdf
);

module.exports = router;
