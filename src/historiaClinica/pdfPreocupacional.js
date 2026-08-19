// ============================================================
// SISSO - Generacion de PDF para evaluaciones ocupacionales.
// Primera pieza: preocupacional - inicio (HCU 077).
//
// Con 17 bloques y varios JSONB anidados, listar cada campo vacio
// haria un PDF de decenas de paginas ilegible. Criterio: solo se
// imprime lo que tiene contenido real. Los bloques tipo checklist
// (revision de sistemas, examen fisico regional) solo muestran los
// items marcados CON hallazgo (con su descripcion); al final se
// indica cuantos items se revisaron sin hallazgos, sin listarlos
// uno por uno.
// ============================================================
const PDFDocument = require('pdfkit');

const MARGEN = 50;
const ANCHO_UTIL = 595.28 - MARGEN * 2;

const ETIQUETAS_SISTEMAS = {
  pielAnexos: 'Piel y anexos', organosSentidos: 'Órganos de los sentidos', respiratorio: 'Respiratorio',
  cardiovascular: 'Cardiovascular', digestivo: 'Digestivo', genitoUrinario: 'Genito-urinario',
  musculoEsqueletico: 'Músculo-esquelético', endocrino: 'Endocrino', hemoLinfatico: 'Hemo-linfático', nervioso: 'Nervioso',
};

const ETIQUETAS_REGIONES = {
  piel: 'Piel', ojos: 'Ojos', oido: 'Oído', oroFaringe: 'Oro-faringe', nariz: 'Nariz', cuello: 'Cuello',
  torax: 'Tórax', abdomen: 'Abdomen', columna: 'Columna', pelvis: 'Pelvis', extremidades: 'Extremidades', neurologico: 'Neurológico',
};

const ETIQUETAS_APTITUD = {
  apto: 'Apto', apto_en_observacion: 'Apto en observación',
  apto_con_limitaciones: 'Apto con limitaciones', no_apto: 'No apto',
};

function tituloBloque(doc, letra, texto) {
  if (doc.y > doc.page.height - MARGEN - 60) doc.addPage();
  doc.moveDown(0.6);
  doc.fontSize(11.5).font('Helvetica-Bold').fillColor('#0f172a')
    .text(`${letra}. ${texto}`);
  doc.moveTo(MARGEN, doc.y + 2).lineTo(MARGEN + ANCHO_UTIL, doc.y + 2).strokeColor('#e2e8f0').stroke();
  doc.moveDown(0.5);
  doc.fontSize(9.5).font('Helvetica').fillColor('#334155');
}

function campo(doc, etiqueta, valor) {
  if (valor === null || valor === undefined || valor === '') return;
  doc.font('Helvetica-Bold').fillColor('#334155').text(`${etiqueta}: `, { continued: true })
    .font('Helvetica').fillColor('#1e293b').text(String(valor));
}

function parrafo(doc, texto) {
  if (!texto) return;
  doc.font('Helvetica').fillColor('#1e293b').text(texto, { align: 'justify' });
}

function sinDatos(doc) {
  doc.font('Helvetica-Oblique').fillColor('#94a3b8').text('Sin información registrada en este bloque.');
}

/**
 * Genera el PDF de una evaluacion preocupacional.
 * @param {object} e - la fila completa devuelta por
 *   historiaClinicaController.js:obtenerEvaluacion (columnas ya
 *   parseadas: los JSONB llegan como objetos/arrays JS).
 * @param {string} nombreOrganizacion
 * @returns {PDFDocument}
 */
