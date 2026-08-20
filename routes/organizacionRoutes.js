// ============================================================
// Rutas de "Mi Empresa": /api/organizacion/*
// Solo admin (ver/editar el perfil de su propia organizacion).
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const organizacionController = require('../controllers/organizacionController');
const { validarActualizarOrganizacion, validarActualizarLogoOrganizacion } = require('../middleware/validacion');

router.get('/', autenticar, autorizar('admin'), organizacionController.obtenerPerfil);
router.put('/', autenticar, autorizar('admin'), validarActualizarOrganizacion, organizacionController.actualizarPerfil);
router.put('/logo', autenticar, autorizar('admin'), validarActualizarLogoOrganizacion, organizacionController.actualizarLogo);

module.exports = router;
