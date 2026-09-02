// ============================================================
// SISSO - Utilidad compartida para obtener el logo de la
// organizacion como Buffer, para poder incrustarlo en documentos
// PDF (marca de agua / membrete). El logo vive en Cloudinary
// (organizaciones.logo_url) -- pdfkit necesita los bytes de la
// imagen, no una URL, asi que hay que descargarlo primero.
//
// CREADO en respuesta a la solicitud de la persona usuaria
// (02/09/2026): "el certificado de capacitacion debe tener como
// fondo y marca de agua el logo de la empresa".
//
// Falla de forma silenciosa (devuelve null) si la organizacion no
// tiene logo o si la descarga falla -- un certificado sin marca de
// agua sigue siendo un certificado valido; no debe bloquear la
// generacion del documento por un problema de red transitorio con
// Cloudinary.
// ============================================================
async function obtenerLogoBuffer(logoUrl) {
  if (!logoUrl) return null;
  try {
    const respuesta = await fetch(logoUrl);
    if (!respuesta.ok) return null;
    const arrayBuffer = await respuesta.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error('No se pudo descargar el logo de la organizacion para el PDF:', err.message);
    return null;
  }
}

/**
 * Dibuja el logo, centrado en la pagina y con opacidad baja, como
 * marca de agua de fondo. Debe llamarse ANTES de escribir el resto
 * del contenido (pdfkit dibuja en orden de llamada -- lo que se
 * dibuja despues queda "encima").
 *
 * @param {PDFKit.PDFDocument} doc
 * @param {Buffer|null} logoBuffer
 */
function dibujarMarcaDeAgua(doc, logoBuffer) {
  if (!logoBuffer) return;
  try {
    const anchoMarca = doc.page.width * 0.55;
    const xCentro = (doc.page.width - anchoMarca) / 2;
    const yCentro = (doc.page.height - anchoMarca) / 2;
    doc.save();
    doc.opacity(0.06);
    doc.image(logoBuffer, xCentro, yCentro, { width: anchoMarca });
    doc.restore();
    // pdfkit no siempre restaura opacity()==1 con doc.restore() en
    // versiones antiguas; se fuerza explicitamente para no dejar
    // el resto del documento semi-transparente por error.
    doc.opacity(1);
  } catch (err) {
    console.error('No se pudo dibujar la marca de agua del logo en el PDF:', err.message);
  }
}

module.exports = { obtenerLogoBuffer, dibujarMarcaDeAgua };