function generarPdfPreocupacional(e, nombreOrganizacion) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, bufferPages: true });

  // ---- Encabezado ----
  doc.fontSize(9).font('Helvetica').fillColor('#64748b')
    .text(nombreOrganizacion || 'SISSO — Sistema Integral de Seguridad y Salud Ocupacional', { align: 'right' });
  doc.moveDown(0.5);
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a')
    .text('Historia Clínica Ocupacional — Evaluación Preocupacional (Inicio)');
  doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
    .text('Formulario HCU 077 — Acuerdo Ministerial MSP 0341-2019');
  doc.moveDown(0.5);
  doc.fontSize(10).font('Helvetica').fillColor('#334155');
  doc.text(`Trabajador: ${e.trabajador_nombre}   |   Documento: ${e.trabajador_documento}`);
  doc.text(`Fecha de atención: ${formatearFecha(e.fecha_atencion)}${e.hora_atencion ? '  ' + e.hora_atencion : ''}   |   Profesional: ${e.medico_nombre}`);

  // ---- Bloque A ----
  tituloBloque(doc, 'A', 'Datos generales del trabajador');
  campo(doc, 'N° de archivo', e.numero_archivo);
  campo(doc, 'Religión', formatEnum(e.religion));
  campo(doc, 'Grupo sanguíneo', e.grupo_sanguineo);
  campo(doc, 'Lateralidad', formatEnum(e.lateralidad));
  campo(doc, 'Fecha de ingreso al trabajo', formatearFecha(e.fecha_ingreso_trabajo));
  campo(doc, 'Área de trabajo', e.area_trabajo);
  campo(doc, 'Código CIUO', e.puesto_trabajo_ciuo);
  if (e.actividades_relevantes) { doc.moveDown(0.3); parrafo(doc, e.actividades_relevantes); }
  if (e.discapacidad_tiene) {
    doc.moveDown(0.3);
    campo(doc, 'Discapacidad', `${e.discapacidad_tipo || 'No especificada'}${e.discapacidad_porcentaje ? ` (${e.discapacidad_porcentaje}%)` : ''}`);
  }
  if (e.antecedentes_ginecobstetricos) {
    const g = e.antecedentes_ginecobstetricos;
    doc.moveDown(0.3);
    campo(doc, 'Menarquia', g.menarquiaEdad ? `${g.menarquiaEdad} años` : null);
    campo(doc, 'Ciclos', g.ciclosDias ? `${g.ciclosDias} días` : null);
    campo(doc, 'Última menstruación', formatearFecha(g.fechaUltimaMenstruacion));
  }

  // ---- Bloque B ----
  tituloBloque(doc, 'B', 'Motivo de consulta');
  parrafo(doc, e.motivo_consulta) || sinDatos(doc);

  // ---- Bloque C ----
  tituloBloque(doc, 'C', 'Antecedentes personales');
  if (e.antecedentes_clinicos_quirurgicos) { doc.font('Helvetica-Bold').text('Clínico-quirúrgicos:'); parrafo(doc, e.antecedentes_clinicos_quirurgicos); doc.moveDown(0.3); }
  if (e.antecedentes_ginecologicos_examenes) {
    const g = e.antecedentes_ginecologicos_examenes;
    campo(doc, 'Gestas/Partos/Cesáreas/Abortos', `${g.gestas ?? '-'} / ${g.partos ?? '-'} / ${g.cesareas ?? '-'} / ${g.abortos ?? '-'}`);
    campo(doc, 'Hijos vivos/fallecidos', `${g.hijosVivos ?? '-'} / ${g.hijosMuertos ?? '-'}`);
    if (g.examenes) {
      campo(doc, 'Papanicolau', g.examenes.papanicolau?.resultado ? `${g.examenes.papanicolau.resultado} (${formatearFecha(g.examenes.papanicolau.fecha)})` : null);
      campo(doc, 'Eco mamario', g.examenes.ecoMamario?.resultado ? `${g.examenes.ecoMamario.resultado} (${formatearFecha(g.examenes.ecoMamario.fecha)})` : null);
      campo(doc, 'Mamografía', g.examenes.mamografia?.resultado ? `${g.examenes.mamografia.resultado} (${formatearFecha(g.examenes.mamografia.fecha)})` : null);
    }
    doc.moveDown(0.3);
  }
  if (e.antecedentes_reproductivos_masculinos) {
    const m = e.antecedentes_reproductivos_masculinos;
    campo(doc, 'Antígeno prostático', m.antigenoProstatico?.resultado ? `${m.antigenoProstatico.resultado} (${formatearFecha(m.antigenoProstatico.fecha)})` : null);
    campo(doc, 'Eco prostático', m.ecoProstatico?.resultado ? `${m.ecoProstatico.resultado} (${formatearFecha(m.ecoProstatico.fecha)})` : null);
    doc.moveDown(0.3);
  }
  if (e.habitos_toxicos) {
    const h = e.habitos_toxicos;
    campo(doc, 'Tabaco', h.tabaco?.consume && h.tabaco.consume !== 'no' ? `${h.tabaco.consume} — ${h.tabaco.detalle || ''}` : 'No');
    campo(doc, 'Alcohol', h.alcohol?.consume && h.alcohol.consume !== 'no' ? `${h.alcohol.consume} — ${h.alcohol.detalle || ''}` : 'No');
    campo(doc, 'Otras drogas', h.otrasDrogas?.consume && h.otrasDrogas.consume !== 'no' ? `${h.otrasDrogas.consume} — ${h.otrasDrogas.detalle || ''}` : 'No');
  }
  if (e.estilo_vida) {
    campo(doc, 'Actividad física', e.estilo_vida.actividadFisica);
    campo(doc, 'Medicación habitual', e.estilo_vida.medicacionHabitual);
  }

  // ---- Bloque D ----
  tituloBloque(doc, 'D', 'Antecedentes de trabajo (empleos anteriores)');
  const laborales = e.antecedentes_laborales_previos || [];
  if (laborales.length === 0) {
    sinDatos(doc);
  } else {
    laborales.forEach((l, i) => {
      doc.font('Helvetica-Bold').text(`${i + 1}. ${l.empresa || 'Empresa no especificada'} — ${l.puestoTrabajo || ''}`);
      doc.font('Helvetica').text(`   ${l.tiempoMeses ? l.tiempoMeses + ' meses. ' : ''}${l.actividades || ''}`);
      if (l.riesgos && l.riesgos.length) doc.text(`   Riesgos: ${l.riesgos.join(', ')}`);
      doc.moveDown(0.2);
    });
  }
  if (e.accidentes_trabajo_previos?.fueCalificado) {
    doc.moveDown(0.2);
    campo(doc, 'Accidente de trabajo previo calificado', `${e.accidentes_trabajo_previos.especificarEntidad || ''} — ${formatearFecha(e.accidentes_trabajo_previos.fecha)}`);
  }
  if (e.enfermedades_profesionales_previas?.fueCalificado) {
    campo(doc, 'Enfermedad profesional previa calificada', `${e.enfermedades_profesionales_previas.especificarEntidad || ''} — ${formatearFecha(e.enfermedades_profesionales_previas.fecha)}`);
  }

  // ---- Bloque E ----
  tituloBloque(doc, 'E', 'Antecedentes familiares');
  const fam = e.antecedentes_familiares || {};
  const familiaEtiquetas = { cardiovascular: 'Cardiovascular', metabolica: 'Metabólica', neurologica: 'Neurológica', oncologica: 'Oncológica', infecciosa: 'Infecciosa', hereditariaCongenita: 'Hereditaria/congénita', discapacidades: 'Discapacidades', otros: 'Otros' };
  let huboFamilia = false;
  Object.entries(familiaEtiquetas).forEach(([campoKey, etq]) => {
    if (fam[campoKey]) { campo(doc, etq, fam[campoKey]); huboFamilia = true; }
  });
  if (!huboFamilia) sinDatos(doc);

  // ---- Bloque F ----
  tituloBloque(doc, 'F', 'Factores de riesgo del puesto de trabajo actual');
  const fr = e.factores_riesgo_actual || {};
  campo(doc, 'Puesto/área', fr.puestoArea);
  if (fr.actividades) parrafo(doc, fr.actividades);
  const categoriasRiesgo = [
    ['riesgosFisicos', 'Físicos'], ['riesgosMecanicos', 'Mecánicos'], ['riesgosQuimicos', 'Químicos'],
    ['riesgosBiologicos', 'Biológicos'], ['riesgosErgonomicos', 'Ergonómicos'], ['riesgosPsicosociales', 'Psicosociales'],
  ];
  doc.moveDown(0.2);
  categoriasRiesgo.forEach(([key, etq]) => {
    if (fr[key] && fr[key].length) campo(doc, etq, fr[key].map(formatEnum).join(', '));
  });
  if (fr.medidasPreventivas) { doc.moveDown(0.2); doc.font('Helvetica-Bold').text('Medidas preventivas:'); parrafo(doc, fr.medidasPreventivas); }

  // ---- Bloque G ----
  tituloBloque(doc, 'G', 'Actividades extra laborales');
  parrafo(doc, e.actividades_extra_laborales) || sinDatos(doc);

  // ---- Bloque H ----
  tituloBloque(doc, 'H', 'Enfermedad actual');
  parrafo(doc, e.enfermedad_actual) || sinDatos(doc);

  // ---- Bloque I ----
  tituloBloque(doc, 'I', 'Revisión actual de órganos y sistemas');
  escribirChecklistConHallazgos(doc, e.revision_organos_sistemas, ETIQUETAS_SISTEMAS, 'sistemas revisados');

  // ---- Bloque J ----
  tituloBloque(doc, 'J', 'Constantes vitales y antropometría');
  const vitalesLinea1 = [
    e.presion_arterial_sistolica && e.presion_arterial_diastolica ? `P.A.: ${e.presion_arterial_sistolica}/${e.presion_arterial_diastolica} mmHg` : null,
    e.temperatura_c ? `Temp.: ${e.temperatura_c} °C` : null,
    e.frecuencia_cardiaca ? `F.C.: ${e.frecuencia_cardiaca} lat/min` : null,
    e.saturacion_oxigeno ? `SatO₂: ${e.saturacion_oxigeno}%` : null,
    e.frecuencia_respiratoria ? `F.R.: ${e.frecuencia_respiratoria} resp/min` : null,
  ].filter(Boolean).join('   |   ');
  const vitalesLinea2 = [
    e.peso_kg ? `Peso: ${e.peso_kg} kg` : null,
    e.talla_cm ? `Talla: ${e.talla_cm} cm` : null,
    e.imc ? `IMC: ${e.imc} kg/m²` : null,
    e.perimetro_abdominal_cm ? `Perímetro abdominal: ${e.perimetro_abdominal_cm} cm` : null,
  ].filter(Boolean).join('   |   ');
  if (vitalesLinea1) doc.text(vitalesLinea1);
  if (vitalesLinea2) doc.text(vitalesLinea2);
  if (!vitalesLinea1 && !vitalesLinea2) sinDatos(doc);

  // ---- Bloque K ----
  tituloBloque(doc, 'K', 'Examen físico regional');
  escribirExamenRegional(doc, e.examen_fisico_regional);

  // ---- Bloque L ----
  tituloBloque(doc, 'L', 'Resultados de exámenes generales/específicos');
  const examenes = e.resultados_examenes || [];
  if (examenes.length === 0) {
    sinDatos(doc);
  } else {
    examenes.forEach(ex => campo(doc, ex.examen, `${ex.resultado || ''}${ex.fecha ? ' (' + formatearFecha(ex.fecha) + ')' : ''}`));
  }

  // ---- Bloque M ----
  tituloBloque(doc, 'M', 'Diagnóstico');
  const diagnosticos = e.diagnosticos || [];
  if (diagnosticos.length === 0) {
    sinDatos(doc);
  } else {
    diagnosticos.forEach(d => {
      doc.font('Helvetica-Bold').fillColor('#0f172a').text(`${d.codigoCie10}  `, { continued: true })
        .font('Helvetica').fillColor('#1e293b').text(`${d.descripcion} (${formatEnum(d.tipo)}, ${formatEnum(d.condicion)})`);
    });
  }

  // ---- Bloque N ----
  tituloBloque(doc, 'N', 'Aptitud médica para el trabajo');
  if (e.aptitud_msp) {
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text(ETIQUETAS_APTITUD[e.aptitud_msp] || e.aptitud_msp);
    doc.fontSize(9.5).font('Helvetica').fillColor('#334155');
  } else {
    sinDatos(doc);
  }
  if (e.aptitud_observacion) { doc.moveDown(0.2); doc.font('Helvetica-Bold').text('Observación:'); parrafo(doc, e.aptitud_observacion); }
  if (e.aptitud_limitacion) { doc.moveDown(0.2); doc.font('Helvetica-Bold').text('Limitación:'); parrafo(doc, e.aptitud_limitacion); }

  // ---- Bloque O ----
  tituloBloque(doc, 'O', 'Recomendaciones y/o tratamiento');
  parrafo(doc, e.recomendaciones_tratamiento) || sinDatos(doc);

  // ---- Bloque P ----
  tituloBloque(doc, 'P', 'Datos del profesional');
  campo(doc, 'Profesional', e.medico_nombre);
  campo(doc, 'Código profesional', e.codigo_profesional_salud);
  campo(doc, 'Fecha y hora de atención', `${formatearFecha(e.fecha_atencion)} ${e.hora_atencion || ''}`);

  // ---- Bloque Q ----
  if (e.firma_imagen_url_buffer) {
    tituloBloque(doc, 'Q', 'Firma del trabajador');
    try {
      doc.image(e.firma_imagen_url_buffer, { fit: [200, 80], align: 'left' });
    } catch (err) {
      doc.font('Helvetica-Oblique').fillColor('#94a3b8').text('(No se pudo incrustar la imagen de la firma.)');
    }
  }

  // ---- Numeracion de paginas ----
  const rangoPaginas = doc.bufferedPageRange();
  for (let i = 0; i < rangoPaginas.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor('#94a3b8')
      .text(`Página ${i + 1} de ${rangoPaginas.count}`, MARGEN, doc.page.height - 35, { align: 'center', width: ANCHO_UTIL });
  }

  return doc;
}

