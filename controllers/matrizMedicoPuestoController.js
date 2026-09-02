// ============================================================
// Controlador de la Matriz Medico-Ocupacional por Puesto.
// Corrige el punto 15 / CRITICO 2 de la Auditoria SISSO N.06.
//
// Acceso: SOLO 'medico'. Es la relacion que decide la vigilancia
// clinica de cada trabajador (que examenes, con que frecuencia).
//
// La pieza central es calcularCobertura(): cruza los requisitos de
// la matriz con las tablas de examenes reales para cada trabajador
// del puesto, y devuelve ultima_evaluacion / proxima_evaluacion /
// esta_vencido calculados en el momento (nunca almacenados, para
// que jamas queden desactualizados).
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

// Mapea cada tipo de examen de la matriz a la tabla real donde se
// guardan los examenes de ese tipo, y la columna de fecha.
const TABLA_POR_TIPO_EXAMEN = {
  audiometria: { tabla: 'examenes_audiometria', columnaFecha: 'fecha_examen' },
  espirometria: { tabla: 'examenes_espirometria', columnaFecha: 'fecha_examen' },
  visiometria: { tabla: 'examenes_visiometria', columnaFecha: 'fecha_examen' },
  evaluacion_periodica: { tabla: 'evaluaciones_ocupacionales', columnaFecha: 'fecha_atencion', filtroExtra: `AND tipo_evaluacion = 'periodica'` },
};

// ------------------------------------------------------------
// POST /api/matriz-medico-puesto
// Crea un requisito de vigilancia para un puesto.
// ------------------------------------------------------------
async function crearRequisito(req, res) {
  const { puestoTrabajoId, tipoExamen, riesgoQueLoJustifica, frecuenciaMeses, obligatorio, responsableId } = req.body;

  if (!puestoTrabajoId || !tipoExamen || !riesgoQueLoJustifica || !frecuenciaMeses) {
    return res.status(400).json({ error: 'puestoTrabajoId, tipoExamen, riesgoQueLoJustifica y frecuenciaMeses son obligatorios.' });
  }
  if (!TABLA_POR_TIPO_EXAMEN[tipoExamen]) {
    return res.status(400).json({ error: 'tipoExamen invalido.' });
  }

  try {
    const puestoRes = await query(
      `SELECT id FROM puestos_trabajo WHERE id = $1 AND organizacion_id = $2`,
      [puestoTrabajoId, req.usuario.organizacionId]
    );
    if (puestoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Puesto de trabajo no encontrado.' });
    }

    const requisitoRes = await query(
      `INSERT INTO matriz_medico_puesto
        (organizacion_id, puesto_trabajo_id, tipo_examen, riesgo_que_lo_justifica, frecuencia_meses, obligatorio, responsable_id, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, tipo_examen, frecuencia_meses, creado_en`,
      [
        req.usuario.organizacionId,
        puestoTrabajoId,
        tipoExamen,
        riesgoQueLoJustifica.trim(),
        frecuenciaMeses,
        obligatorio !== false,
        responsableId || null,
        req.usuario.id,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'matriz_medico_puesto_requisito_creado',
      entidad: 'matriz_medico_puesto',
      entidadId: requisitoRes.rows[0].id,
      detalle: { puestoTrabajoId, tipoExamen },
      req,
    });

    return res.status(201).json({ requisito: requisitoRes.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Este puesto ya tiene un requisito activo de ese tipo de examen.' });
    }
    console.error('Error en crearRequisito (matriz medico puesto):', err);
    return res.status(500).json({ error: 'Error interno al crear el requisito.' });
  }
}

// ------------------------------------------------------------
// GET /api/matriz-medico-puesto/puestos/:puestoId
// Lista los requisitos de un puesto (sin calculo de cobertura).
// ------------------------------------------------------------
async function listarRequisitosPuesto(req, res) {
  const { puestoId } = req.params;
  try {
    const requisitosRes = await query(
      `SELECT mmp.id, mmp.tipo_examen, mmp.riesgo_que_lo_justifica, mmp.frecuencia_meses,
              mmp.obligatorio, mmp.activo, mmp.responsable_id, u.nombre_completo AS responsable_nombre,
              mmp.creado_en
       FROM matriz_medico_puesto mmp
       LEFT JOIN usuarios u ON u.id = mmp.responsable_id
       WHERE mmp.puesto_trabajo_id = $1 AND mmp.organizacion_id = $2
       ORDER BY mmp.tipo_examen ASC`,
      [puestoId, req.usuario.organizacionId]
    );
    return res.json({ requisitos: requisitosRes.rows });
  } catch (err) {
    console.error('Error en listarRequisitosPuesto:', err);
    return res.status(500).json({ error: 'Error interno al listar los requisitos.' });
  }
}

// ------------------------------------------------------------
// PUT /api/matriz-medico-puesto/:requisitoId
// ------------------------------------------------------------
async function actualizarRequisito(req, res) {
  const { requisitoId } = req.params;
  const { riesgoQueLoJustifica, frecuenciaMeses, obligatorio, responsableId, activo } = req.body;

  try {
    const actualizadoRes = await query(
      `UPDATE matriz_medico_puesto SET
         riesgo_que_lo_justifica = COALESCE($1, riesgo_que_lo_justifica),
         frecuencia_meses = COALESCE($2, frecuencia_meses),
         obligatorio = COALESCE($3, obligatorio),
         responsable_id = COALESCE($4, responsable_id),
         activo = COALESCE($5, activo)
       WHERE id = $6 AND organizacion_id = $7
       RETURNING id, tipo_examen, frecuencia_meses, activo`,
      [
        riesgoQueLoJustifica ? riesgoQueLoJustifica.trim() : null,
        frecuenciaMeses || null,
        typeof obligatorio === 'boolean' ? obligatorio : null,
        responsableId || null,
        typeof activo === 'boolean' ? activo : null,
        requisitoId,
        req.usuario.organizacionId,
      ]
    );
    if (actualizadoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Requisito no encontrado.' });
    }

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'matriz_medico_puesto_requisito_actualizado',
      entidad: 'matriz_medico_puesto',
      entidadId: requisitoId,
      req,
    });

    return res.json({ requisito: actualizadoRes.rows[0] });
  } catch (err) {
    console.error('Error en actualizarRequisito (matriz medico puesto):', err);
    return res.status(500).json({ error: 'Error interno al actualizar el requisito.' });
  }
}

