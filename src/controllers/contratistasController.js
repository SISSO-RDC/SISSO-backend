// ============================================================
// Controlador de Contratistas (Lote 3 del plan de cierre de
// brechas frente a plataformas EHS globales -- ver analisis Sep
// 2026). Gestion: admin, sso.
//
// Semaforo de cumplimiento: se calcula SIEMPRE en la consulta
// (comparando fecha_vencimiento contra CURRENT_DATE), nunca con un
// campo booleano que pueda desactualizarse -- mismo criterio que
// obligaciones_legales.vencida (Lote 2).
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { columnas } = require('../db/columnasExplicitas');
const { registrarAuditoria } = require('../utils/auditoria');
const { analizarDataUri } = require('../utils/validarArchivo');
const { subirEvidenciaConCompensacion } = require('../servicios/cloudinaryService');

const CARPETA_DOCUMENTOS_CONTRATISTA = 'sisso/documentos-contratistas';
const TIPOS_DOCUMENTO_VALIDOS = [
  'poliza_responsabilidad_civil', 'poliza_riesgos_trabajo', 'permiso_municipal',
  'certificado_seguridad_industrial', 'rup', 'ruc', 'otro',
];

// ------------------------------------------------------------
// POST /api/contratistas
// ------------------------------------------------------------
async function crear(req, res) {
  const orgId = req.usuario.organizacionId;
  const { razonSocial, ruc, representanteLegal, telefonoContacto, correoContacto, actividad } = req.body;

  if (!razonSocial || !razonSocial.trim()) return res.status(400).json({ error: 'razonSocial es obligatorio.' });
  if (!ruc || !ruc.trim()) return res.status(400).json({ error: 'ruc es obligatorio.' });

  try {
    const resultado = await withTransaction(async (client) => {
      const insertRes = await client.query(
        `INSERT INTO contratistas
          (organizacion_id, razon_social, ruc, representante_legal, telefono_contacto, correo_contacto, actividad, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, razon_social, ruc, estado, creado_en`,
        [orgId, razonSocial.trim(), ruc.trim(), representanteLegal || null, telefonoContacto || null,
          correoContacto || null, actividad || null, req.usuario.id]
      );

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'contratista_creado',
        entidad: 'contratistas', entidadId: insertRes.rows[0].id, detalle: { razonSocial, ruc }, req, client,
      });

      return insertRes;
    });

    return res.status(201).json({ contratista: resultado.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un contratista con ese RUC en esta organizacion.' });
    console.error('Error en crear (contratistas):', err);
    return res.status(500).json({ error: 'Error interno al crear el contratista.' });
  }
}

// ------------------------------------------------------------
// GET /api/contratistas
// Incluye semaforo: 'al_dia' | 'por_vencer' (<=30 dias) | 'vencido' | 'sin_documentos'
// ------------------------------------------------------------
async function listar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado } = req.query;

  const condiciones = ['c.organizacion_id = $1'];
  const parametros = [orgId];
  if (estado) { parametros.push(estado); condiciones.push(`c.estado = $${parametros.length}`); }

  try {
    const resultado = await query(
      `SELECT c.id, c.razon_social, c.ruc, c.actividad, c.estado, c.creado_en,
              MIN(d.fecha_vencimiento) FILTER (WHERE d.fecha_vencimiento IS NOT NULL) AS proximo_vencimiento,
              COUNT(d.id) AS total_documentos,
              CASE
                WHEN COUNT(d.id) = 0 THEN 'sin_documentos'
                WHEN MIN(d.fecha_vencimiento) FILTER (WHERE d.fecha_vencimiento IS NOT NULL) < CURRENT_DATE THEN 'vencido'
                WHEN MIN(d.fecha_vencimiento) FILTER (WHERE d.fecha_vencimiento IS NOT NULL) <= CURRENT_DATE + INTERVAL '30 days' THEN 'por_vencer'
                ELSE 'al_dia'
              END AS semaforo
       FROM contratistas c
       LEFT JOIN contratistas_documentos d ON d.contratista_id = c.id
       WHERE ${condiciones.join(' AND ')}
       GROUP BY c.id
       ORDER BY c.razon_social ASC`,
      parametros
    );
    return res.json({ contratistas: resultado.rows });
  } catch (err) {
    console.error('Error en listar (contratistas):', err);
    return res.status(500).json({ error: 'Error interno al listar contratistas.' });
  }
}

