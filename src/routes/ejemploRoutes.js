// ============================================================
// Rutas de ejemplo para demostrar autenticacion y autorizacion
// por rol. Sirve de PLANTILLA para cuando construyamos los
// modulos reales (trabajadores, examenes medicos, etc).
// ============================================================
const express = require('express');
const router = express.Router();
const { autenticar, autorizar } = require('../middleware/auth');
const { registrarAuditoria } = require('../utils/auditoria');

// Cualquier usuario autenticado (de cualquier rol) puede ver esto.
router.get('/saludo', autenticar, (req, res) => {
  res.json({
    mensaje: `Hola, tu rol es "${req.usuario.rol}" en la organizacion ${req.usuario.organizacionId}.`,
  });
});

// Solo el medico ocupacional puede acceder a esta ruta de ejemplo
// (simula el acceso a una historia clinica). 'admin' se excluye
// deliberadamente: corrige el punto CRITICO #4 de la auditoria
// ("el rol admin tiene acceso completo a historia clinica, eso es
// problematico"). Esta es la plantilla de referencia correcta para
// cualquier ruta futura que toque datos clinicos individuales.
router.get('/historia-clinica-ejemplo', autenticar, autorizar('medico'), async (req, res) => {
  // Acceder a datos clinicos SIEMPRE debe quedar registrado en auditoria.
  await registrarAuditoria({
    organizacionId: req.usuario.organizacionId,
    usuarioId: req.usuario.id,
    accion: 'ver_historia_clinica',
    entidad: 'trabajador',
    entidadId: null,
    req,
  });
  res.json({ mensaje: 'Acceso autorizado a datos clinicos (ejemplo). Este acceso quedo registrado en auditoria.' });
});

// Solo admin puede acceder (simula un panel de administracion).
router.get('/panel-admin', autenticar, autorizar('admin'), (req, res) => {
  res.json({ mensaje: 'Bienvenido al panel de administracion.' });
});

module.exports = router;
