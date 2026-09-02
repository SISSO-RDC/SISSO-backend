// ============================================================
// SISSO - Certificado de asistencia a capacitacion.
//
// CORREGIDO a pedido de la persona usuaria (02/09/2026):
//   a. Orientacion horizontal (landscape) en vez de vertical -- es
//      el formato habitual para este tipo de diploma/certificado.
//   b. Logo de la organizacion como fondo/marca de agua (ver
//      src/utils/logoPdf.js).
// ============================================================
const PDFDocument = require('pdfkit');
const { dibujarMarcaDeAgua } = require('../utils/logoPdf');

// A4 horizontal: 841.89 x 595.28 pt.
const MARGEN = 50;
const ANCHO_PAGINA = 841.89;
const ANCHO_UTIL = ANCHO_PAGINA - MARGEN * 2;

function formatearFecha(fecha) {
  if (!fecha) return null;
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * @param {object} datos - { capacitacion: {nombre, tema, instructor, fecha, horas_duracion}, trabajador: {nombre_completo, documento} }
 * @param {string} nombreOrganizacion
 * @param {Buffer|null} logoBuffer - logo de la organizacion ya descargado (ver obtenerLogoBuffer en logoPdf.js), o null si no tiene / no se pudo descargar.
 * @param {{buffer: Buffer, nombreResponsable: string}|null} firma - CREADO a pedido de la persona usuaria (02/09/2026): firma digital de quien registro/dicto la capacitacion, ya descargada, o null si no tiene firma digital cargada (el certificado sigue siendo valido, solo sin imagen de firma).
 */
function generarPdfCertificadoCapacitacion(datos, nombreOrganizacion, logoBuffer = null, firma = null) {
  const { capacitacion, trabajador } = datos;
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGEN });

  dibujarMarcaDeAgua(doc, logoBuffer);

  doc.fontSize(9).font('Helvetica').fillColor('#64748b')
    .text(nombreOrganizacion || 'SISSO — Sistema Integral de Seguridad y Salud Ocupacional', { align: 'right' });
  doc.moveDown(1.5);

  doc.fontSize(20).font('Helvetica-Bold').fillColor('#0f172a')
    .text('Certificado de Asistencia', { align: 'center' });
  doc.fontSize(9).font('Helvetica').fillColor('#94a3b8')
    .text('Capacitación en Seguridad y Salud Ocupacional', { align: 'center' });
  doc.moveDown(2);

  doc.fontSize(11).font('Helvetica').fillColor('#334155').text('Se certifica que:', { align: 'center' });
  doc.moveDown(0.4);
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#0d9488').text(trabajador.nombre_completo, { align: 'center' });
  doc.fontSize(10).font('Helvetica').fillColor('#64748b').text(`Documento: ${trabajador.documento}`, { align: 'center' });
  doc.moveDown(1.2);

  doc.fontSize(11).font('Helvetica').fillColor('#334155').text('Asistió y aprobó la capacitación:', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(15).font('Helvetica-Bold').fillColor('#0f172a').text(capacitacion.nombre, { align: 'center' });
  if (capacitacion.tema) {
    doc.moveDown(0.2);
    doc.fontSize(10).font('Helvetica').fillColor('#475569').text(capacitacion.tema, { align: 'center' });
  }
  doc.moveDown(1.5);

  const yTabla = doc.y;
  const colAncho = ANCHO_UTIL / 3;
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#64748b');
  doc.text('FECHA', MARGEN, yTabla, { width: colAncho, align: 'center' });
  doc.text('DURACIÓN', MARGEN + colAncho, yTabla, { width: colAncho, align: 'center' });
  doc.text('INSTRUCTOR', MARGEN + colAncho * 2, yTabla, { width: colAncho, align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(11).font('Helvetica').fillColor('#1e293b');
  doc.text(formatearFecha(capacitacion.fecha) || '—', MARGEN, doc.y, { width: colAncho, align: 'center' });
  doc.text(`${capacitacion.horas_duracion} horas`, MARGEN + colAncho, doc.y - doc.currentLineHeight(), { width: colAncho, align: 'center' });
  doc.text(capacitacion.instructor || 'No especificado', MARGEN + colAncho * 2, doc.y - doc.currentLineHeight(), { width: colAncho, align: 'center' });

  doc.moveDown(3);
  // CREADO a pedido de la persona usuaria (02/09/2026): si quien
  // registro/dicto la capacitacion tiene firma digital cargada, se
  // dibuja encima de la linea de firma.
  if (firma && firma.buffer) {
    try {
      const anchoFirma = 140;
      doc.image(firma.buffer, MARGEN + ANCHO_UTIL / 2 - anchoFirma / 2, doc.y - 8, { width: anchoFirma, height: 45, fit: [anchoFirma, 45] });
      doc.moveDown(2.6);
    } catch (err) {
      console.error('No se pudo dibujar la firma digital en el certificado de capacitacion:', err.message);
    }
  }
  doc.moveTo(MARGEN + 100, doc.y).lineTo(MARGEN + ANCHO_UTIL - 100, doc.y).strokeColor('#94a3b8').stroke();
  doc.moveDown(0.3);
  doc.fontSize(9).font('Helvetica').fillColor('#64748b')
    .text(firma?.nombreResponsable || 'Responsable de Seguridad y Salud Ocupacional', { align: 'center' });

  doc.moveDown(2);
  doc.fontSize(7.5).font('Helvetica').fillColor('#cbd5e1')
    .text(`Emitido el ${formatearFecha(new Date())} — Generado automáticamente por SISSO.`, { align: 'center' });

  return doc;
}

module.exports = { generarPdfCertificadoCapacitacion };
