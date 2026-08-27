// ============================================================
// Controlador de ergonomia RULA.
//
// Mismo patron que ergonomiaController.js (REBA): toda consulta
// filtra por organizacion_id, el calculo real vive en
// src/ergonomia/rula.js, este controlador solo valida pertenencia
// del trabajador/sesion, llama al calculo, sube evidencia si
// viene, guarda y audita.
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { calcularRula } = require('../ergonomia/rula');
const { subirEvidencia, borrarEvidencia, generarUrlFirmada } = require('../servicios/cloudinaryService');

// ------------------------------------------------------------
// POST /api/ergonomia/rula/sesiones
// ------------------------------------------------------------
async function crearSesion(req, res) {
  const { trabajadorId, puestoEvaluado, tareaObservada, fechaEvaluacion, notasGenerales } = req.body;

  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2 AND activo = true`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    const resultado = await query(
      `INSERT INTO sesiones_evaluacion_rula
        (organizacion_id, trabajador_id, evaluador_id, puesto_evaluado, tarea_observada, fecha_evaluacion, notas_generales)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), $7)
       RETURNING id, trabajador_id, evaluador_id, puesto_evaluado, tarea_observada, fecha_evaluacion, notas_generales, creado_en`,
      [
        req.usuario.organizacionId,
        trabajadorId,
        req.usuario.id,
        puestoEvaluado,
        tareaObservada || null,
        fechaEvaluacion || null,
        notasGenerales || null,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'crear_sesion_evaluacion_rula',
      entidad: 'sesion_evaluacion_rula',
      entidadId: resultado.rows[0].id,
      detalle: { trabajadorId, puestoEvaluado },
      req,
    });

    return res.status(201).json({ sesion: resultado.rows[0] });
  } catch (err) {
    console.error('Error en crearSesion (RULA):', err);
    return res.status(500).json({ error: 'Error interno al crear la sesion de evaluacion RULA.' });
  }
}

// ------------------------------------------------------------
// GET /api/ergonomia/rula/sesiones/trabajador/:trabajadorId
// ------------------------------------------------------------
async function listarSesionesPorTrabajador(req, res) {
  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    const sesionesRes = await query(
      `SELECT s.id, s.puesto_evaluado, s.tarea_observada, s.fecha_evaluacion, s.notas_generales,
              u.nombre_completo AS evaluador_nombre,
              (
                SELECT MAX(e.puntuacion_c)
                FROM evaluaciones_rula e
                WHERE e.sesion_id = s.id
              ) AS puntuacion_final_maxima
       FROM sesiones_evaluacion_rula s
       JOIN usuarios u ON u.id = s.evaluador_id
       WHERE s.trabajador_id = $1 AND s.organizacion_id = $2
       ORDER BY s.fecha_evaluacion DESC, s.creado_en DESC`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'listar_sesiones_evaluacion_rula',
      entidad: 'trabajador',
      entidadId: req.params.trabajadorId,
      req,
    });

    return res.json({ sesiones: sesionesRes.rows });
  } catch (err) {
    console.error('Error en listarSesionesPorTrabajador (RULA):', err);
    return res.status(500).json({ error: 'Error interno al listar las sesiones de evaluacion RULA.' });
  }
}

// ------------------------------------------------------------
// GET /api/ergonomia/rula/sesiones/:sesionId
// ------------------------------------------------------------
async function obtenerSesion(req, res) {
  try {
    const sesionRes = await query(
      `SELECT s.*, t.nombre_completo AS trabajador_nombre, u.nombre_completo AS evaluador_nombre
       FROM sesiones_evaluacion_rula s
       JOIN trabajadores t ON t.id = s.trabajador_id
       JOIN usuarios u ON u.id = s.evaluador_id
       WHERE s.id = $1 AND s.organizacion_id = $2`,
      [req.params.sesionId, req.usuario.organizacionId]
    );
    if (sesionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Sesion de evaluacion RULA no encontrada.' });
    }

    const evaluacionesRes = await query(
      `SELECT id, nombre_postura, orden, puntuacion_a_derecha, puntuacion_a_izquierda,
              puntuacion_b, puntuacion_c, nivel_riesgo, accion_requerida,
              lado_evaluado, evidencia_url, evidencia_tipo, creado_en
       FROM evaluaciones_rula
       WHERE sesion_id = $1
       ORDER BY orden ASC, creado_en ASC`,
      [req.params.sesionId]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'ver_sesion_evaluacion_rula',
      entidad: 'sesion_evaluacion_rula',
      entidadId: req.params.sesionId,
      req,
    });

    return res.json({ sesion: sesionRes.rows[0], evaluaciones: evaluacionesRes.rows });
  } catch (err) {
    console.error('Error en obtenerSesion (RULA):', err);
    return res.status(500).json({ error: 'Error interno al obtener la sesion de evaluacion RULA.' });
  }
}

// ------------------------------------------------------------
// POST /api/ergonomia/rula/sesiones/:sesionId/evaluaciones
// ------------------------------------------------------------
async function crearEvaluacionRula(req, res) {
  const { sesionId } = req.params;
  const input = req.body;

  try {
    const sesionRes = await query(
      `SELECT id FROM sesiones_evaluacion_rula WHERE id = $1 AND organizacion_id = $2`,
      [sesionId, req.usuario.organizacionId]
    );
    if (sesionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Sesion de evaluacion RULA no encontrada en su organizacion.' });
    }

    // Mapeo de input (camelCase) a los nombres que espera el
    // modulo de calculo (snake_case, igual que columnas SQL).
    const inputCalculo = {
      brazo_derecho: input.brazoDerecho,
      brazo_derecho_hombro_elevado: !!input.brazoDerechoHombroElevado,
      brazo_derecho_abducido: !!input.brazoDerechoAbducido,
      brazo_derecho_apoyado: !!input.brazoDerechoApoyado,
      antebrazo_derecho: input.antebrazoDerecho,
      antebrazo_derecho_cruza_linea_media: !!input.antebrazoDerechoCruzaLineaMedia,
      muneca_derecha: input.munecaDerecha,
      muneca_derecha_desviacion_radial_cubital: !!input.munecaDerechaDesviacionRadialCubital,
      muneca_derecha_rotacion: input.munecaDerechaRotacion,

      brazo_izquierdo: input.brazoIzquierdo,
      brazo_izquierdo_hombro_elevado: !!input.brazoIzquierdoHombroElevado,
      brazo_izquierdo_abducido: !!input.brazoIzquierdoAbducido,
      brazo_izquierdo_apoyado: !!input.brazoIzquierdoApoyado,
      antebrazo_izquierdo: input.antebrazoIzquierdo,
      antebrazo_izquierdo_cruza_linea_media: !!input.antebrazoIzquierdoCruzaLineaMedia,
      muneca_izquierda: input.munecaIzquierda,
      muneca_izquierda_desviacion_radial_cubital: !!input.munecaIzquierdaDesviacionRadialCubital,
      muneca_izquierda_rotacion: input.munecaIzquierdaRotacion,

      grupo_a_musculo_estatico_o_repetido: !!input.grupoAMusculoEstaticoORepetido,
      grupo_a_fuerza_carga: input.grupoAFuerzaCarga,

      cuello: input.cuello,
      cuello_torsion: !!input.cuelloTorsion,
      cuello_inclinacion_lateral: !!input.cuelloInclinacionLateral,
      tronco: input.tronco,
      tronco_torsion: !!input.troncoTorsion,
      tronco_inclinacion_lateral: !!input.troncoInclinacionLateral,
      piernas_bien_apoyadas: input.piernasBienApoyadas !== false, // default true

      grupo_b_musculo_estatico_o_repetido: !!input.grupoBMusculoEstaticoORepetido,
      grupo_b_fuerza_carga: input.grupoBFuerzaCarga,
    };

    const resultado = calcularRula(inputCalculo);

    let evidencia = null;
    if (input.evidenciaBase64) {
      evidencia = await subirEvidencia(input.evidenciaBase64, req.usuario.organizacionId);
    }

    // CORREGIDO en Auditoria N.09 (G-N09-06): si el INSERT falla
    // despues de subir evidencia, se compensa borrandola.
    let insertRes;
    try {
      insertRes = await query(
      `INSERT INTO evaluaciones_rula (
          organizacion_id, sesion_id, nombre_postura, orden,
          brazo_derecho, brazo_derecho_hombro_elevado, brazo_derecho_abducido, brazo_derecho_apoyado,
          antebrazo_derecho, antebrazo_derecho_cruza_linea_media,
          muneca_derecha, muneca_derecha_desviacion_radial_cubital, muneca_derecha_rotacion,
          brazo_izquierdo, brazo_izquierdo_hombro_elevado, brazo_izquierdo_abducido, brazo_izquierdo_apoyado,
          antebrazo_izquierdo, antebrazo_izquierdo_cruza_linea_media,
          muneca_izquierda, muneca_izquierda_desviacion_radial_cubital, muneca_izquierda_rotacion,
          grupo_a_musculo_estatico_o_repetido, grupo_a_fuerza_carga,
          cuello, cuello_torsion, cuello_inclinacion_lateral,
          tronco, tronco_sentado, tronco_torsion, tronco_inclinacion_lateral,
          piernas_bien_apoyadas,
          grupo_b_musculo_estatico_o_repetido, grupo_b_fuerza_carga,
          lado_evaluado,
          puntuacion_a_derecha, puntuacion_a_izquierda, puntuacion_b, puntuacion_c,
          nivel_riesgo, accion_requerida,
          evidencia_url, evidencia_public_id, evidencia_tipo
       ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10,
          $11, $12, $13,
          $14, $15, $16, $17,
          $18, $19,
          $20, $21, $22,
          $23, $24,
          $25, $26, $27,
          $28, $29, $30, $31,
          $32,
          $33, $34,
          $35,
          $36, $37, $38, $39,
          $40, $41,
          $42, $43, $44
       )
       RETURNING id, nombre_postura, orden, puntuacion_a_derecha, puntuacion_a_izquierda,
                 puntuacion_b, puntuacion_c, nivel_riesgo, accion_requerida,
                 lado_evaluado, evidencia_url, evidencia_tipo, creado_en`,
      [
        req.usuario.organizacionId, sesionId, input.nombrePostura, input.orden || 1,
        input.brazoDerecho, !!input.brazoDerechoHombroElevado, !!input.brazoDerechoAbducido, !!input.brazoDerechoApoyado,
        input.antebrazoDerecho, !!input.antebrazoDerechoCruzaLineaMedia,
        input.munecaDerecha, !!input.munecaDerechaDesviacionRadialCubital, input.munecaDerechaRotacion,
        input.brazoIzquierdo, !!input.brazoIzquierdoHombroElevado, !!input.brazoIzquierdoAbducido, !!input.brazoIzquierdoApoyado,
        input.antebrazoIzquierdo, !!input.antebrazoIzquierdoCruzaLineaMedia,
        input.munecaIzquierda, !!input.munecaIzquierdaDesviacionRadialCubital, input.munecaIzquierdaRotacion,
        !!input.grupoAMusculoEstaticoORepetido, input.grupoAFuerzaCarga,
        input.cuello, !!input.cuelloTorsion, !!input.cuelloInclinacionLateral,
        input.tronco, !!input.troncoSentado, !!input.troncoTorsion, !!input.troncoInclinacionLateral,
        input.piernasBienApoyadas !== false,
        !!input.grupoBMusculoEstaticoORepetido, input.grupoBFuerzaCarga,
        resultado.ladoEvaluado,
        resultado.puntuacionADerecha, resultado.puntuacionAIzquierda, resultado.puntuacionB, resultado.puntuacionC,
        resultado.nivelRiesgo, resultado.accionRequerida,
        evidencia ? evidencia.url : null, evidencia ? evidencia.publicId : null, evidencia ? evidencia.tipo : null,
      ]
      );
    } catch (errInsert) {
      if (evidencia && evidencia.publicId) {
        await borrarEvidencia(evidencia.publicId, evidencia.tipo).catch((errBorrado) =>
          console.error(`ORFANO EN CLOUDINARY: no se pudo compensar (borrar) ${evidencia.publicId}.`, errBorrado)
        );
      }
      throw errInsert;
    }

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'crear_evaluacion_rula',
      entidad: 'evaluacion_rula',
      entidadId: insertRes.rows[0].id,
      detalle: {
        sesionId,
        nombrePostura: input.nombrePostura,
        puntuacionFinal: resultado.puntuacionC,
        nivelRiesgo: resultado.nivelRiesgo,
      },
      req,
    });

    return res.status(201).json({ evaluacion: insertRes.rows[0], detalleCalculo: resultado.detalle });
  } catch (err) {
    console.error('Error en crearEvaluacionRula:', err);
    return res.status(500).json({ error: 'Error interno al calcular y guardar la evaluacion RULA.' });
  }
}

// ------------------------------------------------------------
// GET /api/ergonomia/rula/evaluaciones/:evaluacionId/evidencia-url
// (hallazgo G12, ver nota completa en
// ergonomiaController.js:obtenerUrlEvidencia — mismo patron, tabla
// evaluaciones_rula/sesiones_evaluacion_rula en vez de las de REBA).
// ------------------------------------------------------------
async function obtenerUrlEvidencia(req, res) {
  try {
    const resultado = await query(
      `SELECT ev.evidencia_public_id, ev.evidencia_tipo
       FROM evaluaciones_rula ev
       JOIN sesiones_evaluacion_rula s ON s.id = ev.sesion_id
       WHERE ev.id = $1 AND s.organizacion_id = $2`,
      [req.params.evaluacionId, req.usuario.organizacionId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Evaluacion no encontrada.' });
    }
    const { evidencia_public_id: publicId, evidencia_tipo: tipo } = resultado.rows[0];
    if (!publicId) {
      return res.status(404).json({ error: 'Esta evaluacion no tiene evidencia adjunta.' });
    }
    return res.json({ url: generarUrlFirmada(publicId, tipo === 'video' ? 'video' : 'imagen') });
  } catch (err) {
    console.error('Error en obtenerUrlEvidencia (RULA):', err);
    return res.status(500).json({ error: 'Error interno al generar el enlace de la evidencia.' });
  }
}

module.exports = {
  crearSesion,
  listarSesionesPorTrabajador,
  obtenerSesion,
  crearEvaluacionRula,
  obtenerUrlEvidencia,
};
