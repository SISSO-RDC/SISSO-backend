// ============================================================
// SISSO - Modulo de Gobierno de Datos / Incidentes de Seguridad.
//
// CREADO en Auditoria N.12 (hallazgo CRITICO C12-03, punto 3 de la
// correccion obligatoria): la tabla incidentes_seguridad_datos ya
// existia desde migration_057 (Auditoria N.11) con RLS correcto,
// pero no tenia controlador ni rutas -- no habia forma de usarla
// desde la API. Este archivo cierra ese vacio.
//
// Autorizacion: 'admin' gestiona el flujo completo (responsable
// legal de la organizacion ante un incidente). 'sso' puede crear y
// ver (a menudo es quien detecta o reporta el incidente en el dia a
// dia), pero no puede cerrar el incidente ni marcar la notificacion
// a la autoridad -- esa es una decision que debe tomar admin con
// asesoria juridica/DPO (ver comentario en migration_057: este
// registro DOCUMENTA la notificacion, no la automatiza ni la
// decide).
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

const GRAVEDADES_VALIDAS = ['baja', 'media', 'alta', 'critica'];
const ESTADOS_VALIDOS = ['detectado', 'en_investigacion', 'contenido', 'resuelto'];

// ------------------------------------------------------------
// POST /api/incidentes-seguridad
// ------------------------------------------------------------
async function crear(req, res) {
  const orgId = req.usuario.organizacionId;
  const { descripcion, gravedad, categoriasDatosAfectados, cantidadTitularesAfectadosEstimada } = req.body;

  if (!descripcion || !descripcion.trim()) {
    return res.status(400).json({ error: 'descripcion es obligatoria.' });
  }
  if (!GRAVEDADES_VALIDAS.includes(gravedad)) {
    return res.status(400).json({ error: `gravedad invalida. Valores permitidos: ${GRAVEDADES_VALIDAS.join(', ')}.` });
  }

  try {
    const resultado = await withTransaction(async (client) => {
      const insertRes = await client.query(
        `INSERT INTO incidentes_seguridad_datos
          (organizacion_id, descripcion, gravedad, categorias_datos_afectados,
           cantidad_titulares_afectados_estimada, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, gravedad, estado, fecha_deteccion, creado_en`,
        [
          orgId, descripcion.trim(), gravedad,
          Array.isArray(categoriasDatosAfectados) ? categoriasDatosAfectados : null,
          cantidadTitularesAfectadosEstimada || null,
          req.usuario.id,
        ]
      );

      await registrarAuditoria({
        organizacionId: orgId,
        usuarioId: req.usuario.id,
        accion: 'incidente_seguridad_registrado',
        entidad: 'incidentes_seguridad_datos',
        entidadId: insertRes.rows[0].id,
        detalle: { gravedad },
        req,
        client,
      });

      return insertRes;
    });

    return res.status(201).json({ incidente: resultado.rows[0] });
  } catch (err) {
    console.error('Error en crear (incidentes de seguridad):', err);
    return res.status(500).json({ error: 'Error interno al registrar el incidente.' });
  }
}

// ------------------------------------------------------------
// GET /api/incidentes-seguridad
// ------------------------------------------------------------
async function listar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado, gravedad } = req.query;

  try {
    const condiciones = ['organizacion_id = $1'];
    const valores = [orgId];

    if (estado) {
      valores.push(estado);
      condiciones.push(`estado = $${valores.length}`);
    }
    if (gravedad) {
      valores.push(gravedad);
      condiciones.push(`gravedad = $${valores.length}`);
    }

    const resultado = await query(
      `SELECT id, descripcion, gravedad, categorias_datos_afectados, cantidad_titulares_afectados_estimada,
              estado, responsable_id, fecha_deteccion, fecha_contencion, fecha_resolucion,
              notificado_autoridad, fecha_notificacion_autoridad, notificado_titulares, creado_en
       FROM incidentes_seguridad_datos
       WHERE ${condiciones.join(' AND ')}
       ORDER BY fecha_deteccion DESC`,
      valores
    );

    return res.json({ incidentes: resultado.rows });
  } catch (err) {
    console.error('Error en listar (incidentes de seguridad):', err);
    return res.status(500).json({ error: 'Error interno al listar los incidentes.' });
  }
}

