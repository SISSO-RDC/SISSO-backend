// ============================================================
// Rutas del motor base de propuestas/confirmaciones sectoriales:
// /api/configuracion-sectorial/*
//
// Generar y listar quedan abiertos a admin/sso/medico (los 3 roles
// que participan en revisar algun tipo de propuesta, ver
// ROLES_POR_TIPO en el controlador); 'th' queda fuera porque el
// informe N.16 (Seccion 10) es explicito en que TTHH no participa en
// decisiones tecnicas/clinicas de configuracion. La autorizacion
// FINA por tipo de propuesta (quien puede confirmar CADA propuesta
// puntual) se hace dentro del controlador, no aqui, porque depende
// de un dato de la fila (propuesta.tipo), no de la ruta.
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const controlador = require('../controllers/configuracionSectorialController');
const { validarConfirmarPropuestaSectorial } = require('../middleware/validacion');

router.post('/propuestas/generar', autenticar, autorizar('admin'), controlador.generarPropuestas);
router.get('/propuestas', autenticar, autorizar('admin', 'sso', 'medico'), controlador.listarPropuestas);
router.put(
  '/propuestas/:id/confirmar',
  autenticar,
  autorizar('admin', 'sso', 'medico'),
  validarConfirmarPropuestaSectorial,
  controlador.confirmarPropuesta
);

module.exports = router;
