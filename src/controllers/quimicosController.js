// ============================================================
// Controlador de Quimicos/SDS (Lote 4, Sep 2026). Inventario por
// sede/area con la SDS/FDS vigente embebida (ver nota de alcance
// en migration_102). Gestion: admin, sso.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { columnas } = require('../db/columnasExplicitas');
const { registrarAuditoria } = require('../utils/auditoria');
const { analizarDataUri } = require('../utils/validarArchivo');
const { subirEvidenciaConCompensacion } = require('../servicios/cloudinaryService');

const CARPETA_SDS = 'sisso/sds-quimicos';

// ------------------------------------------------------------
// POST /api/quimicos
// ------------------------------------------------------------
async function crear(req, res) {
  const orgId = req.usuario.organizacionId;
  const {
    nombreComercial, nombreQuimico, numeroCas, fabricante, area, cantidadAlmacenada, unidadMedida,
    clasificacionGhs, frasesH, sdsVersion, sdsFechaEmision, sdsIdioma, sdsArchivoBase64,
  } = req.body;

  if (!nombreComercial || !nombreComercial.trim()) return res.status(400).json({ error: 'nombreComercial es obligatorio.' });
  if (!area || !area.trim()) return res.status(400).json({ error: 'area es obligatoria.' });

  let archivoValidado = null;
  if (sdsArchivoBase64) {
    const chk = analizarDataUri(sdsArchivoBase64, 'documento_control'); // PDF, mismo limite que documentos de control
    if (!chk.ok) return res.status(400).json({ error: `sdsArchivoBase64 invalido: ${chk.motivo}` });
    archivoValidado = sdsArchivoBase64;
  }

  try {
    const insertarQuimico = async (client, publicId) => {
      const insertRes = await client.query(
        `INSERT INTO quimicos_inventario
          (organizacion_id, nombre_comercial, nombre_quimico, numero_cas, fabricante, area,
           cantidad_almacenada, unidad_medida, clasificacion_ghs, frases_h,
           sds_version, sds_fecha_emision, sds_idioma, sds_public_id, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id, nombre_comercial, area, estado, creado_en`,
        [orgId, nombreComercial.trim(), nombreQuimico || null, numeroCas || null, fabricante || null, area.trim(),
          cantidadAlmacenada || null, unidadMedida || null, Array.isArray(clasificacionGhs) ? clasificacionGhs : null,
          frasesH || null, sdsVersion || null, sdsFechaEmision || null, sdsIdioma || 'es', publicId, req.usuario.id]
      );

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'quimico_creado',
        entidad: 'quimicos_inventario', entidadId: insertRes.rows[0].id, detalle: { nombreComercial }, req, client,
      });
      return insertRes;
    };

    let resultado;
    if (archivoValidado) {
      const { resultado: r } = await subirEvidenciaConCompensacion(
        archivoValidado, orgId, CARPETA_SDS, { politica: 'documento_control' },
        (subidaInfo) => withTransaction((client) => insertarQuimico(client, subidaInfo.publicId))
      );
      resultado = r;
    } else {
      resultado = await withTransaction((client) => insertarQuimico(client, null));
    }

    return res.status(201).json({ quimico: resultado.rows[0] });
  } catch (err) {
    console.error('Error en crear (quimicos):', err);
    return res.status(500).json({ error: 'Error interno al registrar el quimico.' });
  }
}

// ------------------------------------------------------------
// GET /api/quimicos  (filtros: area, estado, sinSds=true)
// ------------------------------------------------------------
async function listar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { area, estado, sinSds } = req.query;

  const condiciones = ['organizacion_id = $1'];
  const parametros = [orgId];
  if (area) { parametros.push(area); condiciones.push(`area = $${parametros.length}`); }
  if (estado) { parametros.push(estado); condiciones.push(`estado = $${parametros.length}`); }
  if (sinSds === 'true') condiciones.push('sds_public_id IS NULL');

  try {
    const resultado = await query(
      `SELECT id, nombre_comercial, numero_cas, area, cantidad_almacenada, unidad_medida, estado,
              clasificacion_ghs, sds_version, (sds_public_id IS NOT NULL) AS tiene_sds
       FROM quimicos_inventario
       WHERE ${condiciones.join(' AND ')}
       ORDER BY nombre_comercial ASC`,
      parametros
    );
    return res.json({ quimicos: resultado.rows });
  } catch (err) {
    console.error('Error en listar (quimicos):', err);
    return res.status(500).json({ error: 'Error interno al listar el inventario quimico.' });
  }
}

