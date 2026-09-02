// ============================================================
// Controlador de Higiene Industrial. Corrige el hallazgo G4 de la
// Auditoria SISSO N.06: registro estructurado de mediciones y
// cumplimiento.
//
// Acceso: admin, sso gestionan. Lectura: cualquier usuario
// autenticado (dato tecnico/preventivo, no clinico).
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

const TIPOS_VALIDOS = ['ruido', 'iluminacion', 'vibracion', 'quimico', 'estres_termico', 'polvo', 'radiacion', 'otro'];

// ------------------------------------------------------------
// POST /api/higiene-industrial/mediciones
// `cumple` se calcula aqui, no se confia en lo que mande el
// cliente: para la mayoria de agentes "cumple" es valor <= limite,
// pero iluminacion es al reves (un lugar puede fallar por
// DEFECTO de luz, no por exceso) -- se maneja con el parametro
// `criterio`.
// ------------------------------------------------------------
async function crear(req, res) {
  const orgId = req.usuario.organizacionId;
  const {
    tipoMedicion, puestoTrabajoId, area, parametro, valorMedido, unidad, limitePermisible,
    criterio, equipoUtilizado, metodoReferencia, fechaMedicion, observaciones, catalogoLimiteId,
  } = req.body;

  if (!TIPOS_VALIDOS.includes(tipoMedicion)) {
    return res.status(400).json({ error: 'tipoMedicion invalido.' });
  }
  if (!area || !parametro || !fechaMedicion) {
    return res.status(400).json({ error: 'area, parametro y fechaMedicion son obligatorios.' });
  }
  if (valorMedido == null || isNaN(valorMedido)) {
    return res.status(400).json({ error: 'valorMedido debe ser un numero.' });
  }

  // CORREGIDO en Auditoria N.14 (hallazgo GRAVE G14-10, P1): el
  // limite_permisible ya NO se acepta libremente del cliente sin
  // trazabilidad cuando se referencia un catalogoLimiteId -- en ese
  // caso el limite, unidad, criterio y metadatos normativos se toman
  // del catalogo versionado (catalogo_limites_higiene) y quedan
  // "congelados" (snapshot) en la medicion. Se conserva el flujo
  // anterior (limite libre) SOLO por compatibilidad para agentes que
  // aun no estan en el catalogo -- queda marcado explicitamente como
  // no verificable contra catalogo (limite_verificable_en_catalogo=false).
  let unidadFinal = unidad;
  let limiteFinal = limitePermisible;
  let criterioFinal = criterio === 'minimo' ? 'minimo' : 'maximo';
  let limiteVerificableEnCatalogo = false;
  let limiteNormaSnapshot = null;
  let limiteVersionSnapshot = null;
  let limiteJurisdiccionSnapshot = null;

  if (catalogoLimiteId) {
    const catRes = await query(
      `SELECT unidad, limite_valor, criterio, norma, version, jurisdiccion
       FROM catalogo_limites_higiene
       WHERE id = $1 AND fecha_vigencia_hasta IS NULL`,
      [catalogoLimiteId]
    );
    if (catRes.rows.length === 0) {
      return res.status(400).json({ error: 'catalogoLimiteId no corresponde a un limite vigente del catalogo.' });
    }
    const cat = catRes.rows[0];
    unidadFinal = cat.unidad;
    limiteFinal = Number(cat.limite_valor);
    criterioFinal = cat.criterio;
    limiteVerificableEnCatalogo = true;
    limiteNormaSnapshot = cat.norma;
    limiteVersionSnapshot = cat.version;
    limiteJurisdiccionSnapshot = cat.jurisdiccion;
  } else {
    if (!unidad || limitePermisible == null || isNaN(limitePermisible)) {
      return res.status(400).json({ error: 'Sin catalogoLimiteId, debe indicar unidad y limitePermisible manualmente.' });
    }
  }

  // criterio: 'maximo' (valor no debe superar el limite, la mayoria
  // de agentes: ruido, vibracion, quimicos) o 'minimo' (valor no
  // debe estar por debajo del limite, ej: iluminacion insuficiente).
  const cumple = criterioFinal === 'minimo' ? Number(valorMedido) >= Number(limiteFinal) : Number(valorMedido) <= Number(limiteFinal);

  try {
    const creadaRes = await query(
      `INSERT INTO mediciones_higiene_industrial
        (organizacion_id, tipo_medicion, puesto_trabajo_id, area, parametro, valor_medido, unidad,
         limite_permisible, cumple, equipo_utilizado, metodo_referencia, fecha_medicion, responsable_id, observaciones,
         catalogo_limite_id, limite_norma_snapshot, limite_version_snapshot, limite_jurisdiccion_snapshot, limite_verificable_en_catalogo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING id, tipo_medicion, cumple, fecha_medicion, creado_en, limite_verificable_en_catalogo`,
      [
        orgId, tipoMedicion, puestoTrabajoId || null, area.trim(), parametro.trim(), valorMedido, unidadFinal.trim(),
        limiteFinal, cumple, equipoUtilizado || null, metodoReferencia || null, fechaMedicion, req.usuario.id, observaciones || null,
        catalogoLimiteId || null, limiteNormaSnapshot, limiteVersionSnapshot, limiteJurisdiccionSnapshot, limiteVerificableEnCatalogo,
      ]
    );

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'medicion_higiene_creada',
      entidad: 'mediciones_higiene_industrial', entidadId: creadaRes.rows[0].id, detalle: { tipoMedicion, cumple, limiteVerificableEnCatalogo }, req,
    });

    return res.status(201).json({ medicion: creadaRes.rows[0] });
  } catch (err) {
    console.error('Error en crear (higiene industrial):', err);
    return res.status(500).json({ error: 'Error interno al registrar la medicion.' });
  }
}

