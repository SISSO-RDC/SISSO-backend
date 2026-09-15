// ============================================================
// Controlador del catalogo de paises / perfiles normativos.
// Ver migration_079_catalogo_paises_normativos.sql para el diseno
// de la tabla y la advertencia central de la Fase 4 del plan:
// seleccionar un pais NUNCA declara cumplimiento legal automatico,
// solo registra una preferencia de perfil normativo.
//
// Mismo patron que catalogoSectoresController.js (Lote A): catalogo
// global, lectura abierta a autenticados, escritura (solo el texto
// descriptivo / activar-desactivar) restringida a superadmin.
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

async function listar(req, res) {
  try {
    const incluirInactivos = req.query.incluirInactivos === 'true' && req.usuario.rol === 'superadmin';
    const filtro = incluirInactivos ? '' : 'WHERE activo = true';
    const resultado = await query(
      `SELECT id, clave, nombre, bandera_emoji, estado, normativa_principal, descripcion_estado, cobertura_detalle, activo, orden
       FROM catalogo_paises_normativos
       ${filtro}
       ORDER BY orden ASC, nombre ASC`
    );
    return res.json({ paises: resultado.rows });
  } catch (err) {
    console.error('Error en listar (catalogo de paises normativos):', err);
    return res.status(500).json({ error: 'Error interno al obtener el catálogo de países.' });
  }
}

async function obtener(req, res) {
  try {
    const resultado = await query(
      `SELECT id, clave, nombre, bandera_emoji, estado, normativa_principal, descripcion_estado, cobertura_detalle, activo, orden
       FROM catalogo_paises_normativos WHERE clave = $1`,
      [req.params.clave]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'País no encontrado en el catálogo.' });
    }
    return res.json({ pais: resultado.rows[0] });
  } catch (err) {
    console.error('Error en obtener (catalogo de paises normativos):', err);
    return res.status(500).json({ error: 'Error interno al obtener el país.' });
  }
}

// ------------------------------------------------------------
// PUT /api/catalogo-paises/:clave (solo superadmin)
// Permite corregir el texto descriptivo o -- el dia que un pais
// realmente tenga su normativa implementada en el resto del
// sistema -- pasar su "estado" de 'en_desarrollo' a 'completo'.
// Este endpoint NUNCA activa por si solo ninguna regla especifica
// de pais: solo cambia lo que el catalogo describe. Activar reglas
// reales de un pais nuevo es trabajo de desarrollo, no de este CRUD.
// ------------------------------------------------------------
const CAMPOS_EDITABLES = ['nombre', 'bandera_emoji', 'estado', 'normativa_principal', 'descripcion_estado', 'cobertura_detalle', 'orden', 'activo'];
// CREADO en Auditoria N.16 (C-16-03, P0): cobertura_detalle es JSONB
// y necesita el cast ::jsonb en la asignacion SQL, a diferencia del
// resto de campos editables de esta tabla (todos texto/booleano).
const CAMPOS_JSON = new Set(['cobertura_detalle']);

async function actualizar(req, res) {
  const { clave } = req.params;
  const cambios = req.body || {};

  const columnas = Object.keys(cambios).filter((c) => CAMPOS_EDITABLES.includes(c));
  if (columnas.length === 0) {
    return res.status(400).json({ error: 'No se recibió ningún campo editable válido.' });
  }
  if (cambios.estado && !['completo', 'en_desarrollo'].includes(cambios.estado)) {
    return res.status(400).json({ error: "estado debe ser 'completo' o 'en_desarrollo'." });
  }

  const asignaciones = columnas.map((c, i) => `${c} = $${i + 2}${CAMPOS_JSON.has(c) ? '::jsonb' : ''}`);
  const valores = columnas.map((c) => (CAMPOS_JSON.has(c) ? JSON.stringify(cambios[c]) : cambios[c]));

  try {
    const resultado = await query(
      `UPDATE catalogo_paises_normativos SET ${asignaciones.join(', ')} WHERE clave = $1
       RETURNING id, clave, nombre, estado`,
      [clave, ...valores]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'País no encontrado.' });
    }

    await registrarAuditoria({
      usuarioId: req.usuario.id,
      accion: 'actualizar_catalogo_pais_normativo',
      entidad: 'catalogo_paises_normativos',
      entidadId: resultado.rows[0].id,
      detalle: { clave, camposActualizados: columnas },
      req,
    });

    return res.json({ pais: resultado.rows[0] });
  } catch (err) {
    console.error('Error en actualizar (catalogo de paises normativos):', err);
    return res.status(500).json({ error: 'Error interno al actualizar el país.' });
  }
}

module.exports = { listar, obtener, actualizar };
