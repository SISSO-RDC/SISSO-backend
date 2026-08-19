// ============================================================
// SISSO - Certificado de Salud en el Trabajo (HCU 081).
//
// A diferencia de los otros 4 formularios, el certificado NO es
// una evaluacion nueva: es un DOCUMENTO DERIVADO que se emite
// despues de haber realizado una evaluacion preocupacional,
// periodica, de reintegro o de retiro (asi lo define el
// instructivo oficial, Bloque B: "marcar la evaluacion de la cual
// es resultado"). Por eso no tiene tabla propia ni endpoint de
// registro: se genera como PDF a partir de una fila YA GUARDADA en
// evaluaciones_ocupacionales (ver historiaClinicaController.js:
// descargarCertificado), tomando fecha de emision = hoy.
// ============================================================
const PDFDocument = require('pdfkit');

const MARGEN = 50;
const ANCHO_UTIL = 595.28 - MARGEN * 2;

const ETIQUETAS_APTITUD = {
  apto: 'Apto', apto_en_observacion: 'Apto en observación',
  apto_con_limitaciones: 'Apto con limitaciones', no_apto: 'No apto',
};

const ETIQUETAS_TIPO_EVALUACION = {
  preocupacional_inicio: 'Ingreso (preocupacional)', periodica: 'Periódico',
  reintegro: 'Reintegro', retiro: 'Retiro',
};