// ------------------------------------------------------------
// GET /api/higiene-industrial/mediciones  (filtros: tipoMedicion, cumple)
// ------------------------------------------------------------
async function listar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { tipoMedicion, cumple } = req.query;

  const condiciones = ['m.organizacion_id = $1'];
  const parametros = [orgId];
  if (tipoMedicion) { parametros.push(tipoMedicion); condiciones.push(`m.tipo_medicion = $${parametros.length}`); }
  if (cumple === 'true' || cumple === 'false') { parametros.push(cumple === 'true'); condiciones.push(`m.cumple = $${parametros.length}`); }

  try {
    const resultado = await query(
      `SELECT m.id, m.tipo_medicion, m.puesto_trabajo_id, pt.nombre_puesto, m.area, m.parametro,
              m.valor_medido, m.unidad, m.limite_permisible, m.cumple, m.fecha_medicion, m.capa_id,
              u.nombre_completo AS responsable_nombre
       FROM mediciones_higiene_industrial m
       LEFT JOIN puestos_trabajo pt ON pt.id = m.puesto_trabajo_id
       LEFT JOIN usuarios u ON u.id = m.responsable_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY m.fecha_medicion DESC`,
      parametros
    );
    return res.json({ mediciones: resultado.rows });
  } catch (err) {
    console.error('Error en listar (higiene industrial):', err);
    return res.status(500).json({ error: 'Error interno al listar las mediciones.' });
  }
}

