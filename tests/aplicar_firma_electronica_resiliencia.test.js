// ============================================================
// Pruebas del helper aplicarFirmaElectronicaSiCorresponde SIN Postgres:
// el modulo de base de datos se reemplaza por uno simulado antes de
// cargar el helper. Garantizan la promesa de diseño: la firma
// electronica es OPCIONAL y NUNCA debe impedir que se entregue un
// documento clinico -- en cualquier falla el PDF sale sin firmar.
// (Cada archivo de test corre en su propio proceso con `node --test`,
// asi que este reemplazo no afecta a otras pruebas.)
// ============================================================
process.env.FIRMA_ELECTRONICA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const test = require('node:test');
const assert = require('node:assert/strict');
const forge = require('node-forge');
const PDFDocument = require('pdfkit');

// --- Pool simulado, controlable desde cada prueba ---
const estado = { query: async () => ({ rows: [] }), usosRegistrados: [] };
const poolPath = require.resolve('../src/db/pool');
require.cache[poolPath] = {
  id: poolPath, filename: poolPath, loaded: true,
  exports: {
    query: (...args) => estado.query(...args),
    withTransaction: async (fn) => fn({
      query: async (sql, params) => { estado.usosRegistrados.push(params); return { rows: [] }; },
    }),
  },
};

const { encriptar } = require('../src/utils/crypto');
const { aplicarFirmaElectronicaSiCorresponde } = require('../src/utils/aplicarFirmaElectronicaSiCorresponde');

const VAR = 'FIRMA_ELECTRONICA_ENCRYPTION_KEY';
const contexto = { documentoTipo: 'certificado_aptitud', documentoId: '00000000-0000-0000-0000-000000000001' };

async function pdfDePrueba() {
  const doc = new PDFDocument();
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const listo = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.text('Documento de prueba');
  doc.end();
  return listo;
}

function p12DePrueba(diasValidez = 365, passphrase = 'clave-123') {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + diasValidez * 86400000);
  const attrs = [{ name: 'commonName', value: 'DRA PRUEBA' }, { name: 'countryName', value: 'EC' }];
  cert.setSubject(attrs); cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, { algorithm: '3des' });
  return { buffer: Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary'), passphrase, vencimiento: cert.validity.notAfter };
}

function filaCertificado({ p12Buffer, passphrase, vencimiento }) {
  return {
    id: 'cert-1', titular_cn: 'DRA PRUEBA', fecha_vencimiento: vencimiento,
    certificado_p12_cifrado: encriptar(p12Buffer.toString('base64'), VAR),
    passphrase_cifrada: encriptar(passphrase, VAR),
  };
}

test.beforeEach(() => {
  estado.query = async () => ({ rows: [] });
  estado.usosRegistrados = [];
});

test('sin firmante (null) -> devuelve el PDF tal cual y ni siquiera consulta la base', async () => {
  let consultas = 0;
  estado.query = async () => { consultas += 1; return { rows: [] }; };
  const pdf = await pdfDePrueba();
  const r = await aplicarFirmaElectronicaSiCorresponde(pdf, null, 'org-1', contexto);
  assert.equal(r, pdf);
  assert.equal(consultas, 0);
});

test('el firmante no tiene certificado activo -> PDF sin cambios (comportamiento de siempre)', async () => {
  const pdf = await pdfDePrueba();
  const r = await aplicarFirmaElectronicaSiCorresponde(pdf, 'usuario-1', 'org-1', contexto);
  assert.equal(r, pdf);
  assert.equal(estado.usosRegistrados.length, 0);
});

test('RESILIENCIA: la consulta falla (ej. migracion 103 aun no aplicada) -> NO lanza error, entrega el PDF sin firmar', async () => {
  estado.query = async () => { throw new Error('relation "firmas_electronicas_usuario" does not exist'); };
  const pdf = await pdfDePrueba();
  const r = await aplicarFirmaElectronicaSiCorresponde(pdf, 'usuario-1', 'org-1', contexto);
  assert.equal(r, pdf);
});

test('certificado vencido -> PDF sin firmar y se registra el intento fallido', async () => {
  const p = p12DePrueba(365);
  const fila = filaCertificado({ p12Buffer: p.buffer, passphrase: p.passphrase, vencimiento: new Date(Date.now() - 5 * 86400000) });
  estado.query = async () => ({ rows: [fila] });
  const pdf = await pdfDePrueba();
  const r = await aplicarFirmaElectronicaSiCorresponde(pdf, 'usuario-1', 'org-1', contexto);
  assert.equal(r, pdf);
  assert.equal(estado.usosRegistrados.length, 1);
  assert.equal(estado.usosRegistrados[0][4], false, 'exitoso debe ser false');
  assert.match(estado.usosRegistrados[0][5], /venció/);
});

test('secreto guardado ilegible (ej. cambio de clave de cifrado) -> PDF sin firmar y se registra el fallo', async () => {
  const p = p12DePrueba();
  const fila = filaCertificado({ p12Buffer: p.buffer, passphrase: p.passphrase, vencimiento: p.vencimiento });
  fila.certificado_p12_cifrado = 'AAAA:BBBB:CCCC'; // basura con el formato iv:tag:datos
  estado.query = async () => ({ rows: [fila] });
  const pdf = await pdfDePrueba();
  const r = await aplicarFirmaElectronicaSiCorresponde(pdf, 'usuario-1', 'org-1', contexto);
  assert.equal(r, pdf);
  assert.equal(estado.usosRegistrados.length, 1);
  assert.equal(estado.usosRegistrados[0][4], false);
});

test('camino feliz: certificado activo y vigente -> PDF FIRMADO de verdad y uso registrado como exitoso', async () => {
  const p = p12DePrueba();
  estado.query = async () => ({ rows: [filaCertificado({ p12Buffer: p.buffer, passphrase: p.passphrase, vencimiento: p.vencimiento })] });
  const pdf = await pdfDePrueba();
  const r = await aplicarFirmaElectronicaSiCorresponde(pdf, 'usuario-1', 'org-1', contexto);

  assert.notEqual(r, pdf);
  assert.ok(r.length > pdf.length);
  const texto = r.toString('latin1');
  assert.match(texto, /\/ByteRange\s*\[/);
  assert.ok(!/^0+$/.test(texto.match(/\/Contents\s*<([0-9A-Fa-f]+)>/)[1]), 'la firma no debe quedar vacia');

  assert.equal(estado.usosRegistrados.length, 1);
  assert.equal(estado.usosRegistrados[0][4], true, 'exitoso debe ser true');
  assert.equal(estado.usosRegistrados[0][2], 'certificado_aptitud');
});
