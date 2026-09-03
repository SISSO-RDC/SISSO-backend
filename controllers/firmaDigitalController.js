// ============================================================
// SISSO - Firma digital por usuario.
//
// CREADO a pedido de la persona usuaria (02/09/2026): cada usuario
// (medico, sso, th, admin) puede subir su firma dibujada en canvas
// desde la pestaña de Configuracion, para que se incruste
// automaticamente en los certificados PDF que emite (aptitud,
// capacitacion, y otros documentos que lleven firma) -- alternativa
// a la firma electronica que ya existe para consentimientos.
//
// Endpoints, todos sobre la firma del propio usuario autenticado
// (nadie sube la firma de otra persona; eso seria falsificacion):
//   GET    /api/mi-firma-digital       -> ver si ya tengo una
//   PUT    /api/mi-firma-digital       -> subir/reemplazar la mia
//   DELETE /api/mi-firma-digital       -> borrar la mia
//   GET    /api/usuarios/:usuarioId/firma-digital -> (admin/sso/th/medico,
//          para el panel administrativo de firmas y para que el
//          backend arme certificados con la firma correcta)
// ============================================================
const { query } = require('../db/pool');
const { subirEvidenciaConCompensacion, borrarEvidencia, generarUrlFirmada } = require('../servicios/cloudinaryService');
const { registrarAuditoria } = require('../utils/auditoria');

const CARPETA_FIRMAS = 'sisso/firmas-digitales-usuario';

// ------------------------------------------------------------
// GET /api/mi-firma-digital
// ------------------------------------------------------------
async function obtenerMiFirma(req, res) {
  try {
    const resultado = await query(
      `SELECT id, imagen_public_id, actualizado_en FROM firmas_digitales_usuario WHERE usuario_id = $1`,
      [req.usuario.id]
    );
    if (resultado.rows.length === 0) {
      return res.json({ tieneFirma: false });
    }
    return res.json({
      tieneFirma: true,
      actualizadoEn: resultado.rows[0].actualizado_en,
      url: generarUrlFirmada(resultado.rows[0].imagen_public_id, 'imagen'),
    });
  } catch (err) {
    console.error('Error en obtenerMiFirma:', err);
    return res.status(500).json({ error: 'Error interno al obtener la firma digital.' });
  }
}

// ------------------------------------------------------------
// PUT /api/mi-firma-digital
// body: { imagenBase64 } -- data URI del canvas (ver subirEvidencia).
// ------------------------------------------------------------
async function subirMiFirma(req, res) {
  const { imagenBase64 } = req.body;
  if (!imagenBase64 || typeof imagenBase64 !== 'string' || !imagenBase64.startsWith('data:image')) {
    return res.status(400).json({ error: 'imagenBase64 es obligatorio y debe ser una imagen en formato data URI (ej. desde un canvas).' });
  }

  try {
    const existente = await query(`SELECT imagen_public_id FROM firmas_digitales_usuario WHERE usuario_id = $1`, [req.usuario.id]);

    const { subida } = await subirEvidenciaConCompensacion(
      imagenBase64, req.usuario.organizacionId, CARPETA_FIRMAS, { privado: true },
      async (subidaResultado) => {
        await query(
          `INSERT INTO firmas_digitales_usuario (usuario_id, organizacion_id, imagen_url, imagen_public_id, actualizado_por)
           VALUES ($1,$2,$3,$4,$1)
           ON CONFLICT (usuario_id) DO UPDATE SET
             imagen_url = EXCLUDED.imagen_url,
             imagen_public_id = EXCLUDED.imagen_public_id,
             actualizado_por = EXCLUDED.actualizado_por
           RETURNING id`,
          [req.usuario.id, req.usuario.organizacionId, subidaResultado.url, subidaResultado.publicId]
        );
      }
    );

    // La firma anterior (si existia) queda reemplazada -- se borra
    // de Cloudinary DESPUES de que el INSERT/UPDATE tuvo exito, para
    // no quedarnos sin ninguna firma valida si algo falla a mitad de camino.
    if (existente.rows.length > 0 && existente.rows[0].imagen_public_id) {
      await borrarEvidencia(existente.rows[0].imagen_public_id, 'imagen', { privado: true }).catch((err) => {
        console.error('No se pudo borrar la firma digital anterior (huerfano en Cloudinary):', err.message);
      });
    }

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId, usuarioId: req.usuario.id,
      accion: 'subir_firma_digital', entidad: 'firma_digital_usuario', entidadId: req.usuario.id, req,
    });

    return res.json({ tieneFirma: true, url: generarUrlFirmada(subida.publicId, 'imagen') });
  } catch (err) {
    console.error('Error en subirMiFirma:', err);
    return res.status(500).json({ error: 'Error interno al subir la firma digital.' });
  }
}

// ------------------------------------------------------------
// DELETE /api/mi-firma-digital
// ------------------------------------------------------------
async function borrarMiFirma(req, res) {
  try {
    const existente = await query(`SELECT imagen_public_id FROM firmas_digitales_usuario WHERE usuario_id = $1`, [req.usuario.id]);
    if (existente.rows.length === 0) {
      return res.status(404).json({ error: 'No tienes una firma digital registrada.' });
    }
    await query(`DELETE FROM firmas_digitales_usuario WHERE usuario_id = $1`, [req.usuario.id]);
    await borrarEvidencia(existente.rows[0].imagen_public_id, 'imagen', { privado: true }).catch((err) => {
      console.error('No se pudo borrar la firma digital de Cloudinary:', err.message);
    });

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId, usuarioId: req.usuario.id,
      accion: 'borrar_firma_digital', entidad: 'firma_digital_usuario', entidadId: req.usuario.id, req,
    });

    return res.json({ eliminado: true });
  } catch (err) {
    console.error('Error en borrarMiFirma:', err);
    return res.status(500).json({ error: 'Error interno al borrar la firma digital.' });
  }
}

// ------------------------------------------------------------
// GET /api/usuarios/:usuarioId/firma-digital
//
// Panel administrativo de firmas: admin/sso/th/medico pueden ver
// (no subir/borrar) la firma de OTRO usuario de su misma
// organizacion, para el panel donde se administran las firmas antes
// de emitir certificados. RLS ya garantiza que solo se puede leer
// dentro de la propia organizacion.
// ------------------------------------------------------------
async function obtenerFirmaDeUsuario(req, res) {
  try {
    const usuarioRes = await query(
      `SELECT id, nombre, rol FROM usuarios WHERE id = $1 AND organizacion_id = $2`,
      [req.params.usuarioId, req.usuario.organizacionId]
    );
    if (usuarioRes.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    const firmaRes = await query(
      `SELECT imagen_public_id, actualizado_en FROM firmas_digitales_usuario WHERE usuario_id = $1`,
      [req.params.usuarioId]
    );
    if (firmaRes.rows.length === 0) {
      return res.json({ usuario: usuarioRes.rows[0], tieneFirma: false });
    }
    return res.json({
      usuario: usuarioRes.rows[0],
      tieneFirma: true,
      actualizadoEn: firmaRes.rows[0].actualizado_en,
      url: generarUrlFirmada(firmaRes.rows[0].imagen_public_id, 'imagen'),
    });
  } catch (err) {
    console.error('Error en obtenerFirmaDeUsuario:', err);
    return res.status(500).json({ error: 'Error interno al obtener la firma digital del usuario.' });
  }
}

module.exports = { obtenerMiFirma, subirMiFirma, borrarMiFirma, obtenerFirmaDeUsuario };