/**
 * Escribe solo los items marcados "con hallazgo" de un bloque tipo
 * { claveCamel: { conPatologia, descripcion }, ... }, y resume
 * cuantos se revisaron sin hallazgos al final.
 */
function escribirChecklistConHallazgos(doc, bloque, etiquetas, nombrePlural) {
  if (!bloque) { sinDatos(doc); return; }
  const entradas = Object.entries(bloque);
  const conHallazgo = entradas.filter(([, v]) => v && v.conPatologia);
  if (conHallazgo.length === 0) {
    doc.font('Helvetica-Oblique').fillColor('#64748b').text(`Sin hallazgos en los ${entradas.length} ${nombrePlural}.`);
    return;
  }
  conHallazgo.forEach(([clave, v]) => {
    campo(doc, etiquetas[clave] || clave, v.descripcion || '(sin descripción adicional)');
  });
  const normales = entradas.length - conHallazgo.length;
  if (normales > 0) {
    doc.moveDown(0.2);
    doc.font('Helvetica-Oblique').fillColor('#64748b').text(`Los ${normales} restantes se revisaron sin hallazgos.`);
  }
}

/**
 * Igual que escribirChecklistConHallazgos pero para el examen
 * fisico regional, que tiene un nivel extra de anidacion (region -> subitem).
 */
