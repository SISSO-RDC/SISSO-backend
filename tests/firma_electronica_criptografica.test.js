// ============================================================
// Prueba de extremo a extremo del motor de firma electronica
// CRIPTOGRAFICA (src/utils/firmaElectronicaCriptografica.js), que es
// un concepto distinto de la "firma electronica" (imagen en canvas)
// de consentimientos_firmados.metodo_firma.
//
// NO requiere Postgres: genera su propio certificado .p12 de prueba
// (autofirmado, con node-forge) y su propio PDF de prueba (con
// pdfkit), y verifica el ciclo completo:
//   1) el .p12 se abre correctamente con la passphrase correcta
//   2) una passphrase incorrecta es rechazada con un mensaje claro
//   3) un certificado ya vencido es rechazado al intentar registrarlo
//   4) el PDF resultante tiene una firma PKCS#7 real embebida
//   5) LO MAS IMPORTANTE: el digest que la firma dice haber firmado
//      coincide EXACTAMENTE con un SHA-256 calculado de forma
//      independiente sobre los bytes reales del PDF (via /ByteRange).
//      Sin este paso, una firma podria "verse valida" sin proteger
//      en realidad el contenido del documento.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const forge = require('node-forge');
const PDFDocument = require('pdfkit');
const {
  validarYLeerCertificado, firmarPdf, diasHastaVencimiento,
} = require('../src/utils/firmaElectronicaCriptografica');

function generarP12DePrueba({ cn = 'DR JUAN PRUEBA PEREZ', diasValidez = 365, passphrase = 'clave-prueba-123' } = {}) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + diasValidez * 24 * 60 * 60 * 1000);
  const attrs = [{ name: 'commonName', value: cn }, { name: 'countryName', value: 'EC' }];
  cert.setSubject(attrs);
  cert.setIssuer([{ name: 'commonName', value: 'AC DE PRUEBA SISSO' }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, { algorithm: '3des' });
  const p12Buffer = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
  return { p12Buffer, passphrase, cn };
}

async function generarPdfDePrueba() {
  const doc = new PDFDocument();
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const listo = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.fontSize(14).text('Documento de prueba SISSO');
  doc.end();
  return listo;
}

test('firmaElectronicaCriptografica: abre un .p12 valido y lee sus metadatos', () => {
  const { p12Buffer, passphrase, cn } = generarP12DePrueba();
  const info = validarYLeerCertificado(p12Buffer, passphrase);
  assert.equal(info.titularCn, cn);
  assert.equal(info.emisorCn, 'AC DE PRUEBA SISSO');
  assert.ok(info.fechaVencimiento instanceof Date);
  assert.ok(info.fechaVencimiento.getTime() > Date.now());
});

test('firmaElectronicaCriptografica: rechaza una passphrase incorrecta con mensaje claro', () => {
  const { p12Buffer } = generarP12DePrueba();
  assert.throws(
    () => validarYLeerCertificado(p12Buffer, 'contraseña-equivocada'),
    /no se pudo abrir el archivo \.p12/i
  );
});

test('firmaElectronicaCriptografica: rechaza un certificado ya vencido', () => {
  const { p12Buffer, passphrase } = generarP12DePrueba({ diasValidez: -10 }); // vencio hace 10 dias
  assert.throws(
    () => validarYLeerCertificado(p12Buffer, passphrase),
    /venció/i
  );
});

test('firmaElectronicaCriptografica: firma un PDF y el digest firmado coincide con el contenido real (verificacion criptografica completa)', async () => {
  const { p12Buffer, passphrase, cn } = generarP12DePrueba();
  const pdfOriginal = await generarPdfDePrueba();

  const pdfFirmado = await firmarPdf(pdfOriginal, p12Buffer, passphrase, { nombreFirmante: cn });
  assert.ok(pdfFirmado.length > pdfOriginal.length, 'el PDF firmado debe ser mas grande (incluye la firma embebida)');

  const textoFirmado = pdfFirmado.toString('latin1');

  // El /Contents no debe quedar como placeholder sin usar (todo ceros).
  const matchContents = textoFirmado.match(/\/Contents\s*<([0-9A-Fa-f]+)>/);
  assert.ok(matchContents, 'debe existir un campo /Contents con la firma');
  assert.ok(!/^0+$/.test(matchContents[1]), 'el /Contents no debe quedar vacio (todo ceros)');

  // Verificacion real: el digest que firma declara haber firmado DEBE
  // coincidir con un SHA-256 calculado por nosotros mismos sobre los
  // bytes exactos que indica /ByteRange.
  const matchByteRange = textoFirmado.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
  assert.ok(matchByteRange, 'debe existir /ByteRange en el PDF firmado');
  const [r1, r2, r3, r4] = matchByteRange.slice(1).map(Number);
  assert.equal(r3 + r4, pdfFirmado.length, 'el ByteRange debe cubrir el PDF completo (salvo el placeholder de /Contents)');

  const contenidoRealmenteFirmado = Buffer.concat([
    pdfFirmado.subarray(r1, r1 + r2),
    pdfFirmado.subarray(r3, r3 + r4),
  ]);
  const hashCalculadoPorNosotros = forge.md.sha256.create();
  hashCalculadoPorNosotros.update(contenidoRealmenteFirmado.toString('binary'));
  const hashEsperado = hashCalculadoPorNosotros.digest().toHex();

  const p7Der = Buffer.from(matchContents[1], 'hex').toString('binary');
  const p7Asn1 = forge.asn1.fromDer(p7Der, { strict: false, parseAllBytes: false });
  const p7 = forge.pkcs7.messageFromAsn1(p7Asn1);

  let digestFirmado = null;
  for (const attr of p7.rawCapture.authenticatedAttributes) {
    const oid = forge.asn1.derToOid(attr.value[0].value);
    if (oid === forge.pki.oids.messageDigest) {
      digestFirmado = forge.util.bytesToHex(attr.value[1].value[0].value);
      break;
    }
  }
  assert.ok(digestFirmado, 'la firma debe tener el atributo messageDigest');
  assert.equal(digestFirmado, hashEsperado, 'el digest firmado DEBE coincidir con el contenido real del PDF -- si no, la firma no protege el documento');

  // El certificado embebido en la firma debe ser el mismo que se uso para firmar.
  const cnEnFirma = p7.certificates[0].subject.getField('CN').value;
  assert.equal(cnEnFirma, cn);
});

test('firmaElectronicaCriptografica: rechaza firmar con una passphrase que ya no coincide (ej. si el .p12 cambio)', async () => {
  const { p12Buffer } = generarP12DePrueba({ passphrase: 'clave-correcta' });
  const pdfOriginal = await generarPdfDePrueba();
  await assert.rejects(
    () => firmarPdf(pdfOriginal, p12Buffer, 'clave-incorrecta', { nombreFirmante: 'Alguien' }),
    /contraseña guardada para este certificado ya no es válida/i
  );
});

test('diasHastaVencimiento: calcula dias restantes correctamente', () => {
  const en10Dias = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  assert.ok(diasHastaVencimiento(en10Dias) >= 9 && diasHastaVencimiento(en10Dias) <= 10);

  const hace5Dias = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  assert.ok(diasHastaVencimiento(hace5Dias) < 0);
});
