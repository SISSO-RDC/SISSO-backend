// ============================================================
// Controlador de Matriz de Obligaciones Legales (Lote 2, Sep 2026).
//
// Gobierno de la referencia normativa IDENTICO al ya probado en
// examenesOrganizacionController.js / migration_091: una obligacion
// solo pasa a 'verificada' con fuente, jurisdiccion, articulo y
// fecha de validacion -- SIEMPRE de forma explicita y manual, nunca
// automatica. Gestion: admin, sso.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { columnas } = require('../db/columnasExplicitas');
const { registrarAuditoria } = require('../utils/auditoria');

const FRECUENCIAS_VALIDAS = ['unica', 'mensual', 'trimestral', 'semestral', 'anual'];

function proximaFechaSegunFrecuencia(fechaBase, frecuencia) {
  const fecha = new Date(fechaBase);
  switch (frecuencia) {
    case 'mensual': fecha.setMonth(fecha.getMonth() + 1); break;
    case 'trimestral': fecha.setMonth(fecha.getMonth() + 3); break;
    case 'semestral': fecha.setMonth(fecha.getMonth() + 6); break;
    case 'anual': fecha.setFullYear(fecha.getFullYear() + 1); break;
    default: return null; // 'unica': no se reprograma
  }
  return fecha.toISOString().slice(0, 10);
}

// ------------------------------------------------------------
// POST /api/obligaciones-legales
// ------------------------------------------------------------
async function crear(req, res) {
  const orgId = req.usuario.organizacionId;
  const { titulo, descripcion, jurisdiccion, frecuencia, responsableId, proximaFechaVencimiento } = req.body;

  if (!titulo || !titulo.trim()) return res.status(400).json({ error: 'titulo es obligatorio.' });
  if (!FRECUENCIAS_VALIDAS.includes(frecuencia)) {
    return res.status(400).json({ error: `frecuencia invalida. Valores permitidos: ${FRECUENCIAS_VALIDAS.join(', ')}.` });
  }
  if (!responsableId) return res.status(400).json({ error: 'responsableId es obligatorio.' });
  if (!proximaFechaVencimiento) return res.status(400).json({ error: 'proximaFechaVencimiento es obligatoria.' });

  try {
    const resultado = await withTransaction(async (client) => {
      const insertRes = await client.query(
        `INSERT INTO obligaciones_legales
          (organizacion_id, titulo, descripcion, jurisdiccion, frecuencia, responsable_id,
           proxima_fecha_vencimiento, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, titulo, frecuencia, proxima_fecha_vencimiento, estado_cumplimiento, estado_verificacion, creado_en`,
        [orgId, titulo.trim(), descripcion || null, jurisdiccion || null, frecuencia, responsableId, proximaFechaVencimiento, req.usuario.id]
      );

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'obligacion_legal_creada',
        entidad: 'obligaciones_legales', entidadId: insertRes.rows[0].id, detalle: { titulo, frecuencia }, req, client,
      });

      return insertRes;
    });

    return res.status(201).json({ obligacion: resultado.rows[0] });
  } catch (err) {
    console.error('Error en crear (obligaciones legales):', err);
    return res.status(500).json({ error: 'Error interno al crear la obligacion legal.' });
  }
}

// ------------------------------------------------------------
// GET /api/obligaciones-legales  (filtros: estado -- pendiente,
// cumplida, vencida (calculada); estadoVerificacion)
// ------------------------------------------------------------
async function listar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado, estadoVerificacion } = req.query;

  const condiciones = ['o.organizacion_id = $1'];
  const parametros = [orgId];
  if (estadoVerificacion) { parametros.push(estadoVerificacion); condiciones.push(`o.estado_verificacion = $${parametros.length}`); }

  try {
    let resultado = await query(
      `SELECT o.id, o.titulo, o.jurisdiccion, o.frecuencia, o.proxima_fecha_vencimiento, o.estado_cumplimiento,
              o.estado_verificacion, o.capa_id,
              r.nombre_completo AS responsable_nombre,
              (o.estado_cumplimiento = 'pendiente' AND o.proxima_fecha_vencimiento < CURRENT_DATE) AS vencida
       FROM obligaciones_legales o
       LEFT JOIN usuarios r ON r.id = o.responsable_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY o.proxima_fecha_vencimiento ASC`,
      parametros
    );

    if (estado === 'vencida') resultado = { rows: resultado.rows.filter((r) => r.vencida) };
    else if (estado === 'pendiente') resultado = { rows: resultado.rows.filter((r) => r.estado_cumplimiento === 'pendiente' && !r.vencida) };
    else if (estado === 'cumplida') resultado = { rows: resultado.rows.filter((r) => r.estado_cumplimiento === 'cumplida') };

    return res.json({ obligaciones: resultado.rows });
  } catch (err) {
    console.error('Error en listar (obligaciones legales):', err);
    return res.status(500).json({ error: 'Error interno al listar las obligaciones legales.' });
  }
}