// ------------------------------------------------------------
// GET /api/higiene-industrial/mediciones/:id
// ------------------------------------------------------------
async function obtener(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const resultado = await query(
      `SELECT m.*, pt.nombre_puesto, u.nombre_completo AS responsable_nombre
       FROM mediciones_higiene_industrial m
       LEFT JOIN puestos_trabajo pt ON pt.id = m.puesto_trabajo_id
       LEFT JOIN usuarios u ON u.id = m.responsable_id
       WHERE m.id = $1 AND m.organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Medicion no encontrada.' });
    }
    return res.json({ medicion: resultado.rows[0] });
  } catch (err) {
    console.error('Error en obtener (higiene industrial):', err);
    return res.status(500).json({ error: 'Error interno al obtener la medicion.' });
  }
}

// ------------------------------------------------------------
// POST /api/higiene-industrial/mediciones/:id/generar-capa
// Solo tiene sentido si la medicion NO cumple. Mismo patron que
// inspecciones y riesgo psicosocial.
// ------------------------------------------------------------
async function generarCapaDesdeMedicion(req, res) {
  const orgId = req.usuario.organizacionId;
  const { responsableId, fechaLimite, descripcionAccion } = req.body;

  if (!responsableId || !fechaLimite) {
    return res.status(400).json({ error: 'responsableId y fechaLimite son obligatorios.' });
  }

  try {
    const medRes = await query(
      `SELECT id, cumple, capa_id, tipo_medicion, area, parametro, valor_medido, unidad, limite_permisible
       FROM mediciones_higiene_industrial WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (medRes.rows.length === 0) {
      return res.status(404).json({ error: 'Medicion no encontrada.' });
    }
    const medicion = medRes.rows[0];
    if (medicion.cumple) {
      return res.status(400).json({ error: 'Esta medicion cumple el limite permisible; no requiere accion CAPA.' });
    }
    if (medicion.capa_id) {
      return res.status(400).json({ error: 'Esta medicion ya tiene una accion CAPA generada.' });
    }

    const resultado = await withTransaction(async (client) => {
      const capaRes = await client.query(
        `INSERT INTO capa_acciones
          (organizacion_id, origen_tipo, origen_id, origen_descripcion, tipo, hallazgo, descripcion_accion,
           responsable_id, fecha_limite, creado_por)
         VALUES ($1,'higiene_industrial',$2,$3,'correctiva',$4,$5,$6,$7,$8)
         RETURNING id`,
        [
          orgId, req.params.id, `Medición de ${medicion.tipo_medicion} en ${medicion.area}`,
          `${medicion.parametro}: ${medicion.valor_medido} ${medicion.unidad} supera el límite permisible de ${medicion.limite_permisible} ${medicion.unidad}.`,
          descripcionAccion || 'Definir e implementar medidas de control para cumplir el límite permisible.',
          responsableId, fechaLimite, req.usuario.id,
        ]
      );

      await client.query(
        `UPDATE mediciones_higiene_industrial SET capa_id = $1 WHERE id = $2 AND organizacion_id = $3`,
        [capaRes.rows[0].id, req.params.id, orgId]
      );

      return capaRes.rows[0].id;
    });

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'medicion_higiene_genero_capa',
      entidad: 'mediciones_higiene_industrial', entidadId: req.params.id, detalle: { capaId: resultado }, req,
    });

    return res.status(201).json({ capaId: resultado });
  } catch (err) {
    console.error('Error en generarCapaDesdeMedicion (higiene industrial):', err);
    return res.status(500).json({ error: 'Error interno al generar la accion CAPA.' });
  }
}

module.exports = { crear, listar, obtener, generarCapaDesdeMedicion, listarCatalogoLimites };

// ------------------------------------------------------------
// GET /api/higiene-industrial/catalogo-limites
// CREADO en Auditoria N.14 (G14-10, P1): catalogo global (no por
// organizacion) de limites vigentes, para que el frontend pueda
// ofrecer "seleccionar limite del catalogo" en vez de un numero
// libre. Lectura abierta a cualquier usuario autenticado (mismo
// nivel de acceso que las mediciones).
// ------------------------------------------------------------
async function listarCatalogoLimites(req, res) {
  try {
    const resultado = await query(
      `SELECT id, agente, metodo_referencia, norma, jurisdiccion, version, unidad, limite_valor, criterio, fecha_vigencia_desde
       FROM catalogo_limites_higiene
       WHERE fecha_vigencia_hasta IS NULL
       ORDER BY agente`
    );
    return res.json({ catalogo: resultado.rows });
  } catch (err) {
    console.error('Error en listarCatalogoLimites (higiene industrial):', err);
    return res.status(500).json({ error: 'Error interno al listar el catalogo de limites.' });
  }
}
