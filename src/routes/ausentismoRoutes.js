// ============================================================
// Rutas de Ausentismo: /api/ausentismo/*
// Crear/editar/eliminar/importar: admin, sso, th (mismo criterio
// que puestos_trabajo y matriz_riesgos, dato de gestion de SST/
// RRHH, no clinico individual). Ver: cualquier usuario
// autenticado.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const ausentismoController = require('../controllers/ausentismoController');
const { validarCrearAusencia } = require('../middleware/validacion');

router.get('/catalogos', autenticar, ausentismoController.obtenerCatalogos);
router.get('/resumen', autenticar, ausentismoController.resumen);
router.get('/', autenticar, ausentismoController.listar);
router.get('/:id', autenticar, ausentismoController.obtener);
// CORREGIDO (hallazgo G12): endpoint nuevo para pedir una URL firmada
// y temporal del certificado (ver obtenerUrlCertificado en el
// controlador para el porque). La autorizacion por rol se hace
// DENTRO del controlador (no aqui con autorizar(...)) porque tambien
// necesita comprobar que el certificado pertenece a esta
// organizacion, y es mas claro tener esa logica junta en un solo
// lugar.
router.get('/:id/certificado-url', autenticar, ausentismoController.obtenerUrlCertificado);
router.post('/importar', autenticar, autorizar('admin', 'sso', 'th'), ausentismoController.importarMasivo);
router.post('/', autenticar, autorizar('admin', 'sso', 'th'), validarCrearAusencia, ausentismoController.crear);
router.put('/:id', autenticar, autorizar('admin', 'sso', 'th'), validarCrearAusencia, ausentismoController.actualizar);
router.delete('/:id', autenticar, autorizar('admin', 'sso', 'th'), ausentismoController.eliminar);

module.exports = router;
