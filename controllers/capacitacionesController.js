// ============================================================
// Controlador de Capacitaciones (para certificados de
// asistencia). Dato organizacional de gestion SSO/RRHH, no
// clinico individual: mismo criterio de roles que puestos de
// trabajo / matriz de riesgos (admin, sso, th).
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

// ------------------------------------------------------------
// GET /api/capacitaciones
// ------------------------------------------------------------
async function listar(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const resultado = await query(
      `SELECT c.id, c.nombre, c.tema, c.instructor, c.instructor_usuario_id, c.fecha, c.horas_duracion, c.creado_en,
              COUNT(a.id) AS total_asistentes
       FROM capacitaciones c
       LEFT JOIN capacitaciones_asistentes a ON a.capacitacion_id = c.id
       WHERE c.organizacion_id = $1
       GROUP BY c.id
       ORDER BY c.fecha DESC`,
      [orgId]
    );
    return res.json({ capacitaciones: resultado.rows });
  } catch (err) {
    console.error('Error en listar (capacitaciones):', err);
    return res.status(500).json({ error: 'Error interno al listar las capacitaciones.' });
  }
}

// ------------------------------------------------------------
// GET /api/capacitaciones/:id  (incluye lista de asistentes)
// ------------------------------------------------------------
async function obtener(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const capacitacion = await query(
      `SELECT * FROM capacitaciones WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (capacitacion.rows.length === 0) {
      return res.status(404).json({ error: 'Capacitación no encontrada.' });
    }

    const asistentes = await query(
      `SELECT t.id AS trabajador_id, t.nombre_completo, t.documento, t.area
       FROM capacitaciones_asistentes a
       JOIN trabajadores t ON t.id = a.trabajador_id
       WHERE a.capacitacion_id = $1
       ORDER BY t.nombre_completo`,
      [req.params.id]
    );

    return res.json({ capacitacion: capacitacion.rows[0], asistentes: asistentes.rows });
  } catch (err) {
    console.error('Error en obtener (capacitaciones):', err);
    return res.status(500).json({ error: 'Error interno al obtener la capacitación.' });
  }
}

// ------------------------------------------------------------
// POST /api/capacitaciones
// Crea la capacitacion y su lista de asistentes en una sola
// transaccion (o se crea todo o no se crea nada, para no dejar
// una capacitacion "a medias" sin asistentes si algo falla a
// mitad de camino).
//
// CORREGIDO a pedido de la persona usuaria (02/09/2026): "el acceso
// a las capacitaciones debera tambien darse por la persona que hace
// la capacitacion". Antes solo admin/sso/th podian crear (ver
// capacitacionesRoutes.js, ahora abierto a cualquier autenticado).
// Un usuario que NO es admin/sso/th (ej. medico, o cualquier otro
// rol futuro) SOLO puede crear una capacitacion si se asigna a si
// mismo como instructor interno (instructorUsuarioId === su propio
// id) -- es decir, unicamente puede registrar capacitaciones que EL
// MISMO dicto, nunca en nombre de otra persona ni sin vincularse
// como instructor.
// ------------------------------------------------------------
async function crear(req, res) {
  const orgId = req.usuario.organizacionId;
  const b = req.body;
  const ROLES_GESTION = ['admin', 'sso', 'th'];

  if (!b.nombre || !b.fecha || !b.horasDuracion) {
    return res.status(400).json({ error: 'nombre, fecha y horasDuracion son obligatorios.' });
  }

  let instructorUsuarioId = b.instructorUsuarioId || null;
  if (!ROLES_GESTION.includes(req.usuario.rol)) {
    if (instructorUsuarioId && instructorUsuarioId !== req.usuario.id) {
      return res.status(403).json({ error: 'Solo puedes registrar capacitaciones que tú mismo dictaste (instructorUsuarioId debe ser tu propio usuario).' });
    }
    // Un usuario fuera de admin/sso/th SIEMPRE se auto-asigna como
    // instructor: es la unica forma en que tiene acceso a este endpoint.
    instructorUsuarioId = req.usuario.id;
  }

  const asistentesIds = Array.isArray(b.asistentes) ? [...new Set(b.asistentes)] : [];

  try {
    const capacitacionCreada = await withTransaction(async (cliente) => {
      const capacitacion = await cliente.query(
        `INSERT INTO capacitaciones (organizacion_id, nombre, tema, instructor, instructor_usuario_id, fecha, horas_duracion, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, nombre, fecha, horas_duracion`,
        [orgId, b.nombre, b.tema || null, b.instructor || null, instructorUsuarioId, b.fecha, b.horasDuracion, req.usuario.id]
      );
      const capacitacionId = capacitacion.rows[0].id;

      if (asistentesIds.length > 0) {
        // Confirmamos que todos los trabajadores pertenezcan a esta
        // organizacion antes de insertar (evita mezclar datos entre
        // organizaciones si llega un id invalido desde el frontend).
        const validos = await cliente.query(
          `SELECT id FROM trabajadores WHERE organizacion_id = $1 AND id = ANY($2::uuid[])`,
          [orgId, asistentesIds]
        );
        const idsValidos = validos.rows.map((f) => f.id);

        for (const trabajadorId of idsValidos) {
          await cliente.query(
            `INSERT INTO capacitaciones_asistentes (capacitacion_id, trabajador_id) VALUES ($1, $2)
             ON CONFLICT (capacitacion_id, trabajador_id) DO NOTHING`,
            [capacitacionId, trabajadorId]
          );
        }
      }

      return capacitacion.rows[0];
    });

    await registrarAuditoria({
      organizacionId: orgId,
      usuarioId: req.usuario.id,
      accion: 'crear_capacitacion',
      entidad: 'capacitacion',
      entidadId: capacitacionCreada.id,
      detalle: { nombre: b.nombre, asistentes: asistentesIds.length },
      req,
    });

    return res.status(201).json({ capacitacion: capacitacionCreada });
  } catch (err) {
    console.error('Error en crear (capacitaciones):', err);
    return res.status(500).json({ error: 'Error interno al registrar la capacitación.' });
  }
}

// ------------------------------------------------------------
// DELETE /api/capacitaciones/:id
// ------------------------------------------------------------
async function eliminar(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const resultado = await query(
      `DELETE FROM capacitaciones WHERE id = $1 AND organizacion_id = $2 RETURNING id`,
      [req.params.id, orgId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Capacitación no encontrada.' });
    }

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id,
      accion: 'eliminar_capacitacion', entidad: 'capacitacion', entidadId: req.params.id, req,
    });

    return res.json({ eliminado: true });
  } catch (err) {
    console.error('Error en eliminar (capacitaciones):', err);
    return res.status(500).json({ error: 'Error interno al eliminar la capacitación.' });
  }
}

module.exports = { listar, obtener, crear, eliminar };
