// ============================================================
// Controlador de audiometria ocupacional.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { calcularAudiometria } = require('../audiometria/audiometria');

// CORREGIDO en Auditoria N.12 (hallazgo GRAVE G12-02, P1): el patron
// `input.campo || null` trata 0 como "ausente" porque 0 es falsy en
// JavaScript -- una medicion perfectamente valida de 0 dB HL
// (audicion mejor que el umbral de referencia) se guardaba como
// NULL, perdiendo el dato y pudiendo distorsionar PTA/STS/patron.
// `??` (nullish coalescing) solo sustituye null/undefined, nunca 0.
function numOrNull(v) {
  return v ?? null;
}

// ------------------------------------------------------------
// POST /api/audiometria/trabajadores/:trabajadorId
// Registra un nuevo examen audiometrico, calcula STS y patron.
// ------------------------------------------------------------
async function registrarExamen(req, res) {
  const { trabajadorId } = req.params;
  const input = req.body;

  try {
    // Verificar trabajador
    const tRes = await query(
      `SELECT id, fecha_nacimiento FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (tRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    // Calcular edad aproximada
    const t = tRes.rows[0];
    const edadAnios = t.fecha_nacimiento
      ? Math.floor((Date.now() - new Date(t.fecha_nacimiento)) / (365.25 * 24 * 3600 * 1000))
      : 0;

    // Buscar la audiometria basal VIGENTE de este trabajador (para
    // calcular STS). CORREGIDO en Auditoria N.12 (hallazgo GRAVE
    // G12-03, P1): antes se tomaba la basal MAS ANTIGUA
    // (ORDER BY fecha_examen ASC LIMIT 1); ahora se toma la marcada
    // baseline_vigente=true (unica por trabajador, ver
    // migration_060), que puede haber sido revisada explicitamente
    // por un medico via revisarBaseline() cuando un STS persistio
    // en un retest.
    let basal = null;
    if (!input.esBasal) {
      const basalRes = await query(
        `SELECT ca_od_2000, ca_od_3000, ca_od_4000, ca_oi_2000, ca_oi_3000, ca_oi_4000, id
         FROM examenes_audiometria
         WHERE trabajador_id = $1 AND organizacion_id = $2 AND es_basal = true AND baseline_vigente = true
         LIMIT 1`,
        [trabajadorId, req.usuario.organizacionId]
      );
      if (basalRes.rows.length > 0) basal = basalRes.rows[0];
    }

    // Calcular STS y patron audiometrico
    const resultado = calcularAudiometria(input, basal, edadAnios);

    // Insertar examen
    const insertRes = await withTransaction(async (client) => {
    // CORREGIDO en Auditoria N.12 (G12-03): si este examen se marca
    // como nueva basal (esBasal=true), debe quedar como la UNICA
    // vigente para el trabajador -- se retira la vigencia de
    // cualquier basal anterior ANTES de insertar la nueva, dentro de
    // la misma transaccion (el indice unico parcial de migration_060
    // impediria dos vigentes a la vez si no se hace en este orden).
    if (input.esBasal) {
      await client.query(
        `UPDATE examenes_audiometria SET baseline_vigente = false
         WHERE trabajador_id = $1 AND organizacion_id = $2 AND baseline_vigente = true`,
        [trabajadorId, req.usuario.organizacionId]
      );
    }

    const filaInsertada = await client.query(
      `INSERT INTO examenes_audiometria (
        organizacion_id, trabajador_id, medico_id, fecha_examen, es_basal, baseline_vigente,
        ca_od_500, ca_od_1000, ca_od_2000, ca_od_3000, ca_od_4000, ca_od_6000, ca_od_8000,
        ca_oi_500, ca_oi_1000, ca_oi_2000, ca_oi_3000, ca_oi_4000, ca_oi_6000, ca_oi_8000,
        co_od_500, co_od_1000, co_od_2000, co_od_3000, co_od_4000,
        co_oi_500, co_oi_1000, co_oi_2000, co_oi_3000, co_oi_4000,
        pta_od, pta_oi, sts_od, sts_oi, sts_od_positivo, sts_oi_positivo,
        id_audiometria_basal, patron_od, patron_oi, observaciones
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,$12,$13,
        $14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,
        $26,$27,$28,$29,$30,
        $31,$32,$33,$34,$35,$36,
        $37,$38,$39,$40
      ) RETURNING id, fecha_examen, es_basal, baseline_vigente, pta_od, pta_oi,
                  sts_od, sts_oi, sts_od_positivo, sts_oi_positivo,
                  patron_od, patron_oi`,
      [
        req.usuario.organizacionId, trabajadorId, req.usuario.id,
        input.fechaExamen || null, !!input.esBasal, !!input.esBasal,
        numOrNull(input.ca_od_500), numOrNull(input.ca_od_1000), numOrNull(input.ca_od_2000),
        numOrNull(input.ca_od_3000), numOrNull(input.ca_od_4000), numOrNull(input.ca_od_6000), numOrNull(input.ca_od_8000),
        numOrNull(input.ca_oi_500), numOrNull(input.ca_oi_1000), numOrNull(input.ca_oi_2000),
        numOrNull(input.ca_oi_3000), numOrNull(input.ca_oi_4000), numOrNull(input.ca_oi_6000), numOrNull(input.ca_oi_8000),
        numOrNull(input.co_od_500), numOrNull(input.co_od_1000), numOrNull(input.co_od_2000),
        numOrNull(input.co_od_3000), numOrNull(input.co_od_4000),
        numOrNull(input.co_oi_500), numOrNull(input.co_oi_1000), numOrNull(input.co_oi_2000),
        numOrNull(input.co_oi_3000), numOrNull(input.co_oi_4000),
        resultado.ptaOd, resultado.ptaOi,
        resultado.stsOd, resultado.stsOi,
        resultado.stsOdPositivo, resultado.stsOiPositivo,
        basal ? basal.id : null,
        resultado.patronOd, resultado.patronOi,
        input.observaciones || null,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'registrar_examen_audiometria',
      entidad: 'examen_audiometria',
      entidadId: filaInsertada.rows[0].id,
      detalle: {
        trabajadorId,
        esBasal: !!input.esBasal,
        stsOdPositivo: resultado.stsOdPositivo,
        stsOiPositivo: resultado.stsOiPositivo,
        patronOd: resultado.patronOd,
        patronOi: resultado.patronOi,
      },
      req,
      client,
    });

    return filaInsertada;
  });

    return res.status(201).json({
      examen: insertRes.rows[0],
      alertaSTS: resultado.stsOdPositivo || resultado.stsOiPositivo,
    });
  } catch (err) {
    console.error('Error en registrarExamen (audiometria):', err);
    return res.status(500).json({ error: 'Error interno al registrar el examen audiometrico.' });
  }
}

// ------------------------------------------------------------
// GET /api/audiometria/trabajadores/:trabajadorId
// Lista el historial de examenes audiometricos de un trabajador.
// ------------------------------------------------------------
async function listarExamenes(req, res) {
  try {
    const tRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );
    if (tRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    // CORREGIDO en Auditoria N.07 (encontrado por la nueva suite
    // RBAC de esta sesion, tests/rbac_clinico.test.js): varias
    // columnas sin calificar ('id' Y 'creado_en') eran ambiguas
    // porque tanto examenes_audiometria como usuarios las tienen --
    // Postgres rechazaba la consulta completa con "column reference
    // ... is ambiguous" (42702) cada vez que se ejecutaba, para
    // CUALQUIER rol, no solo sso. Bug preexistente, no introducido
    // en esta sesion; no habia sido detectado porque no existia
    // ninguna prueba automatizada que ejecutara este endpoint hasta
    // ahora. Se calificaron TODAS las columnas con el alias de
    // tabla para no dejar ninguna ambiguedad silenciosa mas.
    const res2 = await query(
      `SELECT e.id, e.fecha_examen, e.es_basal, e.pta_od, e.pta_oi,
              e.sts_od, e.sts_oi, e.sts_od_positivo, e.sts_oi_positivo,
              e.patron_od, e.patron_oi, e.observaciones, e.creado_en,
              u.nombre_completo AS medico_nombre
       FROM examenes_audiometria e
       JOIN usuarios u ON u.id = e.medico_id
       WHERE e.trabajador_id = $1 AND e.organizacion_id = $2
       ORDER BY e.fecha_examen DESC`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );

    // CORREGIDO tras auditoria de seguridad (hallazgo GRAVE G1): SSO
    // necesita saber si hay un cambio de umbral significativo (STS)
    // para gestionar el programa de conservacion auditiva, pero no
    // los umbrales crudos por frecuencia ni las observaciones
    // clinicas — eso es informacion medica que corresponde al
    // medico ocupacional (ver tambien audiometriaRoutes.js, donde
    // el detalle completo por examen ya quedo restringido a medico).
    // CORREGIDO en Auditoria N.11 (hallazgo GRAVE G11-03, P1): la
    // correccion anterior (G1) ya habia quitado los umbrales crudos,
    // pero seguia entregando sts_od_positivo/sts_oi_positivo
    // desglosados por oido -- eso sigue siendo un resultado clinico
    // nominal (que oido especifico tuvo cambio de umbral
    // significativo es informacion diagnostica). Se colapsa a una
    // sola senal no lateralizada: si HAY seguimiento requerido o no,
    // sin precisar oido ni magnitud. El desglose por oido queda
    // reservado a medico.
    const examenes = req.usuario.rol === 'sso'
      ? res2.rows.map((e) => ({
          id: e.id,
          fecha_examen: e.fecha_examen,
          es_basal: e.es_basal,
          requiere_seguimiento_auditivo: !!(e.sts_od_positivo || e.sts_oi_positivo),
          creado_en: e.creado_en,
        }))
      : res2.rows;

    return res.json({ examenes });
  } catch (err) {
    console.error('Error en listarExamenes (audiometria):', err);
    return res.status(500).json({ error: 'Error interno al listar los examenes audiometricos.' });
  }
}

// ------------------------------------------------------------
// GET /api/audiometria/:examenId
// Detalle completo de un examen (incluye todos los umbrales).
// ------------------------------------------------------------
async function obtenerExamen(req, res) {
  try {
    const res2 = await query(
      `SELECT e.*, u.nombre_completo AS medico_nombre, t.nombre_completo AS trabajador_nombre
       FROM examenes_audiometria e
       JOIN usuarios u ON u.id = e.medico_id
       JOIN trabajadores t ON t.id = e.trabajador_id
       WHERE e.id = $1 AND e.organizacion_id = $2`,
      [req.params.examenId, req.usuario.organizacionId]
    );
    if (res2.rows.length === 0) {
      return res.status(404).json({ error: 'Examen no encontrado.' });
    }

    // Auditoria de acceso a datos clinicos (mismo criterio que
    // historiaClinicaController.js tras la auditoria de seguridad).
    // CORREGIDO en Auditoria N.12 (hallazgo GRAVE G12-05, P1):
    // faltaba lecturaSensible:true -- sin ese flag, un fallo del
    // INSERT de auditoria se tragaba en silencio (best-effort) en
    // vez de caer a la cola durable auditoria_pendiente.
    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'ver_examen_audiometria',
      entidad: 'examen_audiometria',
      entidadId: req.params.examenId,
      req,
      lecturaSensible: true,
    });

    return res.json({ examen: res2.rows[0] });
  } catch (err) {
    console.error('Error en obtenerExamen (audiometria):', err);
    return res.status(500).json({ error: 'Error interno al obtener el examen.' });
  }
}

// ------------------------------------------------------------
// PUT /api/audiometria/:examenId/revisar-baseline
// CREADO en Auditoria N.12 (hallazgo GRAVE G12-03, P1): marca el
// examen indicado como la NUEVA baseline vigente del trabajador,
// retirando la vigencia de la anterior. Pensado para el flujo
// OSHA/NIOSH de "STS confirmado en retest ameritando revision de
// la basal" -- exige un motivo explicito (por ejemplo, referencia al
// retest que confirmo el cambio) y solo puede hacerlo un medico.
// ------------------------------------------------------------
async function revisarBaseline(req, res) {
  const { examenId } = req.params;
  const { motivo } = req.body;

  if (!motivo || !motivo.trim() || motivo.trim().length < 10) {
    return res.status(400).json({ error: 'motivo es obligatorio (minimo 10 caracteres): debe documentarse por que se revisa la baseline (ej. STS confirmado en retest, fecha y hallazgos).' });
  }

  try {
    const resultado = await withTransaction(async (client) => {
      const examenRes = await client.query(
        `SELECT id, trabajador_id, es_basal FROM examenes_audiometria
         WHERE id = $1 AND organizacion_id = $2 FOR UPDATE`,
        [examenId, req.usuario.organizacionId]
      );
      if (examenRes.rows.length === 0) {
        const err = new Error('Examen no encontrado.');
        err.codigo = 'NO_ENCONTRADA';
        throw err;
      }
      const { trabajador_id: trabajadorId } = examenRes.rows[0];

      // El examen que se promueve a "vigente" debe estar marcado
      // es_basal=true; si no lo estaba, se marca ahora como parte de
      // la revision (es una decision clinica deliberada, no un
      // efecto secundario silencioso).
      await client.query(
        `UPDATE examenes_audiometria SET baseline_vigente = false
         WHERE trabajador_id = $1 AND organizacion_id = $2 AND baseline_vigente = true`,
        [trabajadorId, req.usuario.organizacionId]
      );

      const updateRes = await client.query(
        `UPDATE examenes_audiometria
         SET es_basal = true, baseline_vigente = true,
             baseline_revisada_en = now(), baseline_revision_motivo = $1, baseline_revisada_por = $2
         WHERE id = $3 AND organizacion_id = $4
         RETURNING id, trabajador_id, es_basal, baseline_vigente, baseline_revisada_en`,
        [motivo.trim(), req.usuario.id, examenId, req.usuario.organizacionId]
      );

      await registrarAuditoria({
        organizacionId: req.usuario.organizacionId,
        usuarioId: req.usuario.id,
        accion: 'audiometria_baseline_revisada',
        entidad: 'examen_audiometria',
        entidadId: examenId,
        detalle: { trabajadorId, motivo: motivo.trim() },
        req,
        client,
      });

      return updateRes;
    });

    return res.json({ examen: resultado.rows[0] });
  } catch (err) {
    if (err.codigo === 'NO_ENCONTRADA') {
      return res.status(404).json({ error: err.message });
    }
    console.error('Error en revisarBaseline (audiometria):', err);
    return res.status(500).json({ error: 'Error interno al revisar la baseline.' });
  }
}

module.exports = { registrarExamen, listarExamenes, obtenerExamen, revisarBaseline };
