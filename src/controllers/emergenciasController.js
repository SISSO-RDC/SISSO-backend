// ============================================================
// Controlador de Emergencias (Lote 4, Sep 2026): planes,
// simulacros y equipos criticos (extintores, gabinetes, alarmas,
// DEA, duchas/lavaojos, botiquines, kits de derrame).
// Gestion: admin, sso.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { columnas } = require('../db/columnasExplicitas');
const { registrarAuditoria } = require('../utils/auditoria');
const { analizarDataUri } = require('../utils/validarArchivo');
const { subirEvidenciaConCompensacion } = require('../servicios/cloudinaryService');

const CARPETA_PLANES_EMERGENCIA = 'sisso/planes-emergencia';
const ESCENARIOS_VALIDOS = ['incendio', 'sismo', 'derrame_quimico', 'evacuacion', 'atencion_medica', 'otro'];
const TIPOS_EQUIPO_VALIDOS = ['extintor', 'gabinete_contraincendios', 'alarma', 'dea', 'ducha_lavaojos', 'botiquin', 'kit_derrame', 'otro'];

// ======================= PLANES =======================

async function crearPlan(req, res) {
  const orgId = req.usuario.organizacionId;
  const { nombre, escenario, areaCobertura, archivoBase64 } = req.body;

  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'nombre es obligatorio.' });
  if (!ESCENARIOS_VALIDOS.includes(escenario)) {
    return res.status(400).json({ error: `escenario invalido. Valores permitidos: ${ESCENARIOS_VALIDOS.join(', ')}.` });
  }

  let archivoValidado = null;
  if (archivoBase64) {
    const chk = analizarDataUri(archivoBase64, 'documento_control');
    if (!chk.ok) return res.status(400).json({ error: `archivoBase64 invalido: ${chk.motivo}` });
    archivoValidado = archivoBase64;
  }

  try {
    const insertarPlan = async (client, publicId) => {
      const insertRes = await client.query(
        `INSERT INTO emergencias_planes (organizacion_id, nombre, escenario, area_cobertura, public_id, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, nombre, escenario, version, vigente, creado_en`,
        [orgId, nombre.trim(), escenario, areaCobertura || null, publicId, req.usuario.id]
      );

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'plan_emergencia_creado',
        entidad: 'emergencias_planes', entidadId: insertRes.rows[0].id, detalle: { nombre, escenario }, req, client,
      });
      return insertRes;
    };

    let resultado;
    if (archivoValidado) {
      const { resultado: r } = await subirEvidenciaConCompensacion(
        archivoValidado, orgId, CARPETA_PLANES_EMERGENCIA, { politica: 'documento_control' },
        (subidaInfo) => withTransaction((client) => insertarPlan(client, subidaInfo.publicId))
      );
      resultado = r;
    } else {
      resultado = await withTransaction((client) => insertarPlan(client, null));
    }

    return res.status(201).json({ plan: resultado.rows[0] });
  } catch (err) {
    console.error('Error en crearPlan (emergencias):', err);
    return res.status(500).json({ error: 'Error interno al crear el plan de emergencia.' });
  }
}

async function listarPlanes(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const resultado = await query(
      `SELECT p.id, p.nombre, p.escenario, p.area_cobertura, p.version, p.vigente, p.creado_en,
              COUNT(s.id) AS total_simulacros, MAX(s.fecha_realizado) AS ultimo_simulacro
       FROM emergencias_planes p
       LEFT JOIN emergencias_simulacros s ON s.plan_id = p.id
       WHERE p.organizacion_id = $1
       GROUP BY p.id ORDER BY p.nombre ASC`,
      [orgId]
    );
    return res.json({ planes: resultado.rows });
  } catch (err) {
    console.error('Error en listarPlanes (emergencias):', err);
    return res.status(500).json({ error: 'Error interno al listar los planes de emergencia.' });
  }
}

