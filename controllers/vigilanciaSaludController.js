// ============================================================
// Controlador de Vigilancia de la Salud (programas longitudinales).
// Corrige el punto 16 / CRITICO 4 de la Auditoria SISSO N.06.
//
// Acceso:
//   - 'medico': crea/edita programas y registra observaciones
//     periodicas (cifras agregadas, nunca listados individuales).
//   - 'sso': SOLO lectura de programas y observaciones -- son datos
//     ya agregados por diseno (ver migration_035), por eso SSO puede
//     verlos sin tocar informacion clinica individual (corrige punto
//     3.2 de la auditoria).
//   - 'admin' y 'th': sin acceso, igual que el resto del bloque medico.
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

const TIPOS_RIESGO = ['ruido', 'quimico', 'ergonomico', 'biologico', 'psicosocial', 'otro'];
const TIPOS_EXAMEN_ASOCIADO = ['audiometria', 'espirometria', 'visiometria', 'evaluacion_periodica', 'ergonomia', 'ausentismo', 'otro'];

// ------------------------------------------------------------
// POST /api/vigilancia-salud/programas  (solo medico)
// ------------------------------------------------------------
async function crearPrograma(req, res) {
  const { nombre, tipoRiesgo, descripcion, puestoTrabajoId, tipoExamenAsociado, responsableId } = req.body;

  if (!nombre || nombre.trim().length < 3) {
    return res.status(400).json({ error: 'nombre es obligatorio (minimo 3 caracteres).' });
  }
  if (!TIPOS_RIESGO.includes(tipoRiesgo)) {
    return res.status(400).json({ error: 'tipoRiesgo invalido.' });
  }
  if (tipoExamenAsociado && !TIPOS_EXAMEN_ASOCIADO.includes(tipoExamenAsociado)) {
    return res.status(400).json({ error: 'tipoExamenAsociado invalido.' });
  }

  try {
    const programaRes = await query(
      `INSERT INTO programas_vigilancia_salud
        (organizacion_id, nombre, tipo_riesgo, descripcion, puesto_trabajo_id, tipo_examen_asociado, responsable_id, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, nombre, tipo_riesgo, estado, creado_en`,
      [
        req.usuario.organizacionId,
        nombre.trim(),
        tipoRiesgo,
        descripcion || null,
        puestoTrabajoId || null,
        tipoExamenAsociado || null,
        responsableId || null,
        req.usuario.id,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'programa_vigilancia_salud_creado',
      entidad: 'programas_vigilancia_salud',
      entidadId: programaRes.rows[0].id,
      req,
    });

    return res.status(201).json({ programa: programaRes.rows[0] });
  } catch (err) {
    console.error('Error en crearPrograma (vigilancia salud):', err);
    return res.status(500).json({ error: 'Error interno al crear el programa.' });
  }
}

// ------------------------------------------------------------
// GET /api/vigilancia-salud/programas  (medico, sso)
// ------------------------------------------------------------
async function listarProgramas(req, res) {
  try {
    const programasRes = await query(
      `SELECT p.id, p.nombre, p.tipo_riesgo, p.descripcion, p.puesto_trabajo_id, pt.nombre_puesto,
              p.tipo_examen_asociado, p.estado, p.responsable_id, u.nombre_completo AS responsable_nombre, p.creado_en
       FROM programas_vigilancia_salud p
       LEFT JOIN puestos_trabajo pt ON pt.id = p.puesto_trabajo_id
       LEFT JOIN usuarios u ON u.id = p.responsable_id
       WHERE p.organizacion_id = $1
       ORDER BY p.creado_en DESC`,
      [req.usuario.organizacionId]
    );
    return res.json({ programas: programasRes.rows });
  } catch (err) {
    console.error('Error en listarProgramas (vigilancia salud):', err);
    return res.status(500).json({ error: 'Error interno al listar los programas.' });
  }
}

// ------------------------------------------------------------
// PUT /api/vigilancia-salud/programas/:programaId  (solo medico)
// ------------------------------------------------------------
async function actualizarPrograma(req, res) {
  const { programaId } = req.params;
  const { nombre, descripcion, estado, responsableId } = req.body;

  if (estado && !['activo', 'en_pausa', 'cerrado'].includes(estado)) {
    return res.status(400).json({ error: 'estado invalido.' });
  }

  try {
    const actualizadoRes = await query(
      `UPDATE programas_vigilancia_salud SET
         nombre = COALESCE($1, nombre),
         descripcion = COALESCE($2, descripcion),
         estado = COALESCE($3, estado),
         responsable_id = COALESCE($4, responsable_id)
       WHERE id = $5 AND organizacion_id = $6
       RETURNING id, nombre, estado`,
      [nombre ? nombre.trim() : null, descripcion || null, estado || null, responsableId || null, programaId, req.usuario.organizacionId]
    );
    if (actualizadoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Programa no encontrado.' });
    }

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'programa_vigilancia_salud_actualizado',
      entidad: 'programas_vigilancia_salud',
      entidadId: programaId,
      req,
    });

    return res.json({ programa: actualizadoRes.rows[0] });
  } catch (err) {
    console.error('Error en actualizarPrograma (vigilancia salud):', err);
    return res.status(500).json({ error: 'Error interno al actualizar el programa.' });
  }
}

