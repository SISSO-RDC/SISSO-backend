// ============================================================
// Controlador de Alertas. CORRIGE el hallazgo G9 de la Auditoria
// SISSO N.06: "Deben pasar de señales calculadas a objetos
// persistentes gestionables."
//
// PATRON: en cada GET /api/alertas se sincroniza primero la tabla
// `alertas` contra las mismas señales que antes se calculaban al
// vuelo (EMOs vencidos, consentimientos revocados, aptitud no apta,
// STS en audiometria, etc.) -- las señales NUEVAS se insertan como
// alertas nuevas; las que ya existian NO se tocan (ON CONFLICT DO
// NOTHING), para no perder el estado de gestion que un usuario ya
// le haya dado. No hay cron job (Render free): la sincronizacion
// perezosa en cada lectura es el mismo patron ya usado para el
// vencimiento de trials/suscripciones (authController.js).
//
// CORREGIDO en Auditoria N.07 (hallazgo GRAVE C5): la version
// anterior dejaba que SSO viera tambien las alertas clinicas
// NOMINALES ('Aptitud NO APTO: <nombre>', 'STS positivo en
// audiometria: <nombre>', etc, asociadas al trabajador). Esto era
// inconsistente con la separacion que el propio backend aplica en
// Historia Clinica, Aptitud, Enfermedad Profesional, Audiometria,
// Espirometria y Visiometria, donde esos mismos hallazgos estan
// reservados al medico. Ahora solo 'medico' recibe categoria
// es_clinica=true; admin, sso y th solo ven alertas administrativas
// (EMO vencido, consentimiento revocado). Si en el futuro SSO
// necesita saber que "alguien requiere intervencion de vigilancia"
// sin conocer el diagnostico ni el nombre, debe modelarse como una
// categoria administrativa/agregada nueva y explicita -- no
// reutilizando esClinico.
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

const DIAS_RECIENTE = 180;

// ------------------------------------------------------------
// Sincroniza la tabla `alertas` contra las señales administrativas.
// ------------------------------------------------------------
async function sincronizarAlertasAdministrativas(orgId) {
  await query(
    `INSERT INTO alertas (organizacion_id, categoria, es_clinica, origen_entidad, origen_id, trabajador_id, titulo, detalle, fecha_deteccion)
     SELECT $1, 'emo_vencido', false, 'trabajadores', t.id, t.id,
            'EMO próximo a vencer o vencido: ' || t.nombre_completo,
            'Vence el ' || t.fecha_vencimiento,
            CURRENT_DATE
     FROM trabajadores t
     WHERE t.organizacion_id = $1 AND t.activo = true
       AND t.fecha_vencimiento IS NOT NULL
       AND t.fecha_vencimiento <= CURRENT_DATE + INTERVAL '15 days'
     ON CONFLICT (organizacion_id, categoria, origen_entidad, origen_id) DO NOTHING`,
    [orgId]
  );

  await query(
    `INSERT INTO alertas (organizacion_id, categoria, es_clinica, origen_entidad, origen_id, trabajador_id, titulo, detalle, fecha_deteccion)
     SELECT $1, 'consentimiento_revocado', false, 'consentimientos_firmados', c.id, c.trabajador_id,
            'Consentimiento revocado: ' || t.nombre_completo,
            tc.nombre,
            c.revocado_en::date
     FROM consentimientos_firmados c
     JOIN trabajadores t ON t.id = c.trabajador_id
     JOIN tipos_consentimiento tc ON tc.codigo = c.tipo_consentimiento_codigo
     WHERE c.organizacion_id = $1 AND c.revocado = true
       AND c.revocado_en >= CURRENT_DATE - INTERVAL '${DIAS_RECIENTE} days'
     ON CONFLICT (organizacion_id, categoria, origen_entidad, origen_id) DO NOTHING`,
    [orgId]
  );
}

