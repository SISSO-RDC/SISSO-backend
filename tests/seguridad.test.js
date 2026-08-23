// ============================================================
// Suite de pruebas de seguridad: cubre exactamente los hallazgos
// C1, C2 (via migrate.js, validado por separado) y G4 de la
// Auditoria Integral 2026-08-22, mas la verificacion del fix de
// G1 (rate limiting MFA).
//
//   C1 - Aislamiento multi-tenant: ningun usuario de la
//        Organizacion A puede leer un registro de la Organizacion B
//        por mas que conozca (o adivine) el ID exacto.
//   G4 - Autorizacion entre roles / IDOR clinico: SSO, TH y admin
//        no pueden acceder al detalle clinico (Historia Clinica),
//        reservado a 'medico', ni siquiera con un token valido de
//        su propia organizacion.
//   G1 - El codigo TOTP ahora tiene limite de intentos: tras 5
//        codigos incorrectos, el sexto intento se rechaza con 429
//        AUNQUE el codigo sea correcto.
//
// Arranca el servidor real como proceso hijo (ver helpers/servidor.js)
// y prueba exclusivamente por HTTP, igual que lo haria un atacante
// o un cliente real -- no se importan ni mockean controladores.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { iniciarServidor, detenerServidor, URL_BASE } = require('./helpers/servidor');
const { iniciarSesionCompleta, peticion } = require('./helpers/cliente');
const { sembrar, limpiar } = require('./helpers/seed');
const { authenticator } = require('otplib');

let datos;
let tokenAdminA, tokenMedicoA, tokenSsoA, tokenThA, tokenAdminB;

before(async () => {
  await limpiar();
  datos = await sembrar();
  await iniciarServidor();

  tokenAdminA = await iniciarSesionCompleta(datos.usuarios.admin.email, datos.passwordPrueba, datos.secretoTotp);
  tokenMedicoA = await iniciarSesionCompleta(datos.usuarios.medico.email, datos.passwordPrueba, datos.secretoTotp);
  tokenSsoA = await iniciarSesionCompleta(datos.usuarios.sso.email, datos.passwordPrueba, datos.secretoTotp);
  tokenThA = await iniciarSesionCompleta(datos.usuarios.th.email, datos.passwordPrueba, datos.secretoTotp);
  tokenAdminB = await iniciarSesionCompleta(datos.usuarios.adminB.email, datos.passwordPrueba, datos.secretoTotp);
});

after(async () => {
  detenerServidor();
  await limpiar();
});

// ------------------------------------------------------------
// C1 - Aislamiento multi-tenant
// ------------------------------------------------------------
test('C1: admin de Organizacion A NO puede leer un trabajador de Organizacion B por ID directo', async () => {
  const { status, datos: cuerpo } = await peticion('GET', `/trabajadores/${datos.trabajadorBId}`, tokenAdminA);
  assert.equal(status, 404, `Se esperaba 404 (no encontrado, aislado por organizacion_id); se recibio ${status}: ${JSON.stringify(cuerpo)}`);
});

test('C1: admin de Organizacion A SI puede leer un trabajador de su propia organizacion', async () => {
  const { status } = await peticion('GET', `/trabajadores/${datos.trabajadorAId}`, tokenAdminA);
  assert.equal(status, 200, 'El propio trabajador de la organizacion deberia ser accesible.');
});

test('C1: admin de Organizacion B tampoco puede leer un trabajador de Organizacion A', async () => {
  const { status } = await peticion('GET', `/trabajadores/${datos.trabajadorAId}`, tokenAdminB);
  assert.equal(status, 404, 'El aislamiento debe funcionar en ambos sentidos, no solo A->B.');
});

test('C1: listar trabajadores en Organizacion B jamas incluye trabajadores de Organizacion A', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/trabajadores', tokenAdminB);
  assert.equal(status, 200);
  const idsVisibles = (cuerpo.trabajadores || []).map((t) => t.id);
  assert.ok(!idsVisibles.includes(datos.trabajadorAId), 'El listado de B no debe contener IDs de trabajadores de A.');
});

// ------------------------------------------------------------
// G4 - Autorizacion por rol / IDOR clinico
// ------------------------------------------------------------
test('G4: SSO no puede acceder al catalogo de Historia Clinica (exclusivo de medico)', async () => {
  const { status } = await peticion('GET', '/historia-clinica/catalogos', tokenSsoA);
  assert.equal(status, 403, `Se esperaba 403; se recibio ${status}.`);
});

test('G4: TH no puede acceder al catalogo de Historia Clinica', async () => {
  const { status } = await peticion('GET', '/historia-clinica/catalogos', tokenThA);
  assert.equal(status, 403);
});

test('G4: admin no puede acceder al catalogo de Historia Clinica (dato clinico exclusivo de medico)', async () => {
  const { status } = await peticion('GET', '/historia-clinica/catalogos', tokenAdminA);
  assert.equal(status, 403, 'admin nunca debe tener acceso a datos clinicos individuales.');
});

test('G4: medico SI puede acceder al catalogo de Historia Clinica', async () => {
  const { status } = await peticion('GET', '/historia-clinica/catalogos', tokenMedicoA);
  assert.equal(status, 200);
});

test('G4: sin token, cualquier ruta protegida responde 401 (no 403, no 200)', async () => {
  const { status } = await peticion('GET', '/trabajadores', null);
  assert.equal(status, 401);
});

// ------------------------------------------------------------
// G1 - Rate limiting de codigo MFA (verifica el fix de esta sesion)
// ------------------------------------------------------------
test('G1: tras 5 codigos TOTP incorrectos, el usuario queda bloqueado (429) aunque el 6to codigo sea correcto', async () => {
  // Usuario dedicado para esta prueba (no reutiliza los ya
  // logueados arriba, para no interferir con otras pruebas).
  const respuestaLogin = await fetch(`${URL_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: datos.usuarios.sso.email, password: datos.passwordPrueba }),
  });
  const { mfaToken } = await respuestaLogin.json();
  assert.ok(mfaToken, 'Se esperaba recibir un mfaToken en el primer paso del login.');

  const codigoCorrecto = authenticator.generate(datos.secretoTotp);
  const codigoIncorrecto = codigoCorrecto === '000000' ? '111111' : '000000';

  for (let intento = 1; intento <= 5; intento += 1) {
    const respuesta = await fetch(`${URL_BASE}/auth/mfa/verificar-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken, codigo: codigoIncorrecto }),
    });
    assert.equal(respuesta.status, 401, `Intento ${intento} con codigo incorrecto deberia dar 401.`);
  }

  // Sexto intento: ahora con el codigo CORRECTO. Si el rate
  // limiting funciona, debe seguir rechazado (429), no dejarlo
  // entrar solo porque esta vez acerto.
  const respuestaFinal = await fetch(`${URL_BASE}/auth/mfa/verificar-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mfaToken, codigo: codigoCorrecto }),
  });
  assert.equal(respuestaFinal.status, 429, 'Tras 5 fallos, el sexto intento debe bloquearse (429) incluso con el codigo correcto.');
});
