// ============================================================
// Pruebas de la politica SCA del CI (scripts/ci_sca_audit.js).
// No requieren Postgres ni red.
//
// 1) Logica del evaluador: misma politica que `npm audit
//    --audit-level=high` (falla con alta/critica), con excepciones
//    SOLO por ID explicito.
// 2) GUARD de la excepcion de node-forge (GHSA-86w9-cpqp-85rv): esa
//    excepcion se justifica porque SISSO no verifica firmas RSA con
//    node-forge. Si algun archivo de src/ que usa node-forge empieza a
//    llamar a funciones de verificacion, la justificacion deja de ser
//    cierta y este test falla para forzar una revision.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { evaluarAuditoria, extraerAdvisories, EXCEPCIONES } = require('../scripts/ci_sca_audit');

function auditDe(...advisories) {
  const vulnerabilities = {};
  for (const a of advisories) {
    vulnerabilities[a.paquete] = {
      name: a.paquete, severity: a.severidad,
      via: [{ source: a.source || 1, name: a.paquete, title: a.titulo || 'x', url: `https://github.com/advisories/${a.id}`, severity: a.severidad, range: '*' }],
    };
  }
  return { vulnerabilities };
}

test('SCA: sin hallazgos -> pasa', () => {
  assert.equal(evaluarAuditoria({ vulnerabilities: {} }).ok, true);
});

test('SCA: un hallazgo CRITICO sin excepcion -> falla (caso real proxy-addr)', () => {
  const r = evaluarAuditoria(auditDe({ id: 'GHSA-jqcg-44mw-7w3h', paquete: 'proxy-addr', severidad: 'critical' }));
  assert.equal(r.ok, false);
  assert.equal(r.bloqueantes[0].paquete, 'proxy-addr');
});

test('SCA: un hallazgo ALTO sin excepcion -> falla', () => {
  assert.equal(evaluarAuditoria(auditDe({ id: 'GHSA-aaaa-bbbb-cccc', paquete: 'otro', severidad: 'high' })).ok, false);
});

test('SCA: severidad moderada o baja no bloquea (misma politica que --audit-level=high)', () => {
  assert.equal(evaluarAuditoria(auditDe({ id: 'GHSA-aaaa-bbbb-cccc', paquete: 'otro', severidad: 'moderate' })).ok, true);
  assert.equal(evaluarAuditoria(auditDe({ id: 'GHSA-dddd-eeee-ffff', paquete: 'otro2', severidad: 'low' })).ok, true);
});

test('SCA: SOLO el advisory exceptuado de node-forge -> pasa y queda registrado como exceptuado', () => {
  const r = evaluarAuditoria(auditDe({ id: 'GHSA-86w9-cpqp-85rv', paquete: 'node-forge', severidad: 'high' }));
  assert.equal(r.ok, true);
  assert.equal(r.exceptuados.length, 1);
});

test('SCA: la excepcion NO tapa otros hallazgos -- node-forge exceptuado + un critico nuevo -> falla', () => {
  const r = evaluarAuditoria(auditDe(
    { id: 'GHSA-86w9-cpqp-85rv', paquete: 'node-forge', severidad: 'high' },
    { id: 'GHSA-jqcg-44mw-7w3h', paquete: 'proxy-addr', severidad: 'critical' },
  ));
  assert.equal(r.ok, false);
  assert.deepEqual(r.bloqueantes.map((b) => b.paquete), ['proxy-addr']);
});

test('SCA: paquetes afectados solo "por depender de otro" (via = string) no se cuentan aparte', () => {
  const audit = {
    vulnerabilities: {
      'node-forge': { severity: 'high', via: [{ source: 1, name: 'node-forge', title: 't', url: 'https://github.com/advisories/GHSA-86w9-cpqp-85rv', severity: 'high', range: '<=1.4.0' }] },
      '@signpdf/signer-p12': { severity: 'high', via: ['node-forge'] },
    },
  };
  assert.equal(extraerAdvisories(audit).length, 1);
  assert.equal(evaluarAuditoria(audit).ok, true);
});

test('SCA: una excepcion que ya no corresponde a ningun hallazgo se reporta como obsoleta', () => {
  const r = evaluarAuditoria({ vulnerabilities: {} });
  assert.deepEqual(r.excepcionesObsoletas, ['GHSA-86w9-cpqp-85rv']);
});

test('SCA: toda excepcion declara sin-parche, alcanzabilidad y condicion de salida', () => {
  for (const [id, ex] of Object.entries(EXCEPCIONES)) {
    assert.ok(ex.paquete && ex.paquete.length > 0, `la excepcion ${id} debe indicar el paquete`);
    for (const campo of ['resumen', 'sinParche', 'alcanzabilidad', 'salida']) {
      assert.ok(ex[campo] && ex[campo].length > 20, `la excepcion ${id} debe documentar "${campo}" con una justificacion real`);
    }
  }
});

// ---------- GUARD de la premisa de la excepcion de node-forge ----------
function archivosJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) return archivosJs(ruta);
    return e.name.endsWith('.js') ? [ruta] : [];
  });
}

test('GUARD node-forge: ningun archivo de src/ que use node-forge verifica firmas (premisa de GHSA-86w9-cpqp-85rv)', () => {
  const raiz = path.join(__dirname, '..', 'src');
  const usanForge = archivosJs(raiz).filter((f) => /require\(\s*['"]node-forge['"]\s*\)/.test(fs.readFileSync(f, 'utf8')));
  assert.ok(usanForge.length > 0, 'se esperaba al menos un archivo que use node-forge (firmaElectronicaCriptografica.js)');

  // Funciones de VERIFICACION de node-forge relevantes al advisory.
  const patronesProhibidos = [/\.verify\s*\(/, /\.verifySignature\s*\(/, /\.verifyCertificateChain\s*\(/, /pkcs7\.[A-Za-z]*\.verify/];
  for (const archivo of usanForge) {
    // Se ignoran comentarios de linea para no marcar texto explicativo.
    const codigo = fs.readFileSync(archivo, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const patron of patronesProhibidos) {
      assert.ok(
        !patron.test(codigo),
        `${path.relative(raiz, archivo)} usa node-forge y llama a una funcion de verificacion (${patron}). `
        + 'La excepcion GHSA-86w9-cpqp-85rv de scripts/ci_sca_audit.js se justifica por NO verificar firmas con node-forge: '
        + 'revisa si node-forge ya tiene version corregida o si esa verificacion puede hacerse de otra forma antes de mantener la excepcion.'
      );
    }
  }
});
