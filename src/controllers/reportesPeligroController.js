// ============================================================
// Controlador de Reportes de Peligro (Lote 1 del plan de cierre de
// brechas frente a plataformas EHS globales -- Cority/VelocityEHS/
// Benchmark Gensuite, ver analisis Sep 2026).
//
// crearPublico(): canal SIN autenticacion (por diseno -- el
// trabajador que reporta no tiene cuenta SISSO), protegido por rate
// limiting (ver reportesPeligroRoutes.js), mismo patron ya usado en
// solicitudesTitularController.js:crearPublico. Identifica la
// organizacion por su `codigo` publico, nunca por organizacion_id en
// la URL/QR.
//
// El resto de funciones (listar/obtener/triage/generar-capa) exige
// autenticacion y rol admin/sso: el triage (decidir si un reporte
// amerita una accion CAPA) SIEMPRE lo hace un humano, nunca este
// endpoint publico.
// ============================================================
const { query, withTransaction, queryComoSuperadmin } = require('../db/pool');
const { columnas } = require('../db/columnasExplicitas');
const { registrarAuditoria } = require('../utils/auditoria');
const { analizarDataUri } = require('../utils/validarArchivo');
const { subirEvidenciaConCompensacion, generarUrlFirmada } = require('../servicios/cloudinaryService');

const CARPETA_EVIDENCIA = 'sisso/evidencia-reportes-peligro';
const CLASIFICACIONES_VALIDAS = ['condicion_insegura', 'acto_inseguro', 'casi_accidente', 'observacion_positiva', 'sugerencia'];

// ------------------------------------------------------------
// POST /api/reportes-peligro/publico
// Sin autenticacion por diseno. Ver nota de cabecera y
// reportesPeligroRoutes.js (rate limiter dedicado).
// ------------------------------------------------------------
async function crearPublico(req, res) {
  const {
    codigoOrganizacion, clasificacion, descripcion, area, ubicacionTexto,
    reportanteNombre, anonimo, archivoBase64,
  } = req.body;

  if (!codigoOrganizacion || !codigoOrganizacion.trim()) {
    return res.status(400).json({ error: 'codigoOrganizacion es obligatorio.' });
  }
  if (!CLASIFICACIONES_VALIDAS.includes(clasificacion)) {
    return res.status(400).json({ error: `clasificacion invalida. Valores permitidos: ${CLASIFICACIONES_VALIDAS.join(', ')}.` });
  }
  if (!descripcion || descripcion.trim().length < 10) {
    return res.status(400).json({ error: 'descripcion es obligatoria (minimo 10 caracteres).' });
  }

  const esAnonimo = anonimo !== false; // por defecto anonimo, salvo que el reportante decida identificarse
  if (!esAnonimo && (!reportanteNombre || !reportanteNombre.trim())) {
    return res.status(400).json({ error: 'reportanteNombre es obligatorio si anonimo es false.' });
  }

  let archivoValidado = null;
  if (archivoBase64) {
    const chkArchivo = analizarDataUri(archivoBase64, 'evidencia');
    if (!chkArchivo.ok) return res.status(400).json({ error: `archivoBase64 invalido: ${chkArchivo.motivo}` });
    archivoValidado = archivoBase64;
  }

  try {
    // Respuesta deliberadamente generica si el codigo no existe (no
    // confirmar/negar la existencia de un codigo de organizacion a
    // quien no esta autenticado). Mismo criterio que
    // solicitudesTitularController.js:crearPublico.
    const orgRes = await queryComoSuperadmin(
      `SELECT id FROM organizaciones WHERE codigo = $1 AND activa = true`,
      [codigoOrganizacion.trim()]
    );
    if (orgRes.rows.length === 0) {
      return res.status(400).json({ error: 'No se pudo registrar el reporte. Verifique el codigo de la empresa (puede pedirlo a su supervisor).' });
    }
    const orgId = orgRes.rows[0].id;

    const insertarReporte = async (client, publicIdEvidencia, tipoEvidencia) => {
      const insertRes = await client.query(
        `INSERT INTO reportes_peligro
          (organizacion_id, clasificacion, descripcion, area, ubicacion_texto, reportante_nombre, anonimo)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, clasificacion, estado, creado_en`,
        [
          orgId, clasificacion, descripcion.trim(), area ? area.trim() : null,
          ubicacionTexto ? ubicacionTexto.trim() : null,
          esAnonimo ? null : reportanteNombre.trim(), esAnonimo,
        ]
      );

      if (publicIdEvidencia) {
        await client.query(
          `INSERT INTO reportes_peligro_evidencias (reporte_id, organizacion_id, tipo_archivo, public_id)
           VALUES ($1,$2,$3,$4)`,
          [insertRes.rows[0].id, orgId, tipoEvidencia, publicIdEvidencia]
        );
      }

      // usuarioId: null -- el reportante no tiene cuenta SISSO, igual
      // que solicitudes_titular_creada_canal_directo.
      await registrarAuditoria({
        organizacionId: orgId, usuarioId: null, accion: 'reporte_peligro_creado_canal_directo',
        entidad: 'reportes_peligro', entidadId: insertRes.rows[0].id,
        detalle: { clasificacion, conEvidencia: Boolean(publicIdEvidencia) }, req, client,
      });

      return insertRes;
    };

    let creadoRes;
    if (archivoValidado) {
      // Mismo patron compensatorio que accidentesController.js:subirEvidenciaCaso --
      // si la transaccion de BD falla despues de subir, se borra el archivo huerfano.
      const { resultado } = await subirEvidenciaConCompensacion(
        archivoValidado, orgId, CARPETA_EVIDENCIA, {},
        (subidaInfo) => withTransaction((client) => insertarReporte(client, subidaInfo.publicId, subidaInfo.tipo))
      );
      creadoRes = resultado;
    } else {
      creadoRes = await withTransaction((client) => insertarReporte(client, null, null));
    }

    return res.status(201).json({
      mensaje: 'Gracias por reportar. Su observacion fue registrada y sera revisada por el equipo de SSO.',
      reporte: creadoRes.rows[0],
    });
  } catch (err) {
    console.error('Error en crearPublico (reportes de peligro):', err);
    return res.status(500).json({ error: 'Error interno al registrar el reporte.' });
  }
}

