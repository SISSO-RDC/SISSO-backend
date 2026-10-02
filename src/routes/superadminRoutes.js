// ============================================================
// Rutas exclusivas del superadmin: /api/superadmin/*
// Todas requieren autenticacion Y rol superadmin.
// ============================================================
const express = require('express');
const router = express.Router();

const superadminController = require('../controllers/superadminController');
const { autenticar, autorizar } = require('../middleware/auth');

router.use(autenticar, autorizar('superadmin'));

router.get('/empresas', superadminController.listarEmpresas);
router.post('/empresas', superadminController.crearEmpresa);
router.patch('/empresas/:id/suspension', superadminController.cambiarSuspensionOrganizacion);
router.patch('/empresas/:id/plan', superadminController.asignarPlan);
router.patch('/usuarios/:id/estado', superadminController.cambiarEstadoUsuario);
router.post('/usuarios/:id/resetear-password', superadminController.resetearPassword);
// CORREGIDO (Auditoria N.07, C-N07-01): rotacion forzada de
// secretos MFA heredados en texto plano. Ver superadminController.js.
router.post('/mfa/rotar-legado', superadminController.rotarMfaLegado);
// CREADO en Auditoria N.11 (G11-06): drenaje/monitoreo de la cola
// de auditoria pendiente.
router.get('/auditoria-pendiente/backlog', superadminController.verBacklogAuditoria);
router.post('/auditoria-pendiente/drenar', superadminController.drenarAuditoria);

module.exports = router;
