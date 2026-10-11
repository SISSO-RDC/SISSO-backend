// ============================================================
// Rutas del catalogo de paises / perfiles normativos:
// /api/catalogo-paises/*
//
// Lectura: cualquier usuario autenticado (lo consume el paso 4 del
// configurador de "Mi Empresa"). Escritura: solo superadmin, mismo
// criterio que /api/catalogo-sectores.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const catalogoPaisesController = require('../controllers/catalogoPaisesController');

router.get('/', autenticar, catalogoPaisesController.listar);
router.get('/:clave', autenticar, catalogoPaisesController.obtener);
router.put('/:clave', autenticar, autorizar('superadmin'), catalogoPaisesController.actualizar);

module.exports = router;
