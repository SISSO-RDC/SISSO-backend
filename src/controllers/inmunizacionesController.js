// ============================================================
// Controlador de registro de inmunizaciones (HCU 083). Registro
// acumulativo por trabajador, no una evaluacion puntual (ver nota
// completa en migration_018_inmunizaciones.sql).
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

// ------------------------------------------------------------
// POST /api/historia-clinica/trabajadores/:trabajadorId/inmunizaciones
// ------------------------------------------------------------
async function registrarInmunizacion(req, res) {
  const { trabajadorId } = req.params;
  const { vacunaNombre, numeroDosis, fechaAplicacion, lote, esquemaCompleto, establecimientoSalud, responsableNombre, observaciones } = req.body;

  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    const resultado = await query(
      `INSERT INTO registro_inmunizaciones
        (organizacion_id, trabajador_id, registrado_por, vacuna_nombre, numero_dosis, fecha_aplicacion,
         lote, esquema_completo, establecimiento_salud, responsable_nombre, observaciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, vacuna_nombre, numero_dosis, fecha_aplicacion, esquema_completo, creado_en`,
      [
        req.usuario.organizacionId, trabajadorId, req.usuario.id, vacunaNombre, numeroDosis, fechaAplicacion,
        lote || null, !!esquemaCompleto, establecimientoSalud || null, responsableNombre || null, observaciones || null,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'registrar_inmunizacion',
      entidad: 'registro_inmunizacion',
      entidadId: resultado.rows[0].id,
      detalle: { trabajadorId, vacunaNombre, numeroDosis },
      req,
    });

    return res.status(201).json({ inmunizacion: resultado.rows[0] });
  } catch (err) {
    console.error('Error en registrarInmunizacion:', err);
    return res.status(500).json({ error: 'Error interno al registrar la inmunización.' });
  }
}

// ------------------------------------------------------------
// GET /api/historia-clinica/trabajadores/:trabajadorId/inmunizaciones
// ------------------------------------------------------------
async function listarInmunizaciones(req, res) {
  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    const resultado = await query(
      `SELECT i.id, i.vacuna_nombre, i.numero_dosis, i.fecha_aplicacion, i.lote, i.esquema_completo,
              i.establecimiento_salud, i.responsable_nombre, i.observaciones, i.creado_en,
              u.nombre_completo AS registrado_por_nombre
       FROM registro_inmunizaciones i
       JOIN usuarios u ON u.id = i.registrado_por
       WHERE i.trabajador_id = $1 AND i.organizacion_id = $2
       ORDER BY i.fecha_aplicacion DESC`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );

    return res.json({ inmunizaciones: resultado.rows });
  } catch (err) {
    console.error('Error en listarInmunizaciones:', err);
    return res.status(500).json({ error: 'Error interno al listar las inmunizaciones.' });
  }
}

module.exports = { registrarInmunizacion, listarInmunizaciones };
