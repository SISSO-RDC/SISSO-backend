// ============================================================
// Rutas de la Matriz de Riesgos: /api/matriz-riesgos/*
// Crear/editar/eliminar: admin, sso, th (dato organizacional de
// gestion de SST, mismo patron que puestos_trabajo). Ver:
// cualquier usuario autenticado.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const matrizRiesgosController = require('../controllers/matrizRiesgosController');
const { validarCrearItemMatrizRiesgos } = require('../middleware/validacion');

router.get('/catalogos', autenticar, matrizRiesgosController.obtenerCatalogos);
router.get('/', autenticar, matrizRiesgosController.listar);
router.get('/:id', autenticar, matrizRiesgosController.obtener);
router.post('/', autenticar, autorizar('admin', 'sso', 'th'), validarCrearItemMatrizRiesgos, matrizRiesgosController.crear);
router.put('/:id', autenticar, autorizar('admin', 'sso', 'th'), validarCrearItemMatrizRiesgos, matrizRiesgosController.actualizar);
router.delete('/:id', autenticar, autorizar('admin', 'sso', 'th'), matrizRiesgosController.desactivar);

module.exports = router;
