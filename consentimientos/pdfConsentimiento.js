// ============================================================
// SISSO - Generacion de PDF para consentimientos informados.
//
// Dos flujos:
//   1. generarPdfFirmado()  -> consentimiento YA firmado
//      (electronicamente en el canvas, o fisicamente y luego
//      escaneado): incluye el texto legal completo + la imagen de
//      la firma + los datos de quien registro el consentimiento.
//      Sirve como respaldo/archivo descargable.
//   2. generarPdfEnBlanco() -> el texto legal + los datos del
//      trabajador + un recuadro vacio para firmar a mano, listo
//      para imprimir. Despues de firmarlo en papel, la foto/
//      escaneo se sube con POST /consentimientos/trabajadores/:id/
//      firmar-fisico (ver consentimientosController.js).
//
// Se uso pdfkit (JS puro, sin depender de Chromium/puppeteer) para
// que funcione bien dentro de las limitaciones de memoria del plan
// gratuito de Render.
// ============================================================
const PDFDocument = require('pdfkit');

const MARGEN = 50;
const ANCHO_UTIL = 595.28 - MARGEN * 2; // A4 en puntos, menos margenes

/**
 * Escribe el encabezado comun a ambos tipos de PDF: nombre del
 * tipo de consentimiento, datos del trabajador y fecha.
 */
function escribirEncabezado(doc, { nombreOrganizacion, nombreTipoConsentimiento, trabajador, fecha }) {
  doc.fontSize(9).font('Helvetica').fillColor('#64748b')
    .text(nombreOrganizacion || 'SISSO — Sistema Integral de Seguridad y Salud Ocupacional', { align: 'right' });

  doc.moveDown(0.6);
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a')
    .text(nombreTipoConsentimiento, { align: 'left' });

  doc.moveDown(0.4);
  doc.fontSize(10).font('Helvetica').fillColor('#334155');
  doc.text(`Trabajador: ${trabajador.nombreCompleto}   |   Documento: ${trabajador.documento}`);
  doc.text(`Fecha: ${fecha}`);

  doc.moveDown(0.8);
  doc.moveTo(MARGEN, doc.y).lineTo(MARGEN + ANCHO_UTIL, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown(0.8);
}

/**
 * Escribe el texto legal completo, respetando parrafos (separados
 * por saltos de linea dobles en el texto original).
 */
function escribirTextoLegal(doc, textoLegal) {
  doc.fontSize(10.5).font('Helvetica').fillColor('#1e293b');
  const parrafos = textoLegal.split(/\n\s*\n/);
  parrafos.forEach((p, i) => {
    doc.text(p.trim(), { align: 'justify', lineGap: 2 });
    if (i < parrafos.length - 1) doc.moveDown(0.6);
  });
}

/**
 * PDF de un consentimiento YA FIRMADO (electronico o fisico
 * escaneado): texto legal + imagen de firma + metadatos.
 *
 * @param {object} datos
 * @param {string} datos.nombreOrganizacion
 * @param {string} datos.nombreTipoConsentimiento
 * @param {string} datos.textoLegalFirmado - snapshot guardado al firmar
 * @param {object} datos.trabajador - { nombreCompleto, documento }
 * @param {string} datos.fechaFirma - ya formateada, ej "19/07/2026"
 * @param {string} datos.metodoFirma - 'electronica' | 'fisica_escaneada'
 * @param {string} datos.registradoPorNombre
 * @param {Buffer} datos.imagenFirmaBuffer - bytes de la imagen ya descargada de Cloudinary
 * @param {boolean} [datos.revocado]
 * @param {string} [datos.motivoRevocacion]
 * @param {string} [datos.revocadoEn]
 * @returns {PDFDocument} el documento (el llamador hace doc.pipe(res) y doc.end())
 */
function generarPdfFirmado(datos) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN });

  escribirEncabezado(doc, {
    nombreOrganizacion: datos.nombreOrganizacion,
    nombreTipoConsentimiento: datos.nombreTipoConsentimiento,
    trabajador: datos.trabajador,
    fecha: datos.fechaFirma,
  });

  if (datos.revocado) {
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#b91c1c')
      .text(`⚠ ESTE CONSENTIMIENTO FUE REVOCADO el ${datos.revocadoEn}.`, { align: 'left' });
    if (datos.motivoRevocacion) {
      doc.fontSize(10).font('Helvetica').fillColor('#7f1d1d')
        .text(`Motivo: ${datos.motivoRevocacion}`);
    }
    doc.moveDown(0.8);
  }

  escribirTextoLegal(doc, datos.textoLegalFirmado);

  doc.moveDown(1.2);
  doc.moveTo(MARGEN, doc.y).lineTo(MARGEN + ANCHO_UTIL, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown(0.8);

  const metodoTexto = datos.metodoFirma === 'fisica_escaneada'
    ? 'Firmado en papel y digitalizado (foto/escaneo)'
    : 'Firmado electronicamente en pantalla';
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text('Firma del trabajador:');
  doc.fontSize(8.5).font('Helvetica').fillColor('#64748b').text(metodoTexto);
  doc.moveDown(0.4);

  // Reservamos espacio para la firma; si no entra en la pagina actual, pdfkit salta de pagina solo.
  if (datos.imagenFirmaBuffer) {
    try {
      doc.image(datos.imagenFirmaBuffer, { fit: [220, 90], align: 'left' });
    } catch (e) {
      doc.fontSize(9).fillColor('#b91c1c').text('(No se pudo incrustar la imagen de la firma en este PDF; ver el archivo original en el sistema.)');
    }
  }

  doc.moveDown(0.3);
  doc.moveTo(MARGEN, doc.y).lineTo(MARGEN + 220, doc.y).strokeColor('#94a3b8').stroke();
  doc.moveDown(0.2);
  doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a')
    .text(datos.trabajador.nombreCompleto);
  doc.fontSize(9).font('Helvetica').fillColor('#334155')
    .text(`Cédula/Documento: ${datos.trabajador.documento}`);

  doc.moveDown(0.6);
  doc.fontSize(9).font('Helvetica').fillColor('#64748b')
    .text(`Registrado en el sistema por: ${datos.registradoPorNombre}`);

  return doc;
}

