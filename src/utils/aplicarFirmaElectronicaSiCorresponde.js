// ============================================================
// Helper reusable (Oct 2026): dado un PDF ya generado y la persona
// que lo firma, aplica la firma electronica CRIPTOGRAFICA si esa
// persona tiene un certificado .p12 cargado, vigente, y activado
// ("usar esta firma automaticamente"). Si no, devuelve el PDF sin
// tocar -- el comportamiento de siempre para quien no usa esto.
//
// Centraliza aqui la logica de "buscar certificado -> verificar
// vigencia -> descifrar -> firmar -> registrar el uso" para que cada
// controlador que genera un PDF (certificados de aptitud,
// capacitacion, restricciones, consentimientos, etc.) la reutilice
// con una sola llamada, en vez de reimplementarla cada vez.
//
// Decision de diseño: si la firma falla por un motivo inesperado
// (no por falta de certificado, que es el caso normal), el documento
// se entrega SIN FIRMAR en vez de bloquear su generacion -- un
// certificado de aptitud, por ejemplo, puede ser necesario de forma
// urgente. El fallo queda registrado en firmas_electronicas_usos y
// en consola para que se note y se corrija, pero nunca le impide a
// un medico emitir un documento clinico.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { desencriptar } = require('./crypto');
const { firmarPdf, diasHastaVencimiento } = require('./firmaElectronicaCriptografica');

const VARIABLE_CLAVE = 'FIRMA_ELECTRONICA_ENCRYPTION_KEY';

/**
 * @param {Buffer} pdfBuffer - PDF ya generado (pdfkit u otro).
 * @param {string|null|undefined} usuarioFirmanteId - quien firma (ej. el medico de la evaluacion). Si es null, no se intenta firmar.
 * @param {string} organizacionId
 * @param {{ documentoTipo: string, documentoId?: string, req?: object }} contexto
 * @returns {Promise<Buffer>} el PDF firmado, o el original sin cambios si no corresponde firmar.
 */
async function aplicarFirmaElectronicaSiCorresponde(pdfBuffer, usuarioFirmanteId, organizacionId, contexto) {
  if (!usuarioFirmanteId) return pdfBuffer;

  let certRes;
  try {
    certRes = await query(
      `SELECT id, certificado_p12_cifrado, passphrase_cifrada, titular_cn, fecha_vencimiento
       FROM firmas_electronicas_usuario WHERE usuario_id = $1 AND activo = true`,
      [usuarioFirmanteId]
    );
  } catch (err) {
    // Ej.: la migracion 103 aun no se aplico en esta base, o un fallo
    // transitorio de conexion. La firma es OPCIONAL: nunca debe impedir
    // que un medico emita un documento clinico. Se entrega sin firmar y
    // se deja el motivo en el log del servidor.
    console.error(`Firma electronica: no se pudo consultar el certificado de ${usuarioFirmanteId} al generar ${contexto.documentoTipo}. Documento entregado SIN FIRMAR. Motivo:`, err.message);
    return pdfBuffer;
  }
  if (certRes.rows.length === 0) return pdfBuffer; // no tiene certificado activo -- comportamiento normal, sin cambios

  const cert = certRes.rows[0];

  const registrarUso = async (exitoso, errorDetalle) => {
    try {
      await withTransaction((client) => client.query(
        `INSERT INTO firmas_electronicas_usos (firma_electronica_id, organizacion_id, documento_tipo, documento_id, exitoso, error_detalle)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [cert.id, organizacionId, contexto.documentoTipo, contexto.documentoId || null, exitoso, errorDetalle || null]
      ));
    } catch (errLog) {
      console.error('No se pudo registrar el uso de la firma electronica (el documento continua su flujo normal):', errLog);
    }
  };

  if (diasHastaVencimiento(cert.fecha_vencimiento) < 0) {
    await registrarUso(false, 'El certificado ya venció al momento de intentar firmar.');
    console.error(`Firma electronica: certificado vencido para usuario ${usuarioFirmanteId} al generar ${contexto.documentoTipo}. Documento entregado SIN FIRMAR.`);
    return pdfBuffer;
  }

  try {
    const p12Buffer = Buffer.from(desencriptar(cert.certificado_p12_cifrado, VARIABLE_CLAVE), 'base64');
    const passphrase = desencriptar(cert.passphrase_cifrada, VARIABLE_CLAVE);
    const pdfFirmado = await firmarPdf(pdfBuffer, p12Buffer, passphrase, {
      nombreFirmante: cert.titular_cn,
      razon: `Documento emitido por SISSO -- ${contexto.documentoTipo}`,
    });
    await registrarUso(true, null);
    return pdfFirmado;
  } catch (err) {
    await registrarUso(false, err.message);
    console.error(`Firma electronica: fallo al firmar ${contexto.documentoTipo} para usuario ${usuarioFirmanteId}. Documento entregado SIN FIRMAR. Motivo:`, err);
    return pdfBuffer;
  }
}

/**
 * Convierte un documento pdfkit (que normalmente se streamea directo a la
 * respuesta HTTP con doc.pipe(res)) en un Buffer completo. Es un paso
 * obligatorio antes de poder firmar electronicamente: la firma
 * criptografica necesita el PDF completo para calcular su hash, no se
 * puede firmar un documento a medio generar.
 * @param {PDFKit.PDFDocument} doc - ya con todo su contenido dibujado, SIN llamar a doc.end() todavia.
 * @returns {Promise<Buffer>}
 */
function pdfkitDocToBuffer(doc) {
  const chunks = [];
  const listo = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.end();
  return listo;
}

module.exports = { aplicarFirmaElectronicaSiCorresponde, pdfkitDocToBuffer };
