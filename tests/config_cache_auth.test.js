// Auditoria N.19, G19-12: la ventana de revocacion de la cache de auth no
// puede ampliarse por accidente ni coexistir con un despliegue multi-instancia.
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { resolverConfigCacheAuth, TTL_POR_DEFECTO_MS } = require('../src/utils/configCacheAuth');

test('G19-12: defaults y valores validos', () => {
  assert.equal(resolverConfigCacheAuth({}).ttlMs, TTL_POR_DEFECTO_MS);
  assert.equal(resolverConfigCacheAuth({ AUTH_CACHE_TTL_MS: '0' }).ttlMs, 0);
  assert.equal(resolverConfigCacheAuth({ AUTH_CACHE_TTL_MS: '300000' }).ttlMs, 300000);
});

test('G19-12: rango invalido sigue rechazandose con el mensaje de siempre', () => {
  for (const v of ['-1', '300001', 'abc', '1.5']) {
    assert.throws(() => resolverConfigCacheAuth({ AUTH_CACHE_TTL_MS: v }), /AUTH_CACHE_TTL_MS invalido/);
  }
});

test('G19-12: INSTANCIAS_MULTIPLES=true exige AUTH_CACHE_TTL_MS=0 (incluido el default)', () => {
  for (const flag of ['true', 'TRUE', '1', 'si']) {
    assert.throws(() => resolverConfigCacheAuth({ INSTANCIAS_MULTIPLES: flag }), /Configuracion insegura/);
    assert.throws(() => resolverConfigCacheAuth({ INSTANCIAS_MULTIPLES: flag, AUTH_CACHE_TTL_MS: '5000' }), /Configuracion insegura/);
    assert.equal(resolverConfigCacheAuth({ INSTANCIAS_MULTIPLES: flag, AUTH_CACHE_TTL_MS: '0' }).ttlMs, 0);
  }
  // Declarar una sola instancia no cambia nada.
  assert.equal(resolverConfigCacheAuth({ INSTANCIAS_MULTIPLES: 'false' }).ttlMs, TTL_POR_DEFECTO_MS);
});

test('G19-12: un TTL por encima del default advierte en produccion, no en desarrollo', () => {
  const prod = resolverConfigCacheAuth({ NODE_ENV: 'production', AUTH_CACHE_TTL_MS: '120000' });
  assert.equal(prod.advertencias.length, 1);
  assert.match(prod.advertencias[0], /120 s/);
  assert.equal(resolverConfigCacheAuth({ NODE_ENV: 'production' }).advertencias.length, 0);
  assert.equal(resolverConfigCacheAuth({ AUTH_CACHE_TTL_MS: '120000' }).advertencias.length, 0);
});

test('G19-12: el middleware real se niega a cargar con multi-instancia y TTL > 0', () => {
  const RAIZ = path.join(__dirname, '..');
  const cargar = (extra) => spawnSync(process.execPath, ['-e', "require('dotenv').config(); require('./src/middleware/auth'); console.log('cargado')"],
    { cwd: RAIZ, env: { ...process.env, ...extra }, encoding: 'utf8' });
  const mal = cargar({ INSTANCIAS_MULTIPLES: 'true', AUTH_CACHE_TTL_MS: '20000' });
  assert.notEqual(mal.status, 0);
  assert.match(mal.stderr, /Configuracion insegura/);
  const bien = cargar({ INSTANCIAS_MULTIPLES: 'true', AUTH_CACHE_TTL_MS: '0' });
  assert.equal(bien.status, 0, bien.stderr);
  assert.match(bien.stdout, /TTL=0 ms \(desactivada\)/);
});
