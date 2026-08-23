// ============================================================
// Cliente HTTP para las pruebas: hace login REAL (password + MFA)
// contra el servidor arrancado por servidor.js, y expone un
// helper `peticion` que agrega el token de acceso automaticamente.
// ============================================================
const { authenticator } = require('otplib');
const { URL_BASE } = require('./servidor');

async function iniciarSesionCompleta(email, password, secretoTotp) {
  const respuestaPaso1 = await fetch(`${URL_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const datosPaso1 = await respuestaPaso1.json();

  if (respuestaPaso1.status !== 200 || !datosPaso1.mfaToken) {
    throw new Error(`Paso 1 de login fallo inesperadamente: ${respuestaPaso1.status} ${JSON.stringify(datosPaso1)}`);
  }

  const codigo = authenticator.generate(secretoTotp);
  const respuestaPaso2 = await fetch(`${URL_BASE}/auth/mfa/verificar-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mfaToken: datosPaso1.mfaToken, codigo }),
  });
  const datosPaso2 = await respuestaPaso2.json();

  if (respuestaPaso2.status !== 200 || !datosPaso2.accessToken) {
    throw new Error(`Paso 2 de login (MFA) fallo inesperadamente: ${respuestaPaso2.status} ${JSON.stringify(datosPaso2)}`);
  }

  return datosPaso2.accessToken;
}

async function peticion(metodo, ruta, accessToken, cuerpo) {
  const respuesta = await fetch(`${URL_BASE}${ruta}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  let datos = null;
  try { datos = await respuesta.json(); } catch { /* respuesta sin cuerpo JSON */ }
  return { status: respuesta.status, datos };
}

module.exports = { iniciarSesionCompleta, peticion };
