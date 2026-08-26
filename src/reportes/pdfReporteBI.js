// ============================================================
// SISSO - Generador de PDF del Reporte BI (informe gerencial).
//
// Mismo patron visual que los demas PDF del sistema (certificado
// HCU 081, consentimientos): pdfkit, tipografia Helvetica,
// paleta de grises/azules consistente. Es un informe de TEXTO Y
// TABLAS (no grafica imagenes de barras/torta); para graficos
// interactivos el usuario usa la pantalla de Reportes BI, y este
// PDF esta pensado para imprimir/enviar a gerencia como resumen
// formal de los mismos numeros.
// ============================================================
const PDFDocument = require('pdfkit');

const MARGEN = 50;
const ANCHO_UTIL = 595.28 - MARGEN * 2;

function tituloSeccion(doc, texto) {
  if (doc.y > 700) doc.addPage();
  doc.moveDown(0.8);
  doc.fontSize(12.5).font('Helvetica-Bold').fillColor('#0f172a').text(texto);
  doc.moveTo(MARGEN, doc.y + 3).lineTo(MARGEN + ANCHO_UTIL, doc.y + 3).strokeColor('#e2e8f0').stroke();
  doc.moveDown(0.5);
}

function filaDato(doc, etiqueta, valor) {
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#334155').text(`${etiqueta}: `, { continued: true })
    .font('Helvetica').fillColor('#1e293b').text(String(valor));
}

function tablaSimple(doc, encabezados, filas, anchos) {
  const xInicial = MARGEN;
  let y = doc.y + 4;

  doc.fontSize(9).font('Helvetica-Bold').fillColor('#64748b');
  let x = xInicial;
  encabezados.forEach((h, i) => { doc.text(h, x, y, { width: anchos[i] }); x += anchos[i]; });
  y += 14;
  doc.moveTo(xInicial, y).lineTo(xInicial + ANCHO_UTIL, y).strokeColor('#e2e8f0').stroke();
  y += 4;

  doc.fontSize(9.5).font('Helvetica').fillColor('#1e293b');
  filas.forEach((fila) => {
    if (y > 760) { doc.addPage(); y = MARGEN; }
    x = xInicial;
    fila.forEach((celda, i) => { doc.text(String(celda), x, y, { width: anchos[i] }); x += anchos[i]; });
    y += 15;
  });

  doc.y = y + 6;
}

