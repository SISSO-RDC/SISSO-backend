// ============================================================
// Controlador de Control Documental (Lote 2 del plan de cierre de
// brechas frente a plataformas EHS globales, Sep 2026).
//
// Cada version de un documento es una fila independiente
// (numero_documento agrupa versiones; reemplaza_a apunta a la
// version anterior). Publicar una version nueva marca la anterior
// 'obsoleto' en la misma transaccion -- se conserva el historial
// completo, que una auditoria ISO puede pedir ver.
//
// Gestion (crear/nueva version): admin, sso. Lectura y acuse: todo
// usuario autenticado de la organizacion (cualquier rol interno).
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { columnas } = require('../db/columnasExplicitas');
const { registrarAuditoria } = require('../utils/auditoria');
const { analizarDataUri } = require('../utils/validarArchivo');
const { subirEvidenciaConCompensacion, generarUrlFirmada } = require('../servicios/cloudinaryService');

const CARPETA_EVIDENCIA = 'sisso/documentos-control';
const CATEGORIAS_VALIDAS = ['politica', 'procedimiento', 'instructivo', 'formato', 'otro'];

// ------------------------------------------------------------
// POST /api/documentos-control
// ------------------------------------------------------------
async function crear(req, res) {
  const orgId = req.usuario.organizacionId;
  const {
    numeroDocumento, titulo, categoria, propietarioId, aprobadorId, fechaAprobacion,
    fechaProximaRevision, requiereAcuse, archivoBase64, reemplazaA,
  } = req.body;

  if (!titulo || !titulo.trim()) return res.status(400).json({ error: 'titulo es obligatorio.' });
  if (!CATEGORIAS_VALIDAS.includes(categoria)) {
    return res.status(400).json({ error: `categoria invalida. Valores permitidos: ${CATEGORIAS_VALIDAS.join(', ')}.` });
  }
  if (!propietarioId) return res.status(400).json({ error: 'propietarioId es obligatorio.' });
  if (!archivoBase64) return res.status(400).json({ error: 'archivoBase64 (PDF) es obligatorio.' });

  const chkArchivo = analizarDataUri(archivoBase64, 'documento_control');
  if (!chkArchivo.ok) return res.status(400).json({ error: `archivoBase64 invalido: ${chkArchivo.motivo}` });

  try {
    let numeroFinal = numeroDocumento ? numeroDocumento.trim() : null;
    let versionFinal = 1;
    let anterior = null;

    if (reemplazaA) {
      const anteriorRes = await query(
        `SELECT id, numero_documento, version, estado FROM documentos_control WHERE id = $1 AND organizacion_id = $2`,
        [reemplazaA, orgId]
      );
      if (anteriorRes.rows.length === 0) {
        return res.status(400).json({ error: 'reemplazaA no corresponde a un documento existente.' });
      }
      anterior = anteriorRes.rows[0];
      if (anterior.estado === 'obsoleto') {
        return res.status(400).json({ error: 'Ese documento ya fue reemplazado por otra version.' });
      }
      numeroFinal = numeroFinal || anterior.numero_documento;
      versionFinal = anterior.version + 1;
    }

    if (!numeroFinal) return res.status(400).json({ error: 'numeroDocumento es obligatorio (o indique reemplazaA).' });

    const insertarDocumento = async (client, subidaInfo) => {
      const insertRes = await client.query(
        `INSERT INTO documentos_control
          (organizacion_id, numero_documento, titulo, categoria, version, reemplaza_a, propietario_id,
           aprobador_id, fecha_aprobacion, fecha_proxima_revision, requiere_acuse, public_id, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id, numero_documento, titulo, categoria, version, estado, creado_en`,
        [
          orgId, numeroFinal, titulo.trim(), categoria, versionFinal, reemplazaA || null, propietarioId,
          aprobadorId || null, fechaAprobacion || null, fechaProximaRevision || null,
          requiereAcuse !== false, subidaInfo.publicId, req.usuario.id,
        ]
      );

      if (anterior) {
        await client.query(`UPDATE documentos_control SET estado = 'obsoleto' WHERE id = $1 AND organizacion_id = $2`, [anterior.id, orgId]);
      }

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'documento_control_creado',
        entidad: 'documentos_control', entidadId: insertRes.rows[0].id,
        detalle: { numeroDocumento: numeroFinal, version: versionFinal, reemplazaA: reemplazaA || null }, req, client,
      });

      return insertRes;
    };

    const { resultado } = await subirEvidenciaConCompensacion(
      archivoBase64, orgId, CARPETA_EVIDENCIA, { politica: 'documento_control' },
      (subidaInfo) => withTransaction((client) => insertarDocumento(client, subidaInfo))
    );

    return res.status(201).json({ documento: resultado.rows[0] });
  } catch (err) {
    console.error('Error en crear (documentos de control):', err);
    return res.status(500).json({ error: 'Error interno al crear el documento.' });
  }
}