function escribirExamenRegional(doc, bloque) {
  if (!bloque) { sinDatos(doc); return; }
  let totalSubitems = 0;
  let totalConHallazgo = 0;
  Object.entries(bloque).forEach(([region, subitems]) => {
    const entradas = Object.entries(subitems || {});
    totalSubitems += entradas.length;
    const conHallazgo = entradas.filter(([, v]) => v && v.conPatologia);
    totalConHallazgo += conHallazgo.length;
    if (conHallazgo.length > 0) {
      doc.font('Helvetica-Bold').fillColor('#0f172a').text(ETIQUETAS_REGIONES[region] || region);
      conHallazgo.forEach(([sub, v]) => {
        doc.font('Helvetica').fillColor('#1e293b').text(`   ${sub.replace(/([A-Z])/g, ' $1')}: ${v.descripcion || '(sin descripción adicional)'}`);
      });
    }
  });
  const normales = totalSubitems - totalConHallazgo;
  if (totalConHallazgo === 0) {
    doc.font('Helvetica-Oblique').fillColor('#64748b').text(`Sin hallazgos en las ${Object.keys(bloque).length} regiones examinadas.`);
  } else if (normales > 0) {
    doc.moveDown(0.2);
    doc.font('Helvetica-Oblique').fillColor('#64748b').text(`Los ${normales} ítems restantes se revisaron sin hallazgos.`);
  }
}

function formatEnum(valor) {
  if (!valor) return valor;
  return String(valor).replace(/_/g, ' ');
}

