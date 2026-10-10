// ============================================================
// Controlador de Firma Electronica CRIPTOGRAFICA (Oct 2026).
//
// Distinto del "metodo_firma" de consentimientos_firmados (esa es
// una imagen de canvas). Esto es un certificado X.509 + llave
// privada real (.p12), usado para firmar digitalmente PDFs
// (PKCS#7/CMS) con validez legal.
//
// Es personal: cada usuario gestiona SU PROPIO certificado (no el
// admin de la organizacion en nombre de otros) -- por eso todos los
// endpoints operan sobre req.usuario.id, nunca sobre un :id de la URL.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { analizarDataUri } = require('../utils/validarArchivo');
const { validarYLeerCertificado, diasHastaVencimiento, MAX_DIAS_ANTICIPACION_AVISO_VENCIMIENTO } = require('../utils/firmaElectronicaCriptografica');
const { encriptar } = require('../utils/crypto');

const VARIABLE_CLAVE = 'FIRMA_ELECTRONICA_ENCRYPTION_KEY';

// ------------------------------------------------------------
// GET /api/firma-electronica/mi-certificado
// ------------------------------------------------------------
async function obtenerMiCertificado(req, res) {
  try {
    const resultado = await query(
      `SELECT id, titular_cn, emisor_cn, numero_serie, fecha_emision, fecha_vencimiento, activo, creado_en
       FROM firmas_electronicas_usuario WHERE usuario_id = $1`,
      [req.usuario.id]
    );
    if (resultado.rows.length === 0) return res.json({ certificado: null });

    const cert = resultado.rows[0];
    const diasRestantes = diasHastaVencimiento(cert.fecha_vencimiento);
    return res.json({
      certificado: {
        ...cert,
        diasHastaVencimiento: diasRestantes,
        porVencer: diasRestantes <= MAX_DIAS_ANTICIPACION_AVISO_VENCIMIENTO,
        vencido: diasRestantes < 0,
      },
    });
  } catch (err) {
    console.error('Error en obtenerMiCertificado (firma electronica):', err);
    return res.status(500).json({ error: 'Error interno al obtener el certificado.' });
  }
}

// ------------------------------------------------------------
// POST /api/firma-electronica/cargar
// Body: { archivoBase64 (el .p12), passphrase }
// Reemplaza cualquier certificado anterior del mismo usuario.
// ------------------------------------------------------------
async function cargarCertificado(req, res) {
  const { archivoBase64, passphrase } = req.body;

  if (!archivoBase64) return res.status(400).json({ error: 'archivoBase64 (el archivo .p12) es obligatorio.' });
  if (!passphrase || typeof passphrase !== 'string') return res.status(400).json({ error: 'passphrase es obligatoria.' });

  const chkArchivo = analizarDataUri(archivoBase64, 'certificado_p12');
  if (!chkArchivo.ok) return res.status(400).json({ error: `archivoBase64 invalido: ${chkArchivo.motivo}` });

  const p12Buffer = Buffer.from(archivoBase64.split(',')[1], 'base64');

  let infoCertificado;
  try {
    infoCertificado = validarYLeerCertificado(p12Buffer, passphrase);
  } catch (err) {
    // Mensaje tal cual: validarYLeerCertificado ya redacta errores claros
    // y seguros para mostrar (passphrase incorrecta, certificado vencido, etc.).
    return res.status(400).json({ error: err.message });
  }

  try {
    const p12CifradoBase64 = p12Buffer.toString('base64');
    const resultado = await withTransaction(async (client) => {
      const r = await client.query(
        `INSERT INTO firmas_electronicas_usuario
          (usuario_id, organizacion_id, certificado_p12_cifrado, passphrase_cifrada,
           titular_cn, emisor_cn, numero_serie, fecha_emision, fecha_vencimiento, activo, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$1)
         ON CONFLICT (usuario_id) DO UPDATE SET
           certificado_p12_cifrado = EXCLUDED.certificado_p12_cifrado,
           passphrase_cifrada = EXCLUDED.passphrase_cifrada,
           titular_cn = EXCLUDED.titular_cn, emisor_cn = EXCLUDED.emisor_cn,
           numero_serie = EXCLUDED.numero_serie, fecha_emision = EXCLUDED.fecha_emision,
           fecha_vencimiento = EXCLUDED.fecha_vencimiento,
           activo = false, -- cada vez que se reemplaza el certificado, la persona debe volver a activarlo a proposito
           actualizado_en = now()
         RETURNING id, titular_cn, fecha_vencimiento`,
        [
          req.usuario.id, req.usuario.organizacionId,
          encriptar(p12CifradoBase64, VARIABLE_CLAVE), encriptar(passphrase, VARIABLE_CLAVE),
          infoCertificado.titularCn, infoCertificado.emisorCn, infoCertificado.numeroSerie,
          infoCertificado.fechaEmision, infoCertificado.fechaVencimiento,
        ]
      );

      await registrarAuditoria({
        organizacionId: req.usuario.organizacionId, usuarioId: req.usuario.id, accion: 'firma_electronica_certificado_cargado',
        entidad: 'firmas_electronicas_usuario', entidadId: r.rows[0].id,
        detalle: { titularCn: infoCertificado.titularCn, fechaVencimiento: infoCertificado.fechaVencimiento }, req, client,
      });
      return r;
    });

    return res.status(201).json({ certificado: resultado.rows[0] });
  } catch (err) {
    console.error('Error en cargarCertificado (firma electronica):', err);
    return res.status(500).json({ error: 'Error interno al guardar el certificado.' });
  }
}