// ------------------------------------------------------------
// Sincroniza la tabla `alertas` contra las señales clinicas.
// ------------------------------------------------------------
async function sincronizarAlertasClinicas(orgId) {
  await query(
    `INSERT INTO alertas (organizacion_id, categoria, es_clinica, origen_entidad, origen_id, trabajador_id, titulo, fecha_deteccion)
     SELECT $1, 'aptitud_no_apto', true, 'trabajadores', t.id, t.id,
            'Aptitud NO APTO: ' || t.nombre_completo, CURRENT_DATE
     FROM trabajadores t
     WHERE t.organizacion_id = $1 AND t.activo = true AND t.aptitud = 'no_apto'
     ON CONFLICT (organizacion_id, categoria, origen_entidad, origen_id) DO NOTHING`,
    [orgId]
  );

  await query(
    `INSERT INTO alertas (organizacion_id, categoria, es_clinica, origen_entidad, origen_id, trabajador_id, titulo, detalle, fecha_deteccion)
     SELECT $1, 'historia_clinica_limitada', true, 'evaluaciones_ocupacionales', e.id, e.trabajador_id,
            'Aptitud limitada en historia clínica: ' || t.nombre_completo, e.tipo_evaluacion, e.fecha_atencion::date
     FROM evaluaciones_ocupacionales e
     JOIN trabajadores t ON t.id = e.trabajador_id
     WHERE e.organizacion_id = $1 AND e.aptitud_msp IN ('no_apto', 'apto_con_limitaciones')
       AND e.fecha_atencion >= CURRENT_DATE - INTERVAL '${DIAS_RECIENTE} days'
     ON CONFLICT (organizacion_id, categoria, origen_entidad, origen_id) DO NOTHING`,
    [orgId]
  );

  await query(
    `INSERT INTO alertas (organizacion_id, categoria, es_clinica, origen_entidad, origen_id, trabajador_id, titulo, fecha_deteccion)
     SELECT $1, 'audiometria_sts', true, 'examenes_audiometria', a.id, a.trabajador_id,
            'STS positivo en audiometría: ' || t.nombre_completo, a.fecha_examen
     FROM examenes_audiometria a
     JOIN trabajadores t ON t.id = a.trabajador_id
     WHERE a.organizacion_id = $1 AND (a.sts_od_positivo = true OR a.sts_oi_positivo = true)
       AND a.fecha_examen >= CURRENT_DATE - INTERVAL '${DIAS_RECIENTE} days'
     ON CONFLICT (organizacion_id, categoria, origen_entidad, origen_id) DO NOTHING`,
    [orgId]
  );

  await query(
    `INSERT INTO alertas (organizacion_id, categoria, es_clinica, origen_entidad, origen_id, trabajador_id, titulo, detalle, fecha_deteccion)
     SELECT $1, 'espirometria_anormal', true, 'examenes_espirometria', e.id, e.trabajador_id,
            'Patrón espirométrico anormal: ' || t.nombre_completo, e.patron, e.fecha_examen
     FROM examenes_espirometria e
     JOIN trabajadores t ON t.id = e.trabajador_id
     WHERE e.organizacion_id = $1 AND e.patron IS NOT NULL AND e.patron != 'normal'
       AND e.fecha_examen >= CURRENT_DATE - INTERVAL '${DIAS_RECIENTE} days'
     ON CONFLICT (organizacion_id, categoria, origen_entidad, origen_id) DO NOTHING`,
    [orgId]
  );

  await query(
    `INSERT INTO alertas (organizacion_id, categoria, es_clinica, origen_entidad, origen_id, trabajador_id, titulo, fecha_deteccion)
     SELECT $1, 'visiometria_requiere_evaluacion', true, 'examenes_visiometria', e.id, e.trabajador_id,
            'Requiere evaluación oftalmológica: ' || t.nombre_completo, e.fecha_examen
     FROM examenes_visiometria e
     JOIN trabajadores t ON t.id = e.trabajador_id
     WHERE e.organizacion_id = $1 AND e.aptitud_definida IN ('requiere_evaluacion_oftalmologica', 'no_apto')
       AND e.fecha_examen >= CURRENT_DATE - INTERVAL '${DIAS_RECIENTE} days'
     ON CONFLICT (organizacion_id, categoria, origen_entidad, origen_id) DO NOTHING`,
    [orgId]
  );

  await query(
    `INSERT INTO alertas (organizacion_id, categoria, es_clinica, origen_entidad, origen_id, trabajador_id, titulo, fecha_deteccion)
     SELECT $1, 'nordico_prioritario', true, 'cuestionarios_nordicos', c.id, c.trabajador_id,
            'Cuestionario nórdico prioritario: ' || t.nombre_completo, c.fecha_aplicacion
     FROM cuestionarios_nordicos c
     JOIN trabajadores t ON t.id = c.trabajador_id
     WHERE c.organizacion_id = $1 AND c.requiere_atencion_prioritaria = true
       AND c.fecha_aplicacion >= CURRENT_DATE - INTERVAL '${DIAS_RECIENTE} days'
     ON CONFLICT (organizacion_id, categoria, origen_entidad, origen_id) DO NOTHING`,
    [orgId]
  );

  await query(
    `INSERT INTO alertas (organizacion_id, categoria, es_clinica, origen_entidad, origen_id, trabajador_id, titulo, detalle, fecha_deteccion)
     SELECT $1, 'niosh_riesgo_alto', true, 'evaluaciones_niosh', e.id, e.trabajador_id,
            'Riesgo NIOSH alto: ' || t.nombre_completo, e.nombre_tarea, e.fecha_evaluacion
     FROM evaluaciones_niosh e
     JOIN trabajadores t ON t.id = e.trabajador_id
     WHERE e.organizacion_id = $1 AND e.clasificacion IN ('riesgo_alto', 'riesgo_muy_alto')
       AND e.fecha_evaluacion >= CURRENT_DATE - INTERVAL '${DIAS_RECIENTE} days'
     ON CONFLICT (organizacion_id, categoria, origen_entidad, origen_id) DO NOTHING`,
    [orgId]
  );
}

