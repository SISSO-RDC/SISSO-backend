// ============================================================
// Rutas de Usuarios: /api/usuarios/* (solo lectura, minimo).
// admin y sso: son quienes asignan responsables en accidentes,
// acciones y matriz medico-puesto. La gestion completa de usuarios
// sigue siendo exclusiva del panel de superadmin.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/usuariosController');
const { autenticar, autorizar } = require('../middleware/auth');

router.get('/', autenticar, autorizar('admin', 'sso'), controller.listar);

module.exports = router;
