// ============================================================
// Controlador de Enfermedad Profesional (modulo medico exclusivo).
//
// CORRIGE el punto 3.1 y el hallazgo G2 de la Auditoria SISSO N.06:
// la enfermedad profesional NO es una funcion operativa de SSO. Es
// un proceso clinico (sospecha, evaluacion, diagnostico, seguimiento)
// bajo criterio exclusivo del Medico Ocupacional.
//
// REGLA DE AUTORIZACION DELIBERADA:
//   - 'medico': acceso completo (crear, ver, modificar, cerrar,
//     agregar seguimientos). Unico rol que ve diagnostico_cie10,
//     diagnostico_presuntivo, evolucion_clinica y conclusion.
//   - 'sso': puede ver una lista PREVENTIVA/AGREGADA (ver
//     listarVistaPreventivaSso) que expone unicamente estado,
//     exposicion_relacionada y puesto_trabajo_id -- nunca el
//     diagnostico ni la evolucion clinica. No puede crear, editar
//     ni acceder al detalle clinico de un caso.
//   - 'admin' y 'th': sin acceso a este modulo (ni siquiera la
//     vista agregada), igual que con historia clinica y aptitud.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

// ------------------------------------------------------------
// POST /api/enfermedad-profesional/trabajadores/:trabajadorId
// Solo medico. Abre un caso nuevo en estado 'sospecha'.
// ------------------------------------------------------------
async function crearCaso(req, res) {
  const { trabajadorId } = req.params;
  const {
    fechaSospecha,
    diagnosticoPresuntivo,
    exposicionRelacionada,
    puestoTrabajoId,
  } = req.body;

  if (!fechaSospecha) {
    return res.status(400).json({ error: 'fechaSospecha es obligatoria.' });
  }

  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    const casoRes = await withTransaction(async (client) => {
    const resultado = await client.query(
      `INSERT INTO enfermedad_profesional
        (organizacion_id, trabajador_id, estado, fecha_sospecha, diagnostico_presuntivo,
         exposicion_relacionada, puesto_trabajo_id, medico_responsable_id)
       VALUES ($1, $2, 'sospecha', $3, $4, $5, $6, $7)
       RETURNING id, estado, fecha_sospecha, creado_en`,
      [
        req.usuario.organizacionId,
        trabajadorId,
        fechaSospecha,
        diagnosticoPresuntivo || null,
        exposicionRelacionada || null,
        puestoTrabajoId || null,
        req.usuario.id,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'enfermedad_profesional_creada',
      entidad: 'enfermedad_profesional',
      entidadId: resultado.rows[0].id,
      detalle: { trabajadorId },
      req,
      client,
    });

    return resultado;
  });

    return res.status(201).json({ caso: casoRes.rows[0] });
  } catch (err) {
    console.error('Error en crearCaso (enfermedad profesional):', err);
    return res.status(500).json({ error: 'Error interno al crear el caso.' });
  }
}

// ------------------------------------------------------------
// GET /api/enfermedad-profesional/trabajadores/:trabajadorId
// Solo medico. Historial clinico COMPLETO de casos del trabajador.
// Se audita como acceso a informacion clinica sensible (punto 13.6).
// ------------------------------------------------------------
async function listarCasosTrabajador(req, res) {
  const { trabajadorId } = req.params;
  try {
    const casosRes = await query(
      `SELECT ep.id, ep.estado, ep.fecha_sospecha, ep.diagnostico_cie10, c.descripcion AS diagnostico_descripcion,
              ep.diagnostico_presuntivo, ep.evolucion_clinica, ep.fecha_confirmacion, ep.fecha_cierre,
              ep.conclusion, ep.exposicion_relacionada, ep.puesto_trabajo_id, ep.creado_en, ep.actualizado_en
       FROM enfermedad_profesional ep
       LEFT JOIN catalogo_cie10 c ON c.codigo = ep.diagnostico_cie10
       WHERE ep.trabajador_id = $1 AND ep.organizacion_id = $2
       ORDER BY ep.fecha_sospecha DESC`,
      [trabajadorId, req.usuario.organizacionId]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'lectura_enfermedad_profesional',
      entidad: 'enfermedad_profesional',
      detalle: { trabajadorId, resultados: casosRes.rows.length },
      req,
    });

    return res.json({ casos: casosRes.rows });
  } catch (err) {
    console.error('Error en listarCasosTrabajador (enfermedad profesional):', err);
    return res.status(500).json({ error: 'Error interno al listar los casos.' });
  }
}

