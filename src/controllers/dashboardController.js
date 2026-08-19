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
// ============================================================
const { query } = require('../db/pool');

async function obtenerResumen(req, res) {
  const orgId = req.usuario.organizacionId;

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

      // 2. Distribucion de aptitud
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

      // 7. Actividad reciente: ultimas 5 evaluaciones (REBA o RULA) + aptitudes
      query(
        `SELECT 'reba' AS tipo, e.nombre_postura AS descripcion,
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
         LIMIT 8`,
        [orgId]
      ),
    ]);

    // CORREGIDO tras auditoria de seguridad: "emosProximas" incluye el
    // nombre del trabajador junto a su aptitud medica individual. Esa
    // combinacion (identidad + dato clinico) solo debe llegar a roles
    // que ya manejan informacion clinica (medico, sso), no a roles
    // puramente administrativos/organizacionales (admin, th), que
    // segun la arquitectura de roles de SISSO nunca deben ver aptitud
    // individual de un trabajador nombrado. Se mantiene la fecha de
    // vencimiento (es un dato de gestion, no clinico) para todos los
    // roles, y se oculta solo el campo "aptitud" para admin/th.
    const rolPuedeVerAptitudIndividual = ['medico', 'sso'].includes(req.usuario.rol);
    const emosProximasFiltrado = emosProximas.rows.map((fila) => {
      if (rolPuedeVerAptitudIndividual) return fila;
      const { aptitud, ...resto } = fila;
      return resto;
    });

    return res.json({
      totalTrabajadores: parseInt(trabajadores.rows[0].total, 10),
      distribucionAptitud: aptitud.rows,
      rebaPorArea: rebaPorArea.rows,
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
