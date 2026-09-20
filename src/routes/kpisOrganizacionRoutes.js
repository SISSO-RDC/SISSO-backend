// ============================================================
// Rutas de KPIs de la Organizacion: /api/kpis-organizacion/*
//
// Lectura del catalogo: cualquier rol autenticado (sin datos clinicos).
// Auditoria N.18 (G18-06) -- meta vs valor real:
//   GET  /comparativo        cualquier rol autenticado; cada rol solo ve
//                            el valor de los indicadores que /api/indicadores
//                            ya le muestra (misma proyeccion y supresion de cifras).
//   PUT  /:id/vinculo        solo admin (decide que meta adopta la empresa).
//   POST /mediciones         admin / sso / medico (foto diaria para tendencia).
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const kpisOrganizacionController = require('../controllers/kpisOrganizacionController');

router.get('/', autenticar, kpisOrganizacionController.listar);
router.get('/comparativo', autenticar, kpisOrganizacionController.comparativo);
router.put('/:id/vinculo', autenticar, autorizar('admin'), kpisOrganizacionController.vincular);
router.post('/mediciones', autenticar, autorizar('admin', 'sso', 'medico'), kpisOrganizacionController.registrarMediciones);

module.exports = router;
