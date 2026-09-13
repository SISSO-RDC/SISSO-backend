// ============================================================
// CREADO a pedido de la persona usuaria: nueva pestana "Acerca de"
// dentro de la plataforma (NO en el panel de superadmin), visible
// para cualquier usuario autenticado de cualquier organizacion.
// Muestra quien es el dueno de la aplicacion (RonnDu Corp), la
// version desplegada y un boton de sugerencias/correcciones que
// envia un correo directo a sisso.rdc@gmail.com. Ver src/utils/correo.js
// para el detalle del envio.
// ============================================================
const { query } = require('../db/pool');
const { VERSION_SERVIDOR } = require('../utils/versionServidor');
const { enviarCorreoSugerencia } = require('../utils/correo');

const LIMITE_CARACTERES = 3000;

// ------------------------------------------------------------
// GET /api/plataforma/acerca-de
// Informacion estatica/publica de la plataforma para cualquier
// usuario autenticado. No expone nada que /api/salud ya no
// exponga (el commit desplegado es informacion publica de
// diagnostico, no un secreto).
// ------------------------------------------------------------
async function obtenerAcercaDe(req, res) {
  return res.json({
    aplicacion: 'SISSO — Sistema Integral de Seguridad y Salud Ocupacional',
    dueno: 'RonnDu Corp',
    version: VERSION_SERVIDOR.version,
    correoContacto: process.env.CORREO_SUGERENCIAS_DESTINO || 'sisso.rdc@gmail.com',
  });
}

// ------------------------------------------------------------
// POST /api/plataforma/sugerencias
// Cualquier usuario autenticado puede enviar una sugerencia y/o
// una correccion. Se exige al menos uno de los dos campos con
// contenido. El remitente y su empresa se leen de la sesion
// verificada (req.usuario), nunca del body, para que el correo
// que llega a sisso.rdc@gmail.com sea confiable.
// ------------------------------------------------------------
async function enviarSugerencia(req, res) {
  try {
    const sugerencia = typeof req.body.sugerencia === 'string' ? req.body.sugerencia.trim() : '';
    const correccion = typeof req.body.correccion === 'string' ? req.body.correccion.trim() : '';

    if (!sugerencia && !correccion) {
      return res.status(400).json({ error: 'Escriba una sugerencia o una correccion antes de enviar.' });
    }
    if (sugerencia.length > LIMITE_CARACTERES || correccion.length > LIMITE_CARACTERES) {
      return res.status(400).json({ error: `Cada campo admite un maximo de ${LIMITE_CARACTERES} caracteres.` });
    }

    const resultado = await query(
      `SELECT u.nombre_completo, u.email, u.rol, o.nombre AS empresa
       FROM usuarios u
       LEFT JOIN organizaciones o ON o.id = u.organizacion_id
       WHERE u.id = $1`,
      [req.usuario.id]
    );
    const remitente = resultado.rows[0] || {};

    await enviarCorreoSugerencia({
      sugerencia,
      correccion,
      remitenteNombre: remitente.nombre_completo,
      remitenteEmail: remitente.email,
      empresa: remitente.empresa,
      rol: remitente.rol,
    });

    return res.json({ mensaje: 'Enviado. Gracias por tu sugerencia.' });
  } catch (err) {
    console.error('Error en enviarSugerencia:', err);
    if (err.message && err.message.includes('no esta configurado')) {
      return res.status(503).json({ error: 'El envio de sugerencias no esta disponible por ahora. Intenta mas tarde.' });
    }
    return res.status(500).json({ error: 'No se pudo enviar la sugerencia. Intenta de nuevo mas tarde.' });
  }
}

module.exports = { obtenerAcercaDe, enviarSugerencia };
