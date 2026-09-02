// ============================================================
// Rutas de Usuarios: /api/usuarios/* (solo lectura, minimo).
// admin y sso: son quienes asignan responsables en accidentes,
// acciones y matriz medico-puesto. La gestion completa de usuarios
// sigue siendo exclusiva del panel de superadmin.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/usuariosController');
const firmaDigitalController = require('../controllers/firmaDigitalController');
const { autenticar, autorizar } = require('../middleware/auth');

router.get('/', autenticar, autorizar('admin', 'sso'), controller.listar);

// CREADO a pedido de la persona usuaria (02/09/2026): firma digital
// por usuario, para incrustar en certificados PDF (aptitud,
// capacitacion, etc.) como alternativa a la firma electronica que
// ya existe para consentimientos. Ver firmaDigitalController.js.
router.get('/mi-firma-digital', autenticar, firmaDigitalController.obtenerMiFirma);
router.put('/mi-firma-digital', autenticar, firmaDigitalController.subirMiFirma);
router.delete('/mi-firma-digital', autenticar, firmaDigitalController.borrarMiFirma);
// Panel administrativo de firmas: cualquier rol de gestion/clinico
// puede CONSULTAR (nunca subir/borrar) la firma de otro usuario de
// su misma organizacion.
router.get('/:usuarioId/firma-digital', autenticar, autorizar('admin', 'sso', 'th', 'medico'), firmaDigitalController.obtenerFirmaDeUsuario);

module.exports = router;
