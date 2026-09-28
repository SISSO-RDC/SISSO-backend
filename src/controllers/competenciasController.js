// ============================================================
// Controlador de Competencias (Lote 3, Sep 2026). Catalogo de
// competencias/certificaciones exigibles por la organizacion, y su
// asignacion a un trabajador propio O a un trabajador de
// contratista (exactamente uno de los dos -- CHECK en migration_101).
// Gestion: admin, sso.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { columnas } = require('../db/columnasExplicitas');
const { registrarAuditoria } = require('../utils/auditoria');
const { analizarDataUri } = require('../utils/validarArchivo');
const { subirEvidenciaConCompensacion } = require('../servicios/cloudinaryService');

const CARPETA_CERTIFICADOS_COMPETENCIA = 'sisso/certificados-competencias';

// ------------------------------------------------------------
// POST /api/competencias/catalogo
// ------------------------------------------------------------
async function crearEnCatalogo(req, res) {
  const orgId = req.usuario.organizacionId;
  const { nombre, descripcion, vigenciaMeses } = req.body;

  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'nombre es obligatorio.' });
  if (vigenciaMeses !== undefined && vigenciaMeses !== null && (!Number.isInteger(vigenciaMeses) || vigenciaMeses <= 0)) {
    return res.status(400).json({ error: 'vigenciaMeses debe ser un entero positivo, o omitirse si la competencia no vence.' });
  }

  try {
    const insertRes = await query(
      `INSERT INTO competencias_catalogo (organizacion_id, nombre, descripcion, vigencia_meses)
       VALUES ($1,$2,$3,$4) RETURNING id, nombre, vigencia_meses, creado_en`,
      [orgId, nombre.trim(), descripcion || null, vigenciaMeses || null]
    );
    return res.status(201).json({ competencia: insertRes.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe una competencia con ese nombre en el catalogo.' });
    console.error('Error en crearEnCatalogo (competencias):', err);
    return res.status(500).json({ error: 'Error interno al crear la competencia.' });
  }
}

// ------------------------------------------------------------
// GET /api/competencias/catalogo
// ------------------------------------------------------------
async function listarCatalogo(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const resultado = await query(
      `SELECT ${columnas('competencias_catalogo', 'c')} FROM competencias_catalogo c
       WHERE c.organizacion_id = $1 ORDER BY c.nombre ASC`,
      [orgId]
    );
    return res.json({ competencias: resultado.rows });
  } catch (err) {
    console.error('Error en listarCatalogo (competencias):', err);
    return res.status(500).json({ error: 'Error interno al listar el catalogo de competencias.' });
  }
}

// ------------------------------------------------------------
// POST /api/competencias/asignar
// Exactamente uno de trabajadorId / contratistaTrabajadorId.
// ------------------------------------------------------------
async function asignar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { competenciaId, trabajadorId, contratistaTrabajadorId, fechaObtencion, archivoBase64 } = req.body;

  if (!competenciaId) return res.status(400).json({ error: 'competenciaId es obligatorio.' });
  if (!fechaObtencion) return res.status(400).json({ error: 'fechaObtencion es obligatoria.' });
  if (Boolean(trabajadorId) === Boolean(contratistaTrabajadorId)) {
    return res.status(400).json({ error: 'Debe indicar exactamente uno: trabajadorId o contratistaTrabajadorId (no ambos, no ninguno).' });
  }

  let archivoValidado = null;
  if (archivoBase64) {
    const chkArchivo = analizarDataUri(archivoBase64, 'certificado');
    if (!chkArchivo.ok) return res.status(400).json({ error: `archivoBase64 invalido: ${chkArchivo.motivo}` });
    archivoValidado = archivoBase64;
  }

  try {
    const catalogoRes = await query(
      `SELECT id, vigencia_meses FROM competencias_catalogo WHERE id = $1 AND organizacion_id = $2`,
      [competenciaId, orgId]
    );
    if (catalogoRes.rows.length === 0) return res.status(404).json({ error: 'Competencia no encontrada en el catalogo.' });

    const vigenciaMeses = catalogoRes.rows[0].vigencia_meses;
    const fechaVencimiento = vigenciaMeses
      ? new Date(new Date(fechaObtencion).setMonth(new Date(fechaObtencion).getMonth() + vigenciaMeses)).toISOString().slice(0, 10)
      : null;

    const insertarAsignacion = async (client, publicId) => {
      const insertRes = await client.query(
        `INSERT INTO competencias_asignadas
          (organizacion_id, competencia_id, trabajador_id, contratista_trabajador_id, fecha_obtencion, fecha_vencimiento, public_id, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, fecha_obtencion, fecha_vencimiento, creado_en`,
        [orgId, competenciaId, trabajadorId || null, contratistaTrabajadorId || null,
          fechaObtencion, fechaVencimiento, publicId, req.usuario.id]
      );

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'competencia_asignada',
        entidad: 'competencias_asignadas', entidadId: insertRes.rows[0].id,
        detalle: { competenciaId, trabajadorId: trabajadorId || null, contratistaTrabajadorId: contratistaTrabajadorId || null },
        req, client,
      });
      return insertRes;
    };

    let resultado;
    if (archivoValidado) {
      const { resultado: r } = await subirEvidenciaConCompensacion(
        archivoValidado, orgId, CARPETA_CERTIFICADOS_COMPETENCIA, { politica: 'certificado' },
        (subidaInfo) => withTransaction((client) => insertarAsignacion(client, subidaInfo.publicId))
      );
      resultado = r;
    } else {
      resultado = await withTransaction((client) => insertarAsignacion(client, null));
    }

    return res.status(201).json({ asignacion: resultado.rows[0] });
  } catch (err) {
    console.error('Error en asignar (competencias):', err);
    return res.status(500).json({ error: 'Error interno al asignar la competencia.' });
  }
}

// ------------------------------------------------------------
// GET /api/competencias/asignadas?trabajadorId=...  |  ?contratistaTrabajadorId=...
// Incluye vencida (calculada contra CURRENT_DATE, nunca almacenada).
// ------------------------------------------------------------
async function listarAsignadas(req, res) {
  const orgId = req.usuario.organizacionId;
  const { trabajadorId, contratistaTrabajadorId } = req.query;

  if (Boolean(trabajadorId) === Boolean(contratistaTrabajadorId)) {
    return res.status(400).json({ error: 'Debe indicar exactamente uno: trabajadorId o contratistaTrabajadorId.' });
  }

  const columna = trabajadorId ? 'a.trabajador_id' : 'a.contratista_trabajador_id';
  const valor = trabajadorId || contratistaTrabajadorId;

  try {
    const resultado = await query(
      `SELECT a.id, a.fecha_obtencion, a.fecha_vencimiento, a.public_id, c.nombre AS competencia_nombre,
              (a.fecha_vencimiento IS NOT NULL AND a.fecha_vencimiento < CURRENT_DATE) AS vencida
       FROM competencias_asignadas a
       JOIN competencias_catalogo c ON c.id = a.competencia_id
       WHERE a.organizacion_id = $1 AND ${columna} = $2
       ORDER BY a.fecha_vencimiento ASC NULLS LAST`,
      [orgId, valor]
    );
    return res.json({ asignaciones: resultado.rows });
  } catch (err) {
    console.error('Error en listarAsignadas (competencias):', err);
    return res.status(500).json({ error: 'Error interno al listar las competencias asignadas.' });
  }
}

module.exports = { crearEnCatalogo, listarCatalogo, asignar, listarAsignadas };
