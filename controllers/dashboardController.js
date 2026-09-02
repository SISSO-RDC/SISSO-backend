// ============================================================
// Controlador de Dashboard — estadisticas de resumen.
//
// Devuelve en una sola peticion todos los datos que el
// Dashboard necesita, evitando que el frontend haga 10
// peticiones separadas al cargar la pagina principal.
//
// Solo devuelve datos que YA tienen tablas y datos reales
// en la base de datos (trabajadores, evaluaciones REBA/RULA,
// historial de aptitud, consentimientos). Los modulos que
// aun no existen (audiometria, espirometria, NIOSH, etc.)
// se devuelven como null o array vacio, y el Dashboard los
// muestra como "sin datos aun" en vez de errores.
//
// CORREGIDO en Auditoria N.08 (hallazgo CRITICO/BLOQUEANTE
// C-N08-01, prioridad P0): este endpoint solo exigia
// autenticacion, sin ningun filtro de rol, y devolvia dos vias
// laterales de aptitud medica individual nominal:
//   1. emosProximas incluia el campo "aptitud" para 'medico' Y
//      'sso' (el resto del sistema, desde la Auditoria N.07,
//      reserva la aptitud individual EXCLUSIVAMENTE a medico --
//      ver aptitudController.js, historiaClinicaController.js,
//      certificadosController.js. Dejar a sso como excepcion aqui
//      era exactamente el mismo error ya corregido dos veces antes
//      en ausentismo (C4) y alertas (C5): una excepcion que
//      alguien reintroduce sin querer porque no hay una regla
//      central, solo controles puntuales por endpoint).
//   2. actividadReciente combinaba, para TODOS los roles sin
//      distincion, nombre_completo del trabajador con el
//      resultado de su aptitud medica (union con
//      historial_aptitud_medica). Un admin o th autenticado podia
//      reconstruir "quien es NO APTO" simplemente mirando el
//      dashboard, sin pasar por ninguna de las restricciones ya
//      aplicadas en /api/aptitud.
//
// La correccion sigue la instruccion explicita de la auditoria:
// "La actividad reciente debe eliminar la union con
// historial_aptitud_medica para roles no medicos" -- no se trata
// de ocultar el campo despues de traerlo (como se hacia antes con
// emosProximas), sino de que el propio SQL de actividadReciente
// nunca incluya esa fuente para quien no sea medico.
// ============================================================
const { query } = require('../db/pool');
const { esGrupoPequeno, redactarFilasPorGrupoPequeno } = require('../utils/kAnonimato');

