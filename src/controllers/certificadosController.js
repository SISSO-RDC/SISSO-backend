// ============================================================
// Controlador de Certificados PDF.
//
// Reune la emision de 2 de los 3 tipos de certificado acordados
// con el cliente (el tercero, HCU 081, ya existia y se genera
// desde historiaClinicaController.descargarCertificado -
// GET /api/historia-clinica/:id/certificado - porque es un
// documento derivado de una evaluacion clinica especifica, no
// tiene sentido duplicarlo aqui):
//
//   - Certificado de asistencia a capacitacion (por trabajador,
//     dentro de una capacitacion ya registrada).
//   - Certificado de aptitud independiente (estado actual de
//     trabajadores.aptitud, sin requerir una evaluacion HCU077
//     completa).
// ============================================================
const { query } = require('../db/pool');
const { generarPdfCertificadoCapacitacion } = require('../capacitaciones/pdfCertificadoCapacitacion');
const { generarPdfCertificadoAptitud } = require('../certificados/pdfCertificadoAptitud');
const { registrarAuditoria } = require('../utils/auditoria');

// ------------------------------------------------------------
// GET /api/certificados/capacitacion/:capacitacionId/trabajador/:trabajadorId
// ------------------------------------------------------------
async function certificadoCapacitacion(req, res) {
  const orgId = req.usuario.organizacionId;
  const { capacitacionId, trabajadorId } = req.params;

  try {
    const capacitacionRes = await query(
      `SELECT * FROM capacitaciones WHERE id = $1 AND organizacion_id = $2`,
      [capacitacionId, orgId]
    );
    if (capacitacionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Capacitación no encontrada.' });
    }

    const asistenciaRes = await query(
      `SELECT t.nombre_completo, t.documento
       FROM capacitaciones_asistentes a
       JOIN trabajadores t ON t.id = a.trabajador_id
       WHERE a.capacitacion_id = $1 AND a.trabajador_id = $2 AND t.organizacion_id = $3`,
      [capacitacionId, trabajadorId, orgId]
    );
    if (asistenciaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Este trabajador no está registrado como asistente de esta capacitación.' });
    }

    const orgRes = await query(`SELECT nombre FROM organizaciones WHERE id = $1`, [orgId]);

    const doc = generarPdfCertificadoCapacitacion(
      { capacitacion: capacitacionRes.rows[0], trabajador: asistenciaRes.rows[0] },
      orgRes.rows[0]?.nombre
    );

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id,
      accion: 'generar_certificado_capacitacion', entidad: 'capacitacion', entidadId: capacitacionId, req,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="certificado-capacitacion-${asistenciaRes.rows[0].documento}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error('Error en certificadoCapacitacion:', err);
    return res.status(500).json({ error: 'Error interno al generar el certificado.' });
  }
}

// ------------------------------------------------------------
// GET /api/certificados/aptitud/:trabajadorId
// ------------------------------------------------------------
async function certificadoAptitud(req, res) {
  const orgId = req.usuario.organizacionId;

  try {
    const trabajadorRes = await query(
      `SELECT nombre_completo, documento, area, puesto, aptitud, fecha_vencimiento
       FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [req.params.trabajadorId, orgId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    const orgRes = await query(`SELECT nombre FROM organizaciones WHERE id = $1`, [orgId]);
    const doc = generarPdfCertificadoAptitud(trabajadorRes.rows[0], orgRes.rows[0]?.nombre);

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id,
      accion: 'generar_certificado_aptitud', entidad: 'trabajador', entidadId: req.params.trabajadorId, req,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="certificado-aptitud-${trabajadorRes.rows[0].documento}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error('Error en certificadoAptitud:', err);
    return res.status(500).json({ error: 'Error interno al generar el certificado.' });
  }
}

module.exports = { certificadoCapacitacion, certificadoAptitud };