// ------------------------------------------------------------
// GET /api/documentos-control  (filtros: estado, categoria)
// Por defecto solo muestra la version vigente de cada documento
// (estado=vigente); pasar ?incluirObsoletos=true para ver todo.
// ------------------------------------------------------------
async function listar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { categoria, incluirObsoletos } = req.query;

  const condiciones = ['d.organizacion_id = $1'];
  const parametros = [orgId];
  if (!incluirObsoletos || incluirObsoletos !== 'true') condiciones.push(`d.estado = 'vigente'`);
  if (categoria) { parametros.push(categoria); condiciones.push(`d.categoria = $${parametros.length}`); }

  try {
    const resultado = await query(
      `SELECT d.id, d.numero_documento, d.titulo, d.categoria, d.version, d.estado,
              d.fecha_proxima_revision, d.requiere_acuse, d.creado_en,
              p.nombre_completo AS propietario_nombre,
              (SELECT count(*)::int FROM documentos_control_acuses a WHERE a.documento_id = d.id) AS total_acuses
       FROM documentos_control d
       LEFT JOIN usuarios p ON p.id = d.propietario_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY d.numero_documento ASC, d.version DESC`,
      parametros
    );
    return res.json({ documentos: resultado.rows });
  } catch (err) {
    console.error('Error en listar (documentos de control):', err);
    return res.status(500).json({ error: 'Error interno al listar los documentos.' });
  }
}

// ------------------------------------------------------------
// GET /api/documentos-control/:id
// ------------------------------------------------------------
async function obtener(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const docRes = await query(
      `SELECT ${columnas('documentos_control', 'd')}, p.nombre_completo AS propietario_nombre,
              a.nombre_completo AS aprobador_nombre
       FROM documentos_control d
       LEFT JOIN usuarios p ON p.id = d.propietario_id
       LEFT JOIN usuarios a ON a.id = d.aprobador_id
       WHERE d.id = $1 AND d.organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (docRes.rows.length === 0) return res.status(404).json({ error: 'Documento no encontrado.' });

    const historialRes = await query(
      `SELECT id, version, estado, creado_en FROM documentos_control
       WHERE organizacion_id = $1 AND numero_documento = $2 ORDER BY version DESC`,
      [orgId, docRes.rows[0].numero_documento]
    );

    const acusesRes = await query(
      `SELECT a.usuario_id, u.nombre_completo, a.leido_en FROM documentos_control_acuses a
       JOIN usuarios u ON u.id = a.usuario_id WHERE a.documento_id = $1 ORDER BY a.leido_en DESC`,
      [req.params.id]
    );

    const yaAcuso = acusesRes.rows.some((a) => a.usuario_id === req.usuario.id);

    return res.json({
      documento: docRes.rows[0], historial: historialRes.rows, acuses: acusesRes.rows, yaAcuso,
    });
  } catch (err) {
    console.error('Error en obtener (documentos de control):', err);
    return res.status(500).json({ error: 'Error interno al obtener el documento.' });
  }
}

// ------------------------------------------------------------
// GET /api/documentos-control/:id/url
// ------------------------------------------------------------
async function obtenerUrl(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const docRes = await query(`SELECT public_id FROM documentos_control WHERE id = $1 AND organizacion_id = $2`, [req.params.id, orgId]);
    if (docRes.rows.length === 0) return res.status(404).json({ error: 'Documento no encontrado.' });
    return res.json({ url: generarUrlFirmada(docRes.rows[0].public_id, 'imagen') });
  } catch (err) {
    console.error('Error en obtenerUrl (documentos de control):', err);
    return res.status(500).json({ error: 'Error interno al generar el enlace del documento.' });
  }
}

// ------------------------------------------------------------
// POST /api/documentos-control/:id/acuse
// Cualquier usuario autenticado de la organizacion confirma que
// leyo esta version del documento. Idempotente: repetir el acuse
// no crea una segunda fila (UNIQUE documento_id+usuario_id).
// ------------------------------------------------------------
async function registrarAcuse(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const docRes = await query(`SELECT id FROM documentos_control WHERE id = $1 AND organizacion_id = $2`, [req.params.id, orgId]);
    if (docRes.rows.length === 0) return res.status(404).json({ error: 'Documento no encontrado.' });

    await query(
      `INSERT INTO documentos_control_acuses (documento_id, organizacion_id, usuario_id)
       VALUES ($1,$2,$3) ON CONFLICT (documento_id, usuario_id) DO NOTHING`,
      [req.params.id, orgId, req.usuario.id]
    );

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'documento_control_acuse',
      entidad: 'documentos_control', entidadId: req.params.id, req,
    });

    return res.json({ mensaje: 'Acuse registrado.' });
  } catch (err) {
    console.error('Error en registrarAcuse (documentos de control):', err);
    return res.status(500).json({ error: 'Error interno al registrar el acuse.' });
  }
}

module.exports = { crear, listar, obtener, obtenerUrl, registrarAcuse };