async function obtenerResumen(req, res) {
  const orgId = req.usuario.organizacionId;
  const esMedico = req.usuario.rol === 'medico';

  // La rama 'aptitud' de actividadReciente (UNION ALL con
  // historial_aptitud_medica) SOLO se agrega a la consulta cuando
  // el rol es medico. Para el resto de roles, actividadReciente se
  // arma unicamente con REBA/RULA -- riesgo ergonomico agregado por
  // postura, no un diagnostico ni una conclusion medico-ocupacional
  // individual, y por eso no esta sujeto a la misma restriccion (ver
  // Auditoria N.08, seccion 7.1: la frontera critica es "identidad +
  // aptitud/diagnostico", no "identidad + cualquier dato").
  const consultaActividadReciente = esMedico
    ? `SELECT 'reba' AS tipo, e.nombre_postura AS descripcion,
              e.puntuacion_final AS valor, e.nivel_riesgo,
              t.nombre_completo AS trabajador, e.creado_en
       FROM evaluaciones_reba e
       JOIN sesiones_evaluacion_ergonomica s ON s.id = e.sesion_id
       JOIN trabajadores t ON t.id = s.trabajador_id
       WHERE s.organizacion_id = $1

       UNION ALL

       SELECT 'rula' AS tipo, ev.nombre_postura AS descripcion,
              ev.puntuacion_c AS valor, ev.nivel_riesgo,
              t.nombre_completo AS trabajador, ev.creado_en
       FROM evaluaciones_rula ev
       JOIN sesiones_evaluacion_rula sr ON sr.id = ev.sesion_id
       JOIN trabajadores t ON t.id = sr.trabajador_id
       WHERE sr.organizacion_id = $1

       UNION ALL

       SELECT 'aptitud' AS tipo, h.aptitud AS descripcion,
              NULL AS valor, h.aptitud AS nivel_riesgo,
              t.nombre_completo AS trabajador, h.creado_en
       FROM historial_aptitud_medica h
       JOIN trabajadores t ON t.id = h.trabajador_id
       WHERE h.organizacion_id = $1

       ORDER BY creado_en DESC
       LIMIT 8`
    : `SELECT 'reba' AS tipo, e.nombre_postura AS descripcion,
              e.puntuacion_final AS valor, e.nivel_riesgo,
              t.nombre_completo AS trabajador, e.creado_en
       FROM evaluaciones_reba e
       JOIN sesiones_evaluacion_ergonomica s ON s.id = e.sesion_id
       JOIN trabajadores t ON t.id = s.trabajador_id
       WHERE s.organizacion_id = $1

       UNION ALL

       SELECT 'rula' AS tipo, ev.nombre_postura AS descripcion,
              ev.puntuacion_c AS valor, ev.nivel_riesgo,
              t.nombre_completo AS trabajador, ev.creado_en
       FROM evaluaciones_rula ev
       JOIN sesiones_evaluacion_rula sr ON sr.id = ev.sesion_id
       JOIN trabajadores t ON t.id = sr.trabajador_id
       WHERE sr.organizacion_id = $1

       ORDER BY creado_en DESC
       LIMIT 8`;

  try {
    const [
      trabajadores,
      aptitud,
      rebaPorArea,
      emosProximas,
      consentimientosRecientes,
      rulaResumen,
      actividadReciente,
    ] = await Promise.all([

      // 1. Conteo total de trabajadores activos
      query(
        `SELECT COUNT(*) AS total FROM trabajadores WHERE organizacion_id = $1 AND activo = true`,
        [orgId]
      ),

      // 2. Distribucion de aptitud: agregada (conteo por categoria),
      // nunca ligada a un trabajador identificado -- por eso se
      // mantiene igual para todos los roles, tal como confirma la
      // Auditoria N.08 ("por si sola es razonable").
      query(
        `SELECT aptitud, COUNT(*) AS cantidad
         FROM trabajadores
         WHERE organizacion_id = $1 AND activo = true
         GROUP BY aptitud`,
        [orgId]
      ),

      // 3. Score REBA promedio y maximo por area (para grafico de barras)
      query(
        `SELECT t.area,
                ROUND(AVG(e.puntuacion_final)::numeric, 1) AS promedio,
                MAX(e.puntuacion_final) AS maximo,
                COUNT(DISTINCT t.id) AS trabajadores_evaluados
         FROM evaluaciones_reba e
         JOIN sesiones_evaluacion_ergonomica s ON s.id = e.sesion_id
         JOIN trabajadores t ON t.id = s.trabajador_id
         WHERE s.organizacion_id = $1 AND t.area IS NOT NULL
         GROUP BY t.area
         ORDER BY maximo DESC
         LIMIT 8`,
        [orgId]
      ),

      // 4. Trabajadores con EMO vencida o proxima a vencer (30 dias)
      query(
        `SELECT nombre_completo, fecha_vencimiento, aptitud,
                CURRENT_DATE - fecha_vencimiento AS dias_vencida
         FROM trabajadores
         WHERE organizacion_id = $1 AND activo = true
           AND fecha_vencimiento IS NOT NULL
           AND fecha_vencimiento <= CURRENT_DATE + INTERVAL '30 days'
         ORDER BY fecha_vencimiento ASC
         LIMIT 10`,
        [orgId]
      ),

      // 5. Consentimientos firmados en los ultimos 30 dias
      query(
        `SELECT tipo_consentimiento_codigo, COUNT(*) AS cantidad
         FROM consentimientos_firmados
         WHERE organizacion_id = $1
           AND creado_en >= NOW() - INTERVAL '30 days'
         GROUP BY tipo_consentimiento_codigo`,
        [orgId]
      ),

      // 6. Resumen de evaluaciones RULA: distribucion de niveles de riesgo
      query(
        `SELECT nivel_riesgo, COUNT(*) AS cantidad
         FROM evaluaciones_rula
         WHERE organizacion_id = $1
         GROUP BY nivel_riesgo`,
        [orgId]
      ),

      // 7. Actividad reciente: consulta condicional por rol, ver
      // consultaActividadReciente arriba.
      query(consultaActividadReciente, [orgId]),
    ]);

    // CORREGIDO en Auditoria N.08 (C-N08-01): unicamente medico
    // recibe el campo "aptitud" en emosProximas. Se retira la
    // excepcion que antes tenia sso (heredada del mismo patron que
    // ya se habia corregido en ausentismo/alertas durante la
    // Auditoria N.07 -- ver ausentismoController.js y
    // alertasController.js). Se mantiene la fecha de vencimiento
    // (dato de gestion, no clinico) para todos los roles.
    const emosProximasFiltrado = emosProximas.rows.map((fila) => {
      if (esMedico) return fila;
      const { aptitud: _aptitud, ...resto } = fila;
      return resto;
    });

    // CORREGIDO en Auditoria N.14 (hallazgo GRAVE G14-02, P1): el
    // grafico de REBA promedio/maximo por area no aplicaba ninguna
    // redaccion por grupo pequeño (a diferencia de reportesController.js,
    // que si lo hace desde la Auditoria N.06/N.12). Un area con 1-2
    // trabajadores evaluados exponia en la practica el puntaje
    // ergonomico de una persona identificable disfrazado de
    // "promedio de area". Se redactan las filas cuyo
    // trabajadores_evaluados sea menor al umbral de k-anonimato,
    // dejando visible unicamente que el area existe.
    const rebaPorAreaRedactado = redactarFilasPorGrupoPequeno(
      rebaPorArea.rows,
      (fila) => parseInt(fila.trabajadores_evaluados, 10),
      'area'
    );

    // CORREGIDO en Auditoria N.14 (G14-02): si la organizacion
    // COMPLETA tiene menos trabajadores activos que el umbral de
    // k-anonimato, la distribucion de aptitud por categoria
    // ("1 apto, 0 no aptos") equivale a revelar la aptitud de una
    // persona identificable -- se redacta el desglose y se deja
    // solo el total ya visible en totalTrabajadores.
    const totalTrabajadoresActivos = parseInt(trabajadores.rows[0].total, 10);
    const distribucionAptitudRedactada = esGrupoPequeno(totalTrabajadoresActivos)
      ? [{ redactado: true, nota: `Desglose oculto: la organización tiene ${totalTrabajadoresActivos} trabajador(es) activo(s), menos del mínimo requerido para mostrar la distribución sin riesgo de identificar a una persona en particular.` }]
      : aptitud.rows;

    return res.json({
      totalTrabajadores: totalTrabajadoresActivos,
      distribucionAptitud: distribucionAptitudRedactada,
      rebaPorArea: rebaPorAreaRedactado,
      emosProximas: emosProximasFiltrado,
      consentimientosRecientes: consentimientosRecientes.rows,
      rulaResumen: rulaResumen.rows,
      actividadReciente: actividadReciente.rows,
    });

  } catch (err) {
    console.error('Error en obtenerResumen (dashboard):', err);
    return res.status(500).json({ error: 'Error interno al obtener el resumen del dashboard.' });
  }
}

module.exports = { obtenerResumen };
