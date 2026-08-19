// ============================================================
// SISSO - Certificado de asistencia a capacitacion.
// Mismo patron visual que los demas PDF (pdfCertificado.js de
// historia clinica): pdfkit, A4, tipografia Helvetica.
// ============================================================
const PDFDocument = require('pdfkit');

const MARGEN = 50;
const ANCHO_UTIL = 595.28 - MARGEN * 2;

function formatearFecha(fecha) {
  if (!fecha) return null;
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * @param {object} datos - { capacitacion: {nombre, tema, instructor, fecha, horas_duracion}, trabajador: {nombre_completo, documento} }
 * @param {string} nombreOrganizacion
 */
function generarPdfCertificadoCapacitacion(datos, nombreOrganizacion) {
  const { capacitacion, trabajador } = datos;
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN });

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
  doc.moveTo(MARGEN + 100, doc.y).lineTo(MARGEN + ANCHO_UTIL - 100, doc.y).strokeColor('#94a3b8').stroke();
  doc.moveDown(0.3);
  doc.fontSize(9).font('Helvetica').fillColor('#64748b').text('Responsable de Seguridad y Salud Ocupacional', { align: 'center' });

  doc.moveDown(2);
  doc.fontSize(7.5).font('Helvetica').fillColor('#cbd5e1')
    .text(`Emitido el ${formatearFecha(new Date())} — Generado automáticamente por SISSO.`, { align: 'center' });

  return doc;
}

module.exports = { generarPdfCertificadoCapacitacion };
