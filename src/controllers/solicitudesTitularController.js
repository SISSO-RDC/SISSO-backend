// ============================================================
// SISSO - Modulo de Gobierno de Datos / Derechos del Titular.
//
// CREADO en Auditoria N.11 (hallazgo CRITICO C11-04, P0): da
// capacidad OPERATIVA (no solo controles tecnicos de minimizacion)
// para gestionar solicitudes de acceso, rectificacion,
// actualizacion, bloqueo, eliminacion, oposicion y portabilidad
// ejercidas por el titular de los datos, con responsable asignado,
// plazos, evidencia y auditoria.
//
// Autorizacion: 'admin' gestiona el flujo completo (es quien
// responde legalmente por la organizacion ante estas solicitudes).
// 'sso' puede crear y ver (a menudo es quien recibe la solicitud en
// el dia a dia), pero no cerrar/rechazar una solicitud por su
// cuenta -- eso requiere 'admin'.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

async function crear(req, res) {
  const orgId = req.usuario.organizacionId;
  const {
    trabajadorId, tipoSolicitud, descripcion,
    solicitanteNombre, solicitanteDocumento,
    identidadVerificada, metodoVerificacion,
  } = req.body;

  const TIPOS_VALIDOS = ['acceso', 'rectificacion', 'actualizacion', 'bloqueo', 'eliminacion', 'oposicion', 'portabilidad'];
  if (!TIPOS_VALIDOS.includes(tipoSolicitud)) {
    return res.status(400).json({ error: `tipoSolicitud invalido. Valores permitidos: ${TIPOS_VALIDOS.join(', ')}.` });
  }
  if (!descripcion || !descripcion.trim()) {
    return res.status(400).json({ error: 'descripcion es obligatoria.' });
  }
  if (!solicitanteNombre || !solicitanteDocumento) {
    return res.status(400).json({ error: 'solicitanteNombre y solicitanteDocumento son obligatorios: no se procesa una solicitud sin poder identificar a quien la hace.' });
  }

  try {
    const resultado = await withTransaction(async (client) => {
      const insertRes = await client.query(
        `INSERT INTO solicitudes_titular
          (organizacion_id, trabajador_id, tipo_solicitud, descripcion,
           solicitante_nombre, solicitante_documento, identidad_verificada, metodo_verificacion,
           creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, tipo_solicitud, estado, fecha_recibida, fecha_limite_respuesta, creado_en`,
        [
          orgId, trabajadorId || null, tipoSolicitud, descripcion.trim(),
          solicitanteNombre.trim(), solicitanteDocumento.trim(),
          !!identidadVerificada, metodoVerificacion || null,
          req.usuario.id,
        ]
      );

      await registrarAuditoria({
        organizacionId: orgId,
        usuarioId: req.usuario.id,
        accion: 'solicitud_titular_creada',
        entidad: 'solicitudes_titular',
        entidadId: insertRes.rows[0].id,
        detalle: { tipoSolicitud, trabajadorId: trabajadorId || null },
        req,
        client,
      });

      return insertRes;
    });

    return res.status(201).json({ solicitud: resultado.rows[0] });
  } catch (err) {
    console.error('Error en crear (solicitudes del titular):', err);
    return res.status(500).json({ error: 'Error interno al registrar la solicitud.' });
  }
}

async function listar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado, tipoSolicitud, soloVencidas } = req.query;

  try {
    const condiciones = ['organizacion_id = $1'];
    const valores = [orgId];

    if (estado) {
      valores.push(estado);
      condiciones.push(`estado = $${valores.length}`);
    }
    if (tipoSolicitud) {
      valores.push(tipoSolicitud);
      condiciones.push(`tipo_solicitud = $${valores.length}`);
    }
    if (soloVencidas === 'true') {
      condiciones.push(`estado NOT IN ('respondida', 'rechazada', 'cancelada') AND fecha_limite_respuesta < CURRENT_DATE`);
    }

    const resultado = await query(
      `SELECT s.id, s.tipo_solicitud, s.descripcion, s.solicitante_nombre, s.solicitante_documento,
              s.identidad_verificada, s.estado, s.fecha_recibida, s.fecha_limite_respuesta, s.fecha_respuesta,
              s.trabajador_id, t.nombre_completo AS trabajador_nombre,
              u.nombre_completo AS responsable_nombre,
              (s.estado NOT IN ('respondida', 'rechazada', 'cancelada') AND s.fecha_limite_respuesta < CURRENT_DATE) AS vencida
       FROM solicitudes_titular s
       LEFT JOIN trabajadores t ON t.id = s.trabajador_id
       LEFT JOIN usuarios u ON u.id = s.responsable_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY s.fecha_limite_respuesta ASC`,
      valores
    );

    return res.json({ solicitudes: resultado.rows });
  } catch (err) {
    console.error('Error en listar (solicitudes del titular):', err);
    return res.status(500).json({ error: 'Error interno al listar las solicitudes.' });
  }
}

