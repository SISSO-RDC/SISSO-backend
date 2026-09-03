// ============================================================
// SISSO - Certificado de asistencia a capacitacion.
//
// REDISEÑADO a pedido de la persona usuaria (02/09/2026), sobre la
// version horizontal+marca de agua de la correccion anterior:
//   a. Marco/borde alrededor de todo el certificado.
//   b. Marca de agua del logo mas visible y correctamente centrada
//      (bug de centrado corregido en logoPdf.js).
//   c. Firma mas abajo, distribuida junto con el resto del
//      contenido a lo largo de toda la altura de la hoja (no
//      aislada en el tercio inferior).
//   d. Hoja con menos altura (mas compacta, menos sensacion de
//      "diploma A4 completo").
//   e. Jerarquia tipografica: titulo/nombre/curso mas grandes y en
//      negrita; datos complementarios (fecha/horas/instructor) mas
//      livianos y pequeños.
//   f. Mas interlineado entre bloques para que el contenido respire
//      y ocupe 70-80% de la hoja en vez de quedar apretado arriba.
//   g. Logo institucional visible (no marca de agua) en la cabecera.
// ============================================================
const PDFDocument = require('pdfkit');
const { dibujarMarcaDeAgua, dibujarLogoMembrete } = require('../utils/logoPdf');

// Formato mas compacto que A4 horizontal completo (841.89 x 595.28),
// pero con suficiente altura para que TODO el contenido (con la
// tipografia mas grande pedida) quepa en UNA sola pagina -- 480pt
// resultaba demasiado bajo y pdfkit creaba una segunda pagina en
// blanco automaticamente al desbordar el margen inferior.
const ANCHO_PAGINA = 780;
const ALTO_PAGINA = 560;
const MARGEN = 40;
// Margen interior del marco decorativo, un poco adentro del margen
// de contenido para que el marco no quede pegado al borde fisico.
const MARGEN_MARCO = 22;
const ANCHO_UTIL = ANCHO_PAGINA - MARGEN * 2;

