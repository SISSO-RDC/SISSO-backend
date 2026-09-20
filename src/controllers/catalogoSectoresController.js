// ============================================================
// Controlador del catalogo de sectores empresariales.
// Ver migration_077_catalogo_sectores.sql para el diseno de la
// tabla y la justificacion de por que es global (sin
// organizacion_id, sin RLS) -- mismo patron que catalogo_cie10.
//
// Lote A del plan "Perfil inteligente de empresa" (fusion SISSO
// Demo -> SISSO Plataforma). Lectura: cualquier usuario autenticado
// (lo necesita el configurador de Mi Empresa, Lote B). Escritura:
// solo superadmin, porque es un catalogo de referencia compartido
// por TODAS las organizaciones -- una organizacion normal editando
// "los examenes sugeridos para el sector Salud" afectaria lo que
// ven todas las demas empresas de ese mismo sector.
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { calcularCoberturaContenido } = require('../utils/coberturaSectorial');

const COLUMNAS_EDITABLES = [
  'etiqueta', 'icono', 'color_acento', 'color_fondo', 'descripcion',
  'riesgos', 'areas', 'examenes_sugeridos', 'herramientas_ergonomicas',
  'epp_sugerido', 'kpis_sugeridos', 'puestos_frecuentes', 'orden', 'activo',
  // N.18 (G18-04): estado explicito de validacion del contenido.
  'estado_contenido', 'contenido_validado_por', 'contenido_validado_en', 'notas_contenido',
];

// Columnas de CONTENIDO ocupacional: si cambian, cualquier validacion previa
// deja de valer (se valido OTRO contenido).
const COLUMNAS_DE_CONTENIDO = [
  'riesgos', 'areas', 'examenes_sugeridos', 'herramientas_ergonomicas',
  'epp_sugerido', 'kpis_sugeridos', 'puestos_frecuentes',
];

const CAMPOS_JSON = new Set([
  'riesgos', 'areas', 'examenes_sugeridos', 'herramientas_ergonomicas',
  'epp_sugerido', 'kpis_sugeridos', 'puestos_frecuentes',
]);

// ------------------------------------------------------------
// GET /api/catalogo-sectores
// Lista los sectores activos (o todos si se pide ?incluirInactivos=true,
// solo superadmin -- para poder reactivar uno desde el panel).
// ------------------------------------------------------------
async function listar(req, res) {
  try {
    const incluirInactivos = req.query.incluirInactivos === 'true' && req.usuario.rol === 'superadmin';
    const filtro = incluirInactivos ? '' : 'WHERE activo = true';
    const resultado = await query(
      `SELECT id, clave, etiqueta, icono, color_acento, color_fondo, descripcion,
              riesgos, areas, examenes_sugeridos, herramientas_ergonomicas,
              epp_sugerido, kpis_sugeridos, puestos_frecuentes, activo, orden,
              estado_contenido, contenido_validado_por, contenido_validado_en, notas_contenido
       FROM catalogo_sectores
       ${filtro}
       ORDER BY orden ASC, etiqueta ASC`
    );
    return res.json({
      sectores: resultado.rows.map((s) => ({ ...s, cobertura_contenido: calcularCoberturaContenido(s) })),
    });
  } catch (err) {
    console.error('Error en listar (catalogo de sectores):', err);
    return res.status(500).json({ error: 'Error interno al obtener el catalogo de sectores.' });
  }
}

// ------------------------------------------------------------
// GET /api/catalogo-sectores/:clave
// Detalle de un sector -- lo usara el configurador (Lote B) para
// mostrar la vista previa "riesgos detectados / areas sugeridas / ..."
// antes de que el usuario confirme la configuracion.
// ------------------------------------------------------------
async function obtener(req, res) {
  try {
    const resultado = await query(
      `SELECT id, clave, etiqueta, icono, color_acento, color_fondo, descripcion,
              riesgos, areas, examenes_sugeridos, herramientas_ergonomicas,
              epp_sugerido, kpis_sugeridos, puestos_frecuentes, activo, orden,
              estado_contenido, contenido_validado_por, contenido_validado_en, notas_contenido
       FROM catalogo_sectores WHERE clave = $1`,
      [req.params.clave]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Sector no encontrado.' });
    }
    return res.json({ sector: { ...resultado.rows[0], cobertura_contenido: calcularCoberturaContenido(resultado.rows[0]) } });
  } catch (err) {
    console.error('Error en obtener (catalogo de sectores):', err);
    return res.status(500).json({ error: 'Error interno al obtener el sector.' });
  }
}

