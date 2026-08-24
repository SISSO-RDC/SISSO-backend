// ============================================================
// Controlador del motor de aptitud medica.
//
// Reglas de autorizacion deliberadas (relacionadas al punto
// CRITICO #4 de la auditoria: "el rol admin tiene acceso completo
// a historia clinica, eso es problematico"):
//   - Solo 'medico' puede REGISTRAR aptitud (nunca admin, sso, th).
//   - 'admin' puede gestionar el catalogo de REGLAS (que es
//     configuracion del sistema, no datos clinicos de un
//     trabajador especifico) pero NUNCA puede ver ni registrar
//     la aptitud ni los diagnosticos de un trabajador concreto.
//   - El endpoint de aptitud de un trabajador especifico excluye
//     'admin' explicitamente de los roles autorizados.
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { detectarContraindicaciones } = require('../aptitud/motorContraindicaciones');

// ------------------------------------------------------------
// GET /api/aptitud/reglas
// Lista las reglas de contraindicacion activas (globales + las
// propias de la organizacion, si las hubiera).
// ------------------------------------------------------------
async function listarReglas(req, res) {
  try {
    const reglasRes = await query(
      `SELECT id, nombre, codigo_cie10_patron, tipo_coincidencia, exposicion_codigo,
              severidad, descripcion_riesgo, sugerencia_accion, fuente_referencia, activa, organizacion_id
       FROM reglas_contraindicacion
       WHERE activa = true AND (organizacion_id IS NULL OR organizacion_id = $1)
       ORDER BY severidad ASC, nombre ASC`,
      [req.usuario.organizacionId]
    );
    return res.json({ reglas: reglasRes.rows });
  } catch (err) {
    console.error('Error en listarReglas:', err);
    return res.status(500).json({ error: 'Error interno al listar las reglas de contraindicacion.' });
  }
}

// ------------------------------------------------------------
// POST /api/aptitud/reglas
// Crea una regla propia de la organizacion (no modifica las
// globales). Solo 'admin' puede gestionar el catalogo de reglas;
// esto es configuracion del sistema, no datos clinicos de un
// trabajador especifico, por lo que no entra en conflicto con la
// separacion de roles del punto critico #4.
// ------------------------------------------------------------
async function crearRegla(req, res) {
  const { nombre, codigoCie10Patron, tipoCoincidencia, exposicionCodigo, severidad, descripcionRiesgo, sugerenciaAccion, fuenteReferencia } = req.body;

  try {
    const exposicionRes = await query(
      `SELECT codigo FROM catalogo_exposiciones WHERE codigo = $1 AND (organizacion_id IS NULL OR organizacion_id = $2) AND activo = true`,
      [exposicionCodigo, req.usuario.organizacionId]
    );
    if (exposicionRes.rows.length === 0) {
      return res.status(400).json({ error: 'exposicionCodigo no existe en el catalogo de exposiciones.' });
    }

    const insertRes = await query(
      `INSERT INTO reglas_contraindicacion
        (organizacion_id, nombre, codigo_cie10_patron, tipo_coincidencia, exposicion_codigo, severidad, descripcion_riesgo, sugerencia_accion, fuente_referencia, creado_por)
       VALUES ($1, $2, $3, COALESCE($4, 'exacto'), $5, $6, $7, $8, $9, $10)
       RETURNING id, nombre, codigo_cie10_patron, tipo_coincidencia, exposicion_codigo, severidad, descripcion_riesgo, sugerencia_accion, fuente_referencia, creado_en`,
      [
        req.usuario.organizacionId,
        nombre,
        codigoCie10Patron.toUpperCase(),
        tipoCoincidencia || null,
        exposicionCodigo,
        severidad,
        descripcionRiesgo,
        sugerenciaAccion || null,
        fuenteReferencia || null,
        req.usuario.id,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'crear_regla_contraindicacion',
      critico: true, // Auditoria N.07 C6: escritura clinica, la auditoria no debe fallar en silencio
      entidad: 'regla_contraindicacion',
      entidadId: insertRes.rows[0].id,
      detalle: { nombre, severidad },
      req,
    });

    return res.status(201).json({ regla: insertRes.rows[0] });
  } catch (err) {
    console.error('Error en crearRegla:', err);
    return res.status(500).json({ error: 'Error interno al crear la regla de contraindicacion.' });
  }
}