// ------------------------------------------------------------
// GET /api/enfermedad-profesional/casos/:casoId
// Solo medico. Detalle completo de un caso con sus seguimientos.
// ------------------------------------------------------------
async function obtenerCaso(req, res) {
  const { casoId } = req.params;
  try {
    const casoRes = await query(
      `SELECT ep.*, c.descripcion AS diagnostico_descripcion
       FROM enfermedad_profesional ep
       LEFT JOIN catalogo_cie10 c ON c.codigo = ep.diagnostico_cie10
       WHERE ep.id = $1 AND ep.organizacion_id = $2`,
      [casoId, req.usuario.organizacionId]
    );
    if (casoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Caso no encontrado.' });
    }

    const seguimientosRes = await query(
      `SELECT id, fecha, nota_clinica, medico_id, creado_en
       FROM enfermedad_profesional_seguimientos
       WHERE enfermedad_profesional_id = $1 AND organizacion_id = $2
       ORDER BY fecha DESC, creado_en DESC`,
      [casoId, req.usuario.organizacionId]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'lectura_enfermedad_profesional',
      entidad: 'enfermedad_profesional',
      entidadId: casoId,
      req,
    });

    return res.json({ caso: casoRes.rows[0], seguimientos: seguimientosRes.rows });
  } catch (err) {
    console.error('Error en obtenerCaso (enfermedad profesional):', err);
    return res.status(500).json({ error: 'Error interno al obtener el caso.' });
  }
}

// ------------------------------------------------------------
// PUT /api/enfermedad-profesional/casos/:casoId
// Solo medico. Actualiza estado/diagnostico/evolucion. El estado
// solo puede avanzar dentro del ciclo clinico valido; no se permite
// "saltar" a cerrada sin pasar por evaluacion (evita cierres
// accidentales sin conclusion).
// ------------------------------------------------------------
const ESTADOS_VALIDOS = ['sospecha', 'en_evaluacion', 'confirmada', 'descartada', 'en_seguimiento', 'cerrada'];

async function actualizarCaso(req, res) {
  const { casoId } = req.params;
  const {
    estado,
    diagnosticoCie10,
    diagnosticoPresuntivo,
    evolucionClinica,
    fechaConfirmacion,
    fechaCierre,
    conclusion,
    exposicionRelacionada,
  } = req.body;

  if (estado && !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({ error: 'estado invalido.' });
  }
  if (estado === 'cerrada' && !conclusion && !req.body.conclusionExistente) {
    return res.status(400).json({ error: 'No se puede cerrar un caso sin una conclusion clinica.' });
  }

  try {
    const existenteRes = await query(
      `SELECT id, conclusion FROM enfermedad_profesional WHERE id = $1 AND organizacion_id = $2`,
      [casoId, req.usuario.organizacionId]
    );
    if (existenteRes.rows.length === 0) {
      return res.status(404).json({ error: 'Caso no encontrado.' });
    }
    if (estado === 'cerrada' && !conclusion && !existenteRes.rows[0].conclusion) {
      return res.status(400).json({ error: 'No se puede cerrar un caso sin una conclusion clinica.' });
    }

    const actualizadoRes = await withTransaction(async (client) => {
    const resultado = await client.query(
      `UPDATE enfermedad_profesional SET
         estado = COALESCE($1, estado),
         diagnostico_cie10 = COALESCE($2, diagnostico_cie10),
         diagnostico_presuntivo = COALESCE($3, diagnostico_presuntivo),
         evolucion_clinica = COALESCE($4, evolucion_clinica),
         fecha_confirmacion = COALESCE($5, fecha_confirmacion),
         fecha_cierre = COALESCE($6, fecha_cierre),
         conclusion = COALESCE($7, conclusion),
         exposicion_relacionada = COALESCE($8, exposicion_relacionada)
       WHERE id = $9 AND organizacion_id = $10
       RETURNING id, estado, fecha_cierre`,
      [
        estado || null,
        diagnosticoCie10 || null,
        diagnosticoPresuntivo || null,
        evolucionClinica || null,
        fechaConfirmacion || null,
        fechaCierre || null,
        conclusion || null,
        exposicionRelacionada || null,
        casoId,
        req.usuario.organizacionId,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'enfermedad_profesional_actualizada',
      entidad: 'enfermedad_profesional',
      entidadId: casoId,
      detalle: { estado },
      req,
      client,
    });

    return resultado;
  });

    return res.json({ caso: actualizadoRes.rows[0] });
  } catch (err) {
    console.error('Error en actualizarCaso (enfermedad profesional):', err);
    return res.status(500).json({ error: 'Error interno al actualizar el caso.' });
  }
}

