// ============================================================
// SISSO - Motor de firma electronica CRIPTOGRAFICA (Oct 2026).
//
// NO confundir con la "firma electronica" que ya existia en
// consentimientos_firmados.metodo_firma (migration_013) -- esa es
// una imagen dibujada en un canvas. Esto es una firma digital real
// (PKCS#7/CMS) sobre el PDF completo, usando el certificado X.509 +
// llave privada de un archivo .p12 que la persona usuaria carga.
//
// Ciclo verificado manualmente antes de integrar este modulo (ver
// notas de la conversacion): .p12 -> abrir con passphrase -> firmar
// PDF generado con pdfkit -> extraer el PKCS#7 embebido -> recalcular
// el SHA-256 real sobre los bytes exactos que indica /ByteRange ->
// confirmar que coincide con el digest que la firma dice haber
// firmado. Las 4 librerias que hacen el trabajo pesado:
//   - node-forge: parsear el .p12, extraer certificado/llave privada.
//   - pdf-lib: agregar el campo de firma (placeholder) al PDF.
//   - @signpdf/placeholder-pdf-lib: calcula el placeholder correcto.
//   - @signpdf/signpdf + @signpdf/signer-p12: arma la firma real.
// ============================================================
const forge = require('node-forge');
const { PDFDocument: PDFLibDocument } = require('pdf-lib');
const signpdf = require('@signpdf/signpdf').default || require('@signpdf/signpdf');
const { P12Signer } = require('@signpdf/signer-p12');
const { pdflibAddPlaceholder } = require('@signpdf/placeholder-pdf-lib');

const MAX_DIAS_ANTICIPACION_AVISO_VENCIMIENTO = 30;

/**
 * Abre un .p12 con su passphrase y devuelve los metadatos del
 * certificado (sin devolver la llave privada -- el llamador no la
 * necesita fuera de esta funcion). Lanza un error con mensaje claro
 * si la passphrase es incorrecta o el archivo no es un .p12 valido.
 *
 * @param {Buffer} p12Buffer
 * @param {string} passphrase
 * @returns {{ titularCn: string, emisorCn: string|null, numeroSerie: string, fechaEmision: Date, fechaVencimiento: Date }}
 */
function validarYLeerCertificado(p12Buffer, passphrase) {
  let p12Parsed;
  try {
    const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
    p12Parsed = forge.pkcs12.pkcs12FromAsn1(p12Asn1, passphrase);
  } catch (err) {
    throw new Error(
      'No se pudo abrir el archivo .p12: el archivo esta dañado, no es un certificado .p12 valido, '
      + 'o la contraseña es incorrecta.'
    );
  }

  const bagsCert = p12Parsed.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = (bagsCert[forge.pki.oids.certBag] || [])[0];
  if (!certBag || !certBag.cert) {
    throw new Error('El archivo .p12 se abrió correctamente pero no contiene ningún certificado.');
  }
  const bagsKey = p12Parsed.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag = (bagsKey[forge.pki.oids.pkcs8ShroudedKeyBag] || [])[0];
  if (!keyBag || !keyBag.key) {
    throw new Error('El archivo .p12 contiene un certificado pero no una llave privada -- no se puede firmar con él.');
  }

  const cert = certBag.cert;
  const campoCn = cert.subject.getField('CN');
  const campoCnEmisor = cert.issuer.getField('CN');
  const fechaVencimiento = cert.validity.notAfter;

  if (fechaVencimiento.getTime() < Date.now()) {
    throw new Error(`Este certificado venció el ${fechaVencimiento.toLocaleDateString('es-EC')}. No se puede registrar un certificado ya vencido.`);
  }

  return {
    titularCn: campoCn ? campoCn.value : 'Desconocido',
    emisorCn: campoCnEmisor ? campoCnEmisor.value : null,
    numeroSerie: cert.serialNumber,
    fechaEmision: cert.validity.notBefore,
    fechaVencimiento,
  };
}

/**
 * Firma digitalmente un PDF (buffer) con un certificado .p12.
 * Devuelve el PDF firmado como Buffer. NO verifica aqui la vigencia
 * del certificado -- eso lo hace el llamador (el controlador) ANTES
 * de llegar a esta funcion, para poder registrar en
 * firmas_electronicas_usos un error claro sin gastar el intento de
 * firma en un certificado que ya sabemos vencido.
 *
 * @param {Buffer} pdfBuffer - PDF ya generado (ej. por pdfkit).
 * @param {Buffer} p12Buffer
 * @param {string} passphrase
 * @param {{ nombreFirmante: string, razon?: string, contacto?: string }} opciones
 * @returns {Promise<Buffer>}
 */
async function firmarPdf(pdfBuffer, p12Buffer, passphrase, opciones) {
  const { nombreFirmante, razon, contacto } = opciones;

  const pdfLibDoc = await PDFLibDocument.load(pdfBuffer);
  pdflibAddPlaceholder({
    pdfDoc: pdfLibDoc,
    reason: razon || 'Documento emitido por SISSO',
    contactInfo: contacto || 'soporte@sisso.ec',
    name: nombreFirmante,
    location: 'Ecuador',
  });
  const pdfConPlaceholder = Buffer.from(await pdfLibDoc.save({ useObjectStreams: false }));

  const signer = new P12Signer(p12Buffer, { passphrase });
  try {
    return await signpdf.sign(pdfConPlaceholder, signer);
  } catch (err) {
    if (/invalid password|mac could not be verified/i.test(err.message || '')) {
      throw new Error('La contraseña guardada para este certificado ya no es válida (¿se cambió la contraseña del certificado?). Vuelve a cargar el archivo .p12 en Mi Perfil.');
    }
    throw err;
  }
}

function diasHastaVencimiento(fechaVencimiento) {
  return Math.ceil((new Date(fechaVencimiento).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

module.exports = {
  validarYLeerCertificado,
  firmarPdf,
  diasHastaVencimiento,
  MAX_DIAS_ANTICIPACION_AVISO_VENCIMIENTO,
};