function formatearFecha(fecha) {
  if (!fecha) return null;
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Genera el PDF de una evaluacion de retiro (HCU 080). Formulario
 * mas simple que preocupacional: sin motivo de consulta,
 * antecedentes laborales/familiares, matriz de riesgo, revision de
 * sistemas ni aptitud medica (ver migration_015 para el detalle).
 * @param {object} e - fila completa de evaluaciones_ocupacionales
 * @param {string} nombreOrganizacion
 * @returns {PDFDocument}
 */
function generarPdfRetiro(e, nombreOrganizacion) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, bufferPages: true });

  doc.fontSize(9).font('Helvetica').fillColor('#64748b')
    .text(nombreOrganizacion || 'SISSO — Sistema Integral de Seguridad y Salud Ocupacional', { align: 'right' });
  doc.moveDown(0.5);
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a')
    .text('Historia Clínica Ocupacional — Evaluación de Retiro');
  doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
    .text('Formulario HCU 080 — Acuerdo Ministerial MSP 0341-2019');
  doc.moveDown(0.5);
  doc.fontSize(10).font('Helvetica').fillColor('#334155');
  doc.text(`Trabajador: ${e.trabajador_nombre}   |   Documento: ${e.trabajador_documento}`);
  doc.text(`Fecha de atención: ${formatearFecha(e.fecha_atencion)}${e.hora_atencion ? '  ' + e.hora_atencion : ''}   |   Profesional: ${e.medico_nombre}`);

  tituloBloque(doc, 'A', 'Datos generales del retiro');
  campo(doc, 'Fecha de inicio de labores', formatearFecha(e.fecha_inicio_labores));
  campo(doc, 'Fecha de salida', formatearFecha(e.fecha_salida));
  campo(doc, 'Tiempo de permanencia', e.tiempo_permanencia_meses ? `${e.tiempo_permanencia_meses} meses` : null);
  campo(doc, 'Puesto de trabajo (CIUO)', e.puesto_trabajo_ciuo);
  if (e.actividades_relevantes) { doc.moveDown(0.2); doc.font('Helvetica-Bold').text('Actividades desempeñadas:'); parrafo(doc, e.actividades_relevantes); }
  if (e.factores_riesgo_texto_libre) { doc.moveDown(0.2); doc.font('Helvetica-Bold').text('Factores de riesgo a los que estuvo expuesto:'); parrafo(doc, e.factores_riesgo_texto_libre); }

  tituloBloque(doc, 'B', 'Antecedentes personales');
  if (e.antecedentes_clinicos_quirurgicos) parrafo(doc, e.antecedentes_clinicos_quirurgicos); else sinDatos(doc);
  if (e.accidentes_trabajo_previos?.fueCalificado) {
    doc.moveDown(0.2);
    campo(doc, 'Accidente de trabajo calificado', `${e.accidentes_trabajo_previos.especificarEntidad || ''} — ${formatearFecha(e.accidentes_trabajo_previos.fecha)}`);
  }
  if (e.enfermedades_profesionales_previas?.fueCalificado) {
    campo(doc, 'Enfermedad profesional calificada', `${e.enfermedades_profesionales_previas.especificarEntidad || ''} — ${formatearFecha(e.enfermedades_profesionales_previas.fecha)}`);
  }

  tituloBloque(doc, 'C', 'Constantes vitales y antropometría');
  const vitalesLinea1 = [
    e.presion_arterial_sistolica && e.presion_arterial_diastolica ? `P.A.: ${e.presion_arterial_sistolica}/${e.presion_arterial_diastolica} mmHg` : null,
    e.temperatura_c ? `Temp.: ${e.temperatura_c} °C` : null,
    e.frecuencia_cardiaca ? `F.C.: ${e.frecuencia_cardiaca} lat/min` : null,
    e.saturacion_oxigeno ? `SatO₂: ${e.saturacion_oxigeno}%` : null,
    e.frecuencia_respiratoria ? `F.R.: ${e.frecuencia_respiratoria} resp/min` : null,
  ].filter(Boolean).join('   |   ');
  const vitalesLinea2 = [
    e.peso_kg ? `Peso: ${e.peso_kg} kg` : null,
    e.talla_cm ? `Talla: ${e.talla_cm} cm` : null,
    e.imc ? `IMC: ${e.imc} kg/m²` : null,
    e.perimetro_abdominal_cm ? `Perímetro abdominal: ${e.perimetro_abdominal_cm} cm` : null,
  ].filter(Boolean).join('   |   ');
  if (vitalesLinea1) doc.text(vitalesLinea1);
  if (vitalesLinea2) doc.text(vitalesLinea2);
  if (!vitalesLinea1 && !vitalesLinea2) sinDatos(doc);

  tituloBloque(doc, 'D', 'Examen físico regional');
  escribirExamenRegional(doc, e.examen_fisico_regional);

  tituloBloque(doc, 'E', 'Resultados de exámenes generales/específicos');
  const examenes = e.resultados_examenes || [];
  if (examenes.length === 0) sinDatos(doc);
  else examenes.forEach(ex => campo(doc, ex.examen, `${ex.resultado || ''}${ex.fecha ? ' (' + formatearFecha(ex.fecha) + ')' : ''}`));

  tituloBloque(doc, 'F', 'Diagnóstico');
  const diagnosticos = e.diagnosticos || [];
  if (diagnosticos.length === 0) {
    sinDatos(doc);
  } else {
    diagnosticos.forEach(d => {
      doc.font('Helvetica-Bold').fillColor('#0f172a').text(`${d.codigoCie10}  `, { continued: true })
        .font('Helvetica').fillColor('#1e293b').text(`${d.descripcion} (${formatEnum(d.tipo)}, ${formatEnum(d.condicion)})`);
    });
  }

  tituloBloque(doc, 'G', 'Evaluación médica de retiro');
  campo(doc, 'Se realizó la evaluación', e.retiro_se_realizo_evaluacion === true ? 'Sí' : e.retiro_se_realizo_evaluacion === false ? 'No' : null);
  if (e.retiro_observaciones) parrafo(doc, e.retiro_observaciones);
  if (e.retiro_se_realizo_evaluacion === null && !e.retiro_observaciones) sinDatos(doc);

  tituloBloque(doc, 'H', 'Recomendaciones y/o tratamiento');
  parrafo(doc, e.recomendaciones_tratamiento) || sinDatos(doc);

  tituloBloque(doc, 'I', 'Datos del profesional');
  campo(doc, 'Profesional', e.medico_nombre);
  campo(doc, 'Código profesional', e.codigo_profesional_salud);
  campo(doc, 'Fecha y hora de atención', `${formatearFecha(e.fecha_atencion)} ${e.hora_atencion || ''}`);

  if (e.firma_imagen_url_buffer) {
    tituloBloque(doc, 'J', 'Firma del trabajador');
    try {
      doc.image(e.firma_imagen_url_buffer, { fit: [200, 80], align: 'left' });
    } catch (err) {
      doc.font('Helvetica-Oblique').fillColor('#94a3b8').text('(No se pudo incrustar la imagen de la firma.)');
    }
  }

  const rangoPaginas = doc.bufferedPageRange();
  for (let i = 0; i < rangoPaginas.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor('#94a3b8')
      .text(`Página ${i + 1} de ${rangoPaginas.count}`, MARGEN, doc.page.height - 35, { align: 'center', width: ANCHO_UTIL });
  }

  return doc;
}

