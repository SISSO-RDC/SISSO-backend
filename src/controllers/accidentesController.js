// ============================================================
// Controlador de Accidentes/Incidentes/Casi accidentes.
// Corrige el punto 18 / CRITICO 1 de la Auditoria SISSO N.06:
// ciclo integral de investigacion preventiva (registro,
// investigacion de causas, acciones con verificacion, evidencia).
//
// Acceso: admin, sso gestionan (crear/investigar/accionar/cerrar).
//
// CORREGIDO en Auditoria N.08 (hallazgo CRITICO/P0 C-N08-02, y
// GRAVE G-N08-02 sobre arquitectura): la version anterior dejaba
// leer el expediente COMPLETO (nombre del trabajador + tipo_lesion +
// descripcion libre del accidente + dias_perdidos +
// requiere_atencion_medica + investigacion + acciones + evidencias)
// a CUALQUIER usuario autenticado, incluido TH -- que no tiene
// ninguna necesidad operativa de conocer el tipo de lesion o la
// narrativa del accidente para hacer su trabajo (gestion de
// personal). La combinacion identidad + lesion + necesidad de
// atencion medica es exactamente el tipo de dato personal de salud
// que el resto del sistema ya trata con cuidado en otros modulos.
//
// Se agrega `proyectarCasoSegunRol()`: una funcion de serializacion
// explicita por rol (no una lista de columnas SQL distinta por
// endpoint) para que cualquier ruta futura que reutilice estos datos
// pase por el mismo punto unico de decision, en vez de reimplementar
// su propio criterio de minimizacion (la preocupacion de arquitectura
// que señala G-N08-02).
//   - admin/sso/medico: expediente completo (lo gestionan o lo
//     necesitan para correlacion clinica).
//   - th: proyeccion minimizada -- conserva lo que TH SI necesita
//     para gestion de personal (trabajador, fecha, dias_perdidos,
//     requiere_atencion_medica, estado) y quita lo que no
//     (tipo_lesion, descripcion libre, investigacion de causas,
//     acciones correctivas, evidencias).
//
// Las evidencias (fotos/documentos del caso) quedan ademas
// restringidas por rol directamente en la ruta
// (routes/accidentesRoutes.js): ya no basta con tener un JWT valido
// de la organizacion, TH tampoco puede generar la URL firmada.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { subirEvidencia, borrarEvidencia, generarUrlFirmada } = require('../servicios/cloudinaryService');

const CARPETA_EVIDENCIA = 'sisso/evidencia-accidentes';

// Roles con acceso al expediente completo de un caso.
const ROLES_ACCESO_COMPLETO = ['admin', 'sso', 'medico'];

/**
 * Proyecta un caso de accidente/incidente segun el rol de quien
 * consulta. Ver comentario de cabecera del archivo.
 */
function proyectarCasoSegunRol(caso, rol) {
  if (ROLES_ACCESO_COMPLETO.includes(rol)) return caso;
  // TH (y cualquier rol futuro sin necesidad documentada): version
  // minimizada, sin tipo de lesion ni narrativa libre del accidente.
  const {
    tipo_lesion, descripcion,
    ...resto
  } = caso;
  return resto;
}