// ------------------------------------------------------------
// GET /api/reportes-peligro  (filtros: estado, clasificacion)
// ------------------------------------------------------------
async function listar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado, clasificacion } = req.query;

  const condiciones = ['r.organizacion_id = $1'];
  const parametros = [orgId];
  if (estado) { parametros.push(estado); condiciones.push(`r.estado = $${parametros.length}`); }
  if (clasificacion) { parametros.push(clasificacion); condiciones.push(`r.clasificacion = $${parametros.length}`); }

  try {
    const resultado = await query(
      `SELECT r.id, r.clasificacion, r.descripcion, r.area, r.anonimo, r.reportante_nombre,
              r.estado, r.capa_id, r.creado_en,
              (SELECT count(*)::int FROM reportes_peligro_evidencias e WHERE e.reporte_id = r.id) AS total_evidencias
       FROM reportes_peligro r
       WHERE ${condiciones.join(' AND ')}
       ORDER BY r.creado_en DESC`,
      parametros
    );
    return res.json({ reportes: resultado.rows });
  } catch (err) {
    console.error('Error en listar (reportes de peligro):', err);
    return res.status(500).json({ error: 'Error interno al listar los reportes de peligro.' });
  }
}

// ------------------------------------------------------------
// GET /api/reportes-peligro/:id
// ------------------------------------------------------------
async function obtener(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const reporteRes = await query(
      `SELECT ${columnas('reportes_peligro', 'r')}, u.nombre_completo AS revisado_por_nombre
       FROM reportes_peligro r
       LEFT JOIN usuarios u ON u.id = r.revisado_por
       WHERE r.id = $1 AND r.organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (reporteRes.rows.length === 0) {
      return res.status(404).json({ error: 'Reporte no encontrado.' });
    }

    const evidenciasRes = await query(
      `SELECT id, tipo_archivo, public_id, creado_en FROM reportes_peligro_evidencias
       WHERE reporte_id = $1 AND organizacion_id = $2 ORDER BY creado_en ASC`,
      [req.params.id, orgId]
    );

    return res.json({ reporte: reporteRes.rows[0], evidencias: evidenciasRes.rows });
  } catch (err) {
    console.error('Error en obtener (reportes de peligro):', err);
    return res.status(500).json({ error: 'Error interno al obtener el reporte.' });
  }
}

// ------------------------------------------------------------
// PATCH /api/reportes-peligro/:id/triage
// Clasifica el reporte tras revision humana: en_revision, descartado
// (con nota obligatoria) o cerrado. Pasar a 'con_capa' es exclusivo
// de generarCapaDesdeReporte (abajo), no de este endpoint.
// ------------------------------------------------------------
async function triage(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado, notaTriage } = req.body;

  const ESTADOS_TRIAGE_MANUAL = ['en_revision', 'descartado', 'cerrado'];
  if (!ESTADOS_TRIAGE_MANUAL.includes(estado)) {
    return res.status(400).json({ error: `estado invalido. Valores permitidos aqui: ${ESTADOS_TRIAGE_MANUAL.join(', ')}.` });
  }
  if (estado === 'descartado' && (!notaTriage || notaTriage.trim().length < 5)) {
    return res.status(400).json({ error: 'notaTriage es obligatoria (minimo 5 caracteres) para descartar un reporte.' });
  }

  try {
    const actualizadaRes = await withTransaction(async (client) => {
      const updateRes = await client.query(
        `UPDATE reportes_peligro
         SET estado = $1, nota_triage = $2, revisado_por = $3, revisado_en = now()
         WHERE id = $4 AND organizacion_id = $5
         RETURNING id, estado, nota_triage, revisado_en`,
        [estado, notaTriage ? notaTriage.trim() : null, req.usuario.id, req.params.id, orgId]
      );
      if (updateRes.rows.length === 0) return null;

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'reporte_peligro_triage',
        entidad: 'reportes_peligro', entidadId: req.params.id, detalle: { estado }, req, client,
      });

      return updateRes;
    });

    if (!actualizadaRes) {
      return res.status(404).json({ error: 'Reporte no encontrado.' });
    }
    return res.json({ reporte: actualizadaRes.rows[0] });
  } catch (err) {
    console.error('Error en triage (reportes de peligro):', err);
    return res.status(500).json({ error: 'Error interno al actualizar el reporte.' });
  }
}

// ------------------------------------------------------------
// POST /api/reportes-peligro/:id/generar-capa
// CIERRA EL CICLO: crea una fila real en capa_acciones (origen_tipo
// = 'reporte_peligro', migration_094), enlazada al reporte, y marca
// el reporte como 'con_capa'. Mismo patron que
// inspeccionesController.js:generarCapaDesdeHallazgo.
// ------------------------------------------------------------
async function generarCapaDesdeReporte(req, res) {
  const orgId = req.usuario.organizacionId;
  const { responsableId, fechaLimite, tipo } = req.body;

  if (!responsableId || !fechaLimite) {
    return res.status(400).json({ error: 'responsableId y fechaLimite son obligatorios.' });
  }

  try {
    const reporteRes = await query(
      `SELECT id, descripcion, area, capa_id FROM reportes_peligro WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (reporteRes.rows.length === 0) {
      return res.status(404).json({ error: 'Reporte no encontrado.' });
    }
    if (reporteRes.rows[0].capa_id) {
      return res.status(400).json({ error: 'Este reporte ya tiene una accion CAPA generada.' });
    }

    const reporte = reporteRes.rows[0];

    const resultado = await withTransaction(async (client) => {
      const capaRes = await client.query(
        `INSERT INTO capa_acciones
          (organizacion_id, origen_tipo, origen_id, origen_descripcion, tipo, hallazgo, descripcion_accion,
           responsable_id, fecha_limite, creado_por)
         VALUES ($1,'reporte_peligro',$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          orgId, reporte.id, reporte.area ? `Reporte de peligro en ${reporte.area}` : 'Reporte de peligro',
          tipo || 'correctiva', reporte.descripcion, `Atender el reporte: ${reporte.descripcion}`,
          responsableId, fechaLimite, req.usuario.id,
        ]
      );

      await client.query(
        `UPDATE reportes_peligro SET capa_id = $1, estado = 'con_capa', revisado_por = $2, revisado_en = now()
         WHERE id = $3 AND organizacion_id = $4`,
        [capaRes.rows[0].id, req.usuario.id, req.params.id, orgId]
      );

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'reporte_peligro_genero_capa',
        entidad: 'reportes_peligro', entidadId: req.params.id, detalle: { capaId: capaRes.rows[0].id }, req, client,
      });

      return capaRes.rows[0].id;
    });

    return res.status(201).json({ capaId: resultado });
  } catch (err) {
    console.error('Error en generarCapaDesdeReporte (reportes de peligro):', err);
    return res.status(500).json({ error: 'Error interno al generar la accion CAPA.' });
  }
}

// ------------------------------------------------------------
// GET /api/reportes-peligro/evidencias/:evidenciaId/url
// Genera una URL firmada de corta duracion (recurso privado de
// Cloudinary), mismo patron que accidentesController.js:obtenerUrlEvidencia.
// No se marca lecturaSensible: a diferencia de una evidencia de
// accidente (que puede mostrar una lesion), una foto de reporte de
// peligro es material operativo de seguridad, no dato clinico.
// ------------------------------------------------------------
async function obtenerUrlEvidencia(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const evidenciaRes = await query(
      `SELECT public_id, tipo_archivo FROM reportes_peligro_evidencias WHERE id = $1 AND organizacion_id = $2`,
      [req.params.evidenciaId, orgId]
    );
    if (evidenciaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Evidencia no encontrada.' });
    }

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'ver_evidencia_reporte_peligro',
      entidad: 'reportes_peligro_evidencias', entidadId: req.params.evidenciaId, req,
    });

    return res.json({ url: generarUrlFirmada(evidenciaRes.rows[0].public_id, evidenciaRes.rows[0].tipo_archivo) });
  } catch (err) {
    console.error('Error en obtenerUrlEvidencia (reportes de peligro):', err);
    return res.status(500).json({ error: 'Error interno al generar el enlace de la evidencia.' });
  }
}

module.exports = { crearPublico, listar, obtener, triage, generarCapaDesdeReporte, obtenerUrlEvidencia };
