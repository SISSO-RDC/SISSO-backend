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
router.patch('/usuarios/:id/estado', superadminController.cambiarEstadoUsuario);
router.post('/usuarios/:id/resetear-password', superadminController.resetearPassword);

module.exports = router;