// ------------------------------------------------------------
// GET /api/aptitud/cie10/buscar?q=epilepsia
// Busqueda del catalogo CIE-10 por texto (para el autocompletado
// del formulario donde el medico registra diagnosticos).
// ------------------------------------------------------------
async function buscarCie10(req, res) {
  const q = (req.query.q || '').trim();
  if (q.length < 2) {
    return res.status(400).json({ error: 'El parametro de busqueda "q" debe tener al menos 2 caracteres.' });
  }

  // CORREGIDO: la version anterior armaba el tsquery con
  // `q.split(/\s+/).join(' & ')`, SIN el sufijo de prefijo `:*`.
  // to_tsquery hace match por LEXEMA COMPLETO (tras stemming), no
  // por prefijo -- entonces buscar "ex" solo encontraba
  // descripciones cuya palabra completa fuera literalmente "ex"
  // (ej. "Ambliopia ex anopsia"), y jamas palabras que EMPIEZAN con
  // "ex" como "exposicion", "extremidad" o "eczema", que es como un
  // medico realmente escribe mientras busca.
  //
  // La correccion agrega `:*` a cada palabra (busqueda de prefijo
  // de PostgreSQL) y sanea caracteres que romperian la sintaxis de
  // tsquery (&, |, !, (, ), :, ', -), ya que esos caracteres vienen
  // de texto libre escrito por el usuario y to_tsquery los
  // interpreta como operadores.
  const palabrasTsQuery = q
    .split(/\s+/)
    .map((palabra) => palabra.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((palabra) => palabra.length > 0)
    .map((palabra) => `${palabra}:*`)
    .join(' & ');

  try {
    // Busqueda por codigo exacto/prefijo O por prefijo de palabra en
    // la descripcion (busqueda de texto completo en español).
    const resultados = await query(
      `SELECT codigo, descripcion, nivel
       FROM catalogo_cie10
       WHERE codigo ILIKE $1 || '%'
          OR ($2 <> '' AND to_tsvector('spanish', descripcion) @@ to_tsquery('spanish', $2))
       ORDER BY nivel DESC, codigo ASC
       LIMIT 30`,
      [q, palabrasTsQuery]
    );
    return res.json({ resultados: resultados.rows });
  } catch (err) {
    console.error('Error en buscarCie10:', err);
    return res.status(500).json({ error: 'Error interno al buscar en el catalogo CIE-10.' });
  }
}

// ------------------------------------------------------------
// GET /api/aptitud/exposiciones
// Lista el catalogo de exposiciones (globales + propias).
// ------------------------------------------------------------
async function listarExposiciones(req, res) {
  try {
    const resultados = await query(
      `SELECT id, codigo, nombre, descripcion, categoria
       FROM catalogo_exposiciones
       WHERE activo = true AND (organizacion_id IS NULL OR organizacion_id = $1)
       ORDER BY categoria ASC, nombre ASC`,
      [req.usuario.organizacionId]
    );
    return res.json({ exposiciones: resultados.rows });
  } catch (err) {
    console.error('Error en listarExposiciones:', err);
    return res.status(500).json({ error: 'Error interno al listar el catalogo de exposiciones.' });
  }
}

// ------------------------------------------------------------
// POST /api/aptitud/trabajadores/:trabajadorId/evaluar
// Corre el motor de reglas SIN guardar nada todavia. Devuelve las
// alertas para que el medico las vea antes de decidir. Este paso
// es deliberadamente separado de "registrar" (mas abajo): el
// medico primero consulta, luego decide y escribe su
// justificacion, y solo entonces se persiste.
// ------------------------------------------------------------
async function evaluarContraindicaciones(req, res) {
  const { diagnosticosCie10, exposicionesPuesto } = req.body;

  if (!Array.isArray(diagnosticosCie10) || !Array.isArray(exposicionesPuesto)) {
    return res.status(400).json({ error: 'diagnosticosCie10 y exposicionesPuesto deben ser arreglos.' });
  }

  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    const reglasRes = await query(
      `SELECT id, codigo_cie10_patron, tipo_coincidencia, exposicion_codigo, severidad, descripcion_riesgo, sugerencia_accion, fuente_referencia, nombre
       FROM reglas_contraindicacion
       WHERE activa = true AND (organizacion_id IS NULL OR organizacion_id = $1)`,
      [req.usuario.organizacionId]
    );

    const alertas = detectarContraindicaciones(diagnosticosCie10, exposicionesPuesto, reglasRes.rows);

    return res.json({ alertas });
  } catch (err) {
    console.error('Error en evaluarContraindicaciones:', err);
    return res.status(500).json({ error: 'Error interno al evaluar contraindicaciones.' });
  }
}

