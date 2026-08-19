// ============================================================
// Controlador de Restricciones Medicas (entidad longitudinal).
//
// CORRIGE el punto 3.3 y el hallazgo G8 de la Auditoria SISSO N.06:
// el Medico Ocupacional emite, modifica, prorroga y levanta una
// restriccion. SSO y TH ejecutan la medida laboral derivada, pero
// JAMAS pueden alterar el criterio medico.
//
// SEPARACION DE DATOS DELIBERADA en cada respuesta:
//   - 'medico': ve la fila completa (motivo_clinico,
//     diagnostico_cie10_relacionado incluidos).
//   - 'sso' y 'th': ven una proyeccion SIN motivo_clinico ni
//     diagnostico_cie10_relacionado -- solo estado, medida_laboral,
//     puesto_trabajo_id y fechas. Esto se hace seleccionando
//     columnas distintas segun el rol, no ocultando en el frontend.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

const COLUMNAS_MEDICO = `
  rm.id, rm.trabajador_id, rm.estado, rm.motivo_clinico, rm.diagnostico_cie10_relacionado,
  c.descripcion AS diagnostico_descripcion, rm.enfermedad_profesional_id, rm.medida_laboral,
  rm.puesto_trabajo_id, rm.fecha_emision, rm.fecha_vigencia_hasta, rm.fecha_levantamiento,
  rm.motivo_levantamiento, rm.medico_emisor_id, rm.medico_ultima_modificacion_id,
  rm.creado_en, rm.actualizado_en`;

// Proyeccion SSO/TH: deliberadamente SIN motivo_clinico ni
// diagnostico_cie10_relacionado (dato clinico que origina la medida).
const COLUMNAS_OPERATIVAS = `
  rm.id, rm.trabajador_id, rm.estado, rm.medida_laboral, rm.puesto_trabajo_id,
  rm.fecha_emision, rm.fecha_vigencia_hasta, rm.fecha_levantamiento, rm.creado_en, rm.actualizado_en`;

function columnasSegunRol(rol) {
  return rol === 'medico' ? COLUMNAS_MEDICO : COLUMNAS_OPERATIVAS;
}

// ------------------------------------------------------------
// POST /api/restricciones-medicas/trabajadores/:trabajadorId
// Solo medico. Emite una restriccion nueva.
// ------------------------------------------------------------
async function emitirRestriccion(req, res) {
  const { trabajadorId } = req.params;
  const {
    motivoClinico,
    diagnosticoCie10Relacionado,
    enfermedadProfesionalId,
    medidaLaboral,
    puestoTrabajoId,
    fechaEmision,
    fechaVigenciaHasta,
  } = req.body;

  if (!motivoClinico || motivoClinico.trim().length < 10) {
    return res.status(400).json({ error: 'motivoClinico es obligatorio (minimo 10 caracteres).' });
  }
  if (!medidaLaboral || medidaLaboral.trim().length < 5) {
    return res.status(400).json({ error: 'medidaLaboral es obligatoria (minimo 5 caracteres).' });
  }
  if (!fechaEmision) {
    return res.status(400).json({ error: 'fechaEmision es obligatoria.' });
  }

  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    const resultado = await withTransaction(async (client) => {
      const restriccionRes = await client.query(
        `INSERT INTO restricciones_medicas
          (organizacion_id, trabajador_id, estado, motivo_clinico, diagnostico_cie10_relacionado,
           enfermedad_profesional_id, medida_laboral, puesto_trabajo_id, fecha_emision,
           fecha_vigencia_hasta, medico_emisor_id)
         VALUES ($1, $2, 'activa', $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, estado, fecha_emision, fecha_vigencia_hasta`,
        [
          req.usuario.organizacionId,
          trabajadorId,
          motivoClinico.trim(),
          diagnosticoCie10Relacionado || null,
          enfermedadProfesionalId || null,
          medidaLaboral.trim(),
          puestoTrabajoId || null,
          fechaEmision,
          fechaVigenciaHasta || null,
          req.usuario.id,
        ]
      );

      const restriccion = restriccionRes.rows[0];

      await client.query(
        `INSERT INTO restricciones_medicas_historial
          (restriccion_id, organizacion_id, accion, detalle, medico_id, fecha_vigencia_hasta_nueva)
         VALUES ($1, $2, 'emitida', $3, $4, $5)`,
        [restriccion.id, req.usuario.organizacionId, motivoClinico.trim(), req.usuario.id, fechaVigenciaHasta || null]
      );

      return restriccion;
    });

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'restriccion_medica_emitida',
      entidad: 'restricciones_medicas',
      entidadId: resultado.id,
      detalle: { trabajadorId },
      req,
    });

    return res.status(201).json({ restriccion: resultado });
  } catch (err) {
    console.error('Error en emitirRestriccion:', err);
    return res.status(500).json({ error: 'Error interno al emitir la restriccion.' });
  }
}

