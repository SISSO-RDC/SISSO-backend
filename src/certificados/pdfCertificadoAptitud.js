// ============================================================
// SISSO - Certificado de aptitud medica independiente.
//
// A diferencia del Certificado de Salud en el Trabajo (HCU 081,
// ver historiaClinica/pdfCertificado.js), que es un documento
// oficial derivado de UNA evaluacion especifica ya registrada en
// evaluaciones_ocupacionales, este es un certificado breve e
// informal que solo confirma el estado de aptitud VIGENTE en el
// sistema (trabajadores.aptitud), pensado para tramites rapidos
// (ej: un contratista que solo necesita comprobar que el
// trabajador esta "apto" hoy, sin necesidad del expediente
// clinico completo). No reemplaza al HCU 081 y el PDF lo deja
// explicito en el pie de pagina.
// ============================================================
const PDFDocument = require('pdfkit');

const MARGEN = 50;
const ANCHO_UTIL = 595.28 - MARGEN * 2;

const ETIQUETAS_APTITUD = {
  apto: 'APTO', con_restricciones: 'APTO CON RESTRICCIONES',
  no_apto: 'NO APTO', pendiente: 'PENDIENTE DE EVALUACIÓN',
};
const COLORES_APTITUD = {
  apto: '#16a34a', con_restricciones: '#d97706', no_apto: '#dc2626', pendiente: '#64748b',
};

function formatearFecha(fecha) {
  if (!fecha) return null;
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * @param {object} trabajador - { nombre_completo, documento, area, puesto, aptitud, fecha_vencimiento }
 * @param {string} nombreOrganizacion
 */
function generarPdfCertificadoAptitud(trabajador, nombreOrganizacion) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN });

  doc.fontSize(9).font('Helvetica').fillColor('#64748b')
    .text(nombreOrganizacion || 'SISSO — Sistema Integral de Seguridad y Salud Ocupacional', { align: 'right' });
  doc.moveDown(1.2);

  doc.fontSize(17).font('Helvetica-Bold').fillColor('#0f172a')
    .text('Certificado de Aptitud Médica Laboral', { align: 'center' });
  doc.fontSize(8.5).font('Helvetica').fillColor('#94a3b8')
    .text('Documento informativo de estado vigente en el sistema SISSO', { align: 'center' });
  // CORREGIDO (hallazgo CRITICO C3): rotulo explicito de que esto es
  // un certificado LABORAL (estado de aptitud, sin diagnostico ni
  // detalle clinico) y no el certificado clinico HCU 081. Refuerza
  // visualmente la separacion que ya existe a nivel de codigo/rutas
  // (ver certificadosController.js y historiaClinicaController.js).
  doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#94a3b8')
    .text('CERTIFICADO DE GESTIÓN LABORAL — No constituye documento clínico ni sustituye la historia clínica ocupacional', { align: 'center' });
  doc.moveDown(1.5);

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
  doc.moveDown(1.5);

  // CORREGIDO (hallazgo CRITICO C3 de la auditoria): antes este PDF
  // mostraba trabajador.aptitud tal cual estuviera guardado, sin
  // comprobar si la evaluacion que lo respalda ya vencio. Eso podia
  // producir un certificado que dice "APTO" con una vigencia
  // vencida hace meses — una transformacion silenciosa de dato
  // desactualizado en constancia aparentemente valida (justo lo que
  // la auditoria pide evitar: "los datos fuera de rango deben
  // generar errores claros, no transformaciones silenciosas").
  // Ahora, si fecha_vencimiento ya paso, el certificado SIEMPRE
  // muestra "VENCIDO" sin importar que aptitud tenga guardada, y dej
  // de emitir la etiqueta de aptitud original.
  const hoy = new Date();
  const fechaVencimientoObj = trabajador.fecha_vencimiento ? new Date(trabajador.fecha_vencimiento) : null;
  const vencido = fechaVencimientoObj && !isNaN(fechaVencimientoObj.getTime()) && fechaVencimientoObj < hoy;

  const color = vencido ? '#dc2626' : (COLORES_APTITUD[trabajador.aptitud] || '#64748b');
  const etiqueta = vencido
    ? 'VENCIDO — REQUIERE REEVALUACIÓN'
    : (ETIQUETAS_APTITUD[trabajador.aptitud] || trabajador.aptitud);

  const yCaja = doc.y;
  doc.roundedRect(MARGEN, yCaja, ANCHO_UTIL, 55, 8).fillColor(color).fillOpacity(0.1).fill();
  doc.fillOpacity(1);
  doc.fontSize(vencido ? 13 : 16).font('Helvetica-Bold').fillColor(color)
    .text(etiqueta, MARGEN, yCaja + (vencido ? 20 : 18), { width: ANCHO_UTIL, align: 'center' });
  doc.y = yCaja + 65;
  doc.moveDown(1);

  const vencimiento = formatearFecha(trabajador.fecha_vencimiento);
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#334155').text('Próximo vencimiento de EMO: ', { continued: true })
    .font('Helvetica').fillColor(vencido ? '#dc2626' : '#1e293b').text(vencimiento || 'No registrado');

  doc.moveDown(1.5);
  doc.fontSize(9.5).font('Helvetica').fillColor('#475569').text(
    // CORREGIDO en Auditoria N.11 (hallazgo CRITICO C11-02, P0): este
    // era el ultimo texto USUARIO-FACING (no un comentario interno)
    // que seguia citando el Acuerdo Ministerial MSP 0341-2019 como si
    // fuera la norma vigente para el "Certificado de Salud en el
    // Trabajo" -- exactamente lo que C10-01/C11-02 buscan eliminar.
    'Este certificado refleja el estado de aptitud médica laboral registrado actualmente en el sistema de gestión de SSO de la organización, con base en la última evaluación ocupacional realizada. No sustituye al Certificado de Salud en el Trabajo emitido por el médico ocupacional a partir de una evaluación específica, documento que debe solicitarse cuando se requiera ese respaldo formal.',
    { align: 'justify' }
  );

  doc.moveDown(3);
  doc.moveTo(MARGEN + 100, doc.y).lineTo(MARGEN + ANCHO_UTIL - 100, doc.y).strokeColor('#94a3b8').stroke();
  doc.moveDown(0.3);
  doc.fontSize(9).font('Helvetica').fillColor('#64748b').text('Responsable de Seguridad y Salud Ocupacional', { align: 'center' });

  doc.moveDown(2);
  doc.fontSize(7.5).font('Helvetica').fillColor('#cbd5e1')
    .text(`Emitido el ${formatearFecha(new Date())} — Generado automáticamente por SISSO.`, { align: 'center' });

  return doc;
}

module.exports = { generarPdfCertificadoAptitud };