// ------------------------------------------------------------
// GET /api/alertas  (filtros: estado, categoria)
// ------------------------------------------------------------
async function obtenerAlertas(req, res) {
  const orgId = req.usuario.organizacionId;
  const esClinico = req.usuario.rol === 'medico';
  const { estado, categoria } = req.query;

  try {
    await sincronizarAlertasAdministrativas(orgId);
    if (esClinico) await sincronizarAlertasClinicas(orgId);

    const condiciones = ['a.organizacion_id = $1'];
    const parametros = [orgId];
    if (!esClinico) condiciones.push('a.es_clinica = false');
    if (estado) { parametros.push(estado); condiciones.push(`a.estado = $${parametros.length}`); }
    if (categoria) { parametros.push(categoria); condiciones.push(`a.categoria = $${parametros.length}`); }

    const resultado = await query(
      `SELECT a.id, a.categoria, a.es_clinica, a.trabajador_id, t.nombre_completo AS trabajador_nombre,
              a.titulo, a.detalle, a.estado, a.responsable_id, u.nombre_completo AS responsable_nombre,
              a.nota_gestion, a.fecha_deteccion, a.fecha_resolucion, a.creado_en
       FROM alertas a
       LEFT JOIN trabajadores t ON t.id = a.trabajador_id
       LEFT JOIN usuarios u ON u.id = a.responsable_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY (a.estado = 'nueva') DESC, a.fecha_deteccion DESC`,
      parametros
    );

    const total = resultado.rows.length;
    const nuevas = resultado.rows.filter((a) => a.estado === 'nueva').length;

    return res.json({ alertas: resultado.rows, total, nuevas, incluyeClinicas: esClinico });
  } catch (err) {
    console.error('Error en obtenerAlertas:', err);
    return res.status(500).json({ error: 'Error interno al obtener las alertas.' });
  }
}

// ------------------------------------------------------------
// PUT /api/alertas/:id/estado
// Gestiona el ciclo de vida: vista -> en_gestion -> resuelta (o
// descartada). Puede asignar un responsable y dejar una nota.
// ------------------------------------------------------------
async function actualizarEstadoAlerta(req, res) {
  const orgId = req.usuario.organizacionId;
  const { estado, responsableId, notaGestion } = req.body;

  if (estado && !['nueva', 'vista', 'en_gestion', 'resuelta', 'descartada'].includes(estado)) {
    return res.status(400).json({ error: 'estado invalido.' });
  }

  try {
    // CORREGIDO (Auditoria N.07, C5): una alerta CLINICA (es_clinica=true)
    // solo puede ser gestionada por medico -- mismo criterio de
    // separacion de roles que en la lectura, tras retirar la
    // excepcion de sso.
    const alertaRes = await query(`SELECT id, es_clinica FROM alertas WHERE id = $1 AND organizacion_id = $2`, [req.params.id, orgId]);
    if (alertaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Alerta no encontrada.' });
    }
    if (alertaRes.rows[0].es_clinica && req.usuario.rol !== 'medico') {
      return res.status(403).json({ error: 'No tiene permiso para gestionar esta alerta clínica.' });
    }

    const fechaResolucion = (estado === 'resuelta' || estado === 'descartada') ? new Date().toISOString().slice(0, 10) : null;

    const actualizadaRes = await query(
      `UPDATE alertas SET
         estado = COALESCE($1, estado),
         responsable_id = COALESCE($2, responsable_id),
         nota_gestion = COALESCE($3, nota_gestion),
         fecha_resolucion = COALESCE($4, fecha_resolucion)
       WHERE id = $5 AND organizacion_id = $6
       RETURNING id, estado, responsable_id, fecha_resolucion`,
      [estado || null, responsableId || null, notaGestion || null, fechaResolucion, req.params.id, orgId]
    );

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'alerta_estado_actualizado',
      entidad: 'alertas', entidadId: req.params.id, detalle: { estado }, req,
    });

    return res.json({ alerta: actualizadaRes.rows[0] });
  } catch (err) {
    console.error('Error en actualizarEstadoAlerta:', err);
    return res.status(500).json({ error: 'Error interno al actualizar la alerta.' });
  }
}

module.exports = { obtenerAlertas, actualizarEstadoAlerta };
