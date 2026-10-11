// ============================================================
// Rutas del catalogo de normativas: /api/normativas/*
//
// Lectura: cualquier usuario autenticado (panel "Normativas" +
// disclaimer de aceptacion). Escritura: solo superadmin, mismo
// criterio que /api/catalogo-paises y /api/catalogo-sectores.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const normativasController = require('../controllers/normativasController');

router.get('/', autenticar, normativasController.listar);
router.get('/:id', autenticar, normativasController.obtener);
router.post('/', autenticar, autorizar('superadmin'), normativasController.crear);
router.put('/:id', autenticar, autorizar('superadmin'), normativasController.actualizar);

module.exports = router;
