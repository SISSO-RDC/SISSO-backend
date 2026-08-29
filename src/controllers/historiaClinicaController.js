// ============================================================
// Controlador de Historia Clinica Ocupacional.
// Primera pieza: formulario preocupacional - inicio (HCU 077).
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
// CREADO en Auditoria N.11 (C11-03): red de seguridad centralizada
// de minimizacion por campo, ver src/utils/politicaMinimizacion.js.
const { aplicarBloqueoUniversal } = require('../utils/politicaMinimizacion');
const { subirEvidencia, borrarEvidencia, generarUrlFirmada } = require('../servicios/cloudinaryService');
const { calcularImc, validarFactoresRiesgo } = require('../historiaClinica/historiaClinica');
const { generarPdfPreocupacional, generarPdfRetiro, generarPdfPeriodica, generarPdfReintegro } = require('../historiaClinica/pdfPreocupacional');
const { generarPdfCertificado } = require('../historiaClinica/pdfCertificado');
const catalogos = require('../historiaClinica/catalogosRiesgo');

const CARPETA_FIRMAS = 'sisso/firmas-historia-clinica';

/**
 * Descarga los bytes de una imagen ya subida a Cloudinary (misma
 * necesidad que consentimientosController.js: pdfkit necesita el
 * buffer, no una URL).
 */