/**
 * PDF EN BLANCO de un tipo de consentimiento, para imprimir y
 * firmar a mano. Incluye los datos del trabajador ya llenos (para
 * que no haya que escribirlos a mano) y un recuadro vacio de firma.
 *
 * @param {object} datos
 * @param {string} datos.nombreOrganizacion
 * @param {string} datos.nombreTipoConsentimiento
 * @param {string} datos.textoLegal
 * @param {object} datos.trabajador - { nombreCompleto, documento }
 * @param {string} datos.fecha - fecha de impresion, ej "19/07/2026"
 * @returns {PDFDocument}
 */
function generarPdfEnBlanco(datos) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN });

  escribirEncabezado(doc, {
    nombreOrganizacion: datos.nombreOrganizacion,
    nombreTipoConsentimiento: datos.nombreTipoConsentimiento,
    trabajador: datos.trabajador,
    fecha: datos.fecha,
  });

  escribirTextoLegal(doc, datos.textoLegal);

  doc.moveDown(1.5);

  // Si queda muy poco espacio al final de la pagina para la firma, saltamos de pagina.
  if (doc.y > doc.page.height - MARGEN - 160) {
    doc.addPage();
  }

  doc.moveTo(MARGEN, doc.y).lineTo(MARGEN + ANCHO_UTIL, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown(1);

  doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text('Firma del trabajador (firmar a mano):');
  doc.moveDown(0.4);
  const yRecuadro = doc.y;
  doc.rect(MARGEN, yRecuadro, ANCHO_UTIL, 110).strokeColor('#94a3b8').stroke();
  doc.moveDown(6.5);

  doc.moveTo(MARGEN, doc.y).lineTo(MARGEN + 220, doc.y).strokeColor('#94a3b8').stroke();
  doc.moveDown(0.2);
  doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a')
    .text(datos.trabajador.nombreCompleto);
  doc.fontSize(9).font('Helvetica').fillColor('#334155')
    .text(`Cédula/Documento: ${datos.trabajador.documento}`);

  doc.moveDown(0.6);
  doc.fontSize(9).font('Helvetica').fillColor('#64748b')
    .text('Fecha de firma: ____ / ____ / ________');
  doc.moveDown(1);
  doc.fontSize(8.5).fillColor('#94a3b8')
    .text('Una vez firmado, tome una foto o escanee este documento y cárguelo en SISSO desde la ficha de consentimientos del trabajador.');

  return doc;
}

module.exports = { generarPdfFirmado, generarPdfEnBlanco };
