// ============================================================
// Controlador de ergonomia (REBA).
//
// Regla de oro multi-tenant: TODA consulta filtra por
// organizacion_id = req.usuario.organizacionId, igual que el
// resto del sistema.
//
// El calculo REBA (tablas A/B/C oficiales) vive en
// src/ergonomia/reba.js y se importa aqui; este controlador
// SOLO se encarga de: validar que el trabajador pertenece a la
// organizacion del usuario, llamar al calculo, subir evidencia
// si viene, guardar el resultado y registrar auditoria.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { calcularReba } = require('../ergonomia/reba');
const { subirEvidencia, generarUrlFirmada } = require('../servicios/cloudinaryService');

// ------------------------------------------------------------
// POST /api/ergonomia/sesiones
// Crea una sesion de evaluacion ergonomica (la "carpeta" que
// agrupa una o mas posturas evaluadas del mismo trabajador/puesto).
// ------------------------------------------------------------
async function crearSesion(req, res) {
  const { trabajadorId, puestoEvaluado, tareaObservada, fechaEvaluacion, notasGenerales } = req.body;

  try {
    // Verificamos que el trabajador exista Y pertenezca a la
    // organizacion del usuario autenticado. Nunca se confia en
    // que el trabajadorId que llega del body sea valido sin
    // comprobarlo contra la base de datos.
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2 AND activo = true`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    const resultado = await query(
      `INSERT INTO sesiones_evaluacion_ergonomica
        (organizacion_id, trabajador_id, evaluador_id, puesto_evaluado, tarea_observada, fecha_evaluacion, notas_generales)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), $7)
       RETURNING id, trabajador_id, evaluador_id, puesto_evaluado, tarea_observada, fecha_evaluacion, notas_generales, creado_en`,
      [
        req.usuario.organizacionId,
        trabajadorId,
        req.usuario.id,
        puestoEvaluado,
        tareaObservada || null,
        fechaEvaluacion || null,
        notasGenerales || null,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'crear_sesion_evaluacion_ergonomica',
      entidad: 'sesion_evaluacion_ergonomica',
      entidadId: resultado.rows[0].id,
      detalle: { trabajadorId, puestoEvaluado },
      req,
    });

    return res.status(201).json({ sesion: resultado.rows[0] });
  } catch (err) {
    console.error('Error en crearSesion (ergonomia):', err);
    return res.status(500).json({ error: 'Error interno al crear la sesion de evaluacion ergonomica.' });
  }
}

// ------------------------------------------------------------
// GET /api/ergonomia/sesiones/trabajador/:trabajadorId
// Lista las sesiones de evaluacion ergonomica de un trabajador,
// con un resumen de sus evaluaciones REBA (la postura de mayor
// riesgo de cada sesion), para ver evolucion en el tiempo.
// ------------------------------------------------------------
async function listarSesionesPorTrabajador(req, res) {
  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    const sesionesRes = await query(
      `SELECT s.id, s.puesto_evaluado, s.tarea_observada, s.fecha_evaluacion, s.notas_generales,
              u.nombre_completo AS evaluador_nombre,
              (
                SELECT MAX(e.puntuacion_final)
                FROM evaluaciones_reba e
                WHERE e.sesion_id = s.id
              ) AS puntuacion_final_maxima
       FROM sesiones_evaluacion_ergonomica s
       JOIN usuarios u ON u.id = s.evaluador_id
       WHERE s.trabajador_id = $1 AND s.organizacion_id = $2
       ORDER BY s.fecha_evaluacion DESC, s.creado_en DESC`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'listar_sesiones_evaluacion_ergonomica',
      entidad: 'trabajador',
      entidadId: req.params.trabajadorId,
      req,
    });

    return res.json({ sesiones: sesionesRes.rows });
  } catch (err) {
    console.error('Error en listarSesionesPorTrabajador (ergonomia):', err);
    return res.status(500).json({ error: 'Error interno al listar las sesiones de evaluacion ergonomica.' });
  }
}

// ------------------------------------------------------------
// GET /api/ergonomia/sesiones/:sesionId
// Obtiene una sesion con todas sus evaluaciones REBA (todas las
// posturas evaluadas dentro de ella), ordenadas por "orden".
// ------------------------------------------------------------
async function obtenerSesion(req, res) {
  try {
    const sesionRes = await query(
      `SELECT s.*, t.nombre_completo AS trabajador_nombre, u.nombre_completo AS evaluador_nombre
       FROM sesiones_evaluacion_ergonomica s
       JOIN trabajadores t ON t.id = s.trabajador_id
       JOIN usuarios u ON u.id = s.evaluador_id
       WHERE s.id = $1 AND s.organizacion_id = $2`,
      [req.params.sesionId, req.usuario.organizacionId]
    );
    if (sesionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Sesion de evaluacion no encontrada.' });
    }

    const evaluacionesRes = await query(
      `SELECT id, nombre_postura, orden, puntuacion_a, puntuacion_b_derecho, puntuacion_b_izquierdo,
              puntuacion_c, puntuacion_actividad, puntuacion_final, nivel_riesgo, accion_requerida,
              lado_evaluado, evidencia_url, evidencia_tipo, creado_en
       FROM evaluaciones_reba
       WHERE sesion_id = $1
       ORDER BY orden ASC, creado_en ASC`,
      [req.params.sesionId]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'ver_sesion_evaluacion_ergonomica',
      entidad: 'sesion_evaluacion_ergonomica',
      entidadId: req.params.sesionId,
      req,
    });

    return res.json({ sesion: sesionRes.rows[0], evaluaciones: evaluacionesRes.rows });
  } catch (err) {
    console.error('Error en obtenerSesion (ergonomia):', err);
    return res.status(500).json({ error: 'Error interno al obtener la sesion de evaluacion.' });
  }
}

// ------------------------------------------------------------
// POST /api/ergonomia/sesiones/:sesionId/reba
// Agrega una evaluacion REBA (una postura) a una sesion existente.
// Aqui es donde se ejecuta el calculo real con tablas oficiales
// (src/ergonomia/reba.js), nunca la formula simplificada anterior.
// ------------------------------------------------------------
async function crearEvaluacionReba(req, res) {
  const { sesionId } = req.params;
  const input = req.body;

  try {
    // 1. Verificar que la sesion exista y pertenezca a la organizacion.
    const sesionRes = await query(
      `SELECT id FROM sesiones_evaluacion_ergonomica WHERE id = $1 AND organizacion_id = $2`,
      [sesionId, req.usuario.organizacionId]
    );
    if (sesionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Sesion de evaluacion no encontrada en su organizacion.' });
    }

    // 2. Mapear input del body (camelCase) a los nombres que espera
    //    el modulo de calculo (snake_case, igual que las columnas SQL).
    const inputCalculo = {
      tronco: input.tronco,
      tronco_torsion_lateral: !!input.troncoTorsionLateral,
      cuello: input.cuello,
      cuello_torsion_lateral: !!input.cuelloTorsionLateral,
      piernas: input.piernas,
      piernas_flexion_rodilla: input.piernasFlexionRodilla || 'ninguna',
      carga_fuerza: input.cargaFuerza,
      carga_brusca_o_rapida: !!input.cargaBruscaORapida,
      brazo_derecho: input.brazoDerecho,
      brazo_derecho_abduccion_o_rotacion: !!input.brazoDerechoAbduccionORotacion,
      brazo_derecho_apoyado: !!input.brazoDerechoApoyado,
      antebrazo_derecho: input.antebrazoDerecho,
      muneca_derecha: input.munecaDerecha,
      muneca_derecha_torsion_o_desviacion: !!input.munecaDerechaTorsionODesviacion,
      brazo_izquierdo: input.brazoIzquierdo,
      brazo_izquierdo_abduccion_o_rotacion: !!input.brazoIzquierdoAbduccionORotacion,
      brazo_izquierdo_apoyado: !!input.brazoIzquierdoApoyado,
      antebrazo_izquierdo: input.antebrazoIzquierdo,
      muneca_izquierda: input.munecaIzquierda,
      muneca_izquierda_torsion_o_desviacion: !!input.munecaIzquierdaTorsionODesviacion,
      agarre: input.agarre,
      actividad_posturas_estaticas: !!input.actividadPosturasEstaticas,
      actividad_movimientos_repetidos: !!input.actividadMovimientosRepetidos,
      actividad_cambios_posturales_rapidos: !!input.actividadCambiosPosturalesRapidos,
    };

    // 3. Calcular REBA con las tablas oficiales (sin tocar la BD aun).
    const resultado = calcularReba(inputCalculo);

    // 4. Si viene evidencia (foto/video en base64), subirla a Cloudinary
    //    ANTES de insertar, para guardar la URL final en la misma fila.
    let evidencia = null;
    if (input.evidenciaBase64) {
      evidencia = await subirEvidencia(input.evidenciaBase64, req.usuario.organizacionId);
    }

    // 5. Insertar la evaluacion con los inputs observados + resultado calculado.
    const insertRes = await query(
      `INSERT INTO evaluaciones_reba (
          organizacion_id, sesion_id, nombre_postura, orden,
          tronco, tronco_torsion_lateral, cuello, cuello_torsion_lateral,
          piernas, piernas_flexion_rodilla,
          carga_fuerza, carga_brusca_o_rapida,
          brazo_derecho, brazo_derecho_abduccion_o_rotacion, brazo_derecho_apoyado,
          antebrazo_derecho, muneca_derecha, muneca_derecha_torsion_o_desviacion,
          brazo_izquierdo, brazo_izquierdo_abduccion_o_rotacion, brazo_izquierdo_apoyado,
          antebrazo_izquierdo, muneca_izquierda, muneca_izquierda_torsion_o_desviacion,
          agarre,
          actividad_posturas_estaticas, actividad_movimientos_repetidos, actividad_cambios_posturales_rapidos,
          lado_evaluado,
          puntuacion_a, puntuacion_b_derecho, puntuacion_b_izquierdo, puntuacion_c,
          puntuacion_actividad, puntuacion_final, nivel_riesgo, accion_requerida,
          evidencia_url, evidencia_public_id, evidencia_tipo
       ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10,
          $11, $12,
          $13, $14, $15,
          $16, $17, $18,
          $19, $20, $21,
          $22, $23, $24,
          $25,
          $26, $27, $28,
          $29,
          $30, $31, $32, $33,
          $34, $35, $36, $37,
          $38, $39, $40
       )
       RETURNING id, nombre_postura, orden, puntuacion_a, puntuacion_b_derecho, puntuacion_b_izquierdo,
                 puntuacion_c, puntuacion_actividad, puntuacion_final, nivel_riesgo, accion_requerida,
                 lado_evaluado, evidencia_url, evidencia_tipo, creado_en`,
      [
        req.usuario.organizacionId, sesionId, input.nombrePostura, input.orden || 1,
        input.tronco, !!input.troncoTorsionLateral, input.cuello, !!input.cuelloTorsionLateral,
        input.piernas, input.piernasFlexionRodilla || 'ninguna',
        input.cargaFuerza, !!input.cargaBruscaORapida,
        input.brazoDerecho, !!input.brazoDerechoAbduccionORotacion, !!input.brazoDerechoApoyado,
        input.antebrazoDerecho, input.munecaDerecha, !!input.munecaDerechaTorsionODesviacion,
        input.brazoIzquierdo, !!input.brazoIzquierdoAbduccionORotacion, !!input.brazoIzquierdoApoyado,
        input.antebrazoIzquierdo, input.munecaIzquierda, !!input.munecaIzquierdaTorsionODesviacion,
        input.agarre,
        !!input.actividadPosturasEstaticas, !!input.actividadMovimientosRepetidos, !!input.actividadCambiosPosturalesRapidos,
        resultado.ladoEvaluado,
        resultado.puntuacionA, resultado.puntuacionBDerecho, resultado.puntuacionBIzquierdo, resultado.puntuacionC,
        resultado.puntuacionActividad, resultado.puntuacionFinal, resultado.nivelRiesgo, resultado.accionRequerida,
        evidencia ? evidencia.url : null, evidencia ? evidencia.publicId : null, evidencia ? evidencia.tipo : null,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'crear_evaluacion_reba',
      entidad: 'evaluacion_reba',
      entidadId: insertRes.rows[0].id,
      detalle: {
        sesionId,
        nombrePostura: input.nombrePostura,
        puntuacionFinal: resultado.puntuacionFinal,
        nivelRiesgo: resultado.nivelRiesgo,
      },
      req,
    });

    return res.status(201).json({ evaluacion: insertRes.rows[0], detalleCalculo: resultado.detalle });
  } catch (err) {
    console.error('Error en crearEvaluacionReba:', err);
    return res.status(500).json({ error: 'Error interno al calcular y guardar la evaluacion REBA.' });
  }
}

// ------------------------------------------------------------
// GET /api/ergonomia/evaluaciones/:evaluacionId/evidencia-url
//
// CORREGIDO tras auditoria de seguridad (hallazgo G12): la foto/
// video de evidencia ya no es accesible con una URL publica
// permanente (ver cloudinaryService.js). Este endpoint genera una
// URL firmada de corta duracion, DESPUES de comprobar (via el JOIN
// con la sesion) que la evaluacion pertenece a la organizacion del
// usuario.
// ------------------------------------------------------------
async function obtenerUrlEvidencia(req, res) {
  try {
    const resultado = await query(
      `SELECT ev.evidencia_public_id, ev.evidencia_tipo
       FROM evaluaciones_reba ev
       JOIN sesiones_evaluacion_ergonomica s ON s.id = ev.sesion_id
       WHERE ev.id = $1 AND s.organizacion_id = $2`,
      [req.params.evaluacionId, req.usuario.organizacionId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Evaluacion no encontrada.' });
    }
    const { evidencia_public_id: publicId, evidencia_tipo: tipo } = resultado.rows[0];
    if (!publicId) {
      return res.status(404).json({ error: 'Esta evaluacion no tiene evidencia adjunta.' });
    }
    return res.json({ url: generarUrlFirmada(publicId, tipo === 'video' ? 'video' : 'imagen') });
  } catch (err) {
    console.error('Error en obtenerUrlEvidencia (REBA):', err);
    return res.status(500).json({ error: 'Error interno al generar el enlace de la evidencia.' });
  }
}

module.exports = {
  crearSesion,
  listarSesionesPorTrabajador,
  obtenerSesion,
  crearEvaluacionReba,
  obtenerUrlEvidencia,
};