// ------------------------------------------------------------
// PATCH /api/firma-electronica/activar
// Body: { activo: true|false } -- la casilla "usar esta firma automaticamente".
// ------------------------------------------------------------
async function cambiarActivacion(req, res) {
  const { activo } = req.body;
  if (typeof activo !== 'boolean') return res.status(400).json({ error: 'activo debe ser true o false.' });

  try {
    const actual = await query(`SELECT id, fecha_vencimiento FROM firmas_electronicas_usuario WHERE usuario_id = $1`, [req.usuario.id]);
    if (actual.rows.length === 0) return res.status(404).json({ error: 'No tienes ningún certificado cargado todavía.' });

    if (activo && diasHastaVencimiento(actual.rows[0].fecha_vencimiento) < 0) {
      return res.status(400).json({ error: 'Tu certificado ya venció. Carga uno vigente antes de activarlo.' });
    }

    const resultado = await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE firmas_electronicas_usuario SET activo = $1, actualizado_en = now() WHERE usuario_id = $2 RETURNING id, activo`,
        [activo, req.usuario.id]
      );
      await registrarAuditoria({
        organizacionId: req.usuario.organizacionId, usuarioId: req.usuario.id,
        accion: activo ? 'firma_electronica_activada' : 'firma_electronica_desactivada',
        entidad: 'firmas_electronicas_usuario', entidadId: actual.rows[0].id, detalle: {}, req, client,
      });
      return r;
    });

    return res.json({ certificado: resultado.rows[0] });
  } catch (err) {
    console.error('Error en cambiarActivacion (firma electronica):', err);
    return res.status(500).json({ error: 'Error interno al cambiar el estado del certificado.' });
  }
}

// ------------------------------------------------------------
// DELETE /api/firma-electronica/mi-certificado
// ------------------------------------------------------------
async function eliminarCertificado(req, res) {
  try {
    const resultado = await withTransaction(async (client) => {
      const r = await client.query(`DELETE FROM firmas_electronicas_usuario WHERE usuario_id = $1 RETURNING id`, [req.usuario.id]);
      if (r.rows.length === 0) return r;
      await registrarAuditoria({
        organizacionId: req.usuario.organizacionId, usuarioId: req.usuario.id, accion: 'firma_electronica_certificado_eliminado',
        entidad: 'firmas_electronicas_usuario', entidadId: r.rows[0].id, detalle: {}, req, client,
      });
      return r;
    });
    if (resultado.rows.length === 0) return res.status(404).json({ error: 'No tienes ningún certificado cargado.' });
    return res.json({ eliminado: true });
  } catch (err) {
    console.error('Error en eliminarCertificado (firma electronica):', err);
    return res.status(500).json({ error: 'Error interno al eliminar el certificado.' });
  }
}

module.exports = { obtenerMiCertificado, cargarCertificado, cambiarActivacion, eliminarCertificado };