// ------------------------------------------------------------
// GET /api/restricciones-medicas/trabajadores/:trabajadorId
// medico, sso, th -- proyeccion de columnas segun rol (ver arriba).
// admin queda fuera, igual que en aptitud e historia clinica.
// ------------------------------------------------------------
async function listarRestriccionesTrabajador(req, res) {
  const { trabajadorId } = req.params;
  const soloActivas = req.query.activas === 'true';

  try {
    const columnas = columnasSegunRol(req.usuario.rol);
    const filtroEstado = soloActivas ? `AND rm.estado IN ('activa', 'prorrogada')` : '';

    const restriccionesRes = await query(
      `SELECT ${columnas}
       FROM restricciones_medicas rm
       LEFT JOIN catalogo_cie10 c ON c.codigo = rm.diagnostico_cie10_relacionado
       WHERE rm.trabajador_id = $1 AND rm.organizacion_id = $2 ${filtroEstado}
       ORDER BY rm.fecha_emision DESC`,
      [trabajadorId, req.usuario.organizacionId]
    );

    // Se audita solo cuando el lector es medico (acceso a dato
    // clinico); sso/th consultan una vista ya minimizada que no
    // requiere el mismo nivel de trazabilidad de acceso clinico,
    // pero igual queda registrada la accion operativa.
    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: req.usuario.rol === 'medico' ? 'lectura_restriccion_medica_clinica' : 'lectura_restriccion_medica_operativa',
      entidad: 'restricciones_medicas',
      detalle: { trabajadorId, resultados: restriccionesRes.rows.length },
      req,
    });

    return res.json({ restricciones: restriccionesRes.rows });
  } catch (err) {
    console.error('Error en listarRestriccionesTrabajador:', err);
    return res.status(500).json({ error: 'Error interno al listar las restricciones.' });
  }
}

