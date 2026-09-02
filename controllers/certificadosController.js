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
//     dentro de una capacitacion ya registrada). Documento de
//     gestion, sin dato clinico: admin/sso/th.
//   - Certificado de aptitud independiente (estado actual de
//     trabajadores.aptitud, sin requerir una evaluacion HCU077
//     completa). CORREGIDO (Auditoria N.07, C3): revela un dato
//     clinico individual, asi que certificadosRoutes.js ahora
//     restringe este endpoint a medico unicamente.
// ============================================================
const { query } = require('../db/pool');
const { generarPdfCertificadoCapacitacion } = require('../capacitaciones/pdfCertificadoCapacitacion');
const { generarPdfCertificadoAptitud } = require('../certificados/pdfCertificadoAptitud');
const { registrarAuditoria } = require('../utils/auditoria');
const { obtenerLogoBuffer } = require('../utils/logoPdf');
const { obtenerFirmaParaPdf } = require('../utils/firmaPdf');

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

    const orgRes = await query(`SELECT nombre, logo_url FROM organizaciones WHERE id = $1`, [orgId]);
    // CREADO a pedido de la persona usuaria (02/09/2026): logo de la
    // organizacion como marca de agua de fondo (ver src/utils/logoPdf.js).
    const logoBuffer = await obtenerLogoBuffer(orgRes.rows[0]?.logo_url);
    // Firma digital de quien dicto/registro la capacitacion: prioriza
    // el instructor interno (instructor_usuario_id) si esta vinculado
    // a un usuario del sistema; si no, usa quien la registro (creado_por).
    const capacitacion = capacitacionRes.rows[0];
    const firma = await obtenerFirmaParaPdf(capacitacion.instructor_usuario_id || capacitacion.creado_por, orgId);

    const doc = generarPdfCertificadoCapacitacion(
      { capacitacion: capacitacionRes.rows[0], trabajador: asistenciaRes.rows[0] },
      orgRes.rows[0]?.nombre,
      logoBuffer,
      firma
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

    const orgRes = await query(`SELECT nombre, logo_url FROM organizaciones WHERE id = $1`, [orgId]);
    const logoBuffer = await obtenerLogoBuffer(orgRes.rows[0]?.logo_url);
    // Firma digital del medico que respalda la ultima evaluacion de
    // aptitud registrada para este trabajador.
    const ultimaEvaluacionRes = await query(
      `SELECT medico_id FROM historial_aptitud_medica
       WHERE trabajador_id = $1 AND organizacion_id = $2
       ORDER BY creado_en DESC LIMIT 1`,
      [req.params.trabajadorId, orgId]
    );
    const firma = await obtenerFirmaParaPdf(ultimaEvaluacionRes.rows[0]?.medico_id, orgId);
    const doc = generarPdfCertificadoAptitud(trabajadorRes.rows[0], orgRes.rows[0]?.nombre, logoBuffer, firma);

    // CORREGIDO en Auditoria N.12 (hallazgo GRAVE G12-05, P1): el
    // certificado de aptitud es un documento clinico.
    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id,
      accion: 'generar_certificado_aptitud', entidad: 'trabajador', entidadId: req.params.trabajadorId, req,
      lecturaSensible: true,
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
