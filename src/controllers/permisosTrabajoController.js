// ============================================================
// Controlador de Permisos de Trabajo (Lote 3, Sep 2026): control
// de tareas criticas (trabajo en caliente, altura, espacio
// confinado, electrico/LOTO, excavacion, izaje). Cada permiso
// lleva su propio JSA/AST por pasos (peligro + control + EPP) y
// firmas de los participantes.
//
// Ciclo de estados (siempre manual, nunca automatico):
//   borrador -> aprobado -> en_ejecucion -> cerrado
//                                        -> cancelado (desde cualquier estado previo a cerrado)
// iniciarEjecucion EXIGE condiciones_verificadas=true -- el
// checklist de inicio (aislamiento de energia, EPP, atmosfera
// medida, etc.) se marca explicitamente, nunca se asume.
// Gestion: admin, sso. Los roles medico/th no participan de este
// modulo (no es informacion clinica).
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { columnas } = require('../db/columnasExplicitas');
const { registrarAuditoria } = require('../utils/auditoria');

const TIPOS_VALIDOS = ['trabajo_caliente', 'trabajo_altura', 'espacio_confinado', 'electrico_loto', 'excavacion', 'izaje_cargas', 'otro'];

// ------------------------------------------------------------
// POST /api/permisos-trabajo
// Body incluye pasos: [{ ordenTarea/paso, peligroIdentificado, medidaControl, eppRequerido }]
// ------------------------------------------------------------
async function crear(req, res) {
  const orgId = req.usuario.organizacionId;
  const {
    tipo, area, descripcionTarea, contratistaId, fechaInicioPrevista, fechaFinPrevista, pasos,
  } = req.body;

  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: `tipo invalido. Valores permitidos: ${TIPOS_VALIDOS.join(', ')}.` });
  }
  if (!area || !area.trim()) return res.status(400).json({ error: 'area es obligatoria.' });
  if (!descripcionTarea || descripcionTarea.trim().length < 10) {
    return res.status(400).json({ error: 'descripcionTarea es obligatoria (minimo 10 caracteres).' });
  }
  if (!fechaInicioPrevista || !fechaFinPrevista) {
    return res.status(400).json({ error: 'fechaInicioPrevista y fechaFinPrevista son obligatorias.' });
  }
  if (new Date(fechaFinPrevista) <= new Date(fechaInicioPrevista)) {
    return res.status(400).json({ error: 'fechaFinPrevista debe ser posterior a fechaInicioPrevista.' });
  }
  if (!Array.isArray(pasos) || pasos.length === 0) {
    return res.status(400).json({ error: 'pasos es obligatorio: el Analisis Seguro de Trabajo (JSA/AST) debe tener al menos un paso.' });
  }
  for (const [i, p] of pasos.entries()) {
    if (!p.paso || !p.peligroIdentificado || !p.medidaControl) {
      return res.status(400).json({ error: `El paso ${i + 1} requiere paso, peligroIdentificado y medidaControl.` });
    }
  }

  try {
    if (contratistaId) {
      const contratistaRes = await query(`SELECT id FROM contratistas WHERE id = $1 AND organizacion_id = $2`, [contratistaId, orgId]);
      if (contratistaRes.rows.length === 0) return res.status(404).json({ error: 'Contratista no encontrado.' });
    }

    const resultado = await withTransaction(async (client) => {
      const insertRes = await client.query(
        `INSERT INTO permisos_trabajo
          (organizacion_id, tipo, area, descripcion_tarea, contratista_id, solicitante_id, fecha_inicio_prevista, fecha_fin_prevista, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, tipo, estado, creado_en`,
        [orgId, tipo, area.trim(), descripcionTarea.trim(), contratistaId || null, req.usuario.id,
          fechaInicioPrevista, fechaFinPrevista, req.usuario.id]
      );
      const permisoId = insertRes.rows[0].id;

      for (const [i, p] of pasos.entries()) {
        await client.query(
          `INSERT INTO permisos_trabajo_pasos (permiso_id, organizacion_id, orden, paso_tarea, peligro_identificado, medida_control, epp_requerido)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [permisoId, orgId, i + 1, p.paso.trim(), p.peligroIdentificado.trim(), p.medidaControl.trim(), p.eppRequerido || null]
        );
      }

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'permiso_trabajo_creado',
        entidad: 'permisos_trabajo', entidadId: permisoId, detalle: { tipo, area }, req, client,
      });

      return insertRes;
    });

    return res.status(201).json({ permiso: resultado.rows[0] });
  } catch (err) {
    console.error('Error en crear (permisos de trabajo):', err);
    return res.status(500).json({ error: 'Error interno al crear el permiso de trabajo.' });
  }
}

// ------------------------------------------------------------
// GET /api/permisos-trabajo  (filtros: estado, tipo)
// ------------------------------------------------------------
async function listar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado, tipo } = req.query;

  const condiciones = ['p.organizacion_id = $1'];
  const parametros = [orgId];
  if (estado) { parametros.push(estado); condiciones.push(`p.estado = $${parametros.length}`); }
  if (tipo) { parametros.push(tipo); condiciones.push(`p.tipo = $${parametros.length}`); }

  try {
    const resultado = await query(
      `SELECT p.id, p.tipo, p.area, p.estado, p.fecha_inicio_prevista, p.fecha_fin_prevista,
              c.razon_social AS contratista_nombre, s.nombre_completo AS solicitante_nombre
       FROM permisos_trabajo p
       LEFT JOIN contratistas c ON c.id = p.contratista_id
       LEFT JOIN usuarios s ON s.id = p.solicitante_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY p.fecha_inicio_prevista DESC`,
      parametros
    );
    return res.json({ permisos: resultado.rows });
  } catch (err) {
    console.error('Error en listar (permisos de trabajo):', err);
    return res.status(500).json({ error: 'Error interno al listar los permisos de trabajo.' });
  }
}

// ------------------------------------------------------------
// GET /api/permisos-trabajo/:id
// ------------------------------------------------------------
async function obtener(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const permisoRes = await query(
      `SELECT ${columnas('permisos_trabajo', 'p')}, c.razon_social AS contratista_nombre,
              s.nombre_completo AS solicitante_nombre, au.nombre_completo AS autorizado_por_nombre
       FROM permisos_trabajo p
       LEFT JOIN contratistas c ON c.id = p.contratista_id
       LEFT JOIN usuarios s ON s.id = p.solicitante_id
       LEFT JOIN usuarios au ON au.id = p.autorizado_por
       WHERE p.id = $1 AND p.organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (permisoRes.rows.length === 0) return res.status(404).json({ error: 'Permiso de trabajo no encontrado.' });

    const pasosRes = await query(
      `SELECT ${columnas('permisos_trabajo_pasos', 'pp')} FROM permisos_trabajo_pasos pp
       WHERE pp.permiso_id = $1 ORDER BY pp.orden ASC`,
      [req.params.id]
    );
    const firmasRes = await query(
      `SELECT f.id, f.rol_firma, f.firmado_en,
              COALESCE(t.nombre_completo, ct.nombre_completo) AS firmante_nombre
       FROM permisos_trabajo_firmas f
       LEFT JOIN trabajadores t ON t.id = f.trabajador_id
       LEFT JOIN contratistas_trabajadores ct ON ct.id = f.contratista_trabajador_id
       WHERE f.permiso_id = $1 ORDER BY f.firmado_en ASC`,
      [req.params.id]
    );

    return res.json({ permiso: permisoRes.rows[0], pasos: pasosRes.rows, firmas: firmasRes.rows });
  } catch (err) {
    console.error('Error en obtener (permisos de trabajo):', err);
    return res.status(500).json({ error: 'Error interno al obtener el permiso de trabajo.' });
  }
}

async function cambiarEstadoGenerico(req, res, { estadoRequerido, estadoNuevo, accion, camposExtra, validarExtra }) {
  const orgId = req.usuario.organizacionId;
  try {
    const actual = await query(`SELECT id, estado, condiciones_verificadas FROM permisos_trabajo WHERE id = $1 AND organizacion_id = $2`, [req.params.id, orgId]);
    if (actual.rows.length === 0) return res.status(404).json({ error: 'Permiso de trabajo no encontrado.' });
    if (estadoRequerido && actual.rows[0].estado !== estadoRequerido) {
      return res.status(409).json({ error: `El permiso debe estar en estado '${estadoRequerido}' para esta accion (estado actual: '${actual.rows[0].estado}').` });
    }
    if (validarExtra) {
      const err = validarExtra(actual.rows[0], req.body);
      if (err) return res.status(400).json({ error: err });
    }

    const { setClause, valores } = camposExtra ? camposExtra(req.body) : { setClause: '', valores: [] };

    const resultado = await withTransaction(async (client) => {
      const updateRes = await client.query(
        `UPDATE permisos_trabajo SET estado = $1${setClause} WHERE id = $2 AND organizacion_id = $3 RETURNING id, estado`,
        [estadoNuevo, req.params.id, orgId, ...valores]
      );

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion,
        entidad: 'permisos_trabajo', entidadId: req.params.id, detalle: { estadoNuevo }, req, client,
      });
      return updateRes;
    });

    return res.json({ permiso: resultado.rows[0] });
  } catch (err) {
    console.error(`Error en cambio de estado (permisos de trabajo, accion=${accion}):`, err);
    return res.status(500).json({ error: 'Error interno al cambiar el estado del permiso de trabajo.' });
  }
}

// PATCH /api/permisos-trabajo/:id/aprobar
function aprobar(req, res) {
  return cambiarEstadoGenerico(req, res, {
    estadoRequerido: 'borrador', estadoNuevo: 'aprobado', accion: 'permiso_trabajo_aprobado',
    camposExtra: () => ({ setClause: ', autorizado_por = $4', valores: [req.usuario.id] }),
  });
}

// PATCH /api/permisos-trabajo/:id/iniciar-ejecucion
// Body: { condicionesVerificadas: true } -- obligatorio y explicito.
function iniciarEjecucion(req, res) {
  return cambiarEstadoGenerico(req, res, {
    estadoRequerido: 'aprobado', estadoNuevo: 'en_ejecucion', accion: 'permiso_trabajo_iniciado',
    validarExtra: (_actual, body) => (body.condicionesVerificadas !== true
      ? 'condicionesVerificadas debe enviarse explicitamente como true (checklist de inicio: aislamiento de energia, EPP, atmosfera medida, etc.).'
      : null),
    camposExtra: () => ({ setClause: ', condiciones_verificadas = true', valores: [] }),
  });
}

// PATCH /api/permisos-trabajo/:id/cerrar
// Body: { notasCierre } opcional
function cerrar(req, res) {
  return cambiarEstadoGenerico(req, res, {
    estadoRequerido: 'en_ejecucion', estadoNuevo: 'cerrado', accion: 'permiso_trabajo_cerrado',
    camposExtra: (body) => ({ setClause: ', cerrado_por = $4, cerrado_en = now(), notas_cierre = $5', valores: [req.usuario.id, body.notasCierre || null] }),
  });
}

// PATCH /api/permisos-trabajo/:id/cancelar
// Body: { motivo } -- se guarda en notas_cierre para trazabilidad.
function cancelar(req, res) {
  return cambiarEstadoGenerico(req, res, {
    estadoRequerido: null, estadoNuevo: 'cancelado', accion: 'permiso_trabajo_cancelado',
    validarExtra: (actual) => (['cerrado', 'cancelado'].includes(actual.estado) ? `No se puede cancelar un permiso en estado '${actual.estado}'.` : null),
    camposExtra: (body) => ({ setClause: ', notas_cierre = $4', valores: [body.motivo || null] }),
  });
}

// ------------------------------------------------------------
// POST /api/permisos-trabajo/:id/firmas
// Exactamente uno de trabajadorId / contratistaTrabajadorId.
// ------------------------------------------------------------
async function firmar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { trabajadorId, contratistaTrabajadorId, rolFirma, firmaPublicId } = req.body;

  if (Boolean(trabajadorId) === Boolean(contratistaTrabajadorId)) {
    return res.status(400).json({ error: 'Debe indicar exactamente uno: trabajadorId o contratistaTrabajadorId.' });
  }
  if (rolFirma && !['ejecutante', 'supervisor', 'vigia'].includes(rolFirma)) {
    return res.status(400).json({ error: 'rolFirma invalido. Valores permitidos: ejecutante, supervisor, vigia.' });
  }

  try {
    const permisoRes = await query(`SELECT id FROM permisos_trabajo WHERE id = $1 AND organizacion_id = $2`, [req.params.id, orgId]);
    if (permisoRes.rows.length === 0) return res.status(404).json({ error: 'Permiso de trabajo no encontrado.' });

    const insertRes = await query(
      `INSERT INTO permisos_trabajo_firmas (permiso_id, organizacion_id, trabajador_id, contratista_trabajador_id, rol_firma, firma_public_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, rol_firma, firmado_en`,
      [req.params.id, orgId, trabajadorId || null, contratistaTrabajadorId || null, rolFirma || 'ejecutante', firmaPublicId || null]
    );

    return res.status(201).json({ firma: insertRes.rows[0] });
  } catch (err) {
    console.error('Error en firmar (permisos de trabajo):', err);
    return res.status(500).json({ error: 'Error interno al registrar la firma.' });
  }
}

module.exports = { crear, listar, obtener, aprobar, iniciarEjecucion, cerrar, cancelar, firmar };