// ------------------------------------------------------------
// GET /api/incidentes-seguridad/:id
// ------------------------------------------------------------
async function obtenerDetalle(req, res) {
  const orgId = req.usuario.organizacionId;

  try {
    const resultado = await query(
      `SELECT i.*, u.nombre_completo AS responsable_nombre
       FROM incidentes_seguridad_datos i
       LEFT JOIN usuarios u ON u.id = i.responsable_id
       WHERE i.id = $1 AND i.organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Incidente no encontrado.' });
    }
    return res.json({ incidente: resultado.rows[0] });
  } catch (err) {
    console.error('Error en obtenerDetalle (incidentes de seguridad):', err);
    return res.status(500).json({ error: 'Error interno al obtener el incidente.' });
  }
}

// ------------------------------------------------------------
// PATCH /api/incidentes-seguridad/:id
// Actualiza estado/medidas/notificaciones. Reservado a 'admin':
// estas son decisiones legales (notificar a la autoridad y/o a los
// titulares), no un cambio de estado operativo cualquiera.
// ------------------------------------------------------------
async function actualizar(req, res) {
  const orgId = req.usuario.organizacionId;
  const {
    estado, medidasTomadas, responsableId,
    notificadoAutoridad, notificadoTitulares,
    fechaContencion, fechaResolucion,
  } = req.body;

  if (estado && !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({ error: `estado invalido. Valores permitidos: ${ESTADOS_VALIDOS.join(', ')}.` });
  }

  try {
    const resultado = await withTransaction(async (client) => {
      const actual = await client.query(
        `SELECT id FROM incidentes_seguridad_datos WHERE id = $1 AND organizacion_id = $2 FOR UPDATE`,
        [req.params.id, orgId]
      );
      if (actual.rows.length === 0) {
        const err = new Error('Incidente no encontrado.');
        err.codigo = 'NO_ENCONTRADO';
        throw err;
      }

      const updateRes = await client.query(
        `UPDATE incidentes_seguridad_datos SET
           estado = COALESCE($1, estado),
           medidas_tomadas = COALESCE($2, medidas_tomadas),
           responsable_id = COALESCE($3, responsable_id),
           notificado_autoridad = COALESCE($4, notificado_autoridad),
           fecha_notificacion_autoridad = CASE WHEN $4 = true AND fecha_notificacion_autoridad IS NULL THEN now() ELSE fecha_notificacion_autoridad END,
           notificado_titulares = COALESCE($5, notificado_titulares),
           fecha_contencion = COALESCE($6, fecha_contencion),
           fecha_resolucion = COALESCE($7, fecha_resolucion)
         WHERE id = $8 AND organizacion_id = $9
         RETURNING id, estado, notificado_autoridad, notificado_titulares, fecha_resolucion`,
        [
          estado || null, medidasTomadas || null, responsableId || null,
          typeof notificadoAutoridad === 'boolean' ? notificadoAutoridad : null,
          typeof notificadoTitulares === 'boolean' ? notificadoTitulares : null,
          fechaContencion || null, fechaResolucion || null,
          req.params.id, orgId,
        ]
      );

      await registrarAuditoria({
        organizacionId: orgId,
        usuarioId: req.usuario.id,
        accion: 'incidente_seguridad_actualizado',
        entidad: 'incidentes_seguridad_datos',
        entidadId: req.params.id,
        detalle: { estado, notificadoAutoridad, notificadoTitulares },
        req,
        client,
      });

      return updateRes;
    });

    return res.json({ incidente: resultado.rows[0] });
  } catch (err) {
    if (err.codigo === 'NO_ENCONTRADO') {
      return res.status(404).json({ error: err.message });
    }
    console.error('Error en actualizar (incidentes de seguridad):', err);
    return res.status(500).json({ error: 'Error interno al actualizar el incidente.' });
  }
}

module.exports = { crear, listar, obtenerDetalle, actualizar };
