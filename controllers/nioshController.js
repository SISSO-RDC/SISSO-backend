// ============================================================
// Controlador de la Ecuacion NIOSH revisada (1994) para
// levantamiento manual de cargas. Ver src/niosh/niosh.js para el
// detalle completo de formulas, tablas y fuentes.
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { calcularNiosh } = require('../niosh/niosh');

// ------------------------------------------------------------
// POST /api/niosh/trabajadores/:trabajadorId
// ------------------------------------------------------------
async function registrarEvaluacion(req, res) {
  const { trabajadorId } = req.params;
  const b = req.body;

  // CREADO en Auditoria N.13 (G-10, P1): esta implementacion SOLO
  // cubre la variante de tarea simple de la Ecuacion NIOSH revisada
  // (1994). Se rechaza explicitamente en vez de calcular con la
  // formula equivocada.
  if (b.tipoTarea === 'compuesta') {
    return res.status(400).json({
      error: 'Esta version de SISSO solo implementa la Ecuacion NIOSH para tarea simple (single-task). La variante de tarea multiple/compuesta no esta implementada todavia.',
    });
  }

  try {
    const tRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (tRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    const resultado = calcularNiosh({
      horizontal: b.horizontalCm, vertical: b.verticalCm, distanciaVertical: b.distanciaVerticalCm,
      anguloAsimetria: b.anguloAsimetria, frecuencia: b.frecuenciaPorMin, duracion: b.duracion,
      calidadAgarre: b.calidadAgarre, pesoCarga: b.pesoCargaKg,
    });

    // CORREGIDO en Auditoria N.13 (G-10, P1): mensaje mas especifico
    // que "verifica que los campos tengan valores validos" -- la
    // causa mas comun de 'no_calculable' con datos aparentemente
    // completos es una frecuencia fuera del rango que cubre la
    // Tabla 5 (0.1 a 15 lev/min para tarea simple).
    if (resultado.clasificacion === 'no_calculable') {
      return res.status(400).json({ error: 'No se pudo calcular con los datos proporcionados. Verifique que horizontalCm, verticalCm, distanciaVerticalCm y anguloAsimetria esten dentro de rango, y que frecuenciaPorMin no supere 15 lev/min (limite de la Tabla 5 para tarea simple).' });
    }

    const insertRes = await query(
      `INSERT INTO evaluaciones_niosh (
        organizacion_id, trabajador_id, evaluado_por, fecha_evaluacion, nombre_tarea,
        horizontal_cm, vertical_cm, distancia_vertical_cm, angulo_asimetria,
        frecuencia_por_min, duracion, calidad_agarre, peso_carga_kg,
        hm, vm, dm, am, fm, cm, rwl_kg, li, clasificacion, observaciones
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      RETURNING id, fecha_evaluacion, nombre_tarea, rwl_kg, li, clasificacion`,
      [
        req.usuario.organizacionId, trabajadorId, req.usuario.id, b.fechaEvaluacion || null, b.nombreTarea,
        b.horizontalCm, b.verticalCm, b.distanciaVerticalCm, b.anguloAsimetria,
        b.frecuenciaPorMin, b.duracion, b.calidadAgarre, b.pesoCargaKg,
        resultado.HM, resultado.VM, resultado.DM, resultado.AM, resultado.FM, resultado.CM,
        resultado.RWL, resultado.LI, resultado.clasificacion, b.observaciones || null,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'registrar_evaluacion_niosh',
      entidad: 'evaluacion_niosh',
      entidadId: insertRes.rows[0].id,
      detalle: { trabajadorId, clasificacion: resultado.clasificacion, li: resultado.LI },
      req,
    });

    return res.status(201).json({ evaluacion: insertRes.rows[0] });
  } catch (err) {
    console.error('Error en registrarEvaluacion (niosh):', err);
    return res.status(500).json({ error: 'Error interno al registrar la evaluacion NIOSH.' });
  }
}

// ------------------------------------------------------------
// GET /api/niosh/trabajadores/:trabajadorId
// ------------------------------------------------------------
async function listarEvaluaciones(req, res) {
  try {
    const tRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );
    if (tRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    const res2 = await query(
      `SELECT e.id, e.fecha_evaluacion, e.nombre_tarea, e.peso_carga_kg, e.rwl_kg, e.li, e.clasificacion,
              e.observaciones, e.creado_en, u.nombre_completo AS evaluado_por_nombre
       FROM evaluaciones_niosh e
       JOIN usuarios u ON u.id = e.evaluado_por
       WHERE e.trabajador_id = $1 AND e.organizacion_id = $2
       ORDER BY e.fecha_evaluacion DESC`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: req.usuario.rol === 'medico' ? 'lectura_niosh_clinica' : 'lectura_niosh_operativa',
      entidad: 'evaluaciones_niosh',
      detalle: { trabajadorId: req.params.trabajadorId, resultados: res2.rows.length },
      req,
      lecturaSensible: req.usuario.rol === 'medico',
    });

    return res.json({ evaluaciones: res2.rows });
  } catch (err) {
    console.error('Error en listarEvaluaciones (niosh):', err);
    return res.status(500).json({ error: 'Error interno al listar las evaluaciones.' });
  }
}

// ------------------------------------------------------------
// GET /api/niosh/:evaluacionId
// ------------------------------------------------------------
async function obtenerEvaluacion(req, res) {
  try {
    const res2 = await query(
      `SELECT e.*, u.nombre_completo AS evaluado_por_nombre, t.nombre_completo AS trabajador_nombre
       FROM evaluaciones_niosh e
       JOIN usuarios u ON u.id = e.evaluado_por
       JOIN trabajadores t ON t.id = e.trabajador_id
       WHERE e.id = $1 AND e.organizacion_id = $2`,
      [req.params.evaluacionId, req.usuario.organizacionId]
    );
    if (res2.rows.length === 0) {
      return res.status(404).json({ error: 'Evaluacion no encontrada.' });
    }

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: req.usuario.rol === 'medico' ? 'lectura_niosh_clinica' : 'lectura_niosh_operativa',
      entidad: 'evaluaciones_niosh',
      entidadId: req.params.evaluacionId,
      req,
      lecturaSensible: req.usuario.rol === 'medico',
    });

    return res.json({ evaluacion: res2.rows[0] });
  } catch (err) {
    console.error('Error en obtenerEvaluacion (niosh):', err);
    return res.status(500).json({ error: 'Error interno al obtener la evaluacion.' });
  }
}

module.exports = { registrarEvaluacion, listarEvaluaciones, obtenerEvaluacion };
