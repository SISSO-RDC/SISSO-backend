// ============================================================
// SISSO - Certificado de restriccion medica laboral, para entregar
// a la carpeta de Talento Humano.
//
// CREADO en Auditoria N.15 (pedido de la persona usuaria: "en
// restricciones medicas se debe emitir tambien una certificacion
// del medico que debera ir a carpeta de TH... con el logo de la
// empresa en la esquina superior izquierda, los datos del
// trabajador, razon de la restriccion y firma del medico
// ocupacional con su registro del senescyt").
//
// DELIBERADAMENTE usa `medida_laboral` (el texto operativo, sin
// lenguaje clinico) como "razon de la restriccion", NUNCA
// `motivo_clinico`. Esta separacion no es una eleccion de esta
// entrega: es la misma que ya impone
// restriccionesMedicasController.js desde la Auditoria N.06 (G8)
// para que SSO/TH ejecuten la medida laboral sin necesitar ni poder
// ver el criterio clinico que la origino. El destino declarado de
// este certificado es justamente "la carpeta de TH", asi que
// filtrar aqui el mismo dato que ya se filtra en la lectura
// operativa es la continuacion correcta de esa politica, no una
// excepcion a ella.
// ============================================================
const PDFDocument = require('pdfkit');
const { dibujarMarcaDeAgua, dibujarLogoMembrete } = require('../utils/logoPdf');
const { dibujarBloqueFirma } = require('../utils/firmaPdf');

const MARGEN = 50;
const ANCHO_UTIL = 595.28 - MARGEN * 2;

const ETIQUETAS_ESTADO = {
  activa: 'ACTIVA', prorrogada: 'PRORROGADA (ACTIVA)', levantada: 'LEVANTADA', vencida: 'VENCIDA',
};

function formatearFecha(fecha) {
  if (!fecha) return null;
  const d = new Date(String(fecha).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'long', year: 'numeric' });
}

/**
 * @param {object} restriccion - { estado, medida_laboral, fecha_emision, fecha_vigencia_hasta, puesto_nombre }
 * @param {object} trabajador - { nombre_completo, documento, area, puesto }
 * @param {string} nombreOrganizacion
 * @param {Buffer|null} logoBuffer
 * @param {{buffer: Buffer, nombreResponsable: string, registroSenescytEspecialidad: string|null}|null} firma
 * @returns {PDFDocument}
 */
function generarPdfCertificadoRestriccion(restriccion, trabajador, nombreOrganizacion, logoBuffer = null, firma = null) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, bufferPages: true });
  dibujarMarcaDeAgua(doc, logoBuffer);
  doc.on('pageAdded', () => dibujarMarcaDeAgua(doc, logoBuffer));

  dibujarLogoMembrete(doc, logoBuffer, MARGEN, MARGEN - 12, 40);
  doc.fontSize(9).font('Helvetica').fillColor('#64748b')
    .text(nombreOrganizacion || 'SISSO — Sistema Integral de Seguridad y Salud Ocupacional', { align: 'right' });
  if (doc.y < MARGEN + 32) doc.y = MARGEN + 32;
  doc.moveDown(0.8);

  doc.fontSize(17).font('Helvetica-Bold').fillColor('#0f172a')
    .text('Certificado de Restricción Médica Laboral', { align: 'center' });
  doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
    .text('Para entrega y ejecución por Talento Humano — no contiene criterio clínico ni diagnóstico', { align: 'center' });
  doc.moveDown(1.2);

  doc.fontSize(10).font('Helvetica-Bold').fillColor('#334155').text('Trabajador: ', { continued: true })
    .font('Helvetica').fillColor('#1e293b').text(trabajador.nombre_completo);
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#334155').text('Documento: ', { continued: true })
    .font('Helvetica').fillColor('#1e293b').text(trabajador.documento);
  if (trabajador.area) {
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#334155').text('Área: ', { continued: true })
      .font('Helvetica').fillColor('#1e293b').text(trabajador.area);
  }
  if (trabajador.puesto) {
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#334155').text('Puesto: ', { continued: true })
      .font('Helvetica').fillColor('#1e293b').text(trabajador.puesto);
  }
  doc.moveDown(1);

  const colorEstado = restriccion.estado === 'levantada' ? '#64748b' : (restriccion.estado === 'vencida' ? '#94a3b8' : '#d97706');
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#334155').text('Estado: ', { continued: true })
    .font('Helvetica-Bold').fillColor(colorEstado).text(ETIQUETAS_ESTADO[restriccion.estado] || restriccion.estado);
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#334155').text('Fecha de emisión: ', { continued: true })
    .font('Helvetica').fillColor('#1e293b').text(formatearFecha(restriccion.fecha_emision) || 'No registrada');
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#334155').text('Vigencia hasta: ', { continued: true })
    .font('Helvetica').fillColor('#1e293b').text(formatearFecha(restriccion.fecha_vigencia_hasta) || 'Indefinida (hasta que el médico la levante)');
  doc.moveDown(1);

  doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text('Medida laboral a ejecutar:');
  doc.moveDown(0.2);
  const yCaja = doc.y;
  doc.fontSize(10.5).font('Helvetica').fillColor('#1e293b')
    .text(restriccion.medida_laboral, MARGEN + 10, yCaja + 10, { width: ANCHO_UTIL - 20 });
  const alturaTexto = doc.y - yCaja + 10;
  doc.roundedRect(MARGEN, yCaja, ANCHO_UTIL, alturaTexto, 6).strokeColor('#e2e8f0').stroke();
  doc.y = yCaja + alturaTexto + 12;

  doc.fontSize(8.5).font('Helvetica-Oblique').fillColor('#94a3b8').text(
    'Este documento describe únicamente la medida laboral a ejecutar. El criterio clínico que la origina es información médica confidencial y no se incluye en este certificado.',
    { align: 'justify' }
  );

  // CORREGIDO en Auditoria N.15: unificado con dibujarBloqueFirma()
  // -- misma funcion que el resto de certificados, para que el orden
  // nunca diverja entre documentos.
  doc.moveDown(1);
  dibujarBloqueFirma(doc, {
    margen: MARGEN, anchoUtil: ANCHO_UTIL, firma,
    titulo: 'Firma y credencial del profesional que emite esta restricción:',
    nombreFallback: 'Médico Ocupacional',
  });

  doc.moveDown(2);
  doc.fontSize(7.5).font('Helvetica').fillColor('#cbd5e1')
    .text(`Emitido el ${formatearFecha(new Date().toISOString())} — Generado automáticamente por SISSO.`, { align: 'center' });

  const rangoPaginas = doc.bufferedPageRange();
  for (let i = 0; i < rangoPaginas.count; i++) {
    doc.switchToPage(i);
    const margenInferiorOriginal = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(8).fillColor('#94a3b8')
      .text(`Página ${i + 1} de ${rangoPaginas.count}`, MARGEN, doc.page.height - 35, { align: 'center', width: ANCHO_UTIL, lineBreak: false });
    doc.page.margins.bottom = margenInferiorOriginal;
  }

  return doc;
}

module.exports = { generarPdfCertificadoRestriccion };
