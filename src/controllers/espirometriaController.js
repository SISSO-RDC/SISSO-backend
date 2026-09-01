// ============================================================
// Controlador de espirometria ocupacional (ATS/ERS 2005, valores
// predichos ECSC/ERS 1993). Ver src/espirometria/espirometria.js
// para el detalle de las formulas y el criterio clinico.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { calcularEspirometria } = require('../espirometria/espirometria');

// ------------------------------------------------------------
// POST /api/espirometria/trabajadores/:trabajadorId
// Registra un nuevo examen de espirometria, calcula predichos,
// %predicho, patron ventilatorio y reversibilidad post-BD.
//
// Requiere que el trabajador ya tenga sexo, fecha_nacimiento y
// talla_cm cargados (se piden al crear/editar el trabajador). Si
// faltan, se rechaza con un mensaje claro en vez de calcular con
// datos incompletos o supuestos.
// ------------------------------------------------------------
async function registrarExamen(req, res) {
  const { trabajadorId } = req.params;
  const input = req.body;

  try {
    const tRes = await query(
      `SELECT id, sexo, fecha_nacimiento, talla_cm, peso_kg
       FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (tRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    const t = tRes.rows[0];
    const faltantes = [];
    if (!t.sexo) faltantes.push('sexo');
    if (!t.fecha_nacimiento) faltantes.push('fecha de nacimiento');
    if (!t.talla_cm) faltantes.push('talla');
    if (faltantes.length > 0) {
      return res.status(400).json({
        error: `Para calcular la espirometria se necesita antes registrar: ${faltantes.join(', ')} del trabajador.`,
        camposFaltantes: faltantes,
      });
    }

    const edadAnios = Math.floor(
      (Date.now() - new Date(t.fecha_nacimiento)) / (365.25 * 24 * 3600 * 1000)
    );

    const medidos = {
      fvcPre: input.fvcPre, fev1Pre: input.fev1Pre,
      pefPre: input.pefPre ?? null, fef2575Pre: input.fef2575Pre ?? null,
      fvcPost: input.fvcPost ?? null, fev1Post: input.fev1Post ?? null,
      pefPost: input.pefPost ?? null, fef2575Post: input.fef2575Post ?? null,
      // CREADO en Auditoria N.12 (C12-02): datos de calidad de
      // maniobra (opcionales, ver evaluarCalidadManiobra en
      // espirometria.js). Si el frontend/equipo no los envia, el
      // examen queda marcado interpretable=false automaticamente.
      calidad: input.calidad ? {
        numeroManiobras: input.calidad.numeroManiobras ?? null,
        mejorFvcL: input.calidad.mejorFvcL ?? null,
        segundaMejorFvcL: input.calidad.segundaMejorFvcL ?? null,
        mejorFev1L: input.calidad.mejorFev1L ?? null,
        segundaMejorFev1L: input.calidad.segundaMejorFev1L ?? null,
      } : null,
    };

    if (!medidos.fvcPre || !medidos.fev1Pre) {
      return res.status(400).json({ error: 'fvcPre y fev1Pre son obligatorios y deben ser mayores a 0.' });
    }
    if (medidos.fev1Pre > medidos.fvcPre) {
      return res.status(400).json({ error: 'fev1Pre no puede ser mayor que fvcPre.' });
    }

    const resultado = calcularEspirometria(medidos, t.sexo, edadAnios, t.talla_cm);

    const insertRes = await withTransaction(async (client) => {
    const filaInsertada = await client.query(
      `INSERT INTO examenes_espirometria (
        organizacion_id, trabajador_id, medico_id, fecha_examen,
        sexo_usado, edad_anios_usada, talla_cm_usada, peso_kg_usado,
        fvc_pre, fev1_pre, pef_pre, fef2575_pre,
        fvc_post, fev1_post, pef_post, fef2575_post, minutos_post_broncodilatador,
        fvc_predicho, fev1_predicho, pef_predicho, fef2575_predicho, fev1_fvc_predicho, fev1_fvc_lln,
        fvc_lln, fev1_lln,
        fvc_pct_predicho, fev1_pct_predicho, pef_pct_predicho, fef2575_pct_predicho, fev1_fvc_medido,
        patron,
        reversibilidad_positiva, cambio_fev1_pct_predicho, cambio_fev1_ml, cambio_fvc_pct_predicho, cambio_fvc_ml,
        calidad_numero_maniobras, calidad_repetibilidad_fvc_ml, calidad_repetibilidad_fev1_ml, calidad_grado,
        interpretable, criterio_interpretativo, metadatos_referencia,
        observaciones
      ) VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,$8,
        $9,$10,$11,$12,
        $13,$14,$15,$16,$17,
        $18,$19,$20,$21,$22,$23,
        $24,$25,
        $26,$27,$28,$29,$30,
        $31,
        $32,$33,$34,$35,$36,
        $37,$38,$39,$40,
        $41,$42,$43,
        $44
      ) RETURNING id, fecha_examen, fvc_pre, fev1_pre, fev1_fvc_medido,
                  fvc_pct_predicho, fev1_pct_predicho, patron,
                  reversibilidad_positiva, cambio_fev1_pct_predicho, interpretable, calidad_grado`,
      [
        req.usuario.organizacionId, trabajadorId, req.usuario.id, input.fechaExamen || null,
        t.sexo, edadAnios, t.talla_cm, t.peso_kg || null,
        medidos.fvcPre, medidos.fev1Pre, medidos.pefPre, medidos.fef2575Pre,
        medidos.fvcPost, medidos.fev1Post, medidos.pefPost, medidos.fef2575Post,
        input.minutosPostBroncodilatador || null,
        resultado.fvcPredicho, resultado.fev1Predicho, resultado.pefPredicho, resultado.fef2575Predicho, resultado.fev1FvcPredicho, resultado.fev1FvcLln,
        resultado.fvcLln, resultado.fev1Lln,
        resultado.fvcPctPredicho, resultado.fev1PctPredicho, resultado.pefPctPredicho, resultado.fef2575PctPredicho, resultado.fev1FvcMedido,
        resultado.patron,
        resultado.reversibilidad.esPositiva, resultado.reversibilidad.cambioPctPredicho, resultado.reversibilidad.cambioMl,
        resultado.reversibilidad.cambioPctPredichoFvc ?? null, resultado.reversibilidad.cambioMlFvc ?? null,
        resultado.calidad.numeroManiobras, resultado.calidad.repetibilidadFvcMl, resultado.calidad.repetibilidadFev1Ml, resultado.calidad.grado,
        // CORREGIDO en Auditoria N.13 (C-01, P0): se persiste tambien
        // metadatosReferencia (ecuacion/version/poblacion/variables/
        // metodo LLN), para que quede trazado en cada examen que el
        // resultado es una aproximacion interina, no un estandar
        // GLI-2012 definitivo.
        resultado.interpretable, resultado.criterioInterpretativo, JSON.stringify(resultado.metadatosReferencia),
        input.observaciones || null,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'registrar_examen_espirometria',
      entidad: 'examen_espirometria',
      entidadId: filaInsertada.rows[0].id,
      detalle: { trabajadorId, patron: resultado.patron, reversibilidadPositiva: resultado.reversibilidad.esPositiva },
      req,
      client,
    });

    return filaInsertada;
  });

    return res.status(201).json({ examen: insertRes.rows[0] });
  } catch (err) {
    console.error('Error en registrarExamen (espirometria):', err);
    return res.status(500).json({ error: 'Error interno al registrar el examen de espirometria.' });
  }
}

// ------------------------------------------------------------
// GET /api/espirometria/trabajadores/:trabajadorId
// Lista el historial de espirometrias de un trabajador.
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

    const res2 = await query(
      `SELECT e.id, e.fecha_examen, e.fvc_pre, e.fev1_pre, e.fev1_fvc_medido,
              e.fvc_pct_predicho, e.fev1_pct_predicho, e.patron,
              e.reversibilidad_positiva, e.cambio_fev1_pct_predicho,
              e.interpretable, e.calidad_grado,
              e.observaciones, e.creado_en,
              u.nombre_completo AS medico_nombre
       FROM examenes_espirometria e
       JOIN usuarios u ON u.id = e.medico_id
       WHERE e.trabajador_id = $1 AND e.organizacion_id = $2
       ORDER BY e.fecha_examen DESC`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );

    // CORREGIDO tras auditoria de seguridad (hallazgo GRAVE G2): SSO
    // necesita saber el patron general (normal/obstructivo/
    // restrictivo, relevante por ejemplo para el programa de
    // proteccion respiratoria), pero no los valores medidos, los
    // porcentajes predichos ni las observaciones clinicas — eso es
    // informacion medica que corresponde al medico ocupacional.
    // CORREGIDO en Auditoria N.11 (hallazgo GRAVE G11-04, P1): el
    // patron nominal (normal/obstructivo/restrictivo/etc.) sigue
    // siendo una conclusion clinica sobre funcion pulmonar, aunque no
    // se entreguen los valores medidos. Se colapsa a una senal
    // binaria de seguimiento preventivo, sin nombrar el patron
    // especifico. El patron detallado queda reservado a medico.
    // CORREGIDO en Auditoria N.12 (C12-02, punto 7): si la calidad de
    // la maniobra fue insuficiente (interpretable=false), SSO ve
    // "calidad_insuficiente" en vez de inferir una senal clinica de
    // un examen que el propio sistema no considera confiable -- evita
    // que una mala maniobra dispare una alerta preventiva equivocada.
    const examenes = req.usuario.rol === 'sso'
      ? res2.rows.map((e) => ({
          id: e.id,
          fecha_examen: e.fecha_examen,
          estado_preventivo: !e.interpretable
            ? 'calidad_insuficiente'
            : ((e.patron && e.patron !== 'normal' && e.patron !== 'no_clasificable') ? 'requiere_seguimiento' : 'sin_novedad'),
          creado_en: e.creado_en,
        }))
      : res2.rows;

    return res.json({ examenes });
  } catch (err) {
    console.error('Error en listarExamenes (espirometria):', err);
    return res.status(500).json({ error: 'Error interno al listar las espirometrias.' });
  }
}

// ------------------------------------------------------------
// GET /api/espirometria/:examenId
// Detalle completo de un examen (incluye predichos, LLN, post-BD).
// ------------------------------------------------------------
async function obtenerExamen(req, res) {
  try {
    const res2 = await query(
      `SELECT e.*, u.nombre_completo AS medico_nombre, t.nombre_completo AS trabajador_nombre
       FROM examenes_espirometria e
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
    // CORREGIDO en Auditoria N.12 (hallazgo GRAVE G12-05, P1).
    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'ver_examen_espirometria',
      entidad: 'examen_espirometria',
      entidadId: req.params.examenId,
      req,
      lecturaSensible: true,
    });

    return res.json({ examen: res2.rows[0] });
  } catch (err) {
    console.error('Error en obtenerExamen (espirometria):', err);
    return res.status(500).json({ error: 'Error interno al obtener el examen.' });
  }
}

module.exports = { registrarExamen, listarExamenes, obtenerExamen };