// ------------------------------------------------------------
// PUT /api/catalogo-sectores/:clave  (solo superadmin)
// Actualiza parcialmente un sector del catalogo. No permite crear
// ni borrar claves nuevas desde aqui a proposito: agregar un sector
// nuevo es un cambio estructural (icono, color, taxonomia) que
// conviene revisar caso por caso, no un PUT generico.
// ------------------------------------------------------------
async function actualizar(req, res) {
  const { clave } = req.params;
  const cambios = req.body || {};

  const columnas = Object.keys(cambios).filter((c) => COLUMNAS_EDITABLES.includes(c));
  if (columnas.length === 0) {
    return res.status(400).json({ error: 'No se recibio ningun campo editable valido.' });
  }

  // N.18 (G18-04): un sector 'validado' solo puede declararse con quien lo valido y cuando.
  if (cambios.estado_contenido !== undefined && !['borrador_sin_validar', 'validado'].includes(cambios.estado_contenido)) {
    return res.status(400).json({ error: 'estado_contenido debe ser "borrador_sin_validar" o "validado".' });
  }
  if (cambios.estado_contenido === 'validado'
    && (!String(cambios.contenido_validado_por || '').trim() || !cambios.contenido_validado_en)) {
    return res.status(400).json({ error: 'Para marcar el contenido como "validado" indique contenido_validado_por y contenido_validado_en.' });
  }
  // Si cambia el CONTENIDO y el request no decide el estado, la validacion previa deja de valer.
  if (columnas.some((c) => COLUMNAS_DE_CONTENIDO.includes(c)) && cambios.estado_contenido === undefined) {
    cambios.estado_contenido = 'borrador_sin_validar';
    cambios.contenido_validado_por = null;
    cambios.contenido_validado_en = null;
    ['estado_contenido', 'contenido_validado_por', 'contenido_validado_en'].forEach((c) => {
      if (!columnas.includes(c)) columnas.push(c);
    });
  }

  const asignaciones = columnas.map((c, i) => `${c} = $${i + 2}${CAMPOS_JSON.has(c) ? '::jsonb' : ''}`);
  const valores = columnas.map((c) => (CAMPOS_JSON.has(c) ? JSON.stringify(cambios[c]) : cambios[c]));

  try {
    const resultado = await query(
      `UPDATE catalogo_sectores SET ${asignaciones.join(', ')} WHERE clave = $1
       RETURNING id, clave, etiqueta, activo`,
      [clave, ...valores]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Sector no encontrado.' });
    }

    await registrarAuditoria({
      usuarioId: req.usuario.id,
      accion: 'actualizar_catalogo_sector',
      entidad: 'catalogo_sectores',
      entidadId: resultado.rows[0].id,
      detalle: { clave, camposActualizados: columnas },
      req,
    });

    return res.json({ sector: resultado.rows[0] });
  } catch (err) {
    console.error('Error en actualizar (catalogo de sectores):', err);
    return res.status(500).json({ error: 'Error interno al actualizar el sector.' });
  }
}

// ------------------------------------------------------------
// PATCH /api/catalogo-sectores/:clave/estado  (solo superadmin)
// Activar/desactivar un sector (no se borra nunca en duro: si una
// organizacion ya lo tiene seleccionado, desactivarlo no debe
// destruir esa referencia -- Fase 10, "no cambios destructivos").
// ------------------------------------------------------------
async function cambiarEstado(req, res) {
  const { clave } = req.params;
  const { activo } = req.body;

  if (typeof activo !== 'boolean') {
    return res.status(400).json({ error: 'El campo "activo" debe ser booleano.' });
  }

  try {
    const resultado = await query(
      `UPDATE catalogo_sectores SET activo = $2 WHERE clave = $1 RETURNING id, clave, activo`,
      [clave, activo]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Sector no encontrado.' });
    }

    await registrarAuditoria({
      usuarioId: req.usuario.id,
      accion: activo ? 'activar_catalogo_sector' : 'desactivar_catalogo_sector',
      entidad: 'catalogo_sectores',
      entidadId: resultado.rows[0].id,
      detalle: { clave },
      req,
    });

    return res.json({ sector: resultado.rows[0] });
  } catch (err) {
    console.error('Error en cambiarEstado (catalogo de sectores):', err);
    return res.status(500).json({ error: 'Error interno al cambiar el estado del sector.' });
  }
}

module.exports = { listar, obtener, actualizar, cambiarEstado };
