// ============================================================
// Controlador del catalogo de normativas sobre las que se
// sustenta SISSO. Ver migration_096_normativas_sisso.sql para el
// diseno de la tabla y la advertencia central: este catalogo NO es
// una certificacion de cumplimiento legal integral, fuente_cita
// indica de donde se tomo cada ficha (mismo criterio que
// catalogo_paises_normativos.cobertura_detalle, migration_082).
//
// Mismo patron que catalogoSectoresController.js / catalogoPaisesController.js:
// catalogo GLOBAL (sin organizacion_id), lectura abierta a
// cualquier usuario autenticado, escritura (crear/editar) reservada
// a superadmin -- es un catalogo de referencia compartido por TODAS
// las organizaciones.
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

const COLUMNAS = `id, pais_clave, tipo, numero_acto, titulo, entidad_emisora, fecha_expedicion,
       fecha_publicacion_ro, estado, deroga_a, derogada_por, resumen, ambito_sisso,
       contenido_estructurado, url_pdf, fuente_cita, activa, orden, creado_en, actualizado_en`;

// ------------------------------------------------------------
// GET /api/normativas
// Lista las normativas activas (o todas si ?incluirInactivas=true,
// solo superadmin), opcionalmente filtradas por ?pais=ecuador.
// Cualquier usuario autenticado puede leer: es la base del panel
// "Normativas" y del disclaimer de aceptacion.
// ------------------------------------------------------------
async function listar(req, res) {
  try {
    const incluirInactivas = req.query.incluirInactivas === 'true' && req.usuario.rol === 'superadmin';
    const condiciones = [];
    const valores = [];

    if (!incluirInactivas) condiciones.push('activa = true');
    if (req.query.pais) {
      valores.push(req.query.pais);
      condiciones.push(`pais_clave = $${valores.length}`);
    }

    const filtro = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const resultado = await query(
      `SELECT ${COLUMNAS} FROM normativas_sisso ${filtro} ORDER BY orden ASC, titulo ASC`,
      valores
    );
    return res.json({ normativas: resultado.rows });
  } catch (err) {
    console.error('Error en listar (normativas):', err);
    return res.status(500).json({ error: 'Error interno al obtener el catálogo de normativas.' });
  }
}

// ------------------------------------------------------------
// GET /api/normativas/:id
// ------------------------------------------------------------
async function obtener(req, res) {
  try {
    const resultado = await query(`SELECT ${COLUMNAS} FROM normativas_sisso WHERE id = $1`, [req.params.id]);
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Normativa no encontrada.' });
    }
    return res.json({ normativa: resultado.rows[0] });
  } catch (err) {
    console.error('Error en obtener (normativas):', err);
    return res.status(500).json({ error: 'Error interno al obtener la normativa.' });
  }
}

// ------------------------------------------------------------
// POST /api/normativas (solo superadmin)
// ------------------------------------------------------------
const CAMPOS_EDITABLES = [
  'pais_clave', 'tipo', 'numero_acto', 'titulo', 'entidad_emisora', 'fecha_expedicion',
  'fecha_publicacion_ro', 'estado', 'deroga_a', 'derogada_por', 'resumen', 'ambito_sisso',
  'contenido_estructurado', 'url_pdf', 'fuente_cita', 'activa', 'orden',
];
const CAMPOS_JSON = new Set(['contenido_estructurado']);

async function crear(req, res) {
  const datos = req.body || {};
  if (!datos.titulo || !datos.tipo || !datos.fuente_cita) {
    return res.status(400).json({ error: 'titulo, tipo y fuente_cita son obligatorios.' });
  }

  const columnas = CAMPOS_EDITABLES.filter((c) => datos[c] !== undefined);
  const marcadores = columnas.map((c, i) => `$${i + 2}${CAMPOS_JSON.has(c) ? '::jsonb' : ''}`);
  const valores = columnas.map((c) => (CAMPOS_JSON.has(c) ? JSON.stringify(datos[c]) : datos[c]));

  try {
    const resultado = await query(
      `INSERT INTO normativas_sisso (creado_por, ${columnas.join(', ')})
       VALUES ($1, ${marcadores.join(', ')})
       RETURNING ${COLUMNAS}`,
      [req.usuario.id, ...valores]
    );

    await registrarAuditoria({
      usuarioId: req.usuario.id,
      accion: 'crear_normativa',
      entidad: 'normativas_sisso',
      entidadId: resultado.rows[0].id,
      detalle: { titulo: resultado.rows[0].titulo },
      req,
    });

    return res.status(201).json({ normativa: resultado.rows[0] });
  } catch (err) {
    console.error('Error en crear (normativas):', err);
    return res.status(500).json({ error: 'Error interno al crear la normativa.' });
  }
}

// ------------------------------------------------------------
// PUT /api/normativas/:id (solo superadmin)
// Uso principal esperado: pegar url_pdf una vez que el PDF ya fue
// subido, o confirmar fecha_publicacion_ro cuando se verifique el
// Registro Oficial real (necesario para el generador de
// obligaciones legales de SISAT, ver obligacionesLegalesController.js).
// ------------------------------------------------------------
async function actualizar(req, res) {
  const { id } = req.params;
  const cambios = req.body || {};

  const columnas = Object.keys(cambios).filter((c) => CAMPOS_EDITABLES.includes(c));
  if (columnas.length === 0) {
    return res.status(400).json({ error: 'No se recibió ningún campo editable válido.' });
  }

  const asignaciones = columnas.map((c, i) => `${c} = $${i + 2}${CAMPOS_JSON.has(c) ? '::jsonb' : ''}`);
  const valores = columnas.map((c) => (CAMPOS_JSON.has(c) ? JSON.stringify(cambios[c]) : cambios[c]));

  try {
    const resultado = await query(
      `UPDATE normativas_sisso SET ${asignaciones.join(', ')}, actualizado_en = now()
       WHERE id = $1 RETURNING ${COLUMNAS}`,
      [id, ...valores]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Normativa no encontrada.' });
    }

    await registrarAuditoria({
      usuarioId: req.usuario.id,
      accion: 'actualizar_normativa',
      entidad: 'normativas_sisso',
      entidadId: id,
      detalle: { camposActualizados: columnas },
      req,
    });

    return res.json({ normativa: resultado.rows[0] });
  } catch (err) {
    console.error('Error en actualizar (normativas):', err);
    return res.status(500).json({ error: 'Error interno al actualizar la normativa.' });
  }
}

module.exports = { listar, obtener, crear, actualizar };
