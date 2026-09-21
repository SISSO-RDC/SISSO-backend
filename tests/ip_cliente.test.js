// Auditoria N.19 (G19-10): la IP de origen no puede depender de una
// cabecera X-Forwarded-For escrita por el cliente. Sin base de datos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { configurarTrustProxy, obtenerIpCliente } = require('../src/utils/ipCliente');

test('G19-10: configurarTrustProxy interpreta la variable y rechaza "true"', () => {
  const avisos = [];
  const original = console.warn;
  console.warn = (m) => avisos.push(m);
  try {
    assert.equal(configurarTrustProxy(undefined, true), 1);
    assert.equal(configurarTrustProxy(undefined, false), false);
    assert.equal(configurarTrustProxy('', true), 1);
    assert.equal(configurarTrustProxy('0', true), false);
    assert.equal(configurarTrustProxy('false', true), false);
    assert.equal(configurarTrustProxy('2', true), 2);
    assert.equal(configurarTrustProxy('loopback, 10.0.0.0/8', true), 'loopback, 10.0.0.0/8');
    assert.equal(configurarTrustProxy('true', true), 1);
    assert.equal(avisos.length, 1, 'TRUST_PROXY=true debe advertir');
  } finally {
    console.warn = original;
  }
});

test('G19-10: obtenerIpCliente limita a 64 caracteres y normaliza IPv4 mapeada', () => {
  assert.equal(obtenerIpCliente(null), null);
  assert.equal(obtenerIpCliente({ ip: '::ffff:203.0.113.7' }), '203.0.113.7');
  assert.equal(obtenerIpCliente({ socket: { remoteAddress: '10.0.0.5' } }), '10.0.0.5');
  assert.ok(obtenerIpCliente({ ip: 'x'.repeat(500) }).length <= 64);
});

function servidorPrueba(trustProxy) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.get('/ip', (req, res) => res.json({ ip: obtenerIpCliente(req) }));
  return new Promise((resolve) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s));
  });
}

async function ipVista(servidor, xff) {
  const { port } = servidor.address();
  const r = await fetch(`http://127.0.0.1:${port}/ip`, { headers: xff ? { 'X-Forwarded-For': xff } : {} });
  return (await r.json()).ip;
}

test('G19-10: con 1 proxy de confianza se ignora la IP falsificada por el cliente', async () => {
  const s = await servidorPrueba(configurarTrustProxy('1', true));
  try {
    // Lo que envia un proxy real: agrega al FINAL la IP que el vio; lo que
    // el cliente escribio ("6.6.6.6") queda a la izquierda y no se usa.
    assert.equal(await ipVista(s, '6.6.6.6, 203.0.113.7'), '203.0.113.7');
    // Cabecera enorme: la IP guardada sigue cabiendo en VARCHAR(64).
    const larga = Array.from({ length: 40 }, (_, i) => `10.0.0.${i}`).join(', ') + ', 203.0.113.7';
    const ip = await ipVista(s, larga);
    assert.equal(ip, '203.0.113.7');
    assert.ok(ip.length <= 64);
  } finally {
    s.close();
  }
});

test('G19-10: sin proxy de confianza (TRUST_PROXY=0) X-Forwarded-For se ignora por completo', async () => {
  const s = await servidorPrueba(configurarTrustProxy('0', true));
  try {
    const ip = await ipVista(s, '6.6.6.6');
    assert.ok(['127.0.0.1', '::1'].includes(ip), `se esperaba la IP del socket, llego ${ip}`);
  } finally {
    s.close();
  }
});

test('G19-10: ningun modulo de src lee X-Forwarded-For directamente', () => {
  const RAIZ = path.join(__dirname, '..', 'src');
  const hallazgos = [];
  (function recorrer(dir) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) { recorrer(p); continue; }
      if (!f.endsWith('.js') || p.endsWith(path.join('utils', 'ipCliente.js'))) continue;
      const codigo = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
      if (/x-forwarded-for/i.test(codigo)) hallazgos.push(path.relative(RAIZ, p));
    }
  })(RAIZ);
  assert.deepEqual(hallazgos, [], `usan X-Forwarded-For directo: ${hallazgos.join(', ')}`);
});
