// Auditoria N.18, G18-09: el TTL del cache de auth (estado de organizacion y
// auth_epoch) es configurable y validado; 0 desactiva el cache (multi-instancia).
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
function cargarAuth(valor) {
  const env = { ...process.env };
  if (valor === undefined) delete env.AUTH_CACHE_TTL_MS; else env.AUTH_CACHE_TTL_MS = valor;
  return spawnSync(process.execPath, ['-e', "require('./src/middleware/auth'); console.log('cargado')"], { cwd: RAIZ, env, encoding: 'utf8' });
}

test('G18-09: valores validos de AUTH_CACHE_TTL_MS (ausente, 0, 5000, 300000) cargan el middleware', () => {
  for (const v of [undefined, '', '0', '5000', '300000']) {
    const r = cargarAuth(v);
    assert.equal(r.status, 0, `AUTH_CACHE_TTL_MS=${JSON.stringify(v)}: ${r.stderr}`);
  }
});

test('G18-09: valores invalidos de AUTH_CACHE_TTL_MS abortan la carga con un mensaje claro', () => {
  for (const v of ['-1', '300001', 'abc', '1.5']) {
    const r = cargarAuth(v);
    assert.notEqual(r.status, 0, `debio rechazar ${v}`);
    assert.match(r.stderr, /AUTH_CACHE_TTL_MS invalido/);
  }
});