// ------------------------------------------------------------
// POST /api/vigilancia-salud/programas/:programaId/observaciones
// Solo medico. Registra un corte periodico con cifras agregadas.
// ------------------------------------------------------------
async function registrarObservacion(req, res) {
  const { programaId } = req.params;
  const { periodoEtiqueta, fechaCorte, totalEvaluados, totalConHallazgo, tendencia, notaPreventiva } = req.body;

  if (!periodoEtiqueta || !fechaCorte) {
    return res.status(400).json({ error: 'periodoEtiqueta y fechaCorte son obligatorios.' });
  }
  if (totalEvaluados == null || totalConHallazgo == null || totalEvaluados < 0 || totalConHallazgo < 0) {
    return res.status(400).json({ error: 'totalEvaluados y totalConHallazgo son obligatorios y no pueden ser negativos.' });
  }
  if (totalConHallazgo > totalEvaluados) {
    return res.status(400).json({ error: 'totalConHallazgo no puede ser mayor que totalEvaluados.' });
  }
  if (tendencia && !['mejora', 'estable', 'empeora'].includes(tendencia)) {
    return res.status(400).json({ error: 'tendencia invalida.' });
  }

  try {
    const programaRes = await query(
      `SELECT id FROM programas_vigilancia_salud WHERE id = $1 AND organizacion_id = $2`,
      [programaId, req.usuario.organizacionId]
    );
    if (programaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Programa no encontrado.' });
    }

    const observacionRes = await query(
      `INSERT INTO vigilancia_salud_observaciones
        (programa_id, organizacion_id, periodo_etiqueta, fecha_corte, total_evaluados, total_con_hallazgo, tendencia, nota_preventiva, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, periodo_etiqueta, fecha_corte, total_evaluados, total_con_hallazgo, tendencia, creado_en`,
      [
        programaId,
        req.usuario.organizacionId,
        periodoEtiqueta.trim(),
        fechaCorte,
        totalEvaluados,
        totalConHallazgo,
        tendencia || 'estable',
        notaPreventiva || null,
        req.usuario.id,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'vigilancia_salud_observacion_registrada',
      entidad: 'vigilancia_salud_observaciones',
      entidadId: observacionRes.rows[0].id,
      detalle: { programaId },
      req,
    });

    return res.status(201).json({ observacion: observacionRes.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe una observacion registrada para ese periodo en este programa.' });
    }
    console.error('Error en registrarObservacion (vigilancia salud):', err);
    return res.status(500).json({ error: 'Error interno al registrar la observacion.' });
  }
}

// ------------------------------------------------------------
// GET /api/vigilancia-salud/programas/:programaId/observaciones
// medico, sso. Siempre cifras agregadas (la tabla no guarda otra cosa).
// ------------------------------------------------------------
async function listarObservaciones(req, res) {
  const { programaId } = req.params;
  try {
    const programaRes = await query(
      `SELECT id FROM programas_vigilancia_salud WHERE id = $1 AND organizacion_id = $2`,
      [programaId, req.usuario.organizacionId]
    );
    if (programaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Programa no encontrado.' });
    }

    const observacionesRes = await query(
      `SELECT id, periodo_etiqueta, fecha_corte, total_evaluados, total_con_hallazgo, tendencia, nota_preventiva, creado_en
       FROM vigilancia_salud_observaciones
       WHERE programa_id = $1 AND organizacion_id = $2
       ORDER BY fecha_corte DESC`,
      [programaId, req.usuario.organizacionId]
    );

    return res.json({ observaciones: observacionesRes.rows });
  } catch (err) {
    console.error('Error en listarObservaciones (vigilancia salud):', err);
    return res.status(500).json({ error: 'Error interno al listar las observaciones.' });
  }
}

module.exports = {
  crearPrograma,
  listarProgramas,
  actualizarPrograma,
  registrarObservacion,
  listarObservaciones,
};