// ------------------------------------------------------------
// PUT /api/restricciones-medicas/:restriccionId/prorrogar
// Solo medico.
// ------------------------------------------------------------
async function prorrogarRestriccion(req, res) {
  const { restriccionId } = req.params;
  const { nuevaFechaVigenciaHasta, motivo } = req.body;

  if (!nuevaFechaVigenciaHasta) {
    return res.status(400).json({ error: 'nuevaFechaVigenciaHasta es obligatoria.' });
  }

  try {
    const existenteRes = await query(
      `SELECT id, estado, fecha_vigencia_hasta FROM restricciones_medicas WHERE id = $1 AND organizacion_id = $2`,
      [restriccionId, req.usuario.organizacionId]
    );
    if (existenteRes.rows.length === 0) {
      return res.status(404).json({ error: 'Restriccion no encontrada.' });
    }
    if (existenteRes.rows[0].estado === 'levantada') {
      return res.status(400).json({ error: 'No se puede prorrogar una restriccion ya levantada.' });
    }
    const fechaAnterior = existenteRes.rows[0].fecha_vigencia_hasta;

    const resultado = await withTransaction(async (client) => {
      const actualizadaRes = await client.query(
        `UPDATE restricciones_medicas SET
           estado = 'prorrogada',
           fecha_vigencia_hasta = $1,
           medico_ultima_modificacion_id = $2
         WHERE id = $3 AND organizacion_id = $4
         RETURNING id, estado, fecha_vigencia_hasta`,
        [nuevaFechaVigenciaHasta, req.usuario.id, restriccionId, req.usuario.organizacionId]
      );

      await client.query(
        `INSERT INTO restricciones_medicas_historial
          (restriccion_id, organizacion_id, accion, detalle, medico_id, fecha_vigencia_hasta_anterior, fecha_vigencia_hasta_nueva)
         VALUES ($1, $2, 'prorrogada', $3, $4, $5, $6)`,
        [restriccionId, req.usuario.organizacionId, motivo || null, req.usuario.id, fechaAnterior, nuevaFechaVigenciaHasta]
      );

      return actualizadaRes.rows[0];
    });

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'restriccion_medica_prorrogada',
      entidad: 'restricciones_medicas',
      entidadId: restriccionId,
      req,
    });

    return res.json({ restriccion: resultado });
  } catch (err) {
    console.error('Error en prorrogarRestriccion:', err);
    return res.status(500).json({ error: 'Error interno al prorrogar la restriccion.' });
  }
}

// ------------------------------------------------------------
// PUT /api/restricciones-medicas/:restriccionId/modificar
// Solo medico. Cambia motivo_clinico y/o medida_laboral.
// ------------------------------------------------------------
async function modificarRestriccion(req, res) {
  const { restriccionId } = req.params;
  const { motivoClinico, medidaLaboral, diagnosticoCie10Relacionado, motivo } = req.body;

  try {
    const existenteRes = await query(
      `SELECT id, estado FROM restricciones_medicas WHERE id = $1 AND organizacion_id = $2`,
      [restriccionId, req.usuario.organizacionId]
    );
    if (existenteRes.rows.length === 0) {
      return res.status(404).json({ error: 'Restriccion no encontrada.' });
    }
    if (existenteRes.rows[0].estado === 'levantada') {
      return res.status(400).json({ error: 'No se puede modificar una restriccion ya levantada.' });
    }

    const resultado = await withTransaction(async (client) => {
      const actualizadaRes = await client.query(
        `UPDATE restricciones_medicas SET
           motivo_clinico = COALESCE($1, motivo_clinico),
           medida_laboral = COALESCE($2, medida_laboral),
           diagnostico_cie10_relacionado = COALESCE($3, diagnostico_cie10_relacionado),
           medico_ultima_modificacion_id = $4
         WHERE id = $5 AND organizacion_id = $6
         RETURNING id, estado, medida_laboral`,
        [motivoClinico || null, medidaLaboral || null, diagnosticoCie10Relacionado || null, req.usuario.id, restriccionId, req.usuario.organizacionId]
      );

      await client.query(
        `INSERT INTO restricciones_medicas_historial
          (restriccion_id, organizacion_id, accion, detalle, medico_id)
         VALUES ($1, $2, 'modificada', $3, $4)`,
        [restriccionId, req.usuario.organizacionId, motivo || null, req.usuario.id]
      );

      return actualizadaRes.rows[0];
    });

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'restriccion_medica_modificada',
      entidad: 'restricciones_medicas',
      entidadId: restriccionId,
      req,
    });

    return res.json({ restriccion: resultado });
  } catch (err) {
    console.error('Error en modificarRestriccion:', err);
    return res.status(500).json({ error: 'Error interno al modificar la restriccion.' });
  }
}

