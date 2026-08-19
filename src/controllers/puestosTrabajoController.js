// ============================================================
// Controlador de Puestos de Trabajo (catalogo complementario, ver
// migration_022_puestos_trabajo.sql). Reutiliza el catalogo fijo
// de riesgos y su validador de src/historiaClinica/, para no
// duplicar esa taxonomia en dos lugares del sistema.
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { validarFactoresRiesgo } = require('../historiaClinica/historiaClinica');
const catalogosRiesgo = require('../historiaClinica/catalogosRiesgo');

// ------------------------------------------------------------
// GET /api/puestos-trabajo/catalogos
// ------------------------------------------------------------
async function obtenerCatalogos(req, res) {
  return res.json({ catalogos: catalogosRiesgo });
}

// ------------------------------------------------------------
// POST /api/puestos-trabajo
// ------------------------------------------------------------
async function crear(req, res) {
  const b = req.body;

  const errorRiesgos = validarFactoresRiesgo(b.factoresRiesgo);
  if (errorRiesgos) {
    return res.status(400).json({ error: errorRiesgos });
  }

  try {
    const resultado = await query(
      `INSERT INTO puestos_trabajo (
        organizacion_id, nombre_puesto, area, codigo_ciuo, descripcion_actividades,
        numero_trabajadores_estimado, factores_riesgo, epp_requerido, medidas_preventivas, creado_por
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id, nombre_puesto, area, activo, creado_en`,
      [
        req.usuario.organizacionId, b.nombrePuesto, b.area || null, b.codigoCiuo || null, b.descripcionActividades || null,
        b.numeroTrabajadoresEstimado || null, b.factoresRiesgo ? JSON.stringify(b.factoresRiesgo) : null,
        b.eppRequerido || null, b.medidasPreventivas || null, req.usuario.id,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'crear_puesto_trabajo',
      entidad: 'puesto_trabajo',
      entidadId: resultado.rows[0].id,
      req,
    });

    return res.status(201).json({ puesto: resultado.rows[0] });
  } catch (err) {
    console.error('Error en crear (puestos de trabajo):', err);
    return res.status(500).json({ error: 'Error interno al crear el puesto de trabajo.' });
  }
}

// ------------------------------------------------------------
// GET /api/puestos-trabajo
// ------------------------------------------------------------
async function listar(req, res) {
  try {
    const resultado = await query(
      `SELECT id, nombre_puesto, area, codigo_ciuo, numero_trabajadores_estimado, activo, creado_en
       FROM puestos_trabajo
       WHERE organizacion_id = $1 AND activo = true
       ORDER BY nombre_puesto ASC`,
      [req.usuario.organizacionId]
    );
    return res.json({ puestos: resultado.rows });
  } catch (err) {
    console.error('Error en listar (puestos de trabajo):', err);
    return res.status(500).json({ error: 'Error interno al listar los puestos de trabajo.' });
  }
}

// ------------------------------------------------------------
// GET /api/puestos-trabajo/:id
// ------------------------------------------------------------
async function obtener(req, res) {
  try {
    const resultado = await query(
      `SELECT p.*, u.nombre_completo AS creado_por_nombre,
              (SELECT count(*) FROM trabajadores t WHERE t.puesto_trabajo_id = p.id AND t.activo = true) AS trabajadores_asignados
       FROM puestos_trabajo p
       JOIN usuarios u ON u.id = p.creado_por
       WHERE p.id = $1 AND p.organizacion_id = $2`,
      [req.params.id, req.usuario.organizacionId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Puesto de trabajo no encontrado.' });
    }
    return res.json({ puesto: resultado.rows[0] });
  } catch (err) {
    console.error('Error en obtener (puestos de trabajo):', err);
    return res.status(500).json({ error: 'Error interno al obtener el puesto de trabajo.' });
  }
}

// ------------------------------------------------------------
// PUT /api/puestos-trabajo/:id
// ------------------------------------------------------------
async function actualizar(req, res) {
  const b = req.body;

  const errorRiesgos = validarFactoresRiesgo(b.factoresRiesgo);
  if (errorRiesgos) {
    return res.status(400).json({ error: errorRiesgos });
  }

  try {
    const resultado = await query(
      `UPDATE puestos_trabajo
       SET nombre_puesto = $1, area = $2, codigo_ciuo = $3, descripcion_actividades = $4,
           numero_trabajadores_estimado = $5, factores_riesgo = $6, epp_requerido = $7, medidas_preventivas = $8
       WHERE id = $9 AND organizacion_id = $10
       RETURNING id, nombre_puesto, area, activo`,
      [
        b.nombrePuesto, b.area || null, b.codigoCiuo || null, b.descripcionActividades || null,
        b.numeroTrabajadoresEstimado || null, b.factoresRiesgo ? JSON.stringify(b.factoresRiesgo) : null,
        b.eppRequerido || null, b.medidasPreventivas || null,
        req.params.id, req.usuario.organizacionId,
      ]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Puesto de trabajo no encontrado.' });
    }

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'actualizar_puesto_trabajo',
      entidad: 'puesto_trabajo',
      entidadId: req.params.id,
      req,
    });

    return res.json({ puesto: resultado.rows[0] });
  } catch (err) {
    console.error('Error en actualizar (puestos de trabajo):', err);
    return res.status(500).json({ error: 'Error interno al actualizar el puesto de trabajo.' });
  }
}

// ------------------------------------------------------------
// DELETE /api/puestos-trabajo/:id
// Baja logica (activo = false), mismo patron que trabajadores.
// ------------------------------------------------------------
async function desactivar(req, res) {
  try {
    const resultado = await query(
      `UPDATE puestos_trabajo SET activo = false WHERE id = $1 AND organizacion_id = $2 RETURNING id`,
      [req.params.id, req.usuario.organizacionId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Puesto de trabajo no encontrado.' });
    }

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'desactivar_puesto_trabajo',
      entidad: 'puesto_trabajo',
      entidadId: req.params.id,
      req,
    });

    return res.json({ mensaje: 'Puesto de trabajo desactivado.' });
  } catch (err) {
    console.error('Error en desactivar (puestos de trabajo):', err);
    return res.status(500).json({ error: 'Error interno al desactivar el puesto de trabajo.' });
  }
}

module.exports = { obtenerCatalogos, crear, listar, obtener, actualizar, desactivar };
