// ============================================================
// Controlador de visiometria ocupacional. Ver
// src/visiometria/visiometria.js para el detalle de las formulas
// y el criterio clinico (prueba tamiz, no diagnostico definitivo).
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { calcularVisiometria } = require('../visiometria/visiometria');

// ------------------------------------------------------------
// POST /api/visiometria/trabajadores/:trabajadorId
// Registra un nuevo examen de visiometria y calcula la
// clasificacion de agudeza visual, colores y aptitud sugerida.
// ------------------------------------------------------------
async function registrarExamen(req, res) {
  const { trabajadorId } = req.params;
  const input = req.body;

  try {
    const tRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (tRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    const medidos = {
      odLejanaSinCorreccion: input.odLejanaSinCorreccion ?? null,
      odLejanaConCorreccion: input.odLejanaConCorreccion ?? null,
      oiLejanaSinCorreccion: input.oiLejanaSinCorreccion ?? null,
      oiLejanaConCorreccion: input.oiLejanaConCorreccion ?? null,
      aoLejanaSinCorreccion: input.aoLejanaSinCorreccion ?? null,
      aoLejanaConCorreccion: input.aoLejanaConCorreccion ?? null,
      usaCorreccionOptica: !!input.usaCorreccionOptica,
      ishiharaLaminasCorrectas: input.ishiharaLaminasCorrectas ?? null,
      ishiharaLaminasTotales: input.ishiharaLaminasTotales ?? null,
    };

    // Al menos la agudeza lejana binocular (con o sin correccion,
    // segun corresponda) es obligatoria para poder clasificar algo.
    const tieneAoLejana = medidos.usaCorreccionOptica
      ? (medidos.aoLejanaConCorreccion !== null)
      : (medidos.aoLejanaSinCorreccion !== null);
    if (!tieneAoLejana) {
      return res.status(400).json({
        error: medidos.usaCorreccionOptica
          ? 'aoLejanaConCorreccion es obligatorio cuando el trabajador usa correccion optica.'
          : 'aoLejanaSinCorreccion es obligatorio.',
      });
    }

    const resultado = calcularVisiometria(medidos);

    const insertRes = await withTransaction(async (client) => {
    const filaInsertada = await client.query(
      `INSERT INTO examenes_visiometria (
        organizacion_id, trabajador_id, medico_id, fecha_examen,
        od_lejana_sin_correccion, od_lejana_con_correccion,
        oi_lejana_sin_correccion, oi_lejana_con_correccion,
        ao_lejana_sin_correccion, ao_lejana_con_correccion,
        od_cercana_sin_correccion, od_cercana_con_correccion,
        oi_cercana_sin_correccion, oi_cercana_con_correccion,
        ao_cercana_sin_correccion, ao_cercana_con_correccion,
        usa_correccion_optica, tipo_correccion,
        ishihara_laminas_correctas, ishihara_laminas_totales,
        percepcion_profundidad, balance_muscular,
        clasificacion_od, clasificacion_oi, clasificacion_ao, clasificacion_colores,
        vision_monocular_severa, aptitud_sugerida, aptitud_definida,
        observaciones
      ) VALUES (
        $1,$2,$3,$4,
        $5,$6,
        $7,$8,
        $9,$10,
        $11,$12,
        $13,$14,
        $15,$16,
        $17,$18,
        $19,$20,
        $21,$22,
        $23,$24,$25,$26,
        $27,$28,$29,
        $30
      ) RETURNING id, fecha_examen, clasificacion_ao, clasificacion_colores,
                  vision_monocular_severa, aptitud_sugerida, aptitud_definida`,
      [
        req.usuario.organizacionId, trabajadorId, req.usuario.id, input.fechaExamen || null,
        medidos.odLejanaSinCorreccion, medidos.odLejanaConCorreccion,
        medidos.oiLejanaSinCorreccion, medidos.oiLejanaConCorreccion,
        medidos.aoLejanaSinCorreccion, medidos.aoLejanaConCorreccion,
        input.odCercanaSinCorreccion ?? null, input.odCercanaConCorreccion ?? null,
        input.oiCercanaSinCorreccion ?? null, input.oiCercanaConCorreccion ?? null,
        input.aoCercanaSinCorreccion ?? null, input.aoCercanaConCorreccion ?? null,
        medidos.usaCorreccionOptica, input.tipoCorreccion || null,
        medidos.ishiharaLaminasCorrectas, medidos.ishiharaLaminasTotales,
        input.percepcionProfundidad || null, input.balanceMuscular || null,
        resultado.clasificacionOD, resultado.clasificacionOI, resultado.clasificacionAO, resultado.clasificacionColores,
        resultado.visionMonocularSevera, resultado.aptitudSugerida,
        input.aptitudDefinida || resultado.aptitudSugerida,
        input.observaciones || null,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'registrar_examen_visiometria',
      entidad: 'examen_visiometria',
      entidadId: filaInsertada.rows[0].id,
      detalle: { trabajadorId, aptitudSugerida: resultado.aptitudSugerida },
      req,
      client,
    });

    return filaInsertada;
  });

    return res.status(201).json({ examen: insertRes.rows[0] });
  } catch (err) {
    console.error('Error en registrarExamen (visiometria):', err);
    return res.status(500).json({ error: 'Error interno al registrar el examen de visiometria.' });
  }
}

// ------------------------------------------------------------
// GET /api/visiometria/trabajadores/:trabajadorId
// ------------------------------------------------------------
async function listarExamenes(req, res) {
  try {
    const tRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );
    if (tRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    const res2 = await query(
      `SELECT e.id, e.fecha_examen, e.ao_lejana_sin_correccion, e.ao_lejana_con_correccion,
              e.usa_correccion_optica, e.clasificacion_ao, e.clasificacion_colores,
              e.vision_monocular_severa, e.aptitud_sugerida, e.aptitud_definida,
              e.observaciones, e.creado_en,
              u.nombre_completo AS medico_nombre
       FROM examenes_visiometria e
       JOIN usuarios u ON u.id = e.medico_id
       WHERE e.trabajador_id = $1 AND e.organizacion_id = $2
       ORDER BY e.fecha_examen DESC`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );

    // CORREGIDO tras auditoria de seguridad (hallazgo GRAVE G3): SSO
    // necesita la clasificacion y la aptitud ocupacional resultante
    // (relevante, por ejemplo, para tareas que exigen discriminacion
    // de colores o conduccion), pero no la agudeza visual cruda ni
    // las observaciones clinicas — eso es informacion medica que
    // corresponde al medico ocupacional.
    const examenes = req.usuario.rol === 'sso'
      ? res2.rows.map((e) => ({
          id: e.id,
          fecha_examen: e.fecha_examen,
          clasificacion_ao: e.clasificacion_ao,
          clasificacion_colores: e.clasificacion_colores,
          aptitud_sugerida: e.aptitud_sugerida,
          aptitud_definida: e.aptitud_definida,
          creado_en: e.creado_en,
        }))
      : res2.rows;

    return res.json({ examenes });
  } catch (err) {
    console.error('Error en listarExamenes (visiometria):', err);
    return res.status(500).json({ error: 'Error interno al listar las visiometrias.' });
  }
}

// ------------------------------------------------------------
// GET /api/visiometria/:examenId
// ------------------------------------------------------------
async function obtenerExamen(req, res) {
  try {
    const res2 = await query(
      `SELECT e.*, u.nombre_completo AS medico_nombre, t.nombre_completo AS trabajador_nombre
       FROM examenes_visiometria e
       JOIN usuarios u ON u.id = e.medico_id
       JOIN trabajadores t ON t.id = e.trabajador_id
       WHERE e.id = $1 AND e.organizacion_id = $2`,
      [req.params.examenId, req.usuario.organizacionId]
    );
    if (res2.rows.length === 0) {
      return res.status(404).json({ error: 'Examen no encontrado.' });
    }

    // Auditoria de acceso a datos clinicos (mismo criterio que
    // historiaClinicaController.js tras la auditoria de seguridad).
    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'ver_examen_visiometria',
      entidad: 'examen_visiometria',
      entidadId: req.params.examenId,
      req,
    });

    return res.json({ examen: res2.rows[0] });
  } catch (err) {
    console.error('Error en obtenerExamen (visiometria):', err);
    return res.status(500).json({ error: 'Error interno al obtener el examen.' });
  }
}

module.exports = { registrarExamen, listarExamenes, obtenerExamen };