// ------------------------------------------------------------
// GET /api/matriz-medico-puesto/puestos/:puestoId/cobertura
// El corazon del modulo: para cada requisito activo del puesto,
// cruza contra los trabajadores asignados a ese puesto y calcula,
// por trabajador, su ultimo examen de ese tipo, la proxima fecha
// esperada, y si esta vencido o sin cobertura (nunca se le hizo).
// ------------------------------------------------------------
async function obtenerCobertura(req, res) {
  const { puestoId } = req.params;

  try {
    const puestoRes = await query(
      `SELECT id, nombre_puesto FROM puestos_trabajo WHERE id = $1 AND organizacion_id = $2`,
      [puestoId, req.usuario.organizacionId]
    );
    if (puestoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Puesto de trabajo no encontrado.' });
    }

    const requisitosRes = await query(
      `SELECT id, tipo_examen, riesgo_que_lo_justifica, frecuencia_meses, obligatorio
       FROM matriz_medico_puesto
       WHERE puesto_trabajo_id = $1 AND organizacion_id = $2 AND activo = true`,
      [puestoId, req.usuario.organizacionId]
    );

    const trabajadoresRes = await query(
      `SELECT id, nombre_completo, documento FROM trabajadores
       WHERE puesto_trabajo_id = $1 AND organizacion_id = $2 AND activo = true`,
      [puestoId, req.usuario.organizacionId]
    );
    const trabajadores = trabajadoresRes.rows;

    const cobertura = [];
    for (const requisito of requisitosRes.rows) {
      const config = TABLA_POR_TIPO_EXAMEN[requisito.tipo_examen];
      const filtroExtra = config.filtroExtra || '';

      // Un solo query trae, por trabajador de este puesto, la fecha
      // de su examen mas reciente de este tipo (si existe).
      const ultimosExamenesRes = await query(
        `SELECT trabajador_id, MAX(${config.columnaFecha}) AS ultima_fecha
         FROM ${config.tabla}
         WHERE organizacion_id = $1 AND trabajador_id = ANY($2::uuid[]) ${filtroExtra}
         GROUP BY trabajador_id`,
        [req.usuario.organizacionId, trabajadores.map((t) => t.id)]
      );
      const ultimaFechaPorTrabajador = new Map(
        ultimosExamenesRes.rows.map((r) => [r.trabajador_id, r.ultima_fecha])
      );

      const detalleTrabajadores = trabajadores.map((t) => {
        const ultimaFecha = ultimaFechaPorTrabajador.get(t.id) || null;
        let proximaFecha = null;
        let estaVencido = true;
        if (ultimaFecha) {
          const fecha = new Date(ultimaFecha);
          fecha.setMonth(fecha.getMonth() + requisito.frecuencia_meses);
          proximaFecha = fecha.toISOString().slice(0, 10);
          estaVencido = fecha < new Date();
        }
        return {
          trabajadorId: t.id,
          nombreCompleto: t.nombre_completo,
          documento: t.documento,
          ultimaEvaluacion: ultimaFecha,
          proximaEvaluacion: proximaFecha,
          sinCobertura: !ultimaFecha,
          estaVencido,
        };
      });

      cobertura.push({
        requisitoId: requisito.id,
        tipoExamen: requisito.tipo_examen,
        riesgoQueLoJustifica: requisito.riesgo_que_lo_justifica,
        frecuenciaMeses: requisito.frecuencia_meses,
        obligatorio: requisito.obligatorio,
        totalTrabajadores: trabajadores.length,
        totalSinCobertura: detalleTrabajadores.filter((d) => d.sinCobertura).length,
        totalVencidos: detalleTrabajadores.filter((d) => !d.sinCobertura && d.estaVencido).length,
        trabajadores: detalleTrabajadores,
      });
    }

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'lectura_matriz_medico_puesto_cobertura',
      entidad: 'matriz_medico_puesto',
      entidadId: puestoId,
      req,
    });

    return res.json({ puesto: puestoRes.rows[0], cobertura });
  } catch (err) {
    console.error('Error en obtenerCobertura (matriz medico puesto):', err);
    return res.status(500).json({ error: 'Error interno al calcular la cobertura.' });
  }
}

module.exports = {
  crearRequisito,
  listarRequisitosPuesto,
  actualizarRequisito,
  obtenerCobertura,
};