// ------------------------------------------------------------
// POST /api/aptitud/trabajadores/:trabajadorId/registrar
// Registra una nueva fila en el historial de aptitud (nunca
// sobreescribe la anterior). Exige justificacion clinica
// obligatoria (ya validada por express-validator y por el CHECK
// de la base de datos). Vuelve a correr el motor de reglas en
// este momento y guarda el snapshot de alertas junto con la
// decision, para que el historial sea fiel a lo que el medico
// realmente vio al decidir.
// ------------------------------------------------------------
async function registrarAptitud(req, res) {
  const { trabajadorId } = req.params;
  const {
    aptitud, puestoEvaluado, diagnosticosCie10, exposicionesPuesto,
    justificacionClinica, restricciones, vigenciaHasta,
  } = req.body;

  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    const reglasRes = await query(
      `SELECT id, codigo_cie10_patron, tipo_coincidencia, exposicion_codigo, severidad, descripcion_riesgo, sugerencia_accion, fuente_referencia, nombre
       FROM reglas_contraindicacion
       WHERE activa = true AND (organizacion_id IS NULL OR organizacion_id = $1)`,
      [req.usuario.organizacionId]
    );
    const alertas = detectarContraindicaciones(diagnosticosCie10 || [], exposicionesPuesto || [], reglasRes.rows);

    const insertRes = await query(
      `INSERT INTO historial_aptitud_medica
        (organizacion_id, trabajador_id, medico_id, aptitud, puesto_evaluado,
         diagnosticos_cie10, exposiciones_puesto, alertas_detectadas, justificacion_clinica,
         restricciones, vigencia_hasta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, aptitud, puesto_evaluado, diagnosticos_cie10, exposiciones_puesto,
                 alertas_detectadas, justificacion_clinica, restricciones, vigencia_hasta, creado_en`,
      [
        req.usuario.organizacionId,
        trabajadorId,
        req.usuario.id,
        aptitud,
        puestoEvaluado,
        diagnosticosCie10 || [],
        exposicionesPuesto || [],
        JSON.stringify(alertas),
        justificacionClinica,
        restricciones || null,
        vigenciaHasta || null,
      ]
    );

    // Se actualiza el campo "aptitud" en trabajadores como cache
    // del estado mas reciente (la fuente de verdad y el historial
    // completo viven en historial_aptitud_medica).
    await query(
      `UPDATE trabajadores SET aptitud = $1, actualizado_en = now() WHERE id = $2 AND organizacion_id = $3`,
      [aptitud, trabajadorId, req.usuario.organizacionId]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'registrar_aptitud_medica',
      critico: true, // Auditoria N.07 C6: escritura clinica, la auditoria no debe fallar en silencio
      entidad: 'historial_aptitud_medica',
      entidadId: insertRes.rows[0].id,
      detalle: {
        trabajadorId,
        aptitud,
        cantidadAlertas: alertas.length,
        alertasAbsolutas: alertas.filter((a) => a.severidad === 'absoluta').length,
      },
      req,
    });

    return res.status(201).json({ registroAptitud: insertRes.rows[0] });
  } catch (err) {
    // El CHECK de longitud minima de justificacion_clinica en la
    // base de datos es la ultima linea de defensa si, por algun
    // motivo, la validacion de express-validator fuera evitada.
    if (err.code === '23514') {
      return res.status(400).json({ error: 'La justificacion clinica es obligatoria y debe tener contenido suficiente (minimo 20 caracteres).' });
    }
    console.error('Error en registrarAptitud:', err);
    return res.status(500).json({ error: 'Error interno al registrar la aptitud medica.' });
  }
}

// ------------------------------------------------------------
// GET /api/aptitud/trabajadores/:trabajadorId/historial
// Devuelve el historial completo de aptitud de un trabajador
// (append-only, nunca se borra ni modifica una fila existente).
// ------------------------------------------------------------
async function obtenerHistorial(req, res) {
  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    const historialRes = await query(
      `SELECT h.id, h.aptitud, h.puesto_evaluado, h.diagnosticos_cie10, h.exposiciones_puesto,
              h.alertas_detectadas, h.justificacion_clinica, h.restricciones, h.vigencia_hasta, h.creado_en,
              u.nombre_completo AS medico_nombre
       FROM historial_aptitud_medica h
       JOIN usuarios u ON u.id = h.medico_id
       WHERE h.trabajador_id = $1 AND h.organizacion_id = $2
       ORDER BY h.creado_en DESC`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'ver_historial_aptitud_medica',
      entidad: 'trabajador',
      entidadId: req.params.trabajadorId,
      req,
    });

    return res.json({ historial: historialRes.rows });
  } catch (err) {
    console.error('Error en obtenerHistorial:', err);
    return res.status(500).json({ error: 'Error interno al obtener el historial de aptitud.' });
  }
}

module.exports = {
  listarReglas,
  crearRegla,
  buscarCie10,
  listarExposiciones,
  evaluarContraindicaciones,
  registrarAptitud,
  obtenerHistorial,
};
