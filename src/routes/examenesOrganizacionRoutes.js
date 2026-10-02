// ============================================================
// Rutas de Examenes de la Organizacion: /api/examenes-organizacion/*
// Lectura: cualquier rol autenticado (catalogo, sin datos clinicos).
// Verificacion formal de la norma (N.18, G18-05): solo medico.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const { validarVerificarNormaExamen } = require('../middleware/validacion');
const examenesOrganizacionController = require('../controllers/examenesOrganizacionController');

router.get('/', autenticar, examenesOrganizacionController.listar);
router.put('/:id/verificacion', autenticar, autorizar('medico'), validarVerificarNormaExamen, examenesOrganizacionController.verificarNorma);

module.exports = router;
