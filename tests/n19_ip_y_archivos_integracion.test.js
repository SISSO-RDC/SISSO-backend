// Auditoria N.19 (G19-10 y G19-11) contra el servidor REAL (proceso hijo,
// como en Render), no solo contra funciones sueltas.
//  - G19-10: la IP guardada en auditoria sale de `trust proxy`, no de una
//    cabecera X-Forwarded-For falsificada por el cliente; y una cabecera
//    enorme ya no rompe el login (ip_origen es VARCHAR(64)).
//  - G19-11: los endpoints de subida rechazan con 400 lo que no es una
//    imagen valida (SVG, URL remota, ruta local, contenido que no coincide).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { authenticator } = require('otplib');

// El servidor hijo hereda el entorno: 1 proxy de confianza, como en produccion.
process.env.TRUST_PROXY = '1';

const { iniciarServidor, detenerServidor, URL_BASE } = require('./helpers/servidor');
const { iniciarSesionCompleta, peticion } = require('./helpers/cliente');
const { sembrar, limpiar } = require('./helpers/seed');
const { queryComoSuperadmin } = require('../src/db/pool');

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

async function loginConCabecera(xff) {
  const cab = { 'Content-Type': 'application/json', 'X-Forwarded-For': xff };
  const u = datos.usuarios.th;
  const r1 = await fetch(`${URL_BASE}/auth/login`, {
    method: 'POST', headers: cab, body: JSON.stringify({ email: u.email, password: datos.passwordPrueba }),
  });
  const d1 = await r1.json();
  assert.equal(r1.status, 200, `paso 1: ${JSON.stringify(d1)}`);
  const r2 = await fetch(`${URL_BASE}/auth/mfa/verificar-login`, {
    method: 'POST', headers: cab,
    body: JSON.stringify({ mfaToken: d1.mfaToken, codigo: authenticator.generate(datos.secretoTotp) }),
  });
  return { status: r2.status, cuerpo: await r2.json() };
}

async function ultimaIp(tabla, usuarioId, extra = '') {
  const r = await queryComoSuperadmin(
    `SELECT ip_origen FROM ${tabla} WHERE usuario_id = $1 ${extra} ORDER BY 1 DESC LIMIT 50`, [usuarioId]
  );
  return r.rows.map((x) => x.ip_origen);
}

test('G19-10: la IP registrada ignora lo que el cliente escribio en X-Forwarded-For', async () => {
  // Un proxy real agrega al final la IP que vio; lo escrito por el cliente queda a la izquierda.
  const { status } = await loginConCabecera('6.6.6.6, 203.0.113.7');
  assert.equal(status, 200);
  const ipsAuditoria = await ultimaIp('auditoria', datos.usuarios.th.id, `AND accion = 'login_exitoso'`);
  assert.ok(ipsAuditoria.includes('203.0.113.7'), `auditoria debe guardar 203.0.113.7, hay: ${ipsAuditoria}`);
  assert.ok(!ipsAuditoria.some((ip) => ip && ip.includes('6.6.6.6')), 'nunca la IP falsificada');
  const ipsRefresh = await ultimaIp('refresh_tokens', datos.usuarios.th.id);
  assert.ok(ipsRefresh.includes('203.0.113.7'));
  assert.ok(!ipsRefresh.some((ip) => ip && ip.includes(',')), 'no se guarda la cadena completa');
});

test('G19-10: una cabecera X-Forwarded-For enorme ya no rompe el inicio de sesion', async () => {
  const larga = Array.from({ length: 60 }, (_, i) => `10.9.${i}.1`).join(', ') + ', 203.0.113.8';
  const { status, cuerpo } = await loginConCabecera(larga);
  assert.equal(status, 200, JSON.stringify(cuerpo));
  const ips = await ultimaIp('auditoria', datos.usuarios.th.id, `AND accion = 'login_exitoso'`);
  assert.ok(ips.includes('203.0.113.8'));
});

test('G19-11: PUT /organizacion/logo rechaza SVG, URLs, rutas y contenido que no es imagen', async () => {
  const token = await iniciarSesionCompleta(datos.usuarios.admin.email, datos.passwordPrueba, datos.secretoTotp);
  const casos = {
    svg: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString('base64'),
    url: 'https://ejemplo.com/logo.png',
    ruta: '/etc/passwd',
    falso: 'data:image/png;base64,' + Buffer.from('<html><script>alert(1)</script></html>').toString('base64'),
    dataSinBase64: 'data:image/png,hola',
  };
  for (const [nombre, valor] of Object.entries(casos)) {
    const r = await peticion('PUT', '/organizacion/logo', token, { logoBase64: valor });
    assert.equal(r.status, 400, `${nombre} debio responder 400, respondio ${r.status}: ${JSON.stringify(r.datos)}`);
  }
});

test('G19-11: la evidencia de accidentes ya no acepta cualquier cadena', async () => {
  const token = await iniciarSesionCompleta(datos.usuarios.sso.email, datos.passwordPrueba, datos.secretoTotp);
  const r = await peticion('POST', '/accidentes/00000000-0000-0000-0000-000000000000/evidencias', token, {
    archivoBase64: 'file:///etc/passwd',
  });
  // 400 por archivo invalido (la validacion corre antes de buscar el caso), nunca 200/500.
  assert.equal(r.status, 400, JSON.stringify(r.datos));
});