async function obtenerDetalle(req, res) {
  try {
    const resultado = await query(
      `SELECT s.*, t.nombre_completo AS trabajador_nombre, u.nombre_completo AS responsable_nombre,
              cp.nombre_completo AS creado_por_nombre
       FROM solicitudes_titular s
       LEFT JOIN trabajadores t ON t.id = s.trabajador_id
       LEFT JOIN usuarios u ON u.id = s.responsable_id
       LEFT JOIN usuarios cp ON cp.id = s.creado_por
       WHERE s.id = $1 AND s.organizacion_id = $2`,
      [req.params.id, req.usuario.organizacionId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Solicitud no encontrada.' });
    }

    // Lectura de un expediente de gobierno de datos: se audita como
    // sensible por el mismo criterio que la historia clinica (puede
    // contener referencias a datos de salud del titular).
    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'lectura_solicitud_titular',
      entidad: 'solicitudes_titular',
      entidadId: req.params.id,
      req,
      lecturaSensible: true,
    });

    return res.json({ solicitud: resultado.rows[0] });
  } catch (err) {
    console.error('Error en obtenerDetalle (solicitudes del titular):', err);
    return res.status(500).json({ error: 'Error interno al obtener la solicitud.' });
  }
}

async function asignarResponsable(req, res) {
  const { responsableId } = req.body;
  if (!responsableId) {
    return res.status(400).json({ error: 'responsableId es obligatorio.' });
  }

  try {
    const resultado = await withTransaction(async (client) => {
      const updateRes = await client.query(
        `UPDATE solicitudes_titular SET responsable_id = $1, estado = 'en_proceso', actualizado_en = now()
         WHERE id = $2 AND organizacion_id = $3 AND estado IN ('recibida', 'en_verificacion')
         RETURNING id, estado, responsable_id`,
        [responsableId, req.params.id, req.usuario.organizacionId]
      );
      if (updateRes.rows.length === 0) {
        const errNoEncontrada = new Error('Solicitud no encontrada o ya no admite reasignacion (estado actual no es recibida/en_verificacion).');
        errNoEncontrada.codigo = 'NO_ENCONTRADA';
        throw errNoEncontrada;
      }

      await registrarAuditoria({
        organizacionId: req.usuario.organizacionId,
        usuarioId: req.usuario.id,
        accion: 'solicitud_titular_asignada',
        entidad: 'solicitudes_titular',
        entidadId: req.params.id,
        detalle: { responsableId },
        req,
        client,
      });

      return updateRes;
    });

    return res.json({ solicitud: resultado.rows[0] });
  } catch (err) {
    if (err.codigo === 'NO_ENCONTRADA') {
      return res.status(404).json({ error: err.message });
    }
    console.error('Error en asignarResponsable (solicitudes del titular):', err);
    return res.status(500).json({ error: 'Error interno al asignar responsable.' });
  }
}