function formatearFechaFiltro(fecha) {
  if (!fecha) return null;
  const d = new Date(fecha + 'T00:00:00');
  if (isNaN(d.getTime())) return fecha;
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * @param {object} r - objeto devuelto por reportesController.calcularResumen
 * @param {string} nombreOrganizacion
 * @returns {PDFDocument}
 */
function generarPdfReporteBI(r, nombreOrganizacion) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN });

  // ---- Encabezado ----
  doc.fontSize(9).font('Helvetica').fillColor('#64748b').text(nombreOrganizacion || 'SISSO', { align: 'right' });
  doc.moveDown(0.3);
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#0f172a').text('Reporte BI — Seguridad y Salud Ocupacional', { align: 'center' });

  const desdeTxt = formatearFechaFiltro(r.filtrosAplicados.desde);
  const hastaTxt = formatearFechaFiltro(r.filtrosAplicados.hasta);
  let subtitulo = 'Periodo: histórico completo';
  if (desdeTxt || hastaTxt) subtitulo = `Periodo: ${desdeTxt || 'inicio'} — ${hastaTxt || 'hoy'}`;
  if (r.filtrosAplicados.area) subtitulo += ` · Área: ${r.filtrosAplicados.area}`;
  doc.fontSize(9.5).font('Helvetica').fillColor('#94a3b8').text(subtitulo, { align: 'center' });
  doc.fontSize(8).fillColor('#94a3b8').text(`Generado el ${new Date().toLocaleDateString('es-EC', { day: '2-digit', month: 'long', year: 'numeric' })}`, { align: 'center' });
  doc.moveDown(1);

  // ---- Trabajadores y cobertura EMO ----
  tituloSeccion(doc, '1. Cobertura de exámenes médicos ocupacionales (EMO)');
  filaDato(doc, 'Trabajadores activos', r.trabajadores.total);
  filaDato(doc, 'EMO vigente', `${r.coberturaEmo.vigente} (${r.coberturaEmo.porcentajeVigente}%)`);
  filaDato(doc, 'EMO vencido', r.coberturaEmo.vencido);
  filaDato(doc, 'Sin fecha de vencimiento registrada', r.coberturaEmo.sinFecha);

  // ---- Aptitud medica ----
  // CORREGIDO (hallazgo MODERADO: inferencias en grupos pequeños):
  // si calcularResumen() redacto estas secciones por k-anonimato
  // (area filtrada con muy pocos trabajadores), el PDF debe mostrar
  // el aviso, no intentar leer campos que ya no existen.
  //
  // CORREGIDO en Auditoria N.08 (G-N08-01): ademas del caso de
  // k-anonimato, ahora la seccion puede estar AUSENTE por completo
  // porque reportesController.proyectarResumenSegunRol() no la
  // incluyo para el rol que genero el PDF (ej. TH no recibe
  // aptitudMedica). Cada seccion valida su propia presencia antes
  // de intentar leer sus campos.
  tituloSeccion(doc, '2. Distribución de aptitud médica laboral');
  if (!r.aptitudMedica) {
    doc.fontSize(9).font('Helvetica-Oblique').fillColor('#94a3b8').text('No disponible para su rol.');
  } else if (r.grupoPequenoRedactado) {
    doc.fontSize(9).font('Helvetica-Oblique').fillColor('#dc2626').text(r.aptitudMedica.nota);
    doc.moveDown(0.5);
  } else {
    filaDato(doc, 'Apto', `${r.aptitudMedica.apto} (${r.aptitudMedica.porcentajeApto}%)`);
    filaDato(doc, 'Apto con restricciones', r.aptitudMedica.conRestricciones);
    filaDato(doc, 'No apto', r.aptitudMedica.noApto);
    filaDato(doc, 'Pendiente de evaluación', r.aptitudMedica.pendiente);
  }

  // ---- Examenes complementarios ----
  tituloSeccion(doc, '3. Exámenes complementarios');
  if (!r.examenesComplementarios) {
    doc.fontSize(9).font('Helvetica-Oblique').fillColor('#94a3b8').text('No disponible para su rol.');
  } else if (r.grupoPequenoRedactado) {
    doc.fontSize(9).font('Helvetica-Oblique').fillColor('#dc2626').text(r.examenesComplementarios.nota);
    doc.moveDown(0.5);
  } else {
    tablaSimple(
      doc,
      ['Examen', 'Cobertura', 'Hallazgos anormales'],
      [
        ['Audiometría', `${r.examenesComplementarios.audiometria.trabajadoresCubiertos} trab. (${r.examenesComplementarios.audiometria.porcentajeCobertura}%)`, `${r.examenesComplementarios.audiometria.anormales} de ${r.examenesComplementarios.audiometria.total} (${r.examenesComplementarios.audiometria.porcentajeAnormales}%)`],
        ['Espirometría', `${r.examenesComplementarios.espirometria.trabajadoresCubiertos} trab. (${r.examenesComplementarios.espirometria.porcentajeCobertura}%)`, `${r.examenesComplementarios.espirometria.anormales} de ${r.examenesComplementarios.espirometria.total} (${r.examenesComplementarios.espirometria.porcentajeAnormales}%)`],
        ['Visiometría', `${r.examenesComplementarios.visiometria.trabajadoresCubiertos} trab. (${r.examenesComplementarios.visiometria.porcentajeCobertura}%)`, `${r.examenesComplementarios.visiometria.anormales} de ${r.examenesComplementarios.visiometria.total} (${r.examenesComplementarios.visiometria.porcentajeAnormales}%)`],
      ],
      [140, 190, 190]
    );
  }

  // ---- Ausentismo ----
  tituloSeccion(doc, '4. Ausentismo laboral');
  if (!r.ausentismo) {
    doc.fontSize(9).font('Helvetica-Oblique').fillColor('#94a3b8').text('No disponible para su rol.');
  } else {
    filaDato(doc, 'Total de ausencias registradas', r.ausentismo.totalAusencias);
    filaDato(doc, 'Total de días perdidos', r.ausentismo.totalDias);
    if (r.ausentismo.porTipo.length > 0) {
      doc.moveDown(0.3);
      tablaSimple(doc, ['Tipo', 'Ausencias', 'Días'], r.ausentismo.porTipo.map((t) => [t.etiqueta, t.ausencias, t.dias]), [280, 120, 120]);
    }
  }

  // ---- Matriz de riesgos ----
  tituloSeccion(doc, '5. Matriz de riesgos (IPER)');
  if (!r.matrizRiesgos) {
    doc.fontSize(9).font('Helvetica-Oblique').fillColor('#94a3b8').text('No disponible para su rol.');
  } else {
    doc.fontSize(8.5).font('Helvetica-Oblique').fillColor('#94a3b8').text(r.matrizRiesgos.nota);
    doc.moveDown(0.3);
    filaDato(doc, 'Total de peligros identificados (activos)', r.matrizRiesgos.total);
    filaDato(doc, 'Porcentaje en clasificación importante/intolerable', `${r.matrizRiesgos.porcentajeAltoRiesgo}%`);
    tablaSimple(
      doc,
      ['Clasificación', 'Cantidad'],
      Object.entries(r.matrizRiesgos.porClasificacion).map(([clave, valor]) => [clave, valor]),
      [280, 240]
    );
  }

  // ---- Ergonomia ----
  tituloSeccion(doc, '6. Ergonomía');
  if (!r.ergonomia) {
    doc.fontSize(9).font('Helvetica-Oblique').fillColor('#94a3b8').text('No disponible para su rol.');
  } else if (r.grupoPequenoRedactado) {
    doc.fontSize(9).font('Helvetica-Oblique').fillColor('#dc2626').text(r.ergonomia.nota);
  } else {
    filaDato(doc, 'Cuestionarios Nórdicos aplicados', r.ergonomia.nordico.total);
    filaDato(doc, 'Con zonas de atención prioritaria', `${r.ergonomia.nordico.prioritarios} (${r.ergonomia.nordico.porcentaje}%)`);
    doc.moveDown(0.3);
    filaDato(doc, 'Evaluaciones NIOSH realizadas', r.ergonomia.niosh.total);
    filaDato(doc, 'Con clasificación de riesgo alto/muy alto', `${r.ergonomia.niosh.altoRiesgo} (${r.ergonomia.niosh.porcentaje}%)`);
  }

  // ---- Consentimientos ----
  tituloSeccion(doc, '7. Consentimientos informados');
  if (!r.consentimientos) {
    doc.fontSize(9).font('Helvetica-Oblique').fillColor('#94a3b8').text('No disponible para su rol.');
  } else {
    filaDato(doc, 'Total registrados', r.consentimientos.total);
    filaDato(doc, 'Firma electrónica', r.consentimientos.electronica);
    filaDato(doc, 'Firma física escaneada', r.consentimientos.fisica);
    filaDato(doc, 'Revocados', `${r.consentimientos.revocados} (${r.consentimientos.porcentajeRevocados}%)`);
  }

  doc.moveDown(1.5);
  doc.fontSize(7.5).font('Helvetica').fillColor('#cbd5e1')
    .text('Generado automáticamente por SISSO — Sistema Integral de Seguridad y Salud Ocupacional.', { align: 'center' });

  return doc;
}

module.exports = { generarPdfReporteBI };
