// Auditoria N.19 (G19-11): validacion estricta de archivos data URI antes de
// subirlos a Cloudinary. Sin base de datos ni red.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { analizarDataUri, validarDataUri, POLITICAS } = require('../src/utils/validarArchivo');

const uri = (mime, bytes) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const JPG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10];
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42')]);

test('G19-11: acepta archivos validos segun la politica', () => {
  assert.equal(analizarDataUri(uri('image/png', PNG), 'firma').ok, true);
  assert.equal(analizarDataUri(uri('image/jpeg', JPG), 'firma').ok, true);
  assert.equal(analizarDataUri(uri('image/webp', WEBP), 'logo').ok, true);
  assert.equal(analizarDataUri(uri('application/pdf', PDF), 'certificado').ok, true);
  const v = analizarDataUri(uri('video/mp4', MP4), 'evidencia');
  assert.equal(v.ok, true);
  assert.equal(v.esVideo, true);
});

test('G19-11: rechaza SVG y tipos no permitidos aunque empiecen con data:image', () => {
  const svg = uri('image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'));
  assert.equal(analizarDataUri(svg, 'firma').ok, false);
  assert.equal(analizarDataUri(svg, 'logo').ok, false);
  assert.equal(analizarDataUri(uri('image/gif', [0x47, 0x49, 0x46, 0x38]), 'logo').ok, false);
});

test('G19-11: rechaza contenido que no corresponde al tipo declarado', () => {
  assert.equal(analizarDataUri(uri('image/png', Buffer.from('<html><script>alert(1)</script>')), 'firma').ok, false);
  assert.equal(analizarDataUri(uri('image/jpeg', PNG), 'firma').ok, false);
  assert.equal(analizarDataUri(uri('application/pdf', PNG), 'certificado').ok, false);
  assert.equal(analizarDataUri(uri('video/mp4', PNG), 'evidencia').ok, false);
});

test('G19-11: el logo publico no admite PDF ni video; la firma no admite video', () => {
  assert.equal(analizarDataUri(uri('application/pdf', PDF), 'logo').ok, false);
  assert.equal(analizarDataUri(uri('video/mp4', MP4), 'firma').ok, false);
  assert.equal(analizarDataUri(uri('application/pdf', PDF), 'evidencia').ok, false);
});

test('G19-11: rechaza URLs remotas, rutas locales y cadenas arbitrarias como "archivo"', () => {
  for (const malo of [
    'https://ejemplo.com/foto.png', 'http://169.254.169.254/latest/meta-data', 'ftp://x/y.png',
    '/etc/passwd', '../../.env', 'C:\\Windows\\win.ini', 'file:///etc/passwd',
    'data:image/png,no-es-base64', 'data:image/png;base64,***', 'cualquier cosa', '',
  ]) {
    assert.equal(analizarDataUri(malo, 'evidencia').ok, false, `debio rechazar: ${malo}`);
  }
  for (const noCadena of [null, undefined, 42, {}, []]) {
    assert.equal(analizarDataUri(noCadena, 'evidencia').ok, false);
  }
});

test('G19-11: aplica el tope de tamano por politica', () => {
  const justo = Buffer.concat([Buffer.from(PNG), Buffer.alloc(POLITICAS.logo.maxBytes - PNG.length)]);
  assert.equal(analizarDataUri(uri('image/png', justo), 'logo').ok, true);
  const grande = Buffer.concat([Buffer.from(PNG), Buffer.alloc(POLITICAS.logo.maxBytes)]);
  const r = analizarDataUri(uri('image/png', grande), 'logo');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /maximo/);
  // El mismo archivo si cabe en una politica mas amplia.
  assert.equal(analizarDataUri(uri('image/png', grande), 'firma').ok, true);
});

test('G19-11: validarDataUri lanza el motivo para express-validator', () => {
  assert.equal(validarDataUri('firma')(uri('image/png', PNG)), true);
  assert.throws(() => validarDataUri('firma')('data:image/svg+xml;base64,PHN2Zz4='), /no permitido/);
});

test('G19-11: politica desconocida es un error de programacion, no un pase libre', () => {
  assert.throws(() => analizarDataUri(uri('image/png', PNG), 'inexistente'), /desconocida/);
});

test('G19-11: ningun flujo vuelve a validar solo por el prefijo "data:image"', () => {
  const RAIZ = path.join(__dirname, '..', 'src');
  const hallazgos = [];
  (function recorrer(dir) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) { recorrer(p); continue; }
      if (!f.endsWith('.js')) continue;
      const codigo = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/startsWith\(\s*['"]data:(image|video|application)/.test(codigo)) hallazgos.push(path.relative(RAIZ, p));
    }
  })(RAIZ);
  assert.deepEqual(hallazgos, [], `validan solo por prefijo: ${hallazgos.join(', ')}`);
});

test('G19-11: subirEvidencia rechaza el archivo invalido ANTES de llamar a Cloudinary', async () => {
  const { subirEvidencia } = require('../src/servicios/cloudinaryService');
  await assert.rejects(
    () => subirEvidencia('https://ejemplo.com/x.png', 'org-1', 'sisso/prueba', { politica: 'firma' }),
    (e) => e.name === 'ArchivoInvalidoError' && e.status === 400
  );
  await assert.rejects(
    () => subirEvidencia('/etc/passwd', 'org-1'),
    (e) => e.name === 'ArchivoInvalidoError'
  );
});
