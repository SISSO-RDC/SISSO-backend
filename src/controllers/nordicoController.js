// ============================================================
// Controlador del Cuestionario Nordico Estandarizado. Ver
// src/nordico/nordico.js para el detalle de las zonas y el
// criterio de "atencion prioritaria" (senal, no diagnostico).
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { REGIONES, calcularResumenNordico } = require('../nordico/nordico');
const catalogosNordico = require('../nordico/nordico');

// CORREGIDO en Auditoria N.11 (hallazgo GRAVE G11-01, P1): la
// correccion de N.10 (G-N09-01) ya habia quitado `regiones` y
// `observaciones_generales` de la vista de SSO, pero la auditoria
// N.11 senala -con razon- que lo que quedaba (conteos de regiones
// con molestia a 12 meses/7 dias y el arreglo `regiones_prioritarias`,
// que es una lista NOMINAL de zonas corporales por nombre) sigue
// siendo informacion de salud asociada a una persona identificable.
// Un conteo de "cuantas zonas duelen" y una lista de "cuales zonas
// duelen" no dejan de ser datos de sintomas solo por no incluir el
// detalle completo por zona.
//
// Ahora SSO recibe UNICAMENTE una senal preventiva ya calculada
// (prioridad + accion sugerida), sin ningun conteo ni nombre de zona
// corporal. Todo el detalle -incluidos los conteos y la lista de
// zonas- queda reservado a medico.
function proyectarNordicoPorRol(fila, rol) {
  if (rol === 'medico') return fila;
  return {
    id: fila.id,
    trabajador_id: fila.trabajador_id,
    fecha_aplicacion: fila.fecha_aplicacion,
    prioridad_preventiva: fila.requiere_atencion_prioritaria ? 'alta' : 'rutinaria',
    accion_requerida: fila.requiere_atencion_prioritaria
      ? 'Derivar a valoracion ergonomica/medica prioritaria.'
      : 'Seguimiento preventivo rutinario.',
  };
}

// ------------------------------------------------------------
// GET /api/nordico/catalogos
// ------------------------------------------------------------
async function obtenerCatalogos(req, res) {
  const { REGIONES, REGIONES_BILATERALES, ETIQUETAS_REGIONES, OPCIONES_DURACION_EPISODIO,
    OPCIONES_TIEMPO_TOTAL_12_MESES, OPCIONES_TIEMPO_IMPEDIMENTO, OPCIONES_LADO } = catalogosNordico;
  return res.json({
    catalogos: {
      REGIONES, REGIONES_BILATERALES, ETIQUETAS_REGIONES, OPCIONES_DURACION_EPISODIO,
      OPCIONES_TIEMPO_TOTAL_12_MESES, OPCIONES_TIEMPO_IMPEDIMENTO, OPCIONES_LADO,
    },
  });
}

// ------------------------------------------------------------
// POST /api/nordico/trabajadores/:trabajadorId
// ------------------------------------------------------------
async function registrarCuestionario(req, res) {
  const { trabajadorId } = req.params;
  const { regiones, observacionesGenerales, fechaAplicacion } = req.body;

  try {
    const tRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (tRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    if (!regiones || typeof regiones !== 'object') {
      return res.status(400).json({ error: 'regiones es obligatorio.' });
    }
    const clavesInvalidas = Object.keys(regiones).filter(k => !REGIONES.includes(k));
    if (clavesInvalidas.length > 0) {
      return res.status(400).json({ error: `Zonas no reconocidas: ${clavesInvalidas.join(', ')}.` });
    }

    const resumen = calcularResumenNordico(regiones);

    const insertRes = await query(
      `INSERT INTO cuestionarios_nordicos (
        organizacion_id, trabajador_id, aplicado_por, fecha_aplicacion,
        regiones, regiones_con_molestia_12_meses, regiones_con_molestia_7_dias,
        regiones_prioritarias, requiere_atencion_prioritaria, observaciones_generales
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id, fecha_aplicacion, regiones_con_molestia_12_meses, regiones_con_molestia_7_dias,
                regiones_prioritarias, requiere_atencion_prioritaria`,
      [
        req.usuario.organizacionId, trabajadorId, req.usuario.id, fechaAplicacion || null,
        JSON.stringify(regiones), resumen.regionesConMolestia12Meses, resumen.regionesConMolestia7Dias,
        resumen.regionesPrioritarias, resumen.requiereAtencionPrioritaria, observacionesGenerales || null,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'registrar_cuestionario_nordico',
      entidad: 'cuestionario_nordico',
      entidadId: insertRes.rows[0].id,
      detalle: { trabajadorId, requiereAtencionPrioritaria: resumen.requiereAtencionPrioritaria },
      req,
    });

    return res.status(201).json({ cuestionario: insertRes.rows[0] });
  } catch (err) {
    console.error('Error en registrarCuestionario (nordico):', err);
    return res.status(500).json({ error: 'Error interno al registrar el cuestionario.' });
  }
}

// ------------------------------------------------------------
// GET /api/nordico/trabajadores/:trabajadorId
// ------------------------------------------------------------
async function listarCuestionarios(req, res) {
  try {
    const tRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );
    if (tRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    const res2 = await query(
      `SELECT c.id, c.fecha_aplicacion, c.regiones_con_molestia_12_meses, c.regiones_con_molestia_7_dias,
              c.regiones_prioritarias, c.requiere_atencion_prioritaria, c.observaciones_generales, c.creado_en,
              u.nombre_completo AS aplicado_por_nombre
       FROM cuestionarios_nordicos c
       JOIN usuarios u ON u.id = c.aplicado_por
       WHERE c.trabajador_id = $1 AND c.organizacion_id = $2
       ORDER BY c.fecha_aplicacion DESC`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );

    const cuestionarios = res2.rows.map((fila) => proyectarNordicoPorRol(fila, req.usuario.rol));
    return res.json({ cuestionarios });
  } catch (err) {
    console.error('Error en listarCuestionarios (nordico):', err);
    return res.status(500).json({ error: 'Error interno al listar los cuestionarios.' });
  }
}

// ------------------------------------------------------------
// GET /api/nordico/:cuestionarioId
// ------------------------------------------------------------
async function obtenerCuestionario(req, res) {
  try {
    const res2 = await query(
      `SELECT c.*, u.nombre_completo AS aplicado_por_nombre, t.nombre_completo AS trabajador_nombre
       FROM cuestionarios_nordicos c
       JOIN usuarios u ON u.id = c.aplicado_por
       JOIN trabajadores t ON t.id = c.trabajador_id
       WHERE c.id = $1 AND c.organizacion_id = $2`,
      [req.params.cuestionarioId, req.usuario.organizacionId]
    );
    if (res2.rows.length === 0) {
      return res.status(404).json({ error: 'Cuestionario no encontrado.' });
    }
    return res.json({ cuestionario: proyectarNordicoPorRol(res2.rows[0], req.usuario.rol) });
  } catch (err) {
    console.error('Error en obtenerCuestionario (nordico):', err);
    return res.status(500).json({ error: 'Error interno al obtener el cuestionario.' });
  }
}

module.exports = { obtenerCatalogos, registrarCuestionario, listarCuestionarios, obtenerCuestionario };