// ------------------------------------------------------------
// POST /api/enfermedad-profesional/casos/:casoId/seguimientos
// Solo medico. Agrega una entrada de seguimiento longitudinal.
// ------------------------------------------------------------
async function agregarSeguimiento(req, res) {
  const { casoId } = req.params;
  const { fecha, notaClinica } = req.body;

  if (!fecha || !notaClinica || notaClinica.trim().length < 5) {
    return res.status(400).json({ error: 'fecha y notaClinica (minimo 5 caracteres) son obligatorios.' });
  }

  try {
    const casoRes = await query(
      `SELECT id FROM enfermedad_profesional WHERE id = $1 AND organizacion_id = $2`,
      [casoId, req.usuario.organizacionId]
    );
    if (casoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Caso no encontrado.' });
    }

    const seguimientoRes = await withTransaction(async (client) => {
    const resultado = await client.query(
      `INSERT INTO enfermedad_profesional_seguimientos
        (enfermedad_profesional_id, organizacion_id, fecha, nota_clinica, medico_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, fecha, creado_en`,
      [casoId, req.usuario.organizacionId, fecha, notaClinica.trim(), req.usuario.id]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'enfermedad_profesional_seguimiento_agregado',
      entidad: 'enfermedad_profesional',
      entidadId: casoId,
      req,
      client,
    });

    return resultado;
  });

    return res.status(201).json({ seguimiento: seguimientoRes.rows[0] });
  } catch (err) {
    console.error('Error en agregarSeguimiento (enfermedad profesional):', err);
    return res.status(500).json({ error: 'Error interno al agregar el seguimiento.' });
  }
}

// ------------------------------------------------------------
// GET /api/enfermedad-profesional/vista-preventiva-sso
// Rol 'sso'. Vista AGREGADA/PREVENTIVA (corrige punto 3.2 de la
// auditoria): expone unicamente estado, exposicion_relacionada,
// puesto_trabajo_id y conteos -- JAMAS diagnostico_cie10,
// diagnostico_presuntivo, evolucion_clinica ni conclusion, y NUNCA
// el nombre del trabajador (evita reidentificacion trivial en
// organizaciones pequenas junto con el puesto).
// ------------------------------------------------------------
async function listarVistaPreventivaSso(req, res) {
  try {
    const resumenRes = await query(
      `SELECT puesto_trabajo_id, estado, exposicion_relacionada, COUNT(*)::int AS total
       FROM enfermedad_profesional
       WHERE organizacion_id = $1
       GROUP BY puesto_trabajo_id, estado, exposicion_relacionada
       ORDER BY total DESC`,
      [req.usuario.organizacionId]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'lectura_enfermedad_profesional_vista_preventiva',
      entidad: 'enfermedad_profesional',
      req,
    });

    return res.json({ resumen: resumenRes.rows });
  } catch (err) {
    console.error('Error en listarVistaPreventivaSso (enfermedad profesional):', err);
    return res.status(500).json({ error: 'Error interno al obtener la vista preventiva.' });
  }
}

module.exports = {
  crearCaso,
  listarCasosTrabajador,
  obtenerCaso,
  actualizarCaso,
  agregarSeguimiento,
  listarVistaPreventivaSso,
};
