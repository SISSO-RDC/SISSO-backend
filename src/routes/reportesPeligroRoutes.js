// ============================================================
// Rutas de Reportes de Peligro: /api/reportes-peligro/*
// Canal publico (sin autenticacion) para reportar condiciones
// inseguras/actos inseguros/casi accidentes por QR o enlace;
// gestion (triage, CAPA): admin, sso. Lectura interna: admin, sso.
// Lote 1 del plan de cierre de brechas frente a plataformas EHS
// globales (ver analisis Sep 2026).
// ============================================================
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const controller = require('../controllers/reportesPeligroController');
const { autenticar, autorizar } = require('../middleware/auth');

// Mismo patron que limitadorCanalDirectoTitular
// (solicitudesTitularRoutes.js): canal publico sin cuenta, expuesto
// a spam/DoS por definicion (el QR puede quedar pegado en cualquier
// pared), asi que necesita su propio limitador.
const limitadorReportePublico = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 30,
  message: { error: 'Demasiados reportes desde esta red. Intente de nuevo mas tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Sin autenticacion por diseno: el trabajador que reporta no tiene
// cuenta SISSO.
router.post('/publico', limitadorReportePublico, controller.crearPublico);

router.get('/', autenticar, autorizar('admin', 'sso'), controller.listar);
router.get('/:id', autenticar, autorizar('admin', 'sso'), controller.obtener);
router.patch('/:id/triage', autenticar, autorizar('admin', 'sso'), controller.triage);
router.post('/:id/generar-capa', autenticar, autorizar('admin', 'sso'), controller.generarCapaDesdeReporte);
router.get('/evidencias/:evidenciaId/url', autenticar, autorizar('admin', 'sso'), controller.obtenerUrlEvidencia);

module.exports = router;
