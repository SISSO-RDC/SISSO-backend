// ============================================================
// Rutas de Firma Electronica CRIPTOGRAFICA: /api/firma-electronica/*
// Personal -- sin filtro de rol especifico mas alla de estar
// autenticado, porque cualquier profesional (medico, sso, admin, th)
// podria necesitar firmar documentos propios con su certificado.
// Oct 2026.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/firmaElectronicaController');
const { autenticar } = require('../middleware/auth');

router.get('/mi-certificado', autenticar, controller.obtenerMiCertificado);
router.post('/cargar', autenticar, controller.cargarCertificado);
router.patch('/activar', autenticar, controller.cambiarActivacion);
router.delete('/mi-certificado', autenticar, controller.eliminarCertificado);

module.exports = router;
