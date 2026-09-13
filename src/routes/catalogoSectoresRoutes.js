// ============================================================
// Rutas del catalogo de sectores empresariales: /api/catalogo-sectores/*
//
// Lectura: cualquier usuario autenticado (lo consume el
// configurador de "Mi Empresa" del Lote B, y en el futuro el
// dashboard/Fase 8 para mostrar el perfil sectorial).
// Escritura (actualizar / cambiar estado): solo superadmin, porque
// es un catalogo global compartido por todas las organizaciones
// (ver justificacion en migration_077_catalogo_sectores.sql y en
// el controlador).
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const catalogoSectoresController = require('../controllers/catalogoSectoresController');

router.get('/', autenticar, catalogoSectoresController.listar);
router.get('/:clave', autenticar, catalogoSectoresController.obtener);
router.put('/:clave', autenticar, autorizar('superadmin'), catalogoSectoresController.actualizar);
router.patch('/:clave/estado', autenticar, autorizar('superadmin'), catalogoSectoresController.cambiarEstado);

module.exports = router;