async function descargarImagen(url) {
  const respuesta = await fetch(url);
  if (!respuesta.ok) throw new Error(`No se pudo descargar la imagen (HTTP ${respuesta.status}).`);
  const arrayBuffer = await respuesta.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ------------------------------------------------------------
// GET /api/historia-clinica/catalogos
// Devuelve las listas fijas del formulario oficial MSP (matriz de
// riesgos, sistemas a revisar, regiones del examen fisico, etc.)
// para que el frontend genere los checkboxes sin duplicar la
// taxonomia legal en dos lugares.
// ------------------------------------------------------------
async function obtenerCatalogos(req, res) {
  return res.json({ catalogos });
}

// ------------------------------------------------------------
// POST /api/historia-clinica/trabajadores/:trabajadorId/preocupacional
// Registra una evaluacion preocupacional - inicio completa.
// ------------------------------------------------------------
async function registrarPreocupacional(req, res) {
  const { trabajadorId } = req.params;
  const b = req.body;

  try {
    const trabajadorRes = await query(
      `SELECT id, sexo FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    // Bloque F: la matriz de riesgos debe usar solo valores de la
    // taxonomia oficial (o "otros:..." con texto libre).
    const errorRiesgos = validarFactoresRiesgo(b.factoresRiesgoActual);
    if (errorRiesgos) {
      return res.status(400).json({ error: errorRiesgos });
    }

    // Bloque N: si se selecciono una aptitud, debe ser una de las 4
    // categorias oficiales del MSP (la validacion de formato basica
    // -que exista si se envia- ya la hace validarRegistrarHistoriaClinica).

    const imc = calcularImc(b.pesoKg, b.tallaCm);

    // Bloque Q (opcional): si llega firma, se sube a Cloudinary
    // igual que en consentimientos/audiometria.
    let firma = { url: null, publicId: null };
    if (b.firmaBase64) {
      firma = await subirEvidencia(b.firmaBase64, req.usuario.organizacionId, CARPETA_FIRMAS);
    }

    let insertRes;
    try {
    insertRes = await withTransaction(async (client) => {
    const resultado = await client.query(
      `INSERT INTO evaluaciones_ocupacionales (
        organizacion_id, trabajador_id, medico_id, tipo_evaluacion, fecha_atencion, hora_atencion,
        numero_archivo, religion, grupo_sanguineo, lateralidad, orientacion_sexual, identidad_genero,
        discapacidad_tiene, discapacidad_tipo, discapacidad_porcentaje, fecha_ingreso_trabajo,
        puesto_trabajo_ciuo, area_trabajo, actividades_relevantes, antecedentes_ginecobstetricos,
        motivo_consulta,
        antecedentes_clinicos_quirurgicos, antecedentes_ginecologicos_examenes,
        antecedentes_reproductivos_masculinos, habitos_toxicos, estilo_vida,
        antecedentes_laborales_previos, accidentes_trabajo_previos, enfermedades_profesionales_previas,
        antecedentes_familiares,
        factores_riesgo_actual,
        actividades_extra_laborales,
        enfermedad_actual,
        revision_organos_sistemas,
        presion_arterial_sistolica, presion_arterial_diastolica, temperatura_c, frecuencia_cardiaca,
        saturacion_oxigeno, frecuencia_respiratoria, peso_kg, talla_cm, imc, perimetro_abdominal_cm,
        examen_fisico_regional,
        resultados_examenes,
        diagnosticos,
        aptitud_msp, aptitud_observacion, aptitud_limitacion,
        recomendaciones_tratamiento,
        codigo_profesional_salud,
        firma_imagen_url, firma_imagen_public_id,
        norma_aplicada, version_formulario, fecha_vigencia, base_juridica,
        finalidad_tratamiento_codigo
      ) VALUES (
        $1,$2,$3,'preocupacional_inicio',$4,$5,
        $6,$7,$8,$9,$10,$11,
        $12,$13,$14,$15,
        $16,$17,$18,$19,
        $20,
        $21,$22,
        $23,$24,$25,
        $26,$27,$28,
        $29,
        $30,
        $31,
        $32,
        $33,
        $34,$35,$36,$37,
        $38,$39,$40,$41,$42,$43,
        $44,
        $45,
        $46,
        $47,$48,$49,
        $50,
        $51,
        $52,$53,
        $54,$55,$56,$57,
        $58
      ) RETURNING id, tipo_evaluacion, fecha_atencion, aptitud_msp, imc, creado_en`,
      [
        req.usuario.organizacionId, trabajadorId, req.usuario.id, b.fechaAtencion || null, b.horaAtencion || null,
        // CORREGIDO en Auditoria N.10 (hallazgo CRITICO C10-01, P0):
        // orientacionSexual/identidadGenero ya NO se toman del body,
        // sin importar lo que envie el frontend. La Sentencia
        // 59-19-IN/24 de la Corte Constitucional (11/07/2024) declaro
        // inconstitucional -con efectos diferidos- el Acuerdo
        // 0341-2019 y ordeno expresamente NO solicitar esta
        // informacion mientras el MSP no emita normativa sustitutiva.
        // Las columnas se conservan en el esquema (datos historicos
        // previos a esta correccion quedan bloqueados/restringidos,
        // no borrados, hasta definir politica legal de conservacion),
        // pero ningun flujo nuevo puede volver a escribir en ellas.
        b.numeroArchivo || null, b.religion || null, b.grupoSanguineo || null, b.lateralidad || null, null, null,
        !!b.discapacidadTiene, b.discapacidadTipo || null, b.discapacidadPorcentaje || null, b.fechaIngresoTrabajo || null,
        b.puestoTrabajoCiuo || null, b.areaTrabajo || null, b.actividadesRelevantes || null, b.antecedentesGinecobstetricos ? JSON.stringify(b.antecedentesGinecobstetricos) : null,
        b.motivoConsulta || 'Evaluación médica ocupacional para el ingreso al puesto de trabajo.',
        b.antecedentesClinicosQuirurgicos || null, b.antecedentesGinecologicosExamenes ? JSON.stringify(b.antecedentesGinecologicosExamenes) : null,
        b.antecedentesReproductivosMasculinos ? JSON.stringify(b.antecedentesReproductivosMasculinos) : null,
        b.habitosToxicos ? JSON.stringify(b.habitosToxicos) : null,
        b.estiloVida ? JSON.stringify(b.estiloVida) : null,
        JSON.stringify(b.antecedentesLaboralesPrevios || []),
        b.accidentesTrabajoPrevios ? JSON.stringify(b.accidentesTrabajoPrevios) : null,
        b.enfermedadesProfesionalesPrevias ? JSON.stringify(b.enfermedadesProfesionalesPrevias) : null,
        b.antecedentesFamiliares ? JSON.stringify(b.antecedentesFamiliares) : null,
        b.factoresRiesgoActual ? JSON.stringify(b.factoresRiesgoActual) : null,
        b.actividadesExtraLaborales || null,
        b.enfermedadActual || null,
        b.revisionOrganosSistemas ? JSON.stringify(b.revisionOrganosSistemas) : null,
        b.presionArterialSistolica || null, b.presionArterialDiastolica || null, b.temperaturaC || null, b.frecuenciaCardiaca || null,
        b.saturacionOxigeno || null, b.frecuenciaRespiratoria || null, b.pesoKg || null, b.tallaCm || null, imc, b.perimetroAbdominalCm || null,
        b.examenFisicoRegional ? JSON.stringify(b.examenFisicoRegional) : null,
        JSON.stringify(b.resultadosExamenes || []),
        JSON.stringify(b.diagnosticos || []),
        b.aptitudMsp || null, b.aptitudObservacion || null, b.aptitudLimitacion || null,
        b.recomendacionesTratamiento || null,
        b.codigoProfesionalSalud || null,
        firma.url, firma.publicId,
        catalogos.NORMA_APLICADA_ACTUAL, catalogos.VERSION_FORMULARIO_ACTUAL, new Date().toISOString().slice(0, 10), catalogos.BASE_JURIDICA_ACTUAL,
        'vigilancia_salud_ocupacional',
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'registrar_evaluacion_preocupacional',
      entidad: 'evaluacion_ocupacional',
      entidadId: resultado.rows[0].id,
      detalle: { trabajadorId, aptitudMsp: b.aptitudMsp || null },
      req,
      client,
    });

    return resultado;
  });
    } catch (errTransaccion) {
      // CORREGIDO en Auditoria N.09 (G-N09-06): compensar
      // (borrar) la firma recien subida si la transaccion de BD falla.
      if (firma.publicId) {
        await borrarEvidencia(firma.publicId, 'imagen').catch((errBorrado) =>
          console.error(`ORFANO EN CLOUDINARY: no se pudo compensar (borrar) ${firma.publicId}.`, errBorrado)
        );
      }
      throw errTransaccion;
    }

    return res.status(201).json({ evaluacion: insertRes.rows[0] });
  } catch (err) {
    console.error('Error en registrarPreocupacional:', err);
    return res.status(500).json({ error: 'Error interno al registrar la evaluacion preocupacional.' });
  }
}

// ------------------------------------------------------------
// POST /api/historia-clinica/trabajadores/:trabajadorId/retiro
// Registra una evaluacion de retiro (HCU 080). Formulario mas
// simple que preocupacional: sin motivo de consulta, antecedentes
// laborales/familiares, matriz de riesgo detallada, revision de
// sistemas ni aptitud medica (ver nota completa en
// migration_015_evaluacion_retiro.sql).
// ------------------------------------------------------------
async function registrarRetiro(req, res) {
  const { trabajadorId } = req.params;
  const b = req.body;

  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    const imc = calcularImc(b.pesoKg, b.tallaCm);

    // Tiempo de permanencia: si no lo mandan explicito, se calcula
    // a partir de fechaInicioLabores/fechaSalida cuando ambas existen.
    let tiempoPermanenciaMeses = b.tiempoPermanenciaMeses || null;
    if (!tiempoPermanenciaMeses && b.fechaInicioLabores && b.fechaSalida) {
      const inicio = new Date(b.fechaInicioLabores);
      const salida = new Date(b.fechaSalida);
      tiempoPermanenciaMeses = Math.max(0, Math.round((salida - inicio) / (30.44 * 24 * 3600 * 1000)));
    }

    let firma = { url: null, publicId: null };
    if (b.firmaBase64) {
      firma = await subirEvidencia(b.firmaBase64, req.usuario.organizacionId, CARPETA_FIRMAS);
    }

    let insertRes;
    try {
    insertRes = await withTransaction(async (client) => {
    const resultado = await client.query(
      `INSERT INTO evaluaciones_ocupacionales (
        organizacion_id, trabajador_id, medico_id, tipo_evaluacion, fecha_atencion, hora_atencion,
        fecha_inicio_labores, fecha_salida, tiempo_permanencia_meses,
        puesto_trabajo_ciuo, actividades_relevantes, factores_riesgo_texto_libre,
        motivo_consulta,
        antecedentes_clinicos_quirurgicos,
        accidentes_trabajo_previos, enfermedades_profesionales_previas,
        presion_arterial_sistolica, presion_arterial_diastolica, temperatura_c, frecuencia_cardiaca,
        saturacion_oxigeno, frecuencia_respiratoria, peso_kg, talla_cm, imc, perimetro_abdominal_cm,
        examen_fisico_regional,
        resultados_examenes,
        diagnosticos,
        retiro_se_realizo_evaluacion, retiro_observaciones,
        recomendaciones_tratamiento,
        codigo_profesional_salud,
        firma_imagen_url, firma_imagen_public_id
      ) VALUES (
        $1,$2,$3,'retiro',$4,$5,
        $6,$7,$8,
        $9,$10,$11,
        $12,
        $13,
        $14,$15,
        $16,$17,$18,$19,
        $20,$21,$22,$23,$24,$25,
        $26,
        $27,
        $28,
        $29,$30,
        $31,
        $32,
        $33,$34
      ) RETURNING id, tipo_evaluacion, fecha_atencion, imc, creado_en`,
      [
        req.usuario.organizacionId, trabajadorId, req.usuario.id, b.fechaAtencion || null, b.horaAtencion || null,
        b.fechaInicioLabores || null, b.fechaSalida || null, tiempoPermanenciaMeses,
        b.puestoTrabajoCiuo || null, b.actividadesDesempenadas || null, b.factoresRiesgoTextoLibre || null,
        'Evaluación médica de retiro — finalización de la relación laboral.',
        b.antecedentesClinicosQuirurgicos || null,
        b.accidentesTrabajoPrevios ? JSON.stringify(b.accidentesTrabajoPrevios) : null,
        b.enfermedadesProfesionalesPrevias ? JSON.stringify(b.enfermedadesProfesionalesPrevias) : null,
        b.presionArterialSistolica || null, b.presionArterialDiastolica || null, b.temperaturaC || null, b.frecuenciaCardiaca || null,
        b.saturacionOxigeno || null, b.frecuenciaRespiratoria || null, b.pesoKg || null, b.tallaCm || null, imc, b.perimetroAbdominalCm || null,
        b.examenFisicoRegional ? JSON.stringify(b.examenFisicoRegional) : null,
        JSON.stringify(b.resultadosExamenes || []),
        JSON.stringify(b.diagnosticos || []),
        b.retiroSeRealizoEvaluacion === undefined ? null : !!b.retiroSeRealizoEvaluacion,
        b.retiroObservaciones || null,
        b.recomendacionesTratamiento || null,
        b.codigoProfesionalSalud || null,
        firma.url, firma.publicId,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'registrar_evaluacion_retiro',
      entidad: 'evaluacion_ocupacional',
      entidadId: resultado.rows[0].id,
      detalle: { trabajadorId },
      req,
      client,
    });

    return resultado;
  });
    } catch (errTransaccion) {
      // CORREGIDO en Auditoria N.09 (G-N09-06): compensar
      // (borrar) la firma recien subida si la transaccion de BD falla.
      if (firma.publicId) {
        await borrarEvidencia(firma.publicId, 'imagen').catch((errBorrado) =>
          console.error(`ORFANO EN CLOUDINARY: no se pudo compensar (borrar) ${firma.publicId}.`, errBorrado)
        );
      }
      throw errTransaccion;
    }

    return res.status(201).json({ evaluacion: insertRes.rows[0] });
  } catch (err) {
    console.error('Error en registrarRetiro:', err);
    return res.status(500).json({ error: 'Error interno al registrar la evaluacion de retiro.' });
  }
}

// ------------------------------------------------------------
// POST /api/historia-clinica/trabajadores/:trabajadorId/periodica
// Registra una evaluacion periodica (HCU 078). Comparte con
// preocupacional: habitos toxicos, estilo de vida, antecedentes
// familiares, matriz de riesgo, revision de sistemas y aptitud
// medica (a diferencia de retiro, que no tiene aptitud). NO tiene
// antecedentes laborales anteriores, datos demograficos extendidos
// ni actividades extra laborales. Agrega "incidentes" y "tiempo en
// el puesto actual" (ver migration_016).
// ------------------------------------------------------------
async function registrarPeriodica(req, res) {
  const { trabajadorId } = req.params;
  const b = req.body;

  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    const errorRiesgos = validarFactoresRiesgo(b.factoresRiesgoActual);
    if (errorRiesgos) {
      return res.status(400).json({ error: errorRiesgos });
    }

    const imc = calcularImc(b.pesoKg, b.tallaCm);

    let firma = { url: null, publicId: null };
    if (b.firmaBase64) {
      firma = await subirEvidencia(b.firmaBase64, req.usuario.organizacionId, CARPETA_FIRMAS);
    }

    let insertRes;
    try {
    insertRes = await withTransaction(async (client) => {
    const resultado = await client.query(
      `INSERT INTO evaluaciones_ocupacionales (
        organizacion_id, trabajador_id, medico_id, tipo_evaluacion, fecha_atencion, hora_atencion,
        puesto_trabajo_ciuo,
        motivo_consulta,
        antecedentes_clinicos_quirurgicos,
        habitos_toxicos, estilo_vida, incidentes,
        accidentes_trabajo_previos, enfermedades_profesionales_previas,
        antecedentes_familiares,
        factores_riesgo_actual, tiempo_puesto_actual_meses,
        enfermedad_actual,
        revision_organos_sistemas,
        presion_arterial_sistolica, presion_arterial_diastolica, temperatura_c, frecuencia_cardiaca,
        saturacion_oxigeno, frecuencia_respiratoria, peso_kg, talla_cm, imc, perimetro_abdominal_cm,
        examen_fisico_regional,
        resultados_examenes,
        diagnosticos,
        aptitud_msp, aptitud_observacion, aptitud_limitacion,
        recomendaciones_tratamiento,
        codigo_profesional_salud,
        firma_imagen_url, firma_imagen_public_id
      ) VALUES (
        $1,$2,$3,'periodica',$4,$5,
        $6,
        $7,
        $8,
        $9,$10,$11,
        $12,$13,
        $14,
        $15,$16,
        $17,
        $18,
        $19,$20,$21,$22,
        $23,$24,$25,$26,$27,$28,
        $29,
        $30,
        $31,
        $32,$33,$34,
        $35,
        $36,
        $37,$38
      ) RETURNING id, tipo_evaluacion, fecha_atencion, aptitud_msp, imc, creado_en`,
      [
        req.usuario.organizacionId, trabajadorId, req.usuario.id, b.fechaAtencion || null, b.horaAtencion || null,
        b.puestoTrabajoCiuo || null,
        'Evaluación médica periódica en el puesto de trabajo.',
        b.antecedentesClinicosQuirurgicos || null,
        b.habitosToxicos ? JSON.stringify(b.habitosToxicos) : null,
        b.estiloVida ? JSON.stringify(b.estiloVida) : null,
        b.incidentes || null,
        b.accidentesTrabajoPrevios ? JSON.stringify(b.accidentesTrabajoPrevios) : null,
        b.enfermedadesProfesionalesPrevias ? JSON.stringify(b.enfermedadesProfesionalesPrevias) : null,
        b.antecedentesFamiliares ? JSON.stringify(b.antecedentesFamiliares) : null,
        b.factoresRiesgoActual ? JSON.stringify(b.factoresRiesgoActual) : null,
        b.tiempoPuestoActualMeses || null,
        b.enfermedadActual || null,
        b.revisionOrganosSistemas ? JSON.stringify(b.revisionOrganosSistemas) : null,
        b.presionArterialSistolica || null, b.presionArterialDiastolica || null, b.temperaturaC || null, b.frecuenciaCardiaca || null,
        b.saturacionOxigeno || null, b.frecuenciaRespiratoria || null, b.pesoKg || null, b.tallaCm || null, imc, b.perimetroAbdominalCm || null,
        b.examenFisicoRegional ? JSON.stringify(b.examenFisicoRegional) : null,
        JSON.stringify(b.resultadosExamenes || []),
        JSON.stringify(b.diagnosticos || []),
        b.aptitudMsp || null, b.aptitudObservacion || null, b.aptitudLimitacion || null,
        b.recomendacionesTratamiento || null,
        b.codigoProfesionalSalud || null,
        firma.url, firma.publicId,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'registrar_evaluacion_periodica',
      entidad: 'evaluacion_ocupacional',
      entidadId: resultado.rows[0].id,
      detalle: { trabajadorId, aptitudMsp: b.aptitudMsp || null },
      req,
      client,
    });

    return resultado;
  });
    } catch (errTransaccion) {
      // CORREGIDO en Auditoria N.09 (G-N09-06): compensar
      // (borrar) la firma recien subida si la transaccion de BD falla.
      if (firma.publicId) {
        await borrarEvidencia(firma.publicId, 'imagen').catch((errBorrado) =>
          console.error(`ORFANO EN CLOUDINARY: no se pudo compensar (borrar) ${firma.publicId}.`, errBorrado)
        );
      }
      throw errTransaccion;
    }

    return res.status(201).json({ evaluacion: insertRes.rows[0] });
  } catch (err) {
    console.error('Error en registrarPeriodica:', err);
    return res.status(500).json({ error: 'Error interno al registrar la evaluacion periodica.' });
  }
}

// ------------------------------------------------------------
// POST /api/historia-clinica/trabajadores/:trabajadorId/reintegro
// Registra una evaluacion de reintegro (HCU 079): la mas simple de
// las 4 -sin habitos toxicos, antecedentes familiares, matriz de
// riesgo ni revision de sistemas-. Datos propios de la ausencia +
// enfermedad actual + vitales + examen regional + examenes +
// diagnostico + aptitud (con reubicacion) + recomendaciones.
// ------------------------------------------------------------
async function registrarReintegro(req, res) {
  const { trabajadorId } = req.params;
  const b = req.body;

  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    const imc = calcularImc(b.pesoKg, b.tallaCm);

    let totalDiasAusencia = b.totalDiasAusencia || null;
    if (!totalDiasAusencia && b.fechaUltimoDiaLaboral && b.fechaReingreso) {
      const ultimo = new Date(b.fechaUltimoDiaLaboral);
      const reingreso = new Date(b.fechaReingreso);
      totalDiasAusencia = Math.max(0, Math.round((reingreso - ultimo) / (24 * 3600 * 1000)));
    }

    let firma = { url: null, publicId: null };
    if (b.firmaBase64) {
      firma = await subirEvidencia(b.firmaBase64, req.usuario.organizacionId, CARPETA_FIRMAS);
    }

    let insertRes;
    try {
    insertRes = await withTransaction(async (client) => {
    const resultado = await client.query(
      `INSERT INTO evaluaciones_ocupacionales (
        organizacion_id, trabajador_id, medico_id, tipo_evaluacion, fecha_atencion, hora_atencion,
        fecha_ultimo_dia_laboral, fecha_reingreso, total_dias_ausencia, causa_salida,
        motivo_consulta,
        enfermedad_actual,
        presion_arterial_sistolica, presion_arterial_diastolica, temperatura_c, frecuencia_cardiaca,
        saturacion_oxigeno, frecuencia_respiratoria, peso_kg, talla_cm, imc, perimetro_abdominal_cm,
        examen_fisico_regional,
        resultados_examenes,
        diagnosticos,
        aptitud_msp, aptitud_observacion, aptitud_limitacion, aptitud_reubicacion,
        recomendaciones_tratamiento,
        codigo_profesional_salud,
        firma_imagen_url, firma_imagen_public_id
      ) VALUES (
        $1,$2,$3,'reintegro',$4,$5,
        $6,$7,$8,$9,
        $10,
        $11,
        $12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,
        $22,
        $23,
        $24,
        $25,$26,$27,$28,
        $29,
        $30,
        $31,$32
      ) RETURNING id, tipo_evaluacion, fecha_atencion, aptitud_msp, imc, creado_en`,
      [
        req.usuario.organizacionId, trabajadorId, req.usuario.id, b.fechaAtencion || null, b.horaAtencion || null,
        b.fechaUltimoDiaLaboral || null, b.fechaReingreso || null, totalDiasAusencia, b.causaSalida || null,
        'Evaluación médica ocupacional para el reingreso al puesto de trabajo.',
        b.enfermedadActual || null,
        b.presionArterialSistolica || null, b.presionArterialDiastolica || null, b.temperaturaC || null, b.frecuenciaCardiaca || null,
        b.saturacionOxigeno || null, b.frecuenciaRespiratoria || null, b.pesoKg || null, b.tallaCm || null, imc, b.perimetroAbdominalCm || null,
        b.examenFisicoRegional ? JSON.stringify(b.examenFisicoRegional) : null,
        JSON.stringify(b.resultadosExamenes || []),
        JSON.stringify(b.diagnosticos || []),
        b.aptitudMsp || null, b.aptitudObservacion || null, b.aptitudLimitacion || null, b.aptitudReubicacion || null,
        b.recomendacionesTratamiento || null,
        b.codigoProfesionalSalud || null,
        firma.url, firma.publicId,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'registrar_evaluacion_reintegro',
      entidad: 'evaluacion_ocupacional',
      entidadId: resultado.rows[0].id,
      detalle: { trabajadorId, aptitudMsp: b.aptitudMsp || null },
      req,
      client,
    });

    return resultado;
  });
    } catch (errTransaccion) {
      // CORREGIDO en Auditoria N.09 (G-N09-06): compensar
      // (borrar) la firma recien subida si la transaccion de BD falla.
      if (firma.publicId) {
        await borrarEvidencia(firma.publicId, 'imagen').catch((errBorrado) =>
          console.error(`ORFANO EN CLOUDINARY: no se pudo compensar (borrar) ${firma.publicId}.`, errBorrado)
        );
      }
      throw errTransaccion;
    }

    return res.status(201).json({ evaluacion: insertRes.rows[0] });
  } catch (err) {
    console.error('Error en registrarReintegro:', err);
    return res.status(500).json({ error: 'Error interno al registrar la evaluacion de reintegro.' });
  }
}

// ------------------------------------------------------------
// GET /api/historia-clinica/trabajadores/:trabajadorId
// Lista el historial de evaluaciones ocupacionales de un trabajador
// (de cualquier tipo; por ahora solo existe preocupacional_inicio).
// ------------------------------------------------------------
async function listarPorTrabajador(req, res) {
  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    const resultado = await query(
      `SELECT e.id, e.tipo_evaluacion, e.fecha_atencion, e.aptitud_msp, e.imc, e.retiro_se_realizo_evaluacion,
              e.creado_en, u.nombre_completo AS medico_nombre
       FROM evaluaciones_ocupacionales e
       JOIN usuarios u ON u.id = e.medico_id
       WHERE e.trabajador_id = $1 AND e.organizacion_id = $2
       ORDER BY e.fecha_atencion DESC, e.creado_en DESC`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );

    // CORREGIDO tras Auditoria SISSO N.06 (punto 13.6 / hallazgo
    // G10): hasta ahora esta tabla de auditoria solo registraba
    // ESCRITURAS. La consulta de historia clinica es exactamente
    // el tipo de acceso que el punto 13.6 pide poder rastrear:
    // "saber quien accedio a un expediente, cuando y desde que
    // contexto".
    //
    // CORREGIDO en Auditoria N.10 (hallazgo GRAVE G10-03, P1): esta
    // lectura (listado de historia clinica de un trabajador) es tan
    // sensible como el detalle -- se marca lecturaSensible:true para
    // quedar bajo el mismo estandar de auditoria durable.
    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'lectura_historia_clinica_listado',
      entidad: 'evaluaciones_ocupacionales',
      detalle: { trabajadorId: req.params.trabajadorId, resultados: resultado.rows.length },
      req,
      lecturaSensible: true,
    });

    return res.json({ evaluaciones: resultado.rows });
  } catch (err) {
    console.error('Error en listarPorTrabajador (historia clinica):', err);
    return res.status(500).json({ error: 'Error interno al listar las evaluaciones.' });
  }
}

// ------------------------------------------------------------
// GET /api/historia-clinica/:id
// Detalle completo de una evaluacion (todos los bloques).
// ------------------------------------------------------------
async function obtenerEvaluacion(req, res) {
  try {
    const resultado = await query(
      `SELECT e.*, u.nombre_completo AS medico_nombre,
              t.nombre_completo AS trabajador_nombre, t.documento AS trabajador_documento,
              t.sexo AS trabajador_sexo, t.fecha_nacimiento AS trabajador_fecha_nacimiento,
              t.puesto AS trabajador_puesto, t.area AS trabajador_area
       FROM evaluaciones_ocupacionales e
       JOIN usuarios u ON u.id = e.medico_id
       JOIN trabajadores t ON t.id = e.trabajador_id
       WHERE e.id = $1 AND e.organizacion_id = $2`,
      [req.params.id, req.usuario.organizacionId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Evaluacion no encontrada.' });
    }

    // CORREGIDO en Auditoria N.10 (hallazgo CRITICO C10-01, P0), y
    // en Auditoria N.11 (C11-03) migrado a la politica centralizada
    // de minimizacion: esta consulta usa `e.*`, que incluye
    // orientacion_sexual e identidad_genero -- datos que, tras la
    // Sentencia 59-19-IN/24, SISSO ya no debe exponer en el flujo
    // normal de la aplicacion. Se retiran de la respuesta para
    // CUALQUIER rol, incluido medico: el bloqueo es de lectura de
    // aplicacion, no una minimizacion por rol. Ver
    // src/utils/politicaMinimizacion.js para la lista completa de
    // campos bloqueados de esta tabla (incluye tambien los bloques
    // clinicos completos para roles no medicos).
    const evaluacion = aplicarBloqueoUniversal(resultado.rows[0], 'evaluaciones_ocupacionales', req.usuario.rol);

    // CORREGIDO tras Auditoria SISSO N.06 (punto 13.6 / hallazgo
    // G10): esta es la lectura mas sensible del sistema (detalle
    // clinico completo, incluye datos del trabajador). Se audita
    // igual que una escritura.
    //
    // CORREGIDO en Auditoria N.09 (G-N09-07): se marca
    // lecturaSensible:true para que, si el INSERT normal en
    // `auditoria` falla, no se pierda la evidencia de acceso -- cae
    // a la cola durable auditoria_pendiente, y solo si ESA tambien
    // falla se corta la respuesta (fail-closed).
    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'lectura_historia_clinica_detalle',
      entidad: 'evaluaciones_ocupacionales',
      entidadId: req.params.id,
      req,
      lecturaSensible: true,
    });

    return res.json({ evaluacion });
  } catch (err) {
    console.error('Error en obtenerEvaluacion (historia clinica):', err);
    return res.status(500).json({ error: 'Error interno al obtener la evaluacion.' });
  }
}

// ------------------------------------------------------------
// GET /api/historia-clinica/:id/pdf
// Descarga el PDF de una evaluacion ya guardada.
// ------------------------------------------------------------
async function descargarPdf(req, res) {
  try {
    const resultado = await query(
      `SELECT e.*, u.nombre_completo AS medico_nombre,
              t.nombre_completo AS trabajador_nombre, t.documento AS trabajador_documento,
              o.nombre AS organizacion_nombre
       FROM evaluaciones_ocupacionales e
       JOIN usuarios u ON u.id = e.medico_id
       JOIN trabajadores t ON t.id = e.trabajador_id
       JOIN organizaciones o ON o.id = e.organizacion_id
       WHERE e.id = $1 AND e.organizacion_id = $2`,
      [req.params.id, req.usuario.organizacionId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Evaluacion no encontrada.' });
    }
    // CORREGIDO en Auditoria N.10 (C10-01) y N.11 (C11-03): ver
    // comentario en obtenerEvaluacion(). Migrado a la politica
    // centralizada.
    const e = aplicarBloqueoUniversal(resultado.rows[0], 'evaluaciones_ocupacionales', req.usuario.rol);

    // CORREGIDO en Auditoria N.10 (hallazgo GRAVE G10-04, P1): un PDF
    // clinico no es menos sensible que el JSON de detalle -- de
    // hecho es mas riesgoso porque se puede descargar, imprimir o
    // reenviar. Antes no habia ningun registro de auditoria al
    // generar este documento. Se registra ANTES de generar el PDF,
    // con lecturaSensible:true (fail-closed: si ni el registro
    // normal ni la cola durable funcionan, no se genera el
    // documento).
    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'descarga_pdf_historia_clinica',
      entidad: 'evaluaciones_ocupacionales',
      entidadId: req.params.id,
      detalle: { tipoEvaluacion: e.tipo_evaluacion },
      req,
      lecturaSensible: true,
    });
    // CORREGIDO (hallazgo G12): e.firma_imagen_url ya no es
    // directamente accesible (recurso privado en Cloudinary, ver
    // cloudinaryService.js); generamos una URL firmada de corta
    // duracion justo antes de usarla.
    if (e.firma_imagen_public_id) {
      try {
        const urlFirmada = generarUrlFirmada(e.firma_imagen_public_id, 'imagen');
        e.firma_imagen_url_buffer = await descargarImagen(urlFirmada);
      } catch (err) {
        console.error('No se pudo descargar la imagen de la firma para el PDF:', err.message);
      }
    }

    const doc = e.tipo_evaluacion === 'retiro'
      ? generarPdfRetiro(e, e.organizacion_nombre)
      : e.tipo_evaluacion === 'periodica'
      ? generarPdfPeriodica(e, e.organizacion_nombre)
      : e.tipo_evaluacion === 'reintegro'
      ? generarPdfReintegro(e, e.organizacion_nombre)
      : generarPdfPreocupacional(e, e.organizacion_nombre);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="historia-clinica-${e.tipo_evaluacion}-${e.trabajador_documento}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error('Error en descargarPdf (historia clinica):', err);
    return res.status(500).json({ error: 'Error interno al generar el PDF.' });
  }
}

// ------------------------------------------------------------
// GET /api/historia-clinica/:id/certificado
// Genera el Certificado de Salud en el Trabajo (HCU 081) a partir
// de una evaluacion YA REGISTRADA (cualquiera de los 4 tipos). No
// es una evaluacion nueva, es un documento derivado (ver nota
// completa en pdfCertificado.js).
// ------------------------------------------------------------
async function descargarCertificado(req, res) {
  try {
    const resultado = await query(
      `SELECT e.*, u.nombre_completo AS medico_nombre,
              t.nombre_completo AS trabajador_nombre, t.documento AS trabajador_documento,
              o.nombre AS organizacion_nombre
       FROM evaluaciones_ocupacionales e
       JOIN usuarios u ON u.id = e.medico_id
       JOIN trabajadores t ON t.id = e.trabajador_id
       JOIN organizaciones o ON o.id = e.organizacion_id
       WHERE e.id = $1 AND e.organizacion_id = $2`,
      [req.params.id, req.usuario.organizacionId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Evaluacion no encontrada.' });
    }
    // CORREGIDO en Auditoria N.10 (C10-01) y N.11 (C11-03): migrado
    // a la politica centralizada.
    const e = aplicarBloqueoUniversal(resultado.rows[0], 'evaluaciones_ocupacionales', req.usuario.rol);

    // CORREGIDO en Auditoria N.10 (hallazgo GRAVE G10-04, P1): ver
    // comentario equivalente en descargarPdf(). El certificado
    // clinico se audita como lectura sensible ANTES de generarse.
    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'descarga_certificado_salud_trabajo',
      entidad: 'evaluaciones_ocupacionales',
      entidadId: req.params.id,
      req,
      lecturaSensible: true,
    });

    // CORREGIDO (hallazgo G12): ver nota equivalente en descargarPdf().
    if (e.firma_imagen_public_id) {
      try {
        const urlFirmada = generarUrlFirmada(e.firma_imagen_public_id, 'imagen');
        e.firma_imagen_url_buffer = await descargarImagen(urlFirmada);
      } catch (err) {
        console.error('No se pudo descargar la imagen de la firma para el certificado:', err.message);
      }
    }

    const doc = generarPdfCertificado(e, e.organizacion_nombre);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="certificado-salud-trabajo-${e.trabajador_documento}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error('Error en descargarCertificado:', err);
    return res.status(500).json({ error: 'Error interno al generar el certificado.' });
  }
}

module.exports = {
  obtenerCatalogos, registrarPreocupacional, registrarRetiro, registrarPeriodica, registrarReintegro,
  listarPorTrabajador, obtenerEvaluacion, descargarPdf, descargarCertificado,
};
