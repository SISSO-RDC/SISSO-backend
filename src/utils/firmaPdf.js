// ============================================================
// SISSO - Utilidad compartida para obtener la firma digital de un
// usuario (medico/sso/th/admin) lista para incrustar en un PDF
// (certificado de aptitud, de capacitacion, u otro documento que
// requiera firma). Reune: buscar si el usuario tiene firma
// registrada, generar una URL firmada de corta duracion (el
// recurso es privado en Cloudinary, ver cloudinaryService.js), y
// descargar los bytes.
//
// Falla de forma silenciosa (devuelve null) si el usuario no tiene
// firma digital cargada o si la descarga falla -- un certificado
// sin firma digital sigue siendo un documento valido (queda solo la
// linea con el nombre del responsable, como antes de esta
// correccion); no debe bloquear la emision del certificado.
// ============================================================
const { query } = require('../db/pool');
const { generarUrlFirmada } = require('../servicios/cloudinaryService');

/**
 * @param {string|null|undefined} usuarioId
 * @param {string} organizacionId
 * @returns {Promise<{buffer: Buffer, nombreResponsable: string}|null>}
 */
async function obtenerFirmaParaPdf(usuarioId, organizacionId) {
  if (!usuarioId) return null;
  try {
    const resultado = await query(
      `SELECT f.imagen_public_id, u.nombre, u.rol
       FROM firmas_digitales_usuario f
       JOIN usuarios u ON u.id = f.usuario_id
       WHERE f.usuario_id = $1 AND f.organizacion_id = $2`,
      [usuarioId, organizacionId]
    );
    if (resultado.rows.length === 0) return null;

    const urlFirmada = generarUrlFirmada(resultado.rows[0].imagen_public_id, 'imagen');
    if (!urlFirmada) return null;

    const respuesta = await fetch(urlFirmada);
    if (!respuesta.ok) return null;
    const arrayBuffer = await respuesta.arrayBuffer();

    const ETIQUETAS_ROL = { medico: 'Médico Ocupacional', sso: 'Seguridad y Salud Ocupacional', th: 'Talento Humano', admin: 'Administración' };
    return {
      buffer: Buffer.from(arrayBuffer),
      nombreResponsable: `${resultado.rows[0].nombre} — ${ETIQUETAS_ROL[resultado.rows[0].rol] || resultado.rows[0].rol}`,
    };
  } catch (err) {
    console.error('No se pudo obtener la firma digital para el PDF:', err.message);
    return null;
  }
}

module.exports = { obtenerFirmaParaPdf };
