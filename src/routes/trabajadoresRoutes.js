// ============================================================
// Rutas de trabajadores: /api/trabajadores/*
// Todas requieren autenticacion. Crear/editar esta limitado a
// roles que gestionan personal: admin, medico, th.
// El rol "sso" (seguridad industrial) puede ver, pero no crear,
// en esta primera version - ajustable mas adelante si se necesita.
// ============================================================
const express = require('express');
const router = express.Router();

const trabajadoresController = require('../controllers/trabajadoresController');
const { autenticar, autorizar } = require('../middleware/auth');
const { validarCrearTrabajador, validarActualizarDatosAntropometricos } = require('../middleware/validacion');

router.get('/', autenticar, trabajadoresController.listar);
router.get('/proximos-examenes', autenticar, trabajadoresController.proximosExamenes);
router.get('/:id', autenticar, trabajadoresController.obtener);
router.post('/', autenticar, autorizar('admin', 'medico', 'th'), validarCrearTrabajador, trabajadoresController.crear);
router.post('/importar', autenticar, autorizar('admin', 'medico', 'th'), trabajadoresController.importarMasivo);
// Datos antropometricos: los necesitan audiometria (edad) y
// espirometria (sexo/edad/talla). Mismos roles que gestionan
// personal (no es un dato clinico/diagnostico como "aptitud").
router.put('/:id/datos-antropometricos', autenticar, autorizar('admin', 'medico', 'th'), validarActualizarDatosAntropometricos, trabajadoresController.actualizarDatosAntropometricos);

module.exports = router;