// ------------------------------------------------------------
// PUT /api/restricciones-medicas/:restriccionId/levantar
// Solo medico. Cierra la restriccion definitivamente.
// ------------------------------------------------------------
async function levantarRestriccion(req, res) {
  const { restriccionId } = req.params;
  const { motivoLevantamiento, fechaLevantamiento } = req.body;

  if (!motivoLevantamiento || motivoLevantamiento.trim().length < 5) {
    return res.status(400).json({ error: 'motivoLevantamiento es obligatorio (minimo 5 caracteres).' });
  }

  try {
    const existenteRes = await query(
      `SELECT id, estado FROM restricciones_medicas WHERE id = $1 AND organizacion_id = $2`,
      [restriccionId, req.usuario.organizacionId]
    );
    if (existenteRes.rows.length === 0) {
      return res.status(404).json({ error: 'Restriccion no encontrada.' });
    }
    if (existenteRes.rows[0].estado === 'levantada') {
      return res.status(400).json({ error: 'Esta restriccion ya fue levantada.' });
    }

    const resultado = await withTransaction(async (client) => {
      const actualizadaRes = await client.query(
        `UPDATE restricciones_medicas SET
           estado = 'levantada',
           fecha_levantamiento = $1,
           motivo_levantamiento = $2,
           medico_ultima_modificacion_id = $3
         WHERE id = $4 AND organizacion_id = $5
         RETURNING id, estado, fecha_levantamiento`,
        [fechaLevantamiento || new Date().toISOString().slice(0, 10), motivoLevantamiento.trim(), req.usuario.id, restriccionId, req.usuario.organizacionId]
      );

      await client.query(
        `INSERT INTO restricciones_medicas_historial
          (restriccion_id, organizacion_id, accion, detalle, medico_id)
         VALUES ($1, $2, 'levantada', $3, $4)`,
        [restriccionId, req.usuario.organizacionId, motivoLevantamiento.trim(), req.usuario.id]
      );

      return actualizadaRes.rows[0];
    });

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'restriccion_medica_levantada',
      entidad: 'restricciones_medicas',
      entidadId: restriccionId,
      req,
    });

    return res.json({ restriccion: resultado });
  } catch (err) {
    console.error('Error en levantarRestriccion:', err);
    return res.status(500).json({ error: 'Error interno al levantar la restriccion.' });
  }
}

// ------------------------------------------------------------
// GET /api/restricciones-medicas/:restriccionId/historial
// medico, sso, th. Historial de cambios; sso/th reciben el
// historial SIN el campo "detalle" cuando este contiene motivo
// clinico (accion 'emitida' o 'modificada'), para no filtrar el
// criterio medico por la puerta trasera del historial.
// ------------------------------------------------------------
async function obtenerHistorial(req, res) {
  const { restriccionId } = req.params;
  try {
    const restriccionRes = await query(
      `SELECT id FROM restricciones_medicas WHERE id = $1 AND organizacion_id = $2`,
      [restriccionId, req.usuario.organizacionId]
    );
    if (restriccionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Restriccion no encontrada.' });
    }

    const historialRes = await query(
      `SELECT id, accion, detalle, medico_id, fecha_vigencia_hasta_anterior, fecha_vigencia_hasta_nueva, creado_en
       FROM restricciones_medicas_historial
       WHERE restriccion_id = $1 AND organizacion_id = $2
       ORDER BY creado_en DESC`,
      [restriccionId, req.usuario.organizacionId]
    );

    let filas = historialRes.rows;
    if (req.usuario.rol !== 'medico') {
      // sso/th: se quita el detalle en acciones que tipicamente
      // contienen el motivo clinico (emision/modificacion), pero se
      // conservan las fechas y la accion misma (informacion operativa).
      filas = filas.map((fila) => (
        ['emitida', 'modificada'].includes(fila.accion)
          ? { ...fila, detalle: null }
          : fila
      ));
    }

    return res.json({ historial: filas });
  } catch (err) {
    console.error('Error en obtenerHistorial (restricciones medicas):', err);
    return res.status(500).json({ error: 'Error interno al obtener el historial.' });
  }
}

module.exports = {
  emitirRestriccion,
  listarRestriccionesTrabajador,
  prorrogarRestriccion,
  modificarRestriccion,
  levantarRestriccion,
  obtenerHistorial,
};