// ------------------------------------------------------------
// GET /api/contratistas/:id
// ------------------------------------------------------------
async function obtener(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const contratistaRes = await query(
      `SELECT ${columnas('contratistas', 'c')} FROM contratistas c WHERE c.id = $1 AND c.organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (contratistaRes.rows.length === 0) return res.status(404).json({ error: 'Contratista no encontrado.' });

    const documentosRes = await query(
      `SELECT ${columnas('contratistas_documentos', 'd')},
              (d.fecha_vencimiento IS NOT NULL AND d.fecha_vencimiento < CURRENT_DATE) AS vencido
       FROM contratistas_documentos d WHERE d.contratista_id = $1 ORDER BY d.fecha_vencimiento ASC NULLS LAST`,
      [req.params.id]
    );
    const trabajadoresRes = await query(
      `SELECT ${columnas('contratistas_trabajadores', 't')} FROM contratistas_trabajadores t
       WHERE t.contratista_id = $1 ORDER BY t.nombre_completo ASC`,
      [req.params.id]
    );

    return res.json({
      contratista: contratistaRes.rows[0],
      documentos: documentosRes.rows,
      trabajadores: trabajadoresRes.rows,
    });
  } catch (err) {
    console.error('Error en obtener (contratistas):', err);
    return res.status(500).json({ error: 'Error interno al obtener el contratista.' });
  }
}

// ------------------------------------------------------------
// PATCH /api/contratistas/:id/estado
// ------------------------------------------------------------
async function cambiarEstado(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado } = req.body;
  if (!['activo', 'suspendido', 'inactivo'].includes(estado)) {
    return res.status(400).json({ error: 'estado invalido. Valores permitidos: activo, suspendido, inactivo.' });
  }

  try {
    const resultado = await withTransaction(async (client) => {
      const updateRes = await client.query(
        `UPDATE contratistas SET estado = $1 WHERE id = $2 AND organizacion_id = $3 RETURNING id, estado`,
        [estado, req.params.id, orgId]
      );
      if (updateRes.rows.length === 0) return null;

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'contratista_estado_cambiado',
        entidad: 'contratistas', entidadId: req.params.id, detalle: { estado }, req, client,
      });
      return updateRes;
    });

    if (!resultado) return res.status(404).json({ error: 'Contratista no encontrado.' });
    return res.json({ contratista: resultado.rows[0] });
  } catch (err) {
    console.error('Error en cambiarEstado (contratistas):', err);
    return res.status(500).json({ error: 'Error interno al cambiar el estado del contratista.' });
  }
}

// ------------------------------------------------------------
// POST /api/contratistas/:id/documentos
// ------------------------------------------------------------
async function agregarDocumento(req, res) {
  const orgId = req.usuario.organizacionId;
  const { tipo, numeroDocumento, fechaEmision, fechaVencimiento, archivoBase64 } = req.body;

  if (!TIPOS_DOCUMENTO_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: `tipo invalido. Valores permitidos: ${TIPOS_DOCUMENTO_VALIDOS.join(', ')}.` });
  }

  let archivoValidado = null;
  if (archivoBase64) {
    const chkArchivo = analizarDataUri(archivoBase64, 'documento_control');
    if (!chkArchivo.ok) return res.status(400).json({ error: `archivoBase64 invalido: ${chkArchivo.motivo}` });
    archivoValidado = archivoBase64;
  }

  try {
    const contratistaRes = await query(`SELECT id FROM contratistas WHERE id = $1 AND organizacion_id = $2`, [req.params.id, orgId]);
    if (contratistaRes.rows.length === 0) return res.status(404).json({ error: 'Contratista no encontrado.' });

    const insertarDocumento = async (client, publicId) => {
      const insertRes = await client.query(
        `INSERT INTO contratistas_documentos
          (contratista_id, organizacion_id, tipo, numero_documento, fecha_emision, fecha_vencimiento, public_id, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, tipo, fecha_vencimiento, creado_en`,
        [req.params.id, orgId, tipo, numeroDocumento || null, fechaEmision || null, fechaVencimiento || null,
          publicId, req.usuario.id]
      );

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'contratista_documento_agregado',
        entidad: 'contratistas_documentos', entidadId: insertRes.rows[0].id, detalle: { tipo }, req, client,
      });
      return insertRes;
    };

    let resultado;
    if (archivoValidado) {
      const { resultado: r } = await subirEvidenciaConCompensacion(
        archivoValidado, orgId, CARPETA_DOCUMENTOS_CONTRATISTA, { politica: 'documento_control' },
        (subidaInfo) => withTransaction((client) => insertarDocumento(client, subidaInfo.publicId))
      );
      resultado = r;
    } else {
      resultado = await withTransaction((client) => insertarDocumento(client, null));
    }

    return res.status(201).json({ documento: resultado.rows[0] });
  } catch (err) {
    console.error('Error en agregarDocumento (contratistas):', err);
    return res.status(500).json({ error: 'Error interno al agregar el documento.' });
  }
}

// ------------------------------------------------------------
// POST /api/contratistas/:id/trabajadores
// ------------------------------------------------------------
async function agregarTrabajador(req, res) {
  const orgId = req.usuario.organizacionId;
  const { nombreCompleto, cedula, cargo } = req.body;

  if (!nombreCompleto || !nombreCompleto.trim()) return res.status(400).json({ error: 'nombreCompleto es obligatorio.' });
  if (!cedula || !cedula.trim()) return res.status(400).json({ error: 'cedula es obligatoria.' });

  try {
    const contratistaRes = await query(`SELECT id FROM contratistas WHERE id = $1 AND organizacion_id = $2`, [req.params.id, orgId]);
    if (contratistaRes.rows.length === 0) return res.status(404).json({ error: 'Contratista no encontrado.' });

    const insertRes = await withTransaction(async (client) => {
      const r = await client.query(
        `INSERT INTO contratistas_trabajadores (contratista_id, organizacion_id, nombre_completo, cedula, cargo)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, nombre_completo, cedula, cargo, estado, creado_en`,
        [req.params.id, orgId, nombreCompleto.trim(), cedula.trim(), cargo || null]
      );
      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'contratista_trabajador_agregado',
        entidad: 'contratistas_trabajadores', entidadId: r.rows[0].id, detalle: { contratistaId: req.params.id }, req, client,
      });
      return r;
    });

    return res.status(201).json({ trabajador: insertRes.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un trabajador de contratista con esa cedula en esta organizacion.' });
    console.error('Error en agregarTrabajador (contratistas):', err);
    return res.status(500).json({ error: 'Error interno al agregar el trabajador.' });
  }
}

module.exports = { crear, listar, obtener, cambiarEstado, agregarDocumento, agregarTrabajador };
