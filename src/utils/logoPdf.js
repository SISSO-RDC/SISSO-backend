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
function dibujarMarcaDeAgua(doc, logoBuffer, opcionesPersonalizadas = {}) {
  if (!logoBuffer) return;
  try {
    // CORREGIDO a pedido de la persona usuaria (02/09/2026): la
    // version anterior calculaba el centrado vertical asumiendo que
    // el logo era CUADRADO (usaba el mismo valor "anchoMarca" para
    // ancho y alto al centrar), lo que dejaba el logo visualmente
    // descentrado/"cortado" cuando la imagen real tenia una relacion
    // de aspecto distinta (rectangular). Ahora se dibuja dentro de
    // un cuadro delimitador cuadrado centrado en la pagina, usando
    // `fit` + align/valign 'center' de pdfkit, que preserva la
    // relacion de aspecto real de la imagen y la centra en ambos
    // ejes sin necesidad de conocer sus dimensiones naturales.
    const opacidad = opcionesPersonalizadas.opacidad ?? 0.08;
    const fraccionAncho = opcionesPersonalizadas.fraccionAncho ?? 0.5;
    const ladoCuadro = Math.min(doc.page.width, doc.page.height) * fraccionAncho;
    const x = (doc.page.width - ladoCuadro) / 2;
    const y = (doc.page.height - ladoCuadro) / 2;
    doc.save();
    doc.opacity(opacidad);
    doc.image(logoBuffer, x, y, { fit: [ladoCuadro, ladoCuadro], align: 'center', valign: 'center' });
    doc.restore();
    doc.opacity(1);
  } catch (err) {
    console.error('No se pudo dibujar la marca de agua del logo en el PDF:', err.message);
  }
}

/**
 * Dibuja el logo como membrete visible (opacidad completa), NO como
 * marca de agua -- pensado para la cabecera del documento, para dar
 * respaldo institucional visible.
 *
 * @param {PDFKit.PDFDocument} doc
 * @param {Buffer|null} logoBuffer
 * @param {number} x
 * @param {number} y
 * @param {number} lado - tamano del cuadro delimitador (cuadrado)
 */
function dibujarLogoMembrete(doc, logoBuffer, x, y, lado = 46) {
  if (!logoBuffer) return;
  try {
    doc.image(logoBuffer, x, y, { fit: [lado, lado], align: 'center', valign: 'center' });
  } catch (err) {
    console.error('No se pudo dibujar el logo de membrete en el PDF:', err.message);
  }
}

module.exports = { obtenerLogoBuffer, dibujarMarcaDeAgua, dibujarLogoMembrete };