/**
 * Genera el PDF de una evaluacion periodica (HCU 078). Comparte
 * bloques con preocupacional (habitos, familiares, riesgo,
 * sistemas, aptitud) pero sin antecedentes laborales anteriores ni
 * datos demograficos extendidos; agrega incidentes y tiempo en el
 * puesto actual.
 * @param {object} e - fila completa de evaluaciones_ocupacionales
 * @param {string} nombreOrganizacion
 * @returns {PDFDocument}
 */
function generarPdfPeriodica(e, nombreOrganizacion) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, bufferPages: true });

  doc.fontSize(9).font('Helvetica').fillColor('#64748b')
    .text(nombreOrganizacion || 'SISSO — Sistema Integral de Seguridad y Salud Ocupacional', { align: 'right' });
  doc.moveDown(0.5);
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a')
    .text('Historia Clínica Ocupacional — Evaluación Periódica');
  doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
    .text('Formulario HCU 078 — Acuerdo Ministerial MSP 0341-2019');
  doc.moveDown(0.5);
  doc.fontSize(10).font('Helvetica').fillColor('#334155');
  doc.text(`Trabajador: ${e.trabajador_nombre}   |   Documento: ${e.trabajador_documento}`);
  doc.text(`Fecha de atención: ${formatearFecha(e.fecha_atencion)}${e.hora_atencion ? '  ' + e.hora_atencion : ''}   |   Profesional: ${e.medico_nombre}`);

  tituloBloque(doc, 'A', 'Motivo de consulta');
  parrafo(doc, e.motivo_consulta) || sinDatos(doc);

  tituloBloque(doc, 'B', 'Antecedentes personales');
  if (e.antecedentes_clinicos_quirurgicos) { doc.font('Helvetica-Bold').text('Clínico-quirúrgicos:'); parrafo(doc, e.antecedentes_clinicos_quirurgicos); doc.moveDown(0.3); }
  if (e.habitos_toxicos) {
    const h = e.habitos_toxicos;
    campo(doc, 'Tabaco', h.tabaco?.consume && h.tabaco.consume !== 'no' ? `${h.tabaco.consume} — ${h.tabaco.detalle || ''}` : 'No');
    campo(doc, 'Alcohol', h.alcohol?.consume && h.alcohol.consume !== 'no' ? `${h.alcohol.consume} — ${h.alcohol.detalle || ''}` : 'No');
    campo(doc, 'Otras drogas', h.otrasDrogas?.consume && h.otrasDrogas.consume !== 'no' ? `${h.otrasDrogas.consume} — ${h.otrasDrogas.detalle || ''}` : 'No');
  }
  if (e.estilo_vida) {
    campo(doc, 'Actividad física', e.estilo_vida.actividadFisica);
    campo(doc, 'Medicación habitual', e.estilo_vida.medicacionHabitual);
  }
  if (e.incidentes) { doc.moveDown(0.2); doc.font('Helvetica-Bold').text('Incidentes de mayor recurrencia:'); parrafo(doc, e.incidentes); }
  if (e.accidentes_trabajo_previos?.fueCalificado) {
    doc.moveDown(0.2);
    campo(doc, 'Accidente de trabajo calificado', `${e.accidentes_trabajo_previos.especificarEntidad || ''} — ${formatearFecha(e.accidentes_trabajo_previos.fecha)}`);
  }
  if (e.enfermedades_profesionales_previas?.fueCalificado) {
    campo(doc, 'Enfermedad profesional calificada', `${e.enfermedades_profesionales_previas.especificarEntidad || ''} — ${formatearFecha(e.enfermedades_profesionales_previas.fecha)}`);
  }

  tituloBloque(doc, 'C', 'Antecedentes familiares');
  const fam = e.antecedentes_familiares || {};
  const familiaEtiquetas = { cardiovascular: 'Cardiovascular', metabolica: 'Metabólica', neurologica: 'Neurológica', oncologica: 'Oncológica', infecciosa: 'Infecciosa', hereditariaCongenita: 'Hereditaria/congénita', discapacidades: 'Discapacidades', otros: 'Otros' };
  let huboFamilia = false;
  Object.entries(familiaEtiquetas).forEach(([campoKey, etq]) => {
    if (fam[campoKey]) { campo(doc, etq, fam[campoKey]); huboFamilia = true; }
  });
  if (!huboFamilia) sinDatos(doc);

  tituloBloque(doc, 'D', 'Factores de riesgo del puesto de trabajo');
  const fr = e.factores_riesgo_actual || {};
  campo(doc, 'Puesto/área', fr.puestoArea);
  campo(doc, 'Tiempo en el puesto actual', e.tiempo_puesto_actual_meses ? `${e.tiempo_puesto_actual_meses} meses` : null);
  if (fr.actividades) parrafo(doc, fr.actividades);
  const categoriasRiesgo = [
    ['riesgosFisicos', 'Físicos'], ['riesgosMecanicos', 'Mecánicos'], ['riesgosQuimicos', 'Químicos'],
    ['riesgosBiologicos', 'Biológicos'], ['riesgosErgonomicos', 'Ergonómicos'], ['riesgosPsicosociales', 'Psicosociales'],
  ];
  doc.moveDown(0.2);
  categoriasRiesgo.forEach(([key, etq]) => {
    if (fr[key] && fr[key].length) campo(doc, etq, fr[key].map(formatEnum).join(', '));
  });
  if (fr.medidasPreventivas) { doc.moveDown(0.2); doc.font('Helvetica-Bold').text('Medidas preventivas:'); parrafo(doc, fr.medidasPreventivas); }

  tituloBloque(doc, 'E', 'Enfermedad actual');
  parrafo(doc, e.enfermedad_actual) || sinDatos(doc);

  tituloBloque(doc, 'F', 'Revisión de órganos y sistemas');
  escribirChecklistConHallazgos(doc, e.revision_organos_sistemas, ETIQUETAS_SISTEMAS, 'sistemas revisados');

  tituloBloque(doc, 'G', 'Constantes vitales y antropometría');
  const vitalesLinea1 = [
    e.presion_arterial_sistolica && e.presion_arterial_diastolica ? `P.A.: ${e.presion_arterial_sistolica}/${e.presion_arterial_diastolica} mmHg` : null,
    e.temperatura_c ? `Temp.: ${e.temperatura_c} °C` : null,
    e.frecuencia_cardiaca ? `F.C.: ${e.frecuencia_cardiaca} lat/min` : null,
    e.saturacion_oxigeno ? `SatO₂: ${e.saturacion_oxigeno}%` : null,
    e.frecuencia_respiratoria ? `F.R.: ${e.frecuencia_respiratoria} resp/min` : null,
  ].filter(Boolean).join('   |   ');
  const vitalesLinea2 = [
    e.peso_kg ? `Peso: ${e.peso_kg} kg` : null,
    e.talla_cm ? `Talla: ${e.talla_cm} cm` : null,
    e.imc ? `IMC: ${e.imc} kg/m²` : null,
    e.perimetro_abdominal_cm ? `Perímetro abdominal: ${e.perimetro_abdominal_cm} cm` : null,
  ].filter(Boolean).join('   |   ');
  if (vitalesLinea1) doc.text(vitalesLinea1);
  if (vitalesLinea2) doc.text(vitalesLinea2);
  if (!vitalesLinea1 && !vitalesLinea2) sinDatos(doc);

  tituloBloque(doc, 'H', 'Examen físico regional');
  escribirExamenRegional(doc, e.examen_fisico_regional);

  tituloBloque(doc, 'I', 'Resultados de exámenes generales/específicos');
  const examenes = e.resultados_examenes || [];
  if (examenes.length === 0) sinDatos(doc);
  else examenes.forEach(ex => campo(doc, ex.examen, `${ex.resultado || ''}${ex.fecha ? ' (' + formatearFecha(ex.fecha) + ')' : ''}`));

  tituloBloque(doc, 'J', 'Diagnóstico');
  const diagnosticos = e.diagnosticos || [];
  if (diagnosticos.length === 0) {
    sinDatos(doc);
  } else {
    diagnosticos.forEach(d => {
      doc.font('Helvetica-Bold').fillColor('#0f172a').text(`${d.codigoCie10}  `, { continued: true })
        .font('Helvetica').fillColor('#1e293b').text(`${d.descripcion} (${formatEnum(d.tipo)}, ${formatEnum(d.condicion)})`);
    });
  }

  tituloBloque(doc, 'K', 'Aptitud médica para el trabajo');
  if (e.aptitud_msp) {
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text(ETIQUETAS_APTITUD[e.aptitud_msp] || e.aptitud_msp);
    doc.fontSize(9.5).font('Helvetica').fillColor('#334155');
  } else {
    sinDatos(doc);
  }
  if (e.aptitud_observacion) { doc.moveDown(0.2); doc.font('Helvetica-Bold').text('Observación:'); parrafo(doc, e.aptitud_observacion); }
  if (e.aptitud_limitacion) { doc.moveDown(0.2); doc.font('Helvetica-Bold').text('Limitación:'); parrafo(doc, e.aptitud_limitacion); }

  tituloBloque(doc, 'L', 'Recomendaciones y/o tratamiento');
  parrafo(doc, e.recomendaciones_tratamiento) || sinDatos(doc);

  tituloBloque(doc, 'M', 'Datos del profesional');
  campo(doc, 'Profesional', e.medico_nombre);
  campo(doc, 'Código profesional', e.codigo_profesional_salud);
  campo(doc, 'Fecha y hora de atención', `${formatearFecha(e.fecha_atencion)} ${e.hora_atencion || ''}`);

  if (e.firma_imagen_url_buffer) {
    tituloBloque(doc, 'N', 'Firma del trabajador');
    try {
      doc.image(e.firma_imagen_url_buffer, { fit: [200, 80], align: 'left' });
    } catch (err) {
      doc.font('Helvetica-Oblique').fillColor('#94a3b8').text('(No se pudo incrustar la imagen de la firma.)');
    }
  }

  const rangoPaginas = doc.bufferedPageRange();
  for (let i = 0; i < rangoPaginas.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor('#94a3b8')
      .text(`Página ${i + 1} de ${rangoPaginas.count}`, MARGEN, doc.page.height - 35, { align: 'center', width: ANCHO_UTIL });
  }

  return doc;
}