// ------------------------------------------------------------
// POST /api/accidentes
// ------------------------------------------------------------
async function crear(req, res) {
  const orgId = req.usuario.organizacionId;
  const {
    tipo, trabajadorId, puestoTrabajoId, fechaOcurrencia, horaOcurrencia, lugar,
    descripcion, gravedad, tipoLesion, diasPerdidos, requiereAtencionMedica,
  } = req.body;

  if (!['accidente', 'incidente', 'casi_accidente'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo invalido.' });
  }
  if (!fechaOcurrencia || !lugar || !descripcion || descripcion.trim().length < 10) {
    return res.status(400).json({ error: 'fechaOcurrencia, lugar y descripcion (minimo 10 caracteres) son obligatorios.' });
  }
  if (tipo !== 'casi_accidente' && !trabajadorId) {
    return res.status(400).json({ error: 'trabajadorId es obligatorio para accidentes e incidentes con persona afectada.' });
  }

  try {
    if (trabajadorId) {
      const trabajadorRes = await query(
        `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
        [trabajadorId, orgId]
      );
      if (trabajadorRes.rows.length === 0) {
        return res.status(404).json({ error: 'Trabajador no encontrado.' });
      }
    }

    const creadoRes = await query(
      `INSERT INTO accidentes_incidentes
        (organizacion_id, tipo, trabajador_id, puesto_trabajo_id, fecha_ocurrencia, hora_ocurrencia,
         lugar, descripcion, gravedad, tipo_lesion, dias_perdidos, requiere_atencion_medica, reportado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, tipo, estado, fecha_ocurrencia, creado_en`,
      [
        orgId, tipo, trabajadorId || null, puestoTrabajoId || null, fechaOcurrencia, horaOcurrencia || null,
        lugar.trim(), descripcion.trim(), gravedad || 'no_aplica', tipoLesion || null,
        diasPerdidos || 0, !!requiereAtencionMedica, req.usuario.id,
      ]
    );

    await registrarAuditoria({
      organizacionId: orgId,
      usuarioId: req.usuario.id,
      accion: 'accidente_incidente_creado',
      entidad: 'accidentes_incidentes',
      entidadId: creadoRes.rows[0].id,
      detalle: { tipo },
      req,
    });

    return res.status(201).json({ caso: creadoRes.rows[0] });
  } catch (err) {
    console.error('Error en crear (accidentes):', err);
    return res.status(500).json({ error: 'Error interno al registrar el caso.' });
  }
}

// ------------------------------------------------------------
// GET /api/accidentes  (filtros opcionales: tipo, estado, desde, hasta)
// ------------------------------------------------------------
async function listar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { tipo, estado, desde, hasta } = req.query;

  const condiciones = ['ai.organizacion_id = $1'];
  const parametros = [orgId];

  if (tipo) { parametros.push(tipo); condiciones.push(`ai.tipo = $${parametros.length}`); }
  if (estado) { parametros.push(estado); condiciones.push(`ai.estado = $${parametros.length}`); }
  if (desde) { parametros.push(desde); condiciones.push(`ai.fecha_ocurrencia >= $${parametros.length}`); }
  if (hasta) { parametros.push(hasta); condiciones.push(`ai.fecha_ocurrencia <= $${parametros.length}`); }

  try {
    const resultado = await query(
      `SELECT ai.id, ai.tipo, ai.trabajador_id, t.nombre_completo AS trabajador_nombre,
              ai.puesto_trabajo_id, pt.nombre_puesto, ai.fecha_ocurrencia, ai.hora_ocurrencia,
              ai.lugar, ai.gravedad, ai.tipo_lesion, ai.descripcion, ai.dias_perdidos,
              ai.requiere_atencion_medica, ai.estado, ai.creado_en
       FROM accidentes_incidentes ai
       LEFT JOIN trabajadores t ON t.id = ai.trabajador_id
       LEFT JOIN puestos_trabajo pt ON pt.id = ai.puesto_trabajo_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY ai.fecha_ocurrencia DESC, ai.creado_en DESC`,
      parametros
    );
    const casos = resultado.rows.map((fila) => proyectarCasoSegunRol(fila, req.usuario.rol));
    return res.json({ casos });
  } catch (err) {
    console.error('Error en listar (accidentes):', err);
    return res.status(500).json({ error: 'Error interno al listar los casos.' });
  }
}

// ------------------------------------------------------------
// GET /api/accidentes/:id
// ------------------------------------------------------------
async function obtener(req, res) {
  const orgId = req.usuario.organizacionId;
  const accesoCompleto = ROLES_ACCESO_COMPLETO.includes(req.usuario.rol);
  try {
    const casoRes = await query(
      `SELECT ai.*, t.nombre_completo AS trabajador_nombre, pt.nombre_puesto
       FROM accidentes_incidentes ai
       LEFT JOIN trabajadores t ON t.id = ai.trabajador_id
       LEFT JOIN puestos_trabajo pt ON pt.id = ai.puesto_trabajo_id
       WHERE ai.id = $1 AND ai.organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (casoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Caso no encontrado.' });
    }

    // CORREGIDO en Auditoria N.08 (C-N08-02): para roles sin acceso
    // completo (TH), ni siquiera se consultan investigacion/acciones/
    // evidencias -- son datos operativos de SST (causas raiz, plan de
    // accion, archivos adjuntos) sin relacion con gestion de personal.
    const [investigacionRes, accionesRes, evidenciasRes] = accesoCompleto
      ? await Promise.all([
          query(
            `SELECT i.*, u.nombre_completo AS investigador_nombre
             FROM investigaciones_accidentes i
             LEFT JOIN usuarios u ON u.id = i.investigador_id
             WHERE i.accidente_id = $1 AND i.organizacion_id = $2`,
            [req.params.id, orgId]
          ),
          query(
            `SELECT a.*, u.nombre_completo AS responsable_nombre
             FROM accidentes_acciones a
             LEFT JOIN usuarios u ON u.id = a.responsable_id
             WHERE a.accidente_id = $1 AND a.organizacion_id = $2
             ORDER BY a.fecha_limite ASC`,
            [req.params.id, orgId]
          ),
          query(
            `SELECT id, tipo_archivo, descripcion, creado_en
             FROM accidentes_evidencias
             WHERE accidente_id = $1 AND organizacion_id = $2
             ORDER BY creado_en DESC`,
            [req.params.id, orgId]
          ),
        ])
      : [{ rows: [] }, { rows: [] }, { rows: [] }];

    return res.json({
      caso: proyectarCasoSegunRol(casoRes.rows[0], req.usuario.rol),
      investigacion: investigacionRes.rows[0] || null,
      acciones: accionesRes.rows,
      evidencias: evidenciasRes.rows,
    });
  } catch (err) {
    console.error('Error en obtener (accidentes):', err);
    return res.status(500).json({ error: 'Error interno al obtener el caso.' });
  }
}

// ------------------------------------------------------------
// PUT /api/accidentes/:id
// ------------------------------------------------------------
async function actualizar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado, gravedad, tipoLesion, diasPerdidos, requiereAtencionMedica, descripcion } = req.body;

  if (estado && !['reportado', 'en_investigacion', 'con_acciones', 'cerrado'].includes(estado)) {
    return res.status(400).json({ error: 'estado invalido.' });
  }

  try {
    // Un caso no se puede cerrar si tiene acciones pendientes o en
    // progreso sin verificar (corrige el punto 7.3: "impedir que
    // SISSO se limite a identificar problemas sin comprobar que
    // fueron solucionados").
    if (estado === 'cerrado') {
      const accionesAbiertasRes = await query(
        `SELECT count(*)::int AS total FROM accidentes_acciones
         WHERE accidente_id = $1 AND organizacion_id = $2 AND estado NOT IN ('verificada')`,
        [req.params.id, orgId]
      );
      if (accionesAbiertasRes.rows[0].total > 0) {
        return res.status(400).json({ error: 'No se puede cerrar el caso: tiene acciones sin verificar.' });
      }
    }

    const actualizadoRes = await query(
      `UPDATE accidentes_incidentes SET
         estado = COALESCE($1, estado),
         gravedad = COALESCE($2, gravedad),
         tipo_lesion = COALESCE($3, tipo_lesion),
         dias_perdidos = COALESCE($4, dias_perdidos),
         requiere_atencion_medica = COALESCE($5, requiere_atencion_medica),
         descripcion = COALESCE($6, descripcion)
       WHERE id = $7 AND organizacion_id = $8
       RETURNING id, estado`,
      [
        estado || null, gravedad || null, tipoLesion || null, diasPerdidos ?? null,
        typeof requiereAtencionMedica === 'boolean' ? requiereAtencionMedica : null,
        descripcion ? descripcion.trim() : null, req.params.id, orgId,
      ]
    );
    if (actualizadoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Caso no encontrado.' });
    }

    await registrarAuditoria({
      organizacionId: orgId,
      usuarioId: req.usuario.id,
      accion: 'accidente_incidente_actualizado',
      entidad: 'accidentes_incidentes',
      entidadId: req.params.id,
      detalle: { estado },
      req,
    });

    return res.json({ caso: actualizadoRes.rows[0] });
  } catch (err) {
    console.error('Error en actualizar (accidentes):', err);
    return res.status(500).json({ error: 'Error interno al actualizar el caso.' });
  }
}

// ------------------------------------------------------------
// POST /api/accidentes/:id/investigacion
// Crea o reemplaza la investigacion del caso (UNIQUE por accidente_id).
// ------------------------------------------------------------
async function registrarInvestigacion(req, res) {
  const orgId = req.usuario.organizacionId;
  const { metodoInvestigacion, causasInmediatas, causasBasicas, factoresContribuyentes, fechaInvestigacion } = req.body;

  if (!causasInmediatas || !causasBasicas || !fechaInvestigacion) {
    return res.status(400).json({ error: 'causasInmediatas, causasBasicas y fechaInvestigacion son obligatorios.' });
  }

  try {
    const casoRes = await query(
      `SELECT id FROM accidentes_incidentes WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (casoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Caso no encontrado.' });
    }

    const resultado = await withTransaction(async (client) => {
      const investigacionRes = await client.query(
        `INSERT INTO investigaciones_accidentes
          (accidente_id, organizacion_id, metodo_investigacion, causas_inmediatas, causas_basicas,
           factores_contribuyentes, investigador_id, fecha_investigacion)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (accidente_id) DO UPDATE SET
           metodo_investigacion = EXCLUDED.metodo_investigacion,
           causas_inmediatas = EXCLUDED.causas_inmediatas,
           causas_basicas = EXCLUDED.causas_basicas,
           factores_contribuyentes = EXCLUDED.factores_contribuyentes,
           investigador_id = EXCLUDED.investigador_id,
           fecha_investigacion = EXCLUDED.fecha_investigacion
         RETURNING id, fecha_investigacion`,
        [
          req.params.id, orgId, metodoInvestigacion || null, causasInmediatas.trim(),
          causasBasicas.trim(), factoresContribuyentes || null, req.usuario.id, fechaInvestigacion,
        ]
      );

      await client.query(
        `UPDATE accidentes_incidentes SET estado = 'en_investigacion'
         WHERE id = $1 AND organizacion_id = $2 AND estado = 'reportado'`,
        [req.params.id, orgId]
      );

      return investigacionRes.rows[0];
    });

    await registrarAuditoria({
      organizacionId: orgId,
      usuarioId: req.usuario.id,
      accion: 'accidente_investigacion_registrada',
      entidad: 'investigaciones_accidentes',
      entidadId: req.params.id,
      req,
    });

    return res.status(201).json({ investigacion: resultado });
  } catch (err) {
    console.error('Error en registrarInvestigacion (accidentes):', err);
    return res.status(500).json({ error: 'Error interno al registrar la investigacion.' });
  }
}

// ------------------------------------------------------------
// POST /api/accidentes/:id/acciones
// ------------------------------------------------------------
async function crearAccion(req, res) {
  const orgId = req.usuario.organizacionId;
  const { descripcion, responsableId, fechaLimite } = req.body;

  if (!descripcion || descripcion.trim().length < 5 || !responsableId || !fechaLimite) {
    return res.status(400).json({ error: 'descripcion (minimo 5 caracteres), responsableId y fechaLimite son obligatorios.' });
  }

  try {
    const casoRes = await query(
      `SELECT id FROM accidentes_incidentes WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (casoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Caso no encontrado.' });
    }

    const resultado = await withTransaction(async (client) => {
      const accionRes = await client.query(
        `INSERT INTO accidentes_acciones
          (accidente_id, organizacion_id, descripcion, responsable_id, fecha_limite, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, descripcion, estado, fecha_limite`,
        [req.params.id, orgId, descripcion.trim(), responsableId, fechaLimite, req.usuario.id]
      );

      await client.query(
        `UPDATE accidentes_incidentes SET estado = 'con_acciones'
         WHERE id = $1 AND organizacion_id = $2 AND estado IN ('reportado', 'en_investigacion')`,
        [req.params.id, orgId]
      );

      return accionRes.rows[0];
    });

    await registrarAuditoria({
      organizacionId: orgId,
      usuarioId: req.usuario.id,
      accion: 'accidente_accion_creada',
      entidad: 'accidentes_acciones',
      entidadId: resultado.id,
      req,
    });

    return res.status(201).json({ accion: resultado });
  } catch (err) {
    console.error('Error en crearAccion (accidentes):', err);
    return res.status(500).json({ error: 'Error interno al crear la accion.' });
  }
}

// ------------------------------------------------------------
// PUT /api/accidentes/acciones/:accionId/completar
// El responsable marca la accion como completada (aun no verificada).
// ------------------------------------------------------------
async function completarAccion(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const actualizadaRes = await query(
      `UPDATE accidentes_acciones SET estado = 'completada', fecha_cierre = CURRENT_DATE
       WHERE id = $1 AND organizacion_id = $2 AND estado IN ('pendiente', 'en_progreso')
       RETURNING id, estado, fecha_cierre`,
      [req.params.accionId, orgId]
    );
    if (actualizadaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Accion no encontrada o ya estaba completada/verificada.' });
    }

    await registrarAuditoria({
      organizacionId: orgId,
      usuarioId: req.usuario.id,
      accion: 'accidente_accion_completada',
      entidad: 'accidentes_acciones',
      entidadId: req.params.accionId,
      req,
    });

    return res.json({ accion: actualizadaRes.rows[0] });
  } catch (err) {
    console.error('Error en completarAccion (accidentes):', err);
    return res.status(500).json({ error: 'Error interno al completar la accion.' });
  }
}

// ------------------------------------------------------------
// PUT /api/accidentes/acciones/:accionId/verificar
// CORRIGE el punto 7.3/G1: alguien DISTINTO al responsable debe
// confirmar que la accion fue realmente eficaz antes de poder
// cerrar el caso. Solo admin/sso (mismos roles que gestionan el
// modulo) pueden verificar.
// ------------------------------------------------------------
async function verificarAccion(req, res) {
  const orgId = req.usuario.organizacionId;
  const { notaVerificacion } = req.body;

  try {
    const accionRes = await query(
      `SELECT id, estado, responsable_id FROM accidentes_acciones WHERE id = $1 AND organizacion_id = $2`,
      [req.params.accionId, orgId]
    );
    if (accionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Accion no encontrada.' });
    }
    if (accionRes.rows[0].estado !== 'completada') {
      return res.status(400).json({ error: 'Solo se puede verificar una accion que ya fue marcada como completada.' });
    }

    const actualizadaRes = await query(
      `UPDATE accidentes_acciones SET estado = 'verificada', verificado_por = $1, nota_verificacion = $2
       WHERE id = $3 AND organizacion_id = $4
       RETURNING id, estado`,
      [req.usuario.id, notaVerificacion || null, req.params.accionId, orgId]
    );

    await registrarAuditoria({
      organizacionId: orgId,
      usuarioId: req.usuario.id,
      accion: 'accidente_accion_verificada',
      entidad: 'accidentes_acciones',
      entidadId: req.params.accionId,
      req,
    });

    return res.json({ accion: actualizadaRes.rows[0] });
  } catch (err) {
    console.error('Error en verificarAccion (accidentes):', err);
    return res.status(500).json({ error: 'Error interno al verificar la accion.' });
  }
}

// ------------------------------------------------------------
// POST /api/accidentes/:id/evidencias
// ------------------------------------------------------------
async function subirEvidenciaCaso(req, res) {
  const orgId = req.usuario.organizacionId;
  const { archivoBase64, descripcion } = req.body;

  if (!archivoBase64) {
    return res.status(400).json({ error: 'archivoBase64 es obligatorio.' });
  }

  try {
    const casoRes = await query(
      `SELECT id FROM accidentes_incidentes WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (casoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Caso no encontrado.' });
    }

    const subida = await subirEvidencia(archivoBase64, orgId, CARPETA_EVIDENCIA);

    const evidenciaRes = await query(
      `INSERT INTO accidentes_evidencias (accidente_id, organizacion_id, tipo_archivo, public_id, descripcion, subido_por)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, tipo_archivo, descripcion, creado_en`,
      [req.params.id, orgId, subida.tipo, subida.publicId, descripcion || null, req.usuario.id]
    );

    await registrarAuditoria({
      organizacionId: orgId,
      usuarioId: req.usuario.id,
      accion: 'accidente_evidencia_subida',
      entidad: 'accidentes_evidencias',
      entidadId: evidenciaRes.rows[0].id,
      req,
    });

    return res.status(201).json({ evidencia: evidenciaRes.rows[0] });
  } catch (err) {
    console.error('Error en subirEvidenciaCaso (accidentes):', err);
    return res.status(500).json({ error: 'Error interno al subir la evidencia.' });
  }
}

// ------------------------------------------------------------
// GET /api/accidentes/evidencias/:evidenciaId/url
// Genera una URL firmada de corta duracion (recurso privado de
// Cloudinary), mismo patron que certificados de ausentismo.
// ------------------------------------------------------------
async function obtenerUrlEvidencia(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const evidenciaRes = await query(
      `SELECT public_id, tipo_archivo, accidente_id FROM accidentes_evidencias WHERE id = $1 AND organizacion_id = $2`,
      [req.params.evidenciaId, orgId]
    );
    if (evidenciaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Evidencia no encontrada.' });
    }

    await registrarAuditoria({
      organizacionId: orgId,
      usuarioId: req.usuario.id,
      accion: 'ver_evidencia_accidente',
      entidad: 'accidentes_evidencias',
      entidadId: req.params.evidenciaId,
      req,
    });

    return res.json({ url: generarUrlFirmada(evidenciaRes.rows[0].public_id, evidenciaRes.rows[0].tipo_archivo) });
  } catch (err) {
    console.error('Error en obtenerUrlEvidencia (accidentes):', err);
    return res.status(500).json({ error: 'Error interno al generar el enlace de la evidencia.' });
  }
}

// ------------------------------------------------------------
// DELETE /api/accidentes/evidencias/:evidenciaId
// ------------------------------------------------------------
async function eliminarEvidencia(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const evidenciaRes = await query(
      `SELECT public_id, tipo_archivo FROM accidentes_evidencias WHERE id = $1 AND organizacion_id = $2`,
      [req.params.evidenciaId, orgId]
    );
    if (evidenciaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Evidencia no encontrada.' });
    }

    await query(`DELETE FROM accidentes_evidencias WHERE id = $1 AND organizacion_id = $2`, [req.params.evidenciaId, orgId]);
    await borrarEvidencia(evidenciaRes.rows[0].public_id, evidenciaRes.rows[0].tipo_archivo);

    await registrarAuditoria({
      organizacionId: orgId,
      usuarioId: req.usuario.id,
      accion: 'accidente_evidencia_eliminada',
      entidad: 'accidentes_evidencias',
      entidadId: req.params.evidenciaId,
      req,
    });

    return res.json({ mensaje: 'Evidencia eliminada.' });
  } catch (err) {
    console.error('Error en eliminarEvidencia (accidentes):', err);
    return res.status(500).json({ error: 'Error interno al eliminar la evidencia.' });
  }
}

module.exports = {
  crear,
  listar,
  obtener,
  actualizar,
  registrarInvestigacion,
  crearAccion,
  completarAccion,
  verificarAccion,
  subirEvidenciaCaso,
  obtenerUrlEvidencia,
  eliminarEvidencia,
};
