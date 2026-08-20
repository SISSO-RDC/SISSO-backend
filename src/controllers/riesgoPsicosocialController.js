// ============================================================
// Controlador de Riesgo Psicosocial. Corrige el punto 7.6 /
// hallazgo G6 de la Auditoria SISSO N.06: evaluacion, factores,
// nivel de riesgo, intervencion (via CAPA), seguimiento y
// reevaluacion.
//
// SEPARACION CLINICA (igual criterio que accidentes/enfermedad
// profesional): esta tabla NUNCA guarda notas clinicas de salud
// mental individual. `derivado_atencion_medica` es solo una
// bandera; el detalle clinico real vive en Historia
// Clinica/Enfermedad Profesional, exclusivos de 'medico'.
//
// Acceso: admin, sso gestionan. Lectura: admin, sso, medico
// (medico puede necesitar saber que hay una derivacion pendiente,
// pero TH queda fuera -- no es informacion operativa de TH).
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

const NIVELES_RIESGO = ['bajo', 'medio', 'alto', 'muy_alto'];

// ------------------------------------------------------------
// POST /api/riesgo-psicosocial/evaluaciones
// ------------------------------------------------------------
async function crearEvaluacion(req, res) {
  const orgId = req.usuario.organizacionId;
  const {
    tipoEvaluacion, trabajadorId, puestoTrabajoId, area, metodo, fechaEvaluacion,
    puntajeGlobal, nivelRiesgo, evaluacionAnteriorId, derivadoAtencionMedica, observacionesGenerales,
    factores, // array opcional: [{ factor, nivelRiesgo, puntaje, observacion }]
  } = req.body;

  if (!metodo || metodo.trim().length < 2) {
    return res.status(400).json({ error: 'metodo es obligatorio.' });
  }
  if (!fechaEvaluacion) {
    return res.status(400).json({ error: 'fechaEvaluacion es obligatoria.' });
  }
  if (!NIVELES_RIESGO.includes(nivelRiesgo)) {
    return res.status(400).json({ error: 'nivelRiesgo invalido.' });
  }
  if (tipoEvaluacion === 'individual' && !trabajadorId) {
    return res.status(400).json({ error: 'trabajadorId es obligatorio para evaluaciones individuales.' });
  }
  if (tipoEvaluacion === 'grupal' && !area) {
    return res.status(400).json({ error: 'area es obligatoria para evaluaciones grupales.' });
  }

  try {
    const resultado = await withTransaction(async (client) => {
      const evalRes = await client.query(
        `INSERT INTO evaluaciones_psicosociales
          (organizacion_id, tipo_evaluacion, trabajador_id, puesto_trabajo_id, area, metodo, fecha_evaluacion,
           puntaje_global, nivel_riesgo, evaluacion_anterior_id, derivado_atencion_medica, observaciones_generales, evaluador_id, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id, estado, nivel_riesgo, fecha_evaluacion, creado_en`,
        [
          orgId, tipoEvaluacion || 'individual', trabajadorId || null, puestoTrabajoId || null, area || null,
          metodo.trim(), fechaEvaluacion, puntajeGlobal ?? null, nivelRiesgo, evaluacionAnteriorId || null,
          !!derivadoAtencionMedica, observacionesGenerales || null, req.usuario.id, req.usuario.id,
        ]
      );
      const evaluacion = evalRes.rows[0];

      if (Array.isArray(factores)) {
        for (const f of factores) {
          if (!f.factor || !NIVELES_RIESGO.includes(f.nivelRiesgo)) continue;
          await client.query(
            `INSERT INTO factores_psicosociales (evaluacion_id, organizacion_id, factor, nivel_riesgo, puntaje, observacion)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [evaluacion.id, orgId, f.factor.trim(), f.nivelRiesgo, f.puntaje ?? null, f.observacion || null]
          );
        }
      }

      return evaluacion;
    });

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'evaluacion_psicosocial_creada',
      entidad: 'evaluaciones_psicosociales', entidadId: resultado.id, detalle: { nivelRiesgo }, req,
    });

    return res.status(201).json({ evaluacion: resultado });
  } catch (err) {
    console.error('Error en crearEvaluacion (riesgo psicosocial):', err);
    return res.status(500).json({ error: 'Error interno al crear la evaluacion.' });
  }
}

// ------------------------------------------------------------
// GET /api/riesgo-psicosocial/evaluaciones  (filtros: nivelRiesgo, estado, trabajadorId)
// ------------------------------------------------------------
async function listarEvaluaciones(req, res) {
  const orgId = req.usuario.organizacionId;
  const { nivelRiesgo, estado, trabajadorId } = req.query;

  const condiciones = ['e.organizacion_id = $1'];
  const parametros = [orgId];
  if (nivelRiesgo) { parametros.push(nivelRiesgo); condiciones.push(`e.nivel_riesgo = $${parametros.length}`); }
  if (estado) { parametros.push(estado); condiciones.push(`e.estado = $${parametros.length}`); }
  if (trabajadorId) { parametros.push(trabajadorId); condiciones.push(`e.trabajador_id = $${parametros.length}`); }

  try {
    const resultado = await query(
      `SELECT e.id, e.tipo_evaluacion, e.trabajador_id, t.nombre_completo AS trabajador_nombre, e.area,
              e.metodo, e.fecha_evaluacion, e.nivel_riesgo, e.puntaje_global, e.estado,
              e.derivado_atencion_medica, e.capa_id, e.evaluacion_anterior_id,
              u.nombre_completo AS evaluador_nombre
       FROM evaluaciones_psicosociales e
       LEFT JOIN trabajadores t ON t.id = e.trabajador_id
       LEFT JOIN usuarios u ON u.id = e.evaluador_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY e.fecha_evaluacion DESC`,
      parametros
    );
    return res.json({ evaluaciones: resultado.rows });
  } catch (err) {
    console.error('Error en listarEvaluaciones (riesgo psicosocial):', err);
    return res.status(500).json({ error: 'Error interno al listar las evaluaciones.' });
  }
}

// ------------------------------------------------------------
// GET /api/riesgo-psicosocial/evaluaciones/:id
// ------------------------------------------------------------
async function obtenerEvaluacion(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const evalRes = await query(
      `SELECT e.*, t.nombre_completo AS trabajador_nombre, pt.nombre_puesto, u.nombre_completo AS evaluador_nombre
       FROM evaluaciones_psicosociales e
       LEFT JOIN trabajadores t ON t.id = e.trabajador_id
       LEFT JOIN puestos_trabajo pt ON pt.id = e.puesto_trabajo_id
       LEFT JOIN usuarios u ON u.id = e.evaluador_id
       WHERE e.id = $1 AND e.organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (evalRes.rows.length === 0) {
      return res.status(404).json({ error: 'Evaluacion no encontrada.' });
    }

    const factoresRes = await query(
      `SELECT id, factor, nivel_riesgo, puntaje, observacion FROM factores_psicosociales
       WHERE evaluacion_id = $1 AND organizacion_id = $2 ORDER BY nivel_riesgo DESC`,
      [req.params.id, orgId]
    );

    // Cadena de reevaluaciones: anteriores y siguientes, para ver
    // la evolucion longitudinal del riesgo (punto 7.6: "seguimiento
    // y reevaluacion").
    const historialRes = await query(
      `SELECT id, fecha_evaluacion, nivel_riesgo, puntaje_global
       FROM evaluaciones_psicosociales
       WHERE organizacion_id = $1 AND (
         trabajador_id = (SELECT trabajador_id FROM evaluaciones_psicosociales WHERE id = $2)
         AND trabajador_id IS NOT NULL
       )
       ORDER BY fecha_evaluacion ASC`,
      [orgId, req.params.id]
    );

    return res.json({ evaluacion: evalRes.rows[0], factores: factoresRes.rows, historial: historialRes.rows });
  } catch (err) {
    console.error('Error en obtenerEvaluacion (riesgo psicosocial):', err);
    return res.status(500).json({ error: 'Error interno al obtener la evaluacion.' });
  }
}

// ------------------------------------------------------------
// PUT /api/riesgo-psicosocial/evaluaciones/:id
// ------------------------------------------------------------
async function actualizarEvaluacion(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado, derivadoAtencionMedica, observacionesGenerales } = req.body;

  if (estado && !['evaluado', 'en_intervencion', 'en_seguimiento', 'cerrado'].includes(estado)) {
    return res.status(400).json({ error: 'estado invalido.' });
  }

  try {
    const actualizadaRes = await query(
      `UPDATE evaluaciones_psicosociales SET
         estado = COALESCE($1, estado),
         derivado_atencion_medica = COALESCE($2, derivado_atencion_medica),
         observaciones_generales = COALESCE($3, observaciones_generales)
       WHERE id = $4 AND organizacion_id = $5
       RETURNING id, estado`,
      [
        estado || null, typeof derivadoAtencionMedica === 'boolean' ? derivadoAtencionMedica : null,
        observacionesGenerales || null, req.params.id, orgId,
      ]
    );
    if (actualizadaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Evaluacion no encontrada.' });
    }

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'evaluacion_psicosocial_actualizada',
      entidad: 'evaluaciones_psicosociales', entidadId: req.params.id, detalle: { estado }, req,
    });

    return res.json({ evaluacion: actualizadaRes.rows[0] });
  } catch (err) {
    console.error('Error en actualizarEvaluacion (riesgo psicosocial):', err);
    return res.status(500).json({ error: 'Error interno al actualizar la evaluacion.' });
  }
}

// ------------------------------------------------------------
// POST /api/riesgo-psicosocial/evaluaciones/:id/generar-capa
// Cierra el ciclo de intervencion (punto 7.6): crea una fila real
// en capa_acciones enlazada a esta evaluacion, mismo patron que
// inspecciones_hallazgos.generarCapaDesdeHallazgo.
// ------------------------------------------------------------
async function generarCapaDesdeEvaluacion(req, res) {
  const orgId = req.usuario.organizacionId;
  const { responsableId, fechaLimite, descripcionAccion } = req.body;

  if (!responsableId || !fechaLimite) {
    return res.status(400).json({ error: 'responsableId y fechaLimite son obligatorios.' });
  }

  try {
    const evalRes = await query(
      `SELECT id, nivel_riesgo, area, capa_id, tipo_evaluacion,
              (SELECT nombre_completo FROM trabajadores WHERE id = evaluaciones_psicosociales.trabajador_id) AS trabajador_nombre
       FROM evaluaciones_psicosociales WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (evalRes.rows.length === 0) {
      return res.status(404).json({ error: 'Evaluacion no encontrada.' });
    }
    if (evalRes.rows[0].capa_id) {
      return res.status(400).json({ error: 'Esta evaluacion ya tiene una accion CAPA generada.' });
    }

    const evaluacion = evalRes.rows[0];
    const contexto = evaluacion.tipo_evaluacion === 'individual'
      ? `Riesgo psicosocial ${evaluacion.nivel_riesgo} — ${evaluacion.trabajador_nombre || 'trabajador'}`
      : `Riesgo psicosocial ${evaluacion.nivel_riesgo} — ${evaluacion.area || 'evaluación grupal'}`;

    const resultado = await withTransaction(async (client) => {
      const capaRes = await client.query(
        `INSERT INTO capa_acciones
          (organizacion_id, origen_tipo, origen_id, origen_descripcion, tipo, hallazgo, descripcion_accion,
           responsable_id, fecha_limite, creado_por)
         VALUES ($1,'riesgo_psicosocial',$2,$3,'preventiva',$4,$5,$6,$7,$8)
         RETURNING id`,
        [
          orgId, req.params.id, contexto,
          `Nivel de riesgo psicosocial: ${evaluacion.nivel_riesgo}`,
          descripcionAccion || 'Definir e implementar medidas de intervención psicosocial.',
          responsableId, fechaLimite, req.usuario.id,
        ]
      );

      await client.query(
        `UPDATE evaluaciones_psicosociales SET capa_id = $1, estado = 'en_intervencion' WHERE id = $2 AND organizacion_id = $3`,
        [capaRes.rows[0].id, req.params.id, orgId]
      );

      return capaRes.rows[0].id;
    });

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'evaluacion_psicosocial_genero_capa',
      entidad: 'evaluaciones_psicosociales', entidadId: req.params.id, detalle: { capaId: resultado }, req,
    });

    return res.status(201).json({ capaId: resultado });
  } catch (err) {
    console.error('Error en generarCapaDesdeEvaluacion (riesgo psicosocial):', err);
    return res.status(500).json({ error: 'Error interno al generar la accion CAPA.' });
  }
}

module.exports = { crearEvaluacion, listarEvaluaciones, obtenerEvaluacion, actualizarEvaluacion, generarCapaDesdeEvaluacion };
