// ============================================================
// Prueba de regresion para un bug CRITICO encontrado durante la
// verificacion manual de la Auditoria N.08 (G-N08-03): sin un
// campo de entropia propia (jti), dos refresh tokens del mismo
// usuario emitidos dentro del mismo segundo de reloj podian
// resultar en el MISMO string de JWT (mismo hash), rompiendo por
// completo la deteccion de reuso -- el servidor no podia distinguir
// el token padre (ya usado) del hijo recien emitido.
//
// Esta prueba ejercita exactamente el escenario que lo disparo:
// login seguido INMEDIATAMENTE de un refresh (sin esperar a que
// cambie el segundo de reloj), y confirma que reusar el token viejo
// despues sigue siendo detectado como reuso.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { authenticator } = require('otplib');

const { iniciarServidor, detenerServidor, URL_BASE } = require('./helpers/servidor');
const { sembrar, limpiar } = require('./helpers/seed');

let datos;

before(async () => {
  await limpiar();
  datos = await sembrar();
  await iniciarServidor();
});

after(async () => {
  detenerServidor();
  await limpiar();
});

function extraerCookie(respuesta) {
  const header = respuesta.headers.get('set-cookie');
  const match = header && header.match(/sisso_refresh_token=[^;]+/);
  return match ? match[0] : null;
}

async function loginCompleto() {
  const r1 = await fetch(`${URL_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: datos.usuarios.admin.email, password: datos.passwordPrueba }),
  });
  const d1 = await r1.json();
  const codigo = authenticator.generate(datos.secretoTotp);
  const r2 = await fetch(`${URL_BASE}/auth/mfa/verificar-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mfaToken: d1.mfaToken, codigo }),
  });
  return extraerCookie(r2);
}

test('REFRESH TOKEN: dos tokens del mismo usuario emitidos en el mismo instante NUNCA colisionan (jti unico)', async () => {
  // Se generan 20 refresh tokens "en rafaga" (mismo tick de reloj
  // con alta probabilidad) para el mismo usuario y se confirma que
  // los 20 strings de JWT son distintos entre si.
  const { generarRefreshToken } = require('../src/utils/jwt');
  const usuarioFalso = { id: datos.usuarios.admin.id };
  const tokens = new Set();
  for (let i = 0; i < 20; i++) {
    tokens.add(generarRefreshToken(usuarioFalso));
  }
  assert.equal(tokens.size, 20, 'los 20 refresh tokens generados en rafaga deben ser todos distintos.');
});

test('REFRESH TOKEN: refrescar inmediatamente despues del login (mismo segundo) sigue detectando reuso del token viejo', async () => {
  const cookieOriginal = await loginCompleto();
  assert.ok(cookieOriginal, 'el login debe emitir la cookie de refresh token.');

  // Primer refresh, sin ninguna espera artificial -- exactamente el
  // escenario que disparo el bug (login y refresh en el mismo tick).
  const r3 = await fetch(`${URL_BASE}/auth/refrescar`, { method: 'POST', headers: { Cookie: cookieOriginal } });
  const d3 = await r3.json();
  assert.equal(r3.status, 200);
  assert.ok(d3.accessToken);
  const cookieNueva = extraerCookie(r3);
  assert.ok(cookieNueva, 'la rotacion debe emitir una nueva cookie de refresh token.');
  assert.notEqual(cookieNueva, cookieOriginal, 'el token nuevo debe ser distinto del original.');

  // Reusar el token ORIGINAL (ya rotado) debe ser rechazado como reuso.
  const r4 = await fetch(`${URL_BASE}/auth/refrescar`, { method: 'POST', headers: { Cookie: cookieOriginal } });
  assert.equal(r4.status, 401, 'reusar el refresh token original tras rotarlo debe rechazarse.');

  // Y por deteccion de reuso, TODA la familia queda revocada -- el
  // token nuevo (hijo legitimo) tambien debe quedar invalido.
  const r5 = await fetch(`${URL_BASE}/auth/refrescar`, { method: 'POST', headers: { Cookie: cookieNueva } });
  assert.equal(r5.status, 401, 'tras detectar reuso, toda la familia (incluido el hijo legitimo) debe quedar revocada.');
});