// ------------------------------------------------------------
// GET /api/obligaciones-legales/:id
// ------------------------------------------------------------
async function obtener(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const resultado = await query(
      `SELECT ${columnas('obligaciones_legales', 'o')}, r.nombre_completo AS responsable_nombre,
              v.nombre_completo AS verificado_por_nombre
       FROM obligaciones_legales o
       LEFT JOIN usuarios r ON r.id = o.responsable_id
       LEFT JOIN usuarios v ON v.id = o.verificado_por
       WHERE o.id = $1 AND o.organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (resultado.rows.length === 0) return res.status(404).json({ error: 'Obligacion legal no encontrada.' });
    return res.json({ obligacion: resultado.rows[0] });
  } catch (err) {
    console.error('Error en obtener (obligaciones legales):', err);
    return res.status(500).json({ error: 'Error interno al obtener la obligacion legal.' });
  }
}

// ------------------------------------------------------------
// PATCH /api/obligaciones-legales/:id/verificar
// Establece la referencia normativa como verificada. SIEMPRE
// manual -- nunca se marca verificada por defecto ni se infiere.
// ------------------------------------------------------------
async function verificar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { fuenteNorma, jurisdiccion, articuloReferencia, fechaValidacion } = req.body;

  if (!fuenteNorma || !jurisdiccion || !articuloReferencia || !fechaValidacion) {
    return res.status(400).json({ error: 'fuenteNorma, jurisdiccion, articuloReferencia y fechaValidacion son obligatorios para verificar.' });
  }

  try {
    const resultado = await withTransaction(async (client) => {
      const updateRes = await client.query(
        `UPDATE obligaciones_legales
         SET estado_verificacion = 'verificada', fuente_norma = $1, jurisdiccion = $2,
             articulo_referencia = $3, fecha_validacion = $4, verificado_por = $5, verificado_en = now()
         WHERE id = $6 AND organizacion_id = $7
         RETURNING id, estado_verificacion`,
        [fuenteNorma.trim(), jurisdiccion.trim(), articuloReferencia.trim(), fechaValidacion, req.usuario.id, req.params.id, orgId]
      );
      if (updateRes.rows.length === 0) return null;

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'obligacion_legal_verificada',
        entidad: 'obligaciones_legales', entidadId: req.params.id, detalle: { fuenteNorma }, req, client,
      });

      return updateRes;
    });

    if (!resultado) return res.status(404).json({ error: 'Obligacion legal no encontrada.' });
    return res.json({ obligacion: resultado.rows[0] });
  } catch (err) {
    console.error('Error en verificar (obligaciones legales):', err);
    return res.status(500).json({ error: 'Error interno al verificar la obligacion legal.' });
  }
}

// ------------------------------------------------------------
// POST /api/obligaciones-legales/:id/cumplir
// Marca cumplida esta ocurrencia y, si la frecuencia es
// recurrente, reprograma automaticamente la proxima fecha (a
// partir de HOY, no de la fecha vencida) y vuelve a 'pendiente'.
// ------------------------------------------------------------
async function marcarCumplida(req, res) {
  const orgId = req.usuario.organizacionId;
  const { nota, documentoEvidenciaId } = req.body;

  try {
    const oblRes = await query(`SELECT id, frecuencia FROM obligaciones_legales WHERE id = $1 AND organizacion_id = $2`, [req.params.id, orgId]);
    if (oblRes.rows.length === 0) return res.status(404).json({ error: 'Obligacion legal no encontrada.' });

    const proximaReprogramada = proximaFechaSegunFrecuencia(new Date(), oblRes.rows[0].frecuencia);

    const resultado = await withTransaction(async (client) => {
      const updateRes = await client.query(
        `UPDATE obligaciones_legales
         SET estado_cumplimiento = $1, ultimo_cumplimiento_en = now(), ultimo_cumplimiento_nota = $2,
             documento_evidencia_id = COALESCE($3, documento_evidencia_id),
             proxima_fecha_vencimiento = COALESCE($4, proxima_fecha_vencimiento)
         WHERE id = $5 AND organizacion_id = $6
         RETURNING id, estado_cumplimiento, proxima_fecha_vencimiento`,
        [
          proximaReprogramada ? 'pendiente' : 'cumplida', // recurrente: vuelve a quedar pendiente para el siguiente ciclo
          nota ? nota.trim() : null, documentoEvidenciaId || null, proximaReprogramada, req.params.id, orgId,
        ]
      );

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'obligacion_legal_cumplida',
        entidad: 'obligaciones_legales', entidadId: req.params.id,
        detalle: { proximaReprogramada: proximaReprogramada || null }, req, client,
      });

      return updateRes;
    });

    return res.json({ obligacion: resultado.rows[0] });
  } catch (err) {
    console.error('Error en marcarCumplida (obligaciones legales):', err);
    return res.status(500).json({ error: 'Error interno al marcar la obligacion como cumplida.' });
  }
}

// ------------------------------------------------------------
// POST /api/obligaciones-legales/:id/generar-capa
// Mismo patron que reportesPeligroController.js:generarCapaDesdeReporte.
// ------------------------------------------------------------
async function generarCapaDesdeObligacion(req, res) {
  const orgId = req.usuario.organizacionId;
  const { responsableId, fechaLimite } = req.body;

  if (!responsableId || !fechaLimite) return res.status(400).json({ error: 'responsableId y fechaLimite son obligatorios.' });

  try {
    const oblRes = await query(`SELECT id, titulo, descripcion, capa_id FROM obligaciones_legales WHERE id = $1 AND organizacion_id = $2`, [req.params.id, orgId]);
    if (oblRes.rows.length === 0) return res.status(404).json({ error: 'Obligacion legal no encontrada.' });
    if (oblRes.rows[0].capa_id) return res.status(400).json({ error: 'Esta obligacion ya tiene una accion CAPA generada.' });

    const obligacion = oblRes.rows[0];

    const capaId = await withTransaction(async (client) => {
      const capaRes = await client.query(
        `INSERT INTO capa_acciones
          (organizacion_id, origen_tipo, origen_id, origen_descripcion, tipo, hallazgo, descripcion_accion,
           responsable_id, fecha_limite, creado_por)
         VALUES ($1,'obligacion_legal',$2,$3,'correctiva',$4,$5,$6,$7,$8)
         RETURNING id`,
        [
          orgId, obligacion.id, `Obligacion legal: ${obligacion.titulo}`,
          obligacion.descripcion || obligacion.titulo, `Atender la obligacion legal: ${obligacion.titulo}`,
          responsableId, fechaLimite, req.usuario.id,
        ]
      );

      await client.query(`UPDATE obligaciones_legales SET capa_id = $1 WHERE id = $2 AND organizacion_id = $3`, [capaRes.rows[0].id, req.params.id, orgId]);

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'obligacion_legal_genero_capa',
        entidad: 'obligaciones_legales', entidadId: req.params.id, detalle: { capaId: capaRes.rows[0].id }, req, client,
      });

      return capaRes.rows[0].id;
    });

    return res.status(201).json({ capaId });
  } catch (err) {
    console.error('Error en generarCapaDesdeObligacion (obligaciones legales):', err);
    return res.status(500).json({ error: 'Error interno al generar la accion CAPA.' });
  }
}

// ------------------------------------------------------------
// POST /api/obligaciones-legales/generar-sisat
// Genera en la matriz de obligaciones legales de la organizacion
// los plazos de las Disposiciones Transitorias del Acuerdo
// Ministerial MSP 00004-2026 (SISAT), a partir de una fecha de
// publicacion en Registro Oficial que el ADMIN CONFIRMA
// explicitamente (nunca se asume ni se inventa -- ver la nota en
// migration_096_normativas_sisso.sql sobre por que esa fecha no
// viene en el seed).
//
// Idempotente: usa plantilla_origen + el indice unico de
// migration_096 (organizacion_id, plantilla_origen, titulo) -- si
// se llama dos veces con la misma fecha, la segunda no duplica
// filas (ON CONFLICT DO NOTHING). Si se llama con una fecha
// DISTINTA a una corrida previa, tampoco se sobreescriben las
// obligaciones ya generadas: el admin debe editarlas o borrarlas
// a mano si la fecha confirmada cambia.
//
// El "responsable" de cada obligacion generada es el propio admin
// que ejecuta el generador (puede reasignarse despues desde la UI,
// igual que cualquier obligacion creada manualmente).
// ------------------------------------------------------------
const PLANTILLA_SISAT = 'SISAT-2026-transitorias';

function sumarMeses(fechaIso, meses) {
  const fecha = new Date(fechaIso);
  fecha.setMonth(fecha.getMonth() + meses);
  return fecha.toISOString().slice(0, 10);
}

async function generarPlantillaSisat(req, res) {
  const orgId = req.usuario.organizacionId;
  const { fechaPublicacionRo } = req.body;

  if (!fechaPublicacionRo || Number.isNaN(Date.parse(fechaPublicacionRo))) {
    return res.status(400).json({
      error: 'fechaPublicacionRo es obligatoria (fecha real de publicación del Acuerdo Ministerial '
        + 'MSP 00004-2026 en el Registro Oficial). SISSO no la asume automáticamente: confírmela antes de generar los plazos.',
    });
  }

  // Plazos segun las Disposiciones Transitorias del propio SISAT.
  // Las dos que son obligacion de la AUTORIDAD SANITARIA (no de la
  // empresa) se dejan fuera adrede: no le corresponden a este tenant.
  const PLANTILLA = [
    { meses: 12, titulo: 'SISAT: registro y habilitación de profesionales (ACESS)',
      descripcion: 'Los profesionales médicos, de enfermería y de psicología de los SISAT deben completar el proceso de registro y habilitación ante la Autoridad Sanitaria Nacional a través de la Agencia de Aseguramiento de la Calidad de los Servicios de Salud y Medicina Prepagada (ACESS) o su equivalente.' },
    { meses: 24, titulo: 'SISAT: certificación BLS del personal médico y de enfermería',
      descripcion: 'El profesional médico y de enfermería de los SISAT deben contar como mínimo con certificación en soporte vital básico (BLS) emitida por organismo autorizado, renovable cada 2 años.' },
    { meses: 24, titulo: 'SISAT: permiso de funcionamiento del establecimiento de salud en el trabajo',
      descripcion: 'Obtener el permiso de funcionamiento para el/los establecimiento(s) de salud en el trabajo, de acuerdo con la cartera de servicios y tipología que establezca la Autoridad Sanitaria Nacional.' },
  ];

  try {
    const resultado = await withTransaction(async (client) => {
      const filas = [];
      for (const item of PLANTILLA) {
        const vencimiento = sumarMeses(fechaPublicacionRo, item.meses);
        const insertRes = await client.query(
          `INSERT INTO obligaciones_legales
            (organizacion_id, titulo, descripcion, jurisdiccion, frecuencia, responsable_id,
             proxima_fecha_vencimiento, plantilla_origen,
             fuente_norma, articulo_referencia, creado_por)
           VALUES ($1,$2,$3,'Ecuador - nacional','unica',$4,$5,$6,$7,$8,$9)
           ON CONFLICT (organizacion_id, plantilla_origen, titulo) DO NOTHING
           RETURNING id, titulo, proxima_fecha_vencimiento`,
          [
            orgId, item.titulo, item.descripcion, req.usuario.id, vencimiento, PLANTILLA_SISAT,
            'Acuerdo Ministerial MSP 00004-2026 (SISAT), Disposiciones Transitorias', 'Disposiciones Transitorias',
            req.usuario.id,
          ]
        );
        if (insertRes.rows.length > 0) filas.push(insertRes.rows[0]);
      }

      await registrarAuditoria({
        organizacionId: orgId, usuarioId: req.usuario.id, accion: 'obligaciones_sisat_generadas',
        entidad: 'obligaciones_legales', detalle: { fechaPublicacionRo, generadas: filas.length }, req, client,
      });

      return filas;
    });

    return res.status(201).json({
      obligacionesGeneradas: resultado,
      mensaje: resultado.length === 0
        ? 'No se generó ninguna obligación nueva (ya existían de una corrida anterior con la misma plantilla).'
        : `Se generaron ${resultado.length} obligación(es) legal(es) de SISAT.`,
    });
  } catch (err) {
    console.error('Error en generarPlantillaSisat (obligaciones legales):', err);
    return res.status(500).json({ error: 'Error interno al generar las obligaciones de SISAT.' });
  }
}

module.exports = { crear, listar, obtener, verificar, marcarCumplida, generarCapaDesdeObligacion, generarPlantillaSisat };