/**
 * Genera el PDF de una evaluacion de reintegro (HCU 079). La mas
 * simple de las 4: datos de la ausencia, enfermedad actual,
 * vitales, examen regional, examenes, diagnostico, aptitud (con
 * reubicacion), recomendaciones.
 * @param {object} e - fila completa de evaluaciones_ocupacionales
 * @param {string} nombreOrganizacion
 * @returns {PDFDocument}
 */
function generarPdfReintegro(e, nombreOrganizacion) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, bufferPages: true });

  doc.fontSize(9).font('Helvetica').fillColor('#64748b')
    .text(nombreOrganizacion || 'SISSO — Sistema Integral de Seguridad y Salud Ocupacional', { align: 'right' });
  doc.moveDown(0.5);
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a')
    .text('Historia Clínica Ocupacional — Evaluación de Reintegro');
  doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
    .text('Formulario HCU 079 — Acuerdo Ministerial MSP 0341-2019');
  doc.moveDown(0.5);
  doc.fontSize(10).font('Helvetica').fillColor('#334155');
  doc.text(`Trabajador: ${e.trabajador_nombre}   |   Documento: ${e.trabajador_documento}`);
  doc.text(`Fecha de atención: ${formatearFecha(e.fecha_atencion)}${e.hora_atencion ? '  ' + e.hora_atencion : ''}   |   Profesional: ${e.medico_nombre}`);

  tituloBloque(doc, 'A', 'Datos del reintegro');
  campo(doc, 'Fecha del último día laboral', formatearFecha(e.fecha_ultimo_dia_laboral));
  campo(doc, 'Fecha de reingreso', formatearFecha(e.fecha_reingreso));
  campo(doc, 'Total de días de ausencia', e.total_dias_ausencia !== null && e.total_dias_ausencia !== undefined ? `${e.total_dias_ausencia} días` : null);
  if (e.causa_salida) { doc.moveDown(0.2); doc.font('Helvetica-Bold').text('Causa de la salida:'); parrafo(doc, e.causa_salida); }

  tituloBloque(doc, 'B', 'Enfermedad actual');
  parrafo(doc, e.enfermedad_actual) || sinDatos(doc);

  tituloBloque(doc, 'C', 'Constantes vitales y antropometría');
  const vitalesLinea1 = [
    e.presion_arterial_sistolica && e.presion_arterial_diastolica ? `P.A.: ${e.presion_arterial_sistolica}/${e.presion_arterial_diastolica} mmHg` : null,
    e.temperatura_c ? `Temp.: ${e.temperatura_c} °C` : null,
    e.frecuencia_cardiaca ? `F.C.: ${e.frecuencia_cardiaca} lat/min` : null,
    e.saturacion_oxigeno ? `SatO₂: ${e.saturacion_oxigeno}%` : null,
    e.frecuencia_respiratoria ? `F.R.: ${e.frecuencia_respiratoria} resp/min` : null,
  ].filter(Boolean).join('   |   ');
  const vitalesLinea2 = [
    e.peso_kg ? `Peso: ${e.peso_kg} kg` : null,
    e.talla_cm ? `Talla: ${e.talla_cm} cm` : null,
    e.imc ? `IMC: ${e.imc} kg/m²` : null,
    e.perimetro_abdominal_cm ? `Perímetro abdominal: ${e.perimetro_abdominal_cm} cm` : null,
  ].filter(Boolean).join('   |   ');
  if (vitalesLinea1) doc.text(vitalesLinea1);
  if (vitalesLinea2) doc.text(vitalesLinea2);
  if (!vitalesLinea1 && !vitalesLinea2) sinDatos(doc);

  tituloBloque(doc, 'D', 'Examen físico regional');
  escribirExamenRegional(doc, e.examen_fisico_regional);

  tituloBloque(doc, 'E', 'Resultados de exámenes');
  const examenes = e.resultados_examenes || [];
  if (examenes.length === 0) sinDatos(doc);
  else examenes.forEach(ex => campo(doc, ex.examen, `${ex.resultado || ''}${ex.fecha ? ' (' + formatearFecha(ex.fecha) + ')' : ''}`));

  tituloBloque(doc, 'F', 'Diagnóstico');
  const diagnosticos = e.diagnosticos || [];
  if (diagnosticos.length === 0) {
    sinDatos(doc);
  } else {
    diagnosticos.forEach(d => {
      doc.font('Helvetica-Bold').fillColor('#0f172a').text(`${d.codigoCie10}  `, { continued: true })
        .font('Helvetica').fillColor('#1e293b').text(`${d.descripcion} (${formatEnum(d.tipo)}, ${formatEnum(d.condicion)})`);
    });
  }

  tituloBloque(doc, 'G', 'Aptitud médica para el trabajo');
  if (e.aptitud_msp) {
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text(ETIQUETAS_APTITUD[e.aptitud_msp] || e.aptitud_msp);
    doc.fontSize(9.5).font('Helvetica').fillColor('#334155');
  } else {
    sinDatos(doc);
  }
  if (e.aptitud_observacion) { doc.moveDown(0.2); doc.font('Helvetica-Bold').text('Observación:'); parrafo(doc, e.aptitud_observacion); }
  if (e.aptitud_limitacion) { doc.moveDown(0.2); doc.font('Helvetica-Bold').text('Limitación:'); parrafo(doc, e.aptitud_limitacion); }
  if (e.aptitud_reubicacion) { doc.moveDown(0.2); doc.font('Helvetica-Bold').text('Reubicación:'); parrafo(doc, e.aptitud_reubicacion); }

  tituloBloque(doc, 'H', 'Recomendaciones y/o tratamiento');
  parrafo(doc, e.recomendaciones_tratamiento) || sinDatos(doc);

  tituloBloque(doc, 'I', 'Datos del profesional');
  campo(doc, 'Profesional', e.medico_nombre);
  campo(doc, 'Código profesional', e.codigo_profesional_salud);
  campo(doc, 'Fecha y hora de atención', `${formatearFecha(e.fecha_atencion)} ${e.hora_atencion || ''}`);

  if (e.firma_imagen_url_buffer) {
    tituloBloque(doc, 'J', 'Firma del trabajador');
    try {
      doc.image(e.firma_imagen_url_buffer, { fit: [200, 80], align: 'left' });
    } catch (err) {
      doc.font('Helvetica-Oblique').fillColor('#94a3b8').text('(No se pudo incrustar la imagen de la firma.)');
    }
  }

  const rangoPaginas = doc.bufferedPageRange();
  for (let i = 0; i < rangoPaginas.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor('#94a3b8')
      .text(`Página ${i + 1} de ${rangoPaginas.count}`, MARGEN, doc.page.height - 35, { align: 'center', width: ANCHO_UTIL });
  }

  return doc;
}

module.exports = { generarPdfPreocupacional, generarPdfRetiro, generarPdfPeriodica, generarPdfReintegro };