// ------------------------------------------------------------
// GET /api/quimicos/:id
// ------------------------------------------------------------
async function obtener(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const resultado = await query(
      `SELECT ${columnas('quimicos_inventario', 'q')} FROM quimicos_inventario q WHERE q.id = $1 AND q.organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (resultado.rows.length === 0) return res.status(404).json({ error: 'Quimico no encontrado.' });
    return res.json({ quimico: resultado.rows[0] });
  } catch (err) {
    console.error('Error en obtener (quimicos):', err);
    return res.status(500).json({ error: 'Error interno al obtener el quimico.' });
  }
}

// ------------------------------------------------------------
// PATCH /api/quimicos/:id/sds
// Reemplaza la SDS vigente (sube el archivo nuevo antes de borrar el anterior).
// ------------------------------------------------------------
async function actualizarSds(req, res) {
  const orgId = req.usuario.organizacionId;
  const { sdsVersion, sdsFechaEmision, sdsIdioma, sdsArchivoBase64 } = req.body;

  if (!sdsArchivoBase64) return res.status(400).json({ error: 'sdsArchivoBase64 es obligatorio.' });
  const chk = analizarDataUri(sdsArchivoBase64, 'documento_control');
  if (!chk.ok) return res.status(400).json({ error: `sdsArchivoBase64 invalido: ${chk.motivo}` });

  try {
    const actual = await query(`SELECT id, sds_public_id FROM quimicos_inventario WHERE id = $1 AND organizacion_id = $2`, [req.params.id, orgId]);
    if (actual.rows.length === 0) return res.status(404).json({ error: 'Quimico no encontrado.' });

    const { resultado } = await subirEvidenciaConCompensacion(
      sdsArchivoBase64, orgId, CARPETA_SDS, { politica: 'documento_control' },
      (subidaInfo) => withTransaction(async (client) => {
        const updateRes = await client.query(
          `UPDATE quimicos_inventario
           SET sds_public_id = $1, sds_version = $2, sds_fecha_emision = $3, sds_idioma = $4, actualizado_en = now()
           WHERE id = $5 AND organizacion_id = $6
           RETURNING id, sds_version, sds_fecha_emision`,
          [subidaInfo.publicId, sdsVersion || null, sdsFechaEmision || null, sdsIdioma || 'es', req.params.id, orgId]
        );

        await registrarAuditoria({
          organizacionId: orgId, usuarioId: req.usuario.id, accion: 'quimico_sds_actualizada',
          entidad: 'quimicos_inventario', entidadId: req.params.id, detalle: { sdsVersion }, req, client,
        });
        return updateRes;
      })
    );

    // El PDF anterior (si existia) queda huerfano deliberadamente aqui
    // -- se podria borrar, pero conservar la SDS anterior en Cloudinary
    // (aunque desvinculada) es preferible a arriesgar borrar la nueva
    // por un error de referencia; no es sensible ni tiene costo relevante.
    return res.json({ quimico: resultado.rows[0] });
  } catch (err) {
    console.error('Error en actualizarSds (quimicos):', err);
    return res.status(500).json({ error: 'Error interno al actualizar la SDS.' });
  }
}

// ------------------------------------------------------------
// PATCH /api/quimicos/:id/estado
// ------------------------------------------------------------
async function cambiarEstado(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado } = req.body;
  if (!['activo', 'agotado', 'dado_de_baja'].includes(estado)) {
    return res.status(400).json({ error: 'estado invalido. Valores permitidos: activo, agotado, dado_de_baja.' });
  }

  try {
    const updateRes = await query(
      `UPDATE quimicos_inventario SET estado = $1, actualizado_en = now() WHERE id = $2 AND organizacion_id = $3 RETURNING id, estado`,
      [estado, req.params.id, orgId]
    );
    if (updateRes.rows.length === 0) return res.status(404).json({ error: 'Quimico no encontrado.' });
    return res.json({ quimico: updateRes.rows[0] });
  } catch (err) {
    console.error('Error en cambiarEstado (quimicos):', err);
    return res.status(500).json({ error: 'Error interno al cambiar el estado del quimico.' });
  }
}

module.exports = { crear, listar, obtener, actualizarSds, cambiarEstado };