async function obtenerPlan(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const planRes = await query(
      `SELECT ${columnas('emergencias_planes', 'p')} FROM emergencias_planes p WHERE p.id = $1 AND p.organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (planRes.rows.length === 0) return res.status(404).json({ error: 'Plan de emergencia no encontrado.' });

    const simulacrosRes = await query(
      `SELECT ${columnas('emergencias_simulacros', 's')} FROM emergencias_simulacros s
       WHERE s.plan_id = $1 ORDER BY s.fecha_realizado DESC`,
      [req.params.id]
    );

    return res.json({ plan: planRes.rows[0], simulacros: simulacrosRes.rows });
  } catch (err) {
    console.error('Error en obtenerPlan (emergencias):', err);
    return res.status(500).json({ error: 'Error interno al obtener el plan de emergencia.' });
  }
}

// ======================= SIMULACROS =======================

async function registrarSimulacro(req, res) {
  const orgId = req.usuario.organizacionId;
  const { fechaRealizado, asistentes, duracionMinutos, hallazgos } = req.body;

  if (!fechaRealizado) return res.status(400).json({ error: 'fechaRealizado es obligatoria.' });

  try {
    const planRes = await query(`SELECT id FROM emergencias_planes WHERE id = $1 AND organizacion_id = $2`, [req.params.id, orgId]);
    if (planRes.rows.length === 0) return res.status(404).json({ error: 'Plan de emergencia no encontrado.' });

    const resultado = await withTransaction(async (client) => {
      const insertRes = await client.query(
        `INSERT INTO emergencias_simulacros (plan_id, organizacion_id, fecha_realizado, asistentes, duracion_minutos, hallazgos, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, fecha_realizado, asistentes, creado_en`,
        [req.params.id, orgId, fechaRealizado, asistentes || null, duracionMinutos || null, hallazgos || null, req.usuario.id]
      );

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'simulacro_emergencia_registrado',
        entidad: 'emergencias_simulacros', entidadId: insertRes.rows[0].id, detalle: { planId: req.params.id }, req, client,
      });
      return insertRes;
    });

    return res.status(201).json({ simulacro: resultado.rows[0] });
  } catch (err) {
    console.error('Error en registrarSimulacro (emergencias):', err);
    return res.status(500).json({ error: 'Error interno al registrar el simulacro.' });
  }
}

// ------------------------------------------------------------
// POST /api/emergencias/simulacros/:simulacroId/generar-capa
// Mismo patron ya usado en obligacionesLegalesController y
// reportesPeligroController: solo se genera si hay hallazgos.
// ------------------------------------------------------------
async function generarCapaDesdeSimulacro(req, res) {
  const orgId = req.usuario.organizacionId;
  const { responsableId, fechaLimite } = req.body;

  if (!responsableId || !fechaLimite) return res.status(400).json({ error: 'responsableId y fechaLimite son obligatorios.' });

  try {
    const simulacroRes = await query(
      `SELECT s.id, s.hallazgos, s.capa_id, p.nombre AS plan_nombre
       FROM emergencias_simulacros s JOIN emergencias_planes p ON p.id = s.plan_id
       WHERE s.id = $1 AND s.organizacion_id = $2`,
      [req.params.simulacroId, orgId]
    );
    if (simulacroRes.rows.length === 0) return res.status(404).json({ error: 'Simulacro no encontrado.' });
    const simulacro = simulacroRes.rows[0];
    if (simulacro.capa_id) return res.status(409).json({ error: 'Este simulacro ya tiene una accion CAPA asociada.' });
    if (!simulacro.hallazgos) return res.status(400).json({ error: 'El simulacro no tiene hallazgos registrados.' });

    const resultado = await withTransaction(async (client) => {
      const capaRes = await client.query(
        `INSERT INTO capa_acciones
          (organizacion_id, origen_tipo, origen_id, origen_descripcion, tipo, hallazgo, descripcion_accion,
           responsable_id, fecha_limite, creado_por)
         VALUES ($1,'simulacro_emergencia',$2,$3,'correctiva',$4,$5,$6,$7,$8)
         RETURNING id`,
        [
          orgId, simulacro.id, `Simulacro: ${simulacro.plan_nombre}`, simulacro.hallazgos,
          `Atender los hallazgos del simulacro de ${simulacro.plan_nombre}`, responsableId, fechaLimite, req.usuario.id,
        ]
      );
      await client.query(`UPDATE emergencias_simulacros SET capa_id = $1 WHERE id = $2`, [capaRes.rows[0].id, req.params.simulacroId]);

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'capa_generada_desde_simulacro',
        entidad: 'capa_acciones', entidadId: capaRes.rows[0].id, detalle: { simulacroId: req.params.simulacroId }, req, client,
      });
      return capaRes;
    });

    return res.status(201).json({ capaId: resultado.rows[0].id });
  } catch (err) {
    console.error('Error en generarCapaDesdeSimulacro (emergencias):', err);
    return res.status(500).json({ error: 'Error interno al generar la accion CAPA.' });
  }
}

// ======================= EQUIPOS DE EMERGENCIA =======================

async function crearEquipo(req, res) {
  const orgId = req.usuario.organizacionId;
  const { tipo, codigoIdentificacion, ubicacion, fechaUltimaInspeccion, fechaProximaInspeccion } = req.body;

  if (!TIPOS_EQUIPO_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: `tipo invalido. Valores permitidos: ${TIPOS_EQUIPO_VALIDOS.join(', ')}.` });
  }
  if (!ubicacion || !ubicacion.trim()) return res.status(400).json({ error: 'ubicacion es obligatoria.' });

  try {
    const insertRes = await withTransaction(async (client) => {
      const r = await client.query(
        `INSERT INTO emergencias_equipos (organizacion_id, tipo, codigo_identificacion, ubicacion, fecha_ultima_inspeccion, fecha_proxima_inspeccion, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, tipo, ubicacion, estado, creado_en`,
        [orgId, tipo, codigoIdentificacion || null, ubicacion.trim(), fechaUltimaInspeccion || null, fechaProximaInspeccion || null, req.usuario.id]
      );
      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'equipo_emergencia_creado',
        entidad: 'emergencias_equipos', entidadId: r.rows[0].id, detalle: { tipo, ubicacion: ubicacion.trim() }, req, client,
      });
      return r;
    });
    return res.status(201).json({ equipo: insertRes.rows[0] });
  } catch (err) {
    console.error('Error en crearEquipo (emergencias):', err);
    return res.status(500).json({ error: 'Error interno al registrar el equipo de emergencia.' });
  }
}

// GET /api/emergencias/equipos  (filtros: tipo, estado, vencidos=true)
async function listarEquipos(req, res) {
  const orgId = req.usuario.organizacionId;
  const { tipo, estado, vencidos } = req.query;

  const condiciones = ['organizacion_id = $1'];
  const parametros = [orgId];
  if (tipo) { parametros.push(tipo); condiciones.push(`tipo = $${parametros.length}`); }
  if (estado) { parametros.push(estado); condiciones.push(`estado = $${parametros.length}`); }
  if (vencidos === 'true') condiciones.push(`fecha_proxima_inspeccion < CURRENT_DATE`);

  try {
    const resultado = await query(
      `SELECT id, tipo, codigo_identificacion, ubicacion, estado, fecha_ultima_inspeccion, fecha_proxima_inspeccion,
              (fecha_proxima_inspeccion IS NOT NULL AND fecha_proxima_inspeccion < CURRENT_DATE) AS inspeccion_vencida
       FROM emergencias_equipos WHERE ${condiciones.join(' AND ')}
       ORDER BY fecha_proxima_inspeccion ASC NULLS LAST`,
      parametros
    );
    return res.json({ equipos: resultado.rows });
  } catch (err) {
    console.error('Error en listarEquipos (emergencias):', err);
    return res.status(500).json({ error: 'Error interno al listar los equipos de emergencia.' });
  }
}

// PATCH /api/emergencias/equipos/:id/inspeccion
async function registrarInspeccionEquipo(req, res) {
  const orgId = req.usuario.organizacionId;
  const { fechaInspeccion, fechaProximaInspeccion, estado } = req.body;

  if (!fechaInspeccion) return res.status(400).json({ error: 'fechaInspeccion es obligatoria.' });
  if (estado && !['operativo', 'requiere_mantenimiento', 'fuera_de_servicio'].includes(estado)) {
    return res.status(400).json({ error: 'estado invalido. Valores permitidos: operativo, requiere_mantenimiento, fuera_de_servicio.' });
  }

  try {
    const updateRes = await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE emergencias_equipos
         SET fecha_ultima_inspeccion = $1, fecha_proxima_inspeccion = $2, estado = COALESCE($3, estado)
         WHERE id = $4 AND organizacion_id = $5
         RETURNING id, estado, fecha_ultima_inspeccion, fecha_proxima_inspeccion`,
        [fechaInspeccion, fechaProximaInspeccion || null, estado || null, req.params.id, orgId]
      );
      if (r.rows.length === 0) return r;
      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'equipo_emergencia_inspeccionado',
        entidad: 'emergencias_equipos', entidadId: req.params.id, detalle: { fechaInspeccion, estado: r.rows[0].estado }, req, client,
      });
      return r;
    });
    if (updateRes.rows.length === 0) return res.status(404).json({ error: 'Equipo de emergencia no encontrado.' });
    return res.json({ equipo: updateRes.rows[0] });
  } catch (err) {
    console.error('Error en registrarInspeccionEquipo (emergencias):', err);
    return res.status(500).json({ error: 'Error interno al registrar la inspeccion.' });
  }
}

module.exports = {
  crearPlan, listarPlanes, obtenerPlan, registrarSimulacro, generarCapaDesdeSimulacro,
  crearEquipo, listarEquipos, registrarInspeccionEquipo,
};