function formatearFecha(fecha) {
  if (!fecha) return null;
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function campo(doc, etiqueta, valor) {
  if (valor === null || valor === undefined || valor === '') return;
  doc.font('Helvetica-Bold').fillColor('#334155').text(`${etiqueta}: `, { continued: true })
    .font('Helvetica').fillColor('#1e293b').text(String(valor));
}

/**
 * Genera el PDF del certificado de salud en el trabajo, a partir
 * de una evaluacion ya registrada (cualquiera de los 4 tipos).
 * @param {object} e - fila completa de evaluaciones_ocupacionales
 * @param {string} nombreOrganizacion
 * @returns {PDFDocument}
 */
function generarPdfCertificado(e, nombreOrganizacion) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN });

  doc.fontSize(9).font('Helvetica').fillColor('#64748b')
    .text(nombreOrganizacion || 'SISSO — Sistema Integral de Seguridad y Salud Ocupacional', { align: 'right' });
  doc.moveDown(0.5);
  doc.fontSize(17).font('Helvetica-Bold').fillColor('#0f172a')
    .text('Certificado de Salud en el Trabajo', { align: 'center' });
  doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
    .text('Formulario HCU 081 — Acuerdo Ministerial MSP 0341-2019', { align: 'center' });
  doc.moveDown(1);

  doc.fontSize(10).font('Helvetica').fillColor('#334155');
  campo(doc, 'Trabajador', e.trabajador_nombre);
  campo(doc, 'Documento', e.trabajador_documento);
  campo(doc, 'Fecha de emisión', formatearFecha(new Date()));
  campo(doc, 'Evaluación de la cual es resultado', ETIQUETAS_TIPO_EVALUACION[e.tipo_evaluacion] || e.tipo_evaluacion);
  campo(doc, 'Fecha de la evaluación', formatearFecha(e.fecha_atencion));
  doc.moveDown(1);

  doc.fontSize(10.5).font('Helvetica').fillColor('#1e293b').text(
    'Con este documento se certifica que el trabajador se ha sometido a la evaluación médica requerida, y se le ha informado sobre los riesgos relacionados con el trabajo, emitiendo las recomendaciones relacionadas con su estado de salud. La presente certificación se expide con base en la historia clínica ocupacional del trabajador, la cual tiene carácter confidencial.',
    { align: 'justify' }
  );
  doc.moveDown(1.2);

  // ---- Aptitud medica laboral (solo aplica a ingreso/periodica/reintegro) ----
  if (e.tipo_evaluacion !== 'retiro') {
    doc.fontSize(11.5).font('Helvetica-Bold').fillColor('#0f172a').text('Aptitud médica laboral');
    doc.moveTo(MARGEN, doc.y + 2).lineTo(MARGEN + ANCHO_UTIL, doc.y + 2).strokeColor('#e2e8f0').stroke();
    doc.moveDown(0.5);
    if (e.aptitud_msp) {
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#0f172a').text(ETIQUETAS_APTITUD[e.aptitud_msp] || e.aptitud_msp);
    } else {
      doc.fontSize(10).font('Helvetica-Oblique').fillColor('#94a3b8').text('No se registró aptitud para esta evaluación.');
    }
    doc.fontSize(9.5).font('Helvetica').fillColor('#334155');
    if (e.aptitud_observacion) { doc.moveDown(0.2); parrafoConEtiqueta(doc, 'Observación', e.aptitud_observacion); }
    if (e.aptitud_limitacion) { doc.moveDown(0.2); parrafoConEtiqueta(doc, 'Limitación', e.aptitud_limitacion); }
    doc.moveDown(1);
  }

  // ---- Evaluacion medica de retiro (solo aplica a retiro) ----
  if (e.tipo_evaluacion === 'retiro') {
    doc.fontSize(11.5).font('Helvetica-Bold').fillColor('#0f172a').text('Evaluación médica de retiro');
    doc.moveTo(MARGEN, doc.y + 2).lineTo(MARGEN + ANCHO_UTIL, doc.y + 2).strokeColor('#e2e8f0').stroke();
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').fillColor('#1e293b');
    campo(doc, 'El trabajador se realizó la evaluación', e.retiro_se_realizo_evaluacion === true ? 'Sí' : e.retiro_se_realizo_evaluacion === false ? 'No' : 'No registrado');
    const diagnosticos = e.diagnosticos || [];
    const condicionDiagnostico = diagnosticos.length === 0 ? 'No aplica' : diagnosticos.some(d => d.condicion === 'definitivo') ? 'Definitiva' : 'Presuntiva';
    campo(doc, 'Condición del diagnóstico', condicionDiagnostico);
    const relacionadoConTrabajo = diagnosticos.length === 0 ? 'No aplica' : diagnosticos.some(d => d.tipo === 'enfermedad_profesional') ? 'Sí' : 'No';
    campo(doc, 'La condición de salud está relacionada con el trabajo', relacionadoConTrabajo);
    doc.moveDown(1);
  }

  // ---- Recomendaciones ----
  doc.fontSize(11.5).font('Helvetica-Bold').fillColor('#0f172a').text('Recomendaciones');
  doc.moveTo(MARGEN, doc.y + 2).lineTo(MARGEN + ANCHO_UTIL, doc.y + 2).strokeColor('#e2e8f0').stroke();
  doc.moveDown(0.5);
  doc.fontSize(10).font('Helvetica').fillColor('#1e293b');
  if (e.recomendaciones_tratamiento) {
    doc.text(e.recomendaciones_tratamiento, { align: 'justify' });
  } else {
    doc.font('Helvetica-Oblique').fillColor('#94a3b8').text('Sin recomendaciones adicionales.');
  }
  doc.moveDown(1.5);

  // ---- Datos del profesional y firma ----
  doc.moveTo(MARGEN, doc.y).lineTo(MARGEN + ANCHO_UTIL, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown(0.8);
  doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a').text('Datos del profesional:');
  doc.fontSize(9.5).font('Helvetica').fillColor('#334155');
  campo(doc, 'Nombre', e.medico_nombre);
  campo(doc, 'Código profesional', e.codigo_profesional_salud);

  if (e.firma_imagen_url_buffer) {
    doc.moveDown(0.6);
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a').text('Firma del trabajador:');
    try {
      doc.image(e.firma_imagen_url_buffer, { fit: [200, 80], align: 'left' });
    } catch (err) {
      doc.font('Helvetica-Oblique').fillColor('#94a3b8').text('(No se pudo incrustar la imagen de la firma.)');
    }
  }

  return doc;
}

function parrafoConEtiqueta(doc, etiqueta, texto) {
  doc.font('Helvetica-Bold').fillColor('#334155').text(`${etiqueta}: `, { continued: true })
    .font('Helvetica').fillColor('#1e293b').text(texto);
}

module.exports = { generarPdfCertificado };