function formatearFecha(fecha) {
  if (!fecha) return null;
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function dibujarMarco(doc) {
  // Marco doble (linea gruesa exterior + linea fina interior) --
  // recurso clasico de certificado, delimita el espacio sin
  // competir visualmente con el contenido.
  doc.save();
  doc.lineWidth(1.6).strokeColor('#0d9488')
    .rect(MARGEN_MARCO, MARGEN_MARCO, ANCHO_PAGINA - MARGEN_MARCO * 2, ALTO_PAGINA - MARGEN_MARCO * 2)
    .stroke();
  doc.lineWidth(0.6).strokeColor('#cbd5e1')
    .rect(MARGEN_MARCO + 6, MARGEN_MARCO + 6, ANCHO_PAGINA - (MARGEN_MARCO + 6) * 2, ALTO_PAGINA - (MARGEN_MARCO + 6) * 2)
    .stroke();
  doc.restore();
}

/**
 * @param {object} datos - { capacitacion: {nombre, tema, instructor, fecha, horas_duracion}, trabajador: {nombre_completo, documento} }
 * @param {string} nombreOrganizacion
 * @param {Buffer|null} logoBuffer - logo de la organizacion ya descargado (ver obtenerLogoBuffer en logoPdf.js), o null si no tiene / no se pudo descargar.
 * @param {{buffer: Buffer, nombreResponsable: string}|null} firma - firma digital de quien registro/dicto la capacitacion, o null.
 */
function generarPdfCertificadoCapacitacion(datos, nombreOrganizacion, logoBuffer = null, firma = null) {
  const { capacitacion, trabajador } = datos;
  // CORREGIDO a pedido de la persona usuaria (02/09/2026): el
  // certificado se estaba generando en 2 paginas (la segunda casi
  // en blanco). Causa real: el margen que se le pasa a PDFDocument
  // no es solo estetico -- pdfkit usa ese valor para decidir cuando
  // el contenido "se sale de la pagina" y agregar una pagina nueva
  // automaticamente, INCLUSO si el texto se dibuja con coordenadas
  // x/y explicitas. El pie de pagina se dibujaba a una altura que
  // quedaba dentro de esa zona de margen inferior vigilada por
  // pdfkit, disparando la paginacion automatica. Se usa un margen
  // de PDFDocument deliberadamente chico (solo para que pdfkit no
  // agregue paginas de mas), y MARGEN (mas grande) se mantiene como
  // constante propia para el diseño visual del contenido.
  const doc = new PDFDocument({ size: [ANCHO_PAGINA, ALTO_PAGINA], margin: 12 });

  dibujarMarcaDeAgua(doc, logoBuffer, { opacidad: 0.08, fraccionAncho: 0.55 });
  dibujarMarco(doc);

  // ---- Cabecera: logo institucional (visible) + nombre de la organizacion ----
  const yCabecera = MARGEN + 4;
  if (logoBuffer) {
    dibujarLogoMembrete(doc, logoBuffer, MARGEN + 4, yCabecera, 38);
  }
  doc.fontSize(9).font('Helvetica').fillColor('#64748b')
    .text(nombreOrganizacion || 'SISSO — Sistema Integral de Seguridad y Salud Ocupacional', MARGEN, yCabecera + 12, { width: ANCHO_UTIL, align: 'right' });

  // ---- Titulo (punto focal 1) ----
  doc.y = yCabecera + 44;
  doc.fontSize(26).font('Helvetica-Bold').fillColor('#0f172a')
    .text('Certificado de Asistencia', MARGEN, doc.y, { width: ANCHO_UTIL, align: 'center' });
  doc.fontSize(9.5).font('Helvetica').fillColor('#94a3b8')
    .text('Capacitación en Seguridad y Salud Ocupacional', { width: ANCHO_UTIL, align: 'center' });

  // ---- Nombre del participante (punto focal 2) ----
  doc.moveDown(1.4);
  doc.fontSize(10.5).font('Helvetica').fillColor('#334155').text('Se certifica que:', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(24).font('Helvetica-Bold').fillColor('#0d9488').text(trabajador.nombre_completo, { align: 'center' });
  doc.fontSize(9.5).font('Helvetica').fillColor('#64748b').text(`Documento: ${trabajador.documento}`, { align: 'center' });

  // ---- Nombre del curso (punto focal 3) ----
  doc.moveDown(1.4);
  doc.fontSize(10.5).font('Helvetica').fillColor('#334155').text('Asistió y aprobó la capacitación:', { align: 'center' });
  doc.moveDown(0.4);
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#0f172a').text(capacitacion.nombre, { align: 'center' });
  if (capacitacion.tema && capacitacion.tema !== capacitacion.nombre) {
    doc.moveDown(0.2);
    doc.fontSize(9.5).font('Helvetica').fillColor('#475569').text(capacitacion.tema, { align: 'center' });
  }

  // ---- Datos complementarios: tipografia liviana, secundaria ----
  doc.moveDown(1.6);
  const yTabla = doc.y;
  const colAncho = ANCHO_UTIL / 3;
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#94a3b8');
  doc.text('FECHA', MARGEN, yTabla, { width: colAncho, align: 'center', characterSpacing: 0.5 });
  doc.text('DURACIÓN', MARGEN + colAncho, yTabla, { width: colAncho, align: 'center', characterSpacing: 0.5 });
  doc.text('INSTRUCTOR', MARGEN + colAncho * 2, yTabla, { width: colAncho, align: 'center', characterSpacing: 0.5 });
  const yValores = yTabla + 13;
  doc.fontSize(10.5).font('Helvetica').fillColor('#334155');
  doc.text(formatearFecha(capacitacion.fecha) || '—', MARGEN, yValores, { width: colAncho, align: 'center' });
  doc.text(`${capacitacion.horas_duracion} horas`, MARGEN + colAncho, yValores, { width: colAncho, align: 'center' });
  doc.text(capacitacion.instructor || 'No especificado', MARGEN + colAncho * 2, yValores, { width: colAncho, align: 'center' });

  // ---- Firma: anclada cerca del pie de pagina (no aislada en medio
  // de espacio vacio), calculada desde la altura REAL de la hoja
  // para que el diseño se adapte si en el futuro cambia ALTO_PAGINA. ----
  const yPieFirma = ALTO_PAGINA - MARGEN - 46;
  if (firma && firma.buffer) {
    try {
      const anchoFirma = 130;
      doc.image(firma.buffer, MARGEN + ANCHO_UTIL / 2 - anchoFirma / 2, yPieFirma - 40, { fit: [anchoFirma, 40], align: 'center', valign: 'bottom' });
    } catch (err) {
      console.error('No se pudo dibujar la firma digital en el certificado de capacitacion:', err.message);
    }
  }
  doc.moveTo(MARGEN + 110, yPieFirma).lineTo(MARGEN + ANCHO_UTIL - 110, yPieFirma).strokeColor('#94a3b8').lineWidth(0.7).stroke();
  doc.fontSize(9).font('Helvetica').fillColor('#64748b')
    .text(firma?.nombreResponsable || 'Responsable de Seguridad y Salud Ocupacional', MARGEN, yPieFirma + 6, { width: ANCHO_UTIL, align: 'center' });

  // ---- Pie de pagina ----
  doc.fontSize(7).font('Helvetica').fillColor('#cbd5e1')
    .text(`Emitido el ${formatearFecha(new Date())} — Generado automáticamente por SISSO.`, MARGEN, ALTO_PAGINA - MARGEN_MARCO - 16, { width: ANCHO_UTIL, align: 'center' });

  return doc;
}

module.exports = { generarPdfCertificadoCapacitacion };
