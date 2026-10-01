// ============================================================
// Rutas de Riesgo Psicosocial: /api/riesgo-psicosocial/*
// Gestion: admin, sso. Lectura: admin, sso, medico (TH queda fuera
// -- no es informacion operativa de TH). Corrige el punto 7.6 /
// hallazgo G6 de la Auditoria SISSO N.06.
// ============================================================
const express = require('express');
const router = express.Router();

const controller = require('../controllers/riesgoPsicosocialController');
const { autenticar, autorizar } = require('../middleware/auth');

// CORREGIDO en Auditoria N.14 (hallazgo GRAVE G14-01, P1): 'admin'
// tenia lectura de evaluaciones psicosociales INDIVIDUALES
// (listado y detalle, incluyendo factores/puntaje/nombre del
// trabajador). El riesgo psicosocial es informacion sensible
// equivalente a un dato de salud (Sentencia 59-19-IN/24 y el
// propio catalogo de finalidades la trata como 'sensible' -- ver
// gobierno_datos_inventario, migration_069). Un administrador de
// negocio no deberia poder leer, de un trabajador identificado,
// que factor psicosocial especifico lo afecta. 'admin' conserva
// unicamente el resumen agregado (ver GET /resumen-agregado,
// que ya aplica k-anonimato) y la capacidad de gestionar
// (crear/actualizar/generar CAPA), que es una funcion
// administrativa, no de lectura clinica.
router.post('/evaluaciones', autenticar, autorizar('admin', 'sso'), controller.crearEvaluacion);
router.get('/evaluaciones/resumen-agregado', autenticar, autorizar('admin', 'sso', 'medico'), controller.obtenerResumenAgregado);
router.get('/evaluaciones', autenticar, autorizar('sso', 'medico'), controller.listarEvaluaciones);
router.get('/evaluaciones/:id', autenticar, autorizar('sso', 'medico'), controller.obtenerEvaluacion);
router.put('/evaluaciones/:id', autenticar, autorizar('admin', 'sso'), controller.actualizarEvaluacion);
router.post('/evaluaciones/:id/generar-capa', autenticar, autorizar('admin', 'sso'), controller.generarCapaDesdeEvaluacion);

module.exports = router;
