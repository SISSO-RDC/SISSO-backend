// ============================================================
// Rutas de CAPA: /api/capa/*
//
// Gestion: admin, sso, medico (un hallazgo puede originarse en
// cualquiera de sus dominios). Lectura: cualquier usuario
// autenticado. Corrige el punto 19 / hallazgo G1 de la Auditoria
// SISSO N.06.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/capaController');
const { autenticar, autorizar } = require('../middleware/auth');

router.post('/', autenticar, autorizar('admin', 'sso', 'medico'), controller.crear);
router.get('/', autenticar, controller.listar);
router.get('/:id', autenticar, controller.obtener);
router.put('/:id', autenticar, autorizar('admin', 'sso', 'medico'), controller.actualizar);

router.put('/:id/implementar', autenticar, autorizar('admin', 'sso', 'medico'), controller.implementar);
router.put('/:id/verificar', autenticar, autorizar('admin', 'sso', 'medico'), controller.verificar);
router.put('/:id/evaluar-eficacia', autenticar, autorizar('admin', 'sso', 'medico'), controller.evaluarEficacia);
router.put('/:id/cerrar', autenticar, autorizar('admin', 'sso', 'medico'), controller.cerrar);

module.exports = router;
