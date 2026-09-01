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
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { detectarContraindicaciones } = require('../aptitud/motorContraindicaciones');

// ------------------------------------------------------------
// CREADO en Auditoria N.13 (hallazgo CRITICO C-03, P0): el motor
// recibia diagnosticosCie10 y exposicionesPuesto UNICAMENTE del
// payload, sin ninguna garantia de que fueran el conjunto completo
// y vigente. Esta funcion deriva ambos conjuntos desde fuentes de
// verdad ya existentes en el sistema:
//   - Diagnosticos: ultima Historia Clinica Ocupacional
//     (evaluaciones_ocupacionales.diagnosticos, JSONB), casos de
//     enfermedad profesional confirmados/en seguimiento, y
//     restricciones medicas activas/prorrogadas con diagnostico
//     relacionado.
//   - Exposiciones: puesto_exposiciones (migration_065) del puesto
//     asignado al trabajador -- fuente declarada explicitamente por
//     la organizacion con los mismos codigos que ya usa el motor
//     (ver el comentario de esa migracion sobre por que NO se
//     intenta traducir puestos_trabajo.factores_riesgo por texto).
//
// El payload (diagnosticosPayload/exposicionesPayload) se sigue
// aceptando, pero como COMPLEMENTO -- nunca como reemplazo silencioso
// de lo derivado. Se devuelve tambien la procedencia de cada dato
// (derivado vs. agregado manualmente) para que quede trazado que
// datos vinieron de una fuente clinica confiable y cuales fueron
// declarados a mano por quien hizo la evaluacion.
//
// `evaluacionIncompleta` es true cuando el trabajador no tiene un
// puesto asignado (no se puede derivar exposiciones en absoluto) --
// el motor debe comunicar esto explicitamente en vez de proceder
// como si "sin exposiciones derivadas" significara "sin riesgo".
// ------------------------------------------------------------
async function derivarDatosClinicosParaAptitud(trabajadorId, organizacionId, diagnosticosPayload, exposicionesPayload) {
  const trabajadorRes = await query(
    `SELECT puesto_trabajo_id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
    [trabajadorId, organizacionId]
  );
  const puestoTrabajoId = trabajadorRes.rows.length > 0 ? trabajadorRes.rows[0].puesto_trabajo_id : null;

  // --- Diagnosticos derivados ---
  const evaluacionRes = await query(
    `SELECT diagnosticos FROM evaluaciones_ocupacionales
     WHERE trabajador_id = $1 AND organizacion_id = $2
     ORDER BY fecha_atencion DESC, creado_en DESC LIMIT 1`,
    [trabajadorId, organizacionId]
  );
  const diagnosticosHistoriaClinica = (evaluacionRes.rows[0]?.diagnosticos || [])
    .map((d) => d.codigoCie10)
    .filter(Boolean);

  const enfProfRes = await query(
    `SELECT diagnostico_cie10 FROM enfermedad_profesional
     WHERE trabajador_id = $1 AND organizacion_id = $2 AND estado IN ('confirmada', 'en_seguimiento')
       AND diagnostico_cie10 IS NOT NULL`,
    [trabajadorId, organizacionId]
  );
  const restrMedRes = await query(
    `SELECT diagnostico_cie10_relacionado FROM restricciones_medicas
     WHERE trabajador_id = $1 AND organizacion_id = $2 AND estado IN ('activa', 'prorrogada')
       AND diagnostico_cie10_relacionado IS NOT NULL`,
    [trabajadorId, organizacionId]
  );

  const diagnosticosDerivados = [...new Set([
    ...diagnosticosHistoriaClinica,
    ...enfProfRes.rows.map((r) => r.diagnostico_cie10),
    ...restrMedRes.rows.map((r) => r.diagnostico_cie10_relacionado),
  ])];

  // --- Exposiciones derivadas ---
  let exposicionesDerivadas = [];
  if (puestoTrabajoId) {
    const expRes = await query(
      `SELECT exposicion_codigo FROM puesto_exposiciones WHERE puesto_trabajo_id = $1 AND organizacion_id = $2`,
      [puestoTrabajoId, organizacionId]
    );
    exposicionesDerivadas = expRes.rows.map((r) => r.exposicion_codigo);
  }

  const diagnosticosManualAdicionales = (diagnosticosPayload || []).filter((d) => !diagnosticosDerivados.includes(d));
  const exposicionesManualAdicionales = (exposicionesPayload || []).filter((e) => !exposicionesDerivadas.includes(e));

  return {
    diagnosticosCie10: [...new Set([...diagnosticosDerivados, ...diagnosticosManualAdicionales])],
    exposicionesPuesto: [...new Set([...exposicionesDerivadas, ...exposicionesManualAdicionales])],
    procedencia: {
      diagnosticosDerivados,
      diagnosticosManualAdicionales,
      exposicionesDerivadas,
      exposicionesManualAdicionales,
    },
    // Solo se marca incompleta por falta de puesto (no poder derivar
    // exposiciones en absoluto). Si el puesto existe pero no tiene
    // exposiciones declaradas en puesto_exposiciones, es una
    // afirmacion valida ("este puesto no tiene exposiciones
    // registradas"), no una ausencia de dato.
    evaluacionIncompleta: !puestoTrabajoId,
    motivoIncompleta: !puestoTrabajoId ? 'El trabajador no tiene un puesto de trabajo asignado; no fue posible derivar sus exposiciones ocupacionales automaticamente.' : null,
  };
}

// ------------------------------------------------------------
// GET /api/aptitud/reglas
// Lista las reglas de contraindicacion (globales + las propias de la
// organizacion, si las hubiera).
//
// CORREGIDO en Auditoria N.13 (C-04, P0): por defecto solo muestra
// reglas 'aprobada' (las que el motor realmente usa). Con
// ?estado=borrador se puede ver la cola pendiente de aprobacion
// medica -- necesario para que exista un flujo de revision real y
// no solo un campo que nadie consulta.
// ------------------------------------------------------------
async function listarReglas(req, res) {
  const estadoFiltro = ['borrador', 'aprobada', 'retirada'].includes(req.query.estado) ? req.query.estado : 'aprobada';
  try {
    const reglasRes = await query(
      `SELECT id, nombre, codigo_cie10_patron, tipo_coincidencia, exposicion_codigo,
              severidad, descripcion_riesgo, sugerencia_accion, fuente_referencia, activa, organizacion_id,
              estado, autor_id, revisor_medico_id, fecha_revision, version
       FROM reglas_contraindicacion
       WHERE activa = true AND estado = $2 AND (organizacion_id IS NULL OR organizacion_id = $1)
       ORDER BY severidad ASC, nombre ASC`,
      [req.usuario.organizacionId, estadoFiltro]
    );
    return res.json({ reglas: reglasRes.rows, estadoFiltro });
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

    // CORREGIDO en Auditoria N.13 (hallazgo CRITICO C-04, P0): separa
    // gestion tecnica de aprobacion clinica. Si quien crea la regla
    // es 'medico', se autoaprueba (el medico ya es la autoridad
    // clinica para esto). Si es 'admin', nace en 'borrador' y NO
    // participa en detectarContraindicaciones hasta que un medico la
    // apruebe explicitamente via PATCH /reglas/:id/aprobar.
    const autoAprobada = req.usuario.rol === 'medico';

    const insertRes = await withTransaction(async (client) => {
      const res = await client.query(
        `INSERT INTO reglas_contraindicacion
          (organizacion_id, nombre, codigo_cie10_patron, tipo_coincidencia, exposicion_codigo, severidad, descripcion_riesgo, sugerencia_accion, fuente_referencia, creado_por,
           autor_id, estado, revisor_medico_id, fecha_revision)
         VALUES ($1, $2, $3, COALESCE($4, 'exacto'), $5, $6, $7, $8, $9, $10,
           $10, $11, $12, $13)
         RETURNING id, nombre, codigo_cie10_patron, tipo_coincidencia, exposicion_codigo, severidad, descripcion_riesgo, sugerencia_accion, fuente_referencia, estado, creado_en`,
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
          autoAprobada ? 'aprobada' : 'borrador',
          autoAprobada ? req.usuario.id : null,
          autoAprobada ? new Date() : null,
        ]
      );

      // CORREGIDO en Auditoria N.08 (C-N08-01): auditoria dentro de
      // la misma transaccion que el INSERT -- ver registrarAptitud
      // mas abajo para la explicacion completa del patron.
      await registrarAuditoria({
        organizacionId: req.usuario.organizacionId,
        usuarioId: req.usuario.id,
        accion: 'crear_regla_contraindicacion',
        entidad: 'regla_contraindicacion',
        entidadId: res.rows[0].id,
        detalle: { nombre, severidad, estado: res.rows[0].estado },
        req,
        client,
      });

      return res;
    });

    return res.status(201).json({ regla: insertRes.rows[0] });
  } catch (err) {
    console.error('Error en crearRegla:', err);
    return res.status(500).json({ error: 'Error interno al crear la regla de contraindicacion.' });
  }
}

// ------------------------------------------------------------
// PATCH /api/aptitud/reglas/:id/aprobar
// CREADO en Auditoria N.13 (C-04, P0). Solo 'medico'. Aprueba una
// regla en 'borrador' -- a partir de este momento SI participa en
// detectarContraindicaciones.
// ------------------------------------------------------------
async function aprobarRegla(req, res) {
  try {
    const resultado = await withTransaction(async (client) => {
      const actual = await client.query(
        `SELECT id, estado FROM reglas_contraindicacion
         WHERE id = $1 AND (organizacion_id IS NULL OR organizacion_id = $2) FOR UPDATE`,
        [req.params.id, req.usuario.organizacionId]
      );
      if (actual.rows.length === 0) {
        const err = new Error('Regla no encontrada.');
        err.codigo = 'NO_ENCONTRADA';
        throw err;
      }
      if (actual.rows[0].estado === 'retirada') {
        const err = new Error('No se puede aprobar una regla retirada; cree una nueva version.');
        err.codigo = 'ESTADO_INVALIDO';
        throw err;
      }

      const updateRes = await client.query(
        `UPDATE reglas_contraindicacion
         SET estado = 'aprobada', revisor_medico_id = $1, fecha_revision = now()
         WHERE id = $2
         RETURNING id, nombre, estado, revisor_medico_id, fecha_revision`,
        [req.usuario.id, req.params.id]
      );

      await registrarAuditoria({
        organizacionId: req.usuario.organizacionId,
        usuarioId: req.usuario.id,
        accion: 'aprobar_regla_contraindicacion',
        entidad: 'regla_contraindicacion',
        entidadId: req.params.id,
        req,
        client,
      });

      return updateRes;
    });

    return res.json({ regla: resultado.rows[0] });
  } catch (err) {
    if (err.codigo === 'NO_ENCONTRADA') return res.status(404).json({ error: err.message });
    if (err.codigo === 'ESTADO_INVALIDO') return res.status(409).json({ error: err.message });
    console.error('Error en aprobarRegla:', err);
    return res.status(500).json({ error: 'Error interno al aprobar la regla.' });
  }
}

// ------------------------------------------------------------
// PATCH /api/aptitud/reglas/:id/retirar
// CREADO en Auditoria N.13 (C-04, P0). 'medico' o 'admin'. Retira
// una regla (deja de participar en el motor) sin borrarla, para
// mantener trazabilidad.
// ------------------------------------------------------------
async function retirarRegla(req, res) {
  const { motivo } = req.body;
  if (!motivo || !motivo.trim()) {
    return res.status(400).json({ error: 'motivo es obligatorio para retirar una regla.' });
  }
  try {
    const resultado = await withTransaction(async (client) => {
      const updateRes = await client.query(
        `UPDATE reglas_contraindicacion SET estado = 'retirada'
         WHERE id = $1 AND (organizacion_id IS NULL OR organizacion_id = $2)
         RETURNING id, nombre, estado`,
        [req.params.id, req.usuario.organizacionId]
      );
      if (updateRes.rows.length === 0) {
        const err = new Error('Regla no encontrada.');
        err.codigo = 'NO_ENCONTRADA';
        throw err;
      }

      await registrarAuditoria({
        organizacionId: req.usuario.organizacionId,
        usuarioId: req.usuario.id,
        accion: 'retirar_regla_contraindicacion',
        entidad: 'regla_contraindicacion',
        entidadId: req.params.id,
        detalle: { motivo: motivo.trim() },
        req,
        client,
      });

      return updateRes;
    });
    return res.json({ regla: resultado.rows[0] });
  } catch (err) {
    if (err.codigo === 'NO_ENCONTRADA') return res.status(404).json({ error: err.message });
    console.error('Error en retirarRegla:', err);
    return res.status(500).json({ error: 'Error interno al retirar la regla.' });
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

    // CORREGIDO en Auditoria N.13 (C-03, P0): derivar automaticamente
    // en vez de confiar unicamente en el payload.
    const derivado = await derivarDatosClinicosParaAptitud(
      req.params.trabajadorId, req.usuario.organizacionId, diagnosticosCie10, exposicionesPuesto
    );

    const reglasRes = await query(
      `SELECT id, codigo_cie10_patron, tipo_coincidencia, exposicion_codigo, severidad, descripcion_riesgo, sugerencia_accion, fuente_referencia, nombre
       FROM reglas_contraindicacion
       WHERE activa = true AND estado = 'aprobada' AND (organizacion_id IS NULL OR organizacion_id = $1)`,
      [req.usuario.organizacionId]
    );

    const alertas = detectarContraindicaciones(derivado.diagnosticosCie10, derivado.exposicionesPuesto, reglasRes.rows);

    return res.json({
      alertas,
      diagnosticosCie10Usados: derivado.diagnosticosCie10,
      exposicionesPuestoUsadas: derivado.exposicionesPuesto,
      procedencia: derivado.procedencia,
      evaluacionIncompleta: derivado.evaluacionIncompleta,
      motivoIncompleta: derivado.motivoIncompleta,
    });
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
       WHERE activa = true AND estado = 'aprobada' AND (organizacion_id IS NULL OR organizacion_id = $1)`,
      [req.usuario.organizacionId]
    );
    // CORREGIDO en Auditoria N.13 (C-03, P0): mismo criterio de
    // derivacion automatica que evaluarContraindicaciones. Si la
    // evaluacion queda incompleta (sin puesto asignado) y la
    // aptitud a registrar no es 'no_apto', se exige confirmar
    // explicitamente que se procede sin ese dato -- evita que la
    // ausencia silenciosa de exposiciones derivadas se traduzca en
    // una aptitud sin restricciones por simple falta de dato.
    const derivado = await derivarDatosClinicosParaAptitud(
      trabajadorId, req.usuario.organizacionId, diagnosticosCie10, exposicionesPuesto
    );
    if (derivado.evaluacionIncompleta && aptitud !== 'no_apto' && !req.body.confirmarEvaluacionIncompleta) {
      return res.status(409).json({
        error: 'Evaluacion incompleta: ' + derivado.motivoIncompleta,
        evaluacionIncompleta: true,
        solucion: 'Asigne un puesto de trabajo al trabajador, o reenvie la solicitud con confirmarEvaluacionIncompleta:true si el medico decide continuar de todas formas (quedara registrado en el historial).',
      });
    }
    const alertas = detectarContraindicaciones(derivado.diagnosticosCie10, derivado.exposicionesPuesto, reglasRes.rows);

    // CREADO en Auditoria N.13 (seccion 6.2, refuerzo de C-04): una
    // alerta ABSOLUTA no puede quedar simplemente "mostrada" sin que
    // conste que el medico la vio y decidio contradecirla a
    // sabiendas -- se exige confirmacion explicita antes de registrar
    // una aptitud que no sea 'no_apto'.
    const alertasAbsolutas = alertas.filter((a) => a.severidad === 'absoluta');
    if (alertasAbsolutas.length > 0 && aptitud !== 'no_apto' && !req.body.alertasAbsolutasRevisadas) {
      return res.status(409).json({
        error: 'Existen alertas de severidad absoluta que contradicen la aptitud propuesta.',
        alertasAbsolutas,
        solucion: 'Revise las alertas y reenvie con alertasAbsolutasRevisadas:true si, con justificacion clinica, decide continuar de todas formas.',
      });
    }

    const insertRes = await withTransaction(async (client) => {
      // CORREGIDO en Auditoria N.08 (hallazgo CRITICO/P0 C-N08-01):
      // el INSERT del historial de aptitud, el UPDATE del cache en
      // trabajadores.aptitud y el registro de auditoria ahora viven
      // en la MISMA transaccion. Antes, cada uno corria con query()
      // independiente (BEGIN/COMMIT propio): si la auditoria fallaba
      // despues de que los dos primeros ya se habian confirmado, la
      // API respondia 500 pero el cambio clinico ya habia quedado
      // guardado -- justo el escenario que describe la auditoria.
      // Ahora, si CUALQUIERA de los 3 pasos falla, withTransaction()
      // hace ROLLBACK de los 3 juntos: no puede quedar un registro
      // de aptitud sin su auditoria, ni un cache de trabajadores
      // desincronizado del historial.
      const res = await client.query(
        `INSERT INTO historial_aptitud_medica
          (organizacion_id, trabajador_id, medico_id, aptitud, puesto_evaluado,
           diagnosticos_cie10, exposiciones_puesto, alertas_detectadas, justificacion_clinica,
           restricciones, vigencia_hasta, procedencia_datos, evaluacion_incompleta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, aptitud, puesto_evaluado, diagnosticos_cie10, exposiciones_puesto,
                   alertas_detectadas, justificacion_clinica, restricciones, vigencia_hasta,
                   evaluacion_incompleta, creado_en`,
        [
          req.usuario.organizacionId,
          trabajadorId,
          req.usuario.id,
          aptitud,
          puestoEvaluado,
          derivado.diagnosticosCie10,
          derivado.exposicionesPuesto,
          JSON.stringify(alertas),
          justificacionClinica,
          restricciones || null,
          vigenciaHasta || null,
          JSON.stringify(derivado.procedencia),
          derivado.evaluacionIncompleta,
        ]
      );

      // Se actualiza el campo "aptitud" en trabajadores como cache
      // del estado mas reciente (la fuente de verdad y el historial
      // completo viven en historial_aptitud_medica).
      await client.query(
        `UPDATE trabajadores SET aptitud = $1, actualizado_en = now() WHERE id = $2 AND organizacion_id = $3`,
        [aptitud, trabajadorId, req.usuario.organizacionId]
      );

      await registrarAuditoria({
        organizacionId: req.usuario.organizacionId,
        usuarioId: req.usuario.id,
        accion: 'registrar_aptitud_medica',
        entidad: 'historial_aptitud_medica',
        entidadId: res.rows[0].id,
        detalle: {
          trabajadorId,
          aptitud,
          cantidadAlertas: alertas.length,
          alertasAbsolutas: alertas.filter((a) => a.severidad === 'absoluta').length,
          evaluacionIncompleta: derivado.evaluacionIncompleta,
        },
        req,
        client,
      });

      return res;
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

    // CORREGIDO en Auditoria N.09 (G-N09-07): lectura clinica
    // sensible -> lecturaSensible:true (cola durable si falla el
    // INSERT normal, ver utils/auditoria.js).
    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'ver_historial_aptitud_medica',
      entidad: 'trabajador',
      entidadId: req.params.trabajadorId,
      req,
      lecturaSensible: true,
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
  aprobarRegla,
  retirarRegla,
  buscarCie10,
  listarExposiciones,
  evaluarContraindicaciones,
  registrarAptitud,
  obtenerHistorial,
};