async function marcarIdentidadVerificada(req, res) {
  const { metodoVerificacion } = req.body;
  if (!metodoVerificacion || !metodoVerificacion.trim()) {
    return res.status(400).json({ error: 'metodoVerificacion es obligatorio: debe quedar constancia de como se verifico la identidad.' });
  }

  try {
    const resultado = await withTransaction(async (client) => {
      const updateRes = await client.query(
        `UPDATE solicitudes_titular
         SET identidad_verificada = true, metodo_verificacion = $1, actualizado_en = now()
         WHERE id = $2 AND organizacion_id = $3
         RETURNING id, identidad_verificada, metodo_verificacion`,
        [metodoVerificacion.trim(), req.params.id, req.usuario.organizacionId]
      );
      if (updateRes.rows.length === 0) {
        const errNoEncontrada = new Error('Solicitud no encontrada.');
        errNoEncontrada.codigo = 'NO_ENCONTRADA';
        throw errNoEncontrada;
      }

      await registrarAuditoria({
        organizacionId: req.usuario.organizacionId,
        usuarioId: req.usuario.id,
        accion: 'solicitud_titular_identidad_verificada',
        entidad: 'solicitudes_titular',
        entidadId: req.params.id,
        req,
        client,
      });

      return updateRes;
    });

    return res.json({ solicitud: resultado.rows[0] });
  } catch (err) {
    if (err.codigo === 'NO_ENCONTRADA') {
      return res.status(404).json({ error: err.message });
    }
    console.error('Error en marcarIdentidadVerificada:', err);
    return res.status(500).json({ error: 'Error interno al verificar identidad.' });
  }
}

// CORREGIDO/DECISION DE DISENO (C11-04): responder/rechazar una
// solicitud queda reservado a 'admin' (ver rutas) porque es quien
// responde legalmente por la organizacion frente al titular; SSO
// puede recibir y avanzar la solicitud pero no cerrarla.
async function responder(req, res) {
  const { estado, respuestaTexto } = req.body;
  const ESTADOS_FINALES = ['respondida', 'rechazada', 'cancelada'];
  if (!ESTADOS_FINALES.includes(estado)) {
    return res.status(400).json({ error: `estado invalido. Debe ser uno de: ${ESTADOS_FINALES.join(', ')}.` });
  }
  if (!respuestaTexto || !respuestaTexto.trim()) {
    return res.status(400).json({ error: 'respuestaTexto es obligatorio: debe quedar constancia de que se respondio y que.' });
  }

  try {
    const resultado = await withTransaction(async (client) => {
      const actualRes = await client.query(
        `SELECT identidad_verificada FROM solicitudes_titular WHERE id = $1 AND organizacion_id = $2 FOR UPDATE`,
        [req.params.id, req.usuario.organizacionId]
      );
      if (actualRes.rows.length === 0) {
        const errNoEncontrada = new Error('Solicitud no encontrada.');
        errNoEncontrada.codigo = 'NO_ENCONTRADA';
        throw errNoEncontrada;
      }
      // No se puede dar por 'respondida' una solicitud sobre datos
      // sensibles sin haber verificado la identidad del solicitante
      // primero -- responder a la persona equivocada es en si mismo
      // un incidente de seguridad de datos.
      if (estado === 'respondida' && !actualRes.rows[0].identidad_verificada) {
        const errSinVerificar = new Error('No se puede marcar como respondida sin verificar antes la identidad del solicitante.');
        errSinVerificar.codigo = 'IDENTIDAD_NO_VERIFICADA';
        throw errSinVerificar;
      }

      const updateRes = await client.query(
        `UPDATE solicitudes_titular
         SET estado = $1, respuesta_texto = $2, fecha_respuesta = CURRENT_DATE, actualizado_en = now()
         WHERE id = $3 AND organizacion_id = $4
         RETURNING id, estado, fecha_respuesta`,
        [estado, respuestaTexto.trim(), req.params.id, req.usuario.organizacionId]
      );

      await registrarAuditoria({
        organizacionId: req.usuario.organizacionId,
        usuarioId: req.usuario.id,
        accion: 'solicitud_titular_respondida',
        entidad: 'solicitudes_titular',
        entidadId: req.params.id,
        detalle: { estado },
        req,
        client,
      });

      return updateRes;
    });

    return res.json({ solicitud: resultado.rows[0] });
  } catch (err) {
    if (err.codigo === 'NO_ENCONTRADA') {
      return res.status(404).json({ error: err.message });
    }
    if (err.codigo === 'IDENTIDAD_NO_VERIFICADA') {
      return res.status(409).json({ error: err.message, codigo: err.codigo });
    }
    console.error('Error en responder (solicitudes del titular):', err);
    return res.status(500).json({ error: 'Error interno al responder la solicitud.' });
  }
}

module.exports = { crear, listar, obtenerDetalle, asignarResponsable, marcarIdentidadVerificada, responder };
