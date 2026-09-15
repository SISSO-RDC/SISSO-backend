// ============================================================
// CREADO en Auditoria N.16 (P0: "Crear pruebas de autorizacion del
// configurador"). El configurador sectorial (Lotes A/B/C: catalogo
// de sectores, catalogo de paises/normativa, perfil sectorial de la
// organizacion) no tenia una bateria de pruebas dedicada -- la
// auditoria lo senala explicitamente (G-16-07) porque estos
// endpoints tocan un catalogo GLOBAL compartido por todas las
// organizaciones (escritura debe ser exclusiva de superadmin) y un
// perfil por-organizacion (aislamiento multi-tenant).
//
// Cubre:
//   - Lectura de catalogos (sectores/paises): cualquier rol
//     autenticado puede, sin autenticar no puede.
//   - Escritura de catalogos: SOLO superadmin (admin/medico/sso/th
//     deben recibir 403).
//   - PUT /organizacion/perfil-sectorial: solo admin de la propia
//     organizacion; sso/medico/th reciben 403.
//   - Aislamiento: aplicar la configuracion sectorial en la
//     organizacion A nunca modifica el perfil de la organizacion B.
//   - Validacion: un sectorClave o paisNormativoClave inexistente
//     es rechazado (400), no se aplica silenciosamente.
//   - Auditoria: aplicar_configuracion_sectorial queda registrado.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { iniciarServidor, detenerServidor } = require('./helpers/servidor');
const { iniciarSesionCompleta, peticion } = require('./helpers/cliente');
const { sembrar, limpiar } = require('./helpers/seed');
const { queryComoSuperadmin } = require('../src/db/pool');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const { encriptar } = require('../src/utils/crypto');

let datos;
let tokenAdminA, tokenMedicoA, tokenSsoA, tokenThA, tokenAdminB, tokenSuperadmin;

before(async () => {
  await limpiar();
  datos = await sembrar();
  await iniciarServidor();

  tokenAdminA = await iniciarSesionCompleta(datos.usuarios.admin.email, datos.passwordPrueba, datos.secretoTotp);
  tokenMedicoA = await iniciarSesionCompleta(datos.usuarios.medico.email, datos.passwordPrueba, datos.secretoTotp);
  tokenSsoA = await iniciarSesionCompleta(datos.usuarios.sso.email, datos.passwordPrueba, datos.secretoTotp);
  tokenThA = await iniciarSesionCompleta(datos.usuarios.th.email, datos.passwordPrueba, datos.secretoTotp);
  tokenAdminB = await iniciarSesionCompleta(datos.usuarios.adminB.email, datos.passwordPrueba, datos.secretoTotp);

  // Un superadmin real (organizacion_id NULL), sembrado directamente
  // -- sembrar() no crea uno por defecto porque la mayoria de suites
  // no lo necesitan. Mismo secreto TOTP que el resto para reusar
  // iniciarSesionCompleta sin logica adicional.
  const passwordHash = await bcrypt.hash(datos.passwordPrueba, 10);
  const secretoCifrado = encriptar(datos.secretoTotp);
  await queryComoSuperadmin(
    `INSERT INTO usuarios (organizacion_id, email, password_hash, nombre_completo, rol, mfa_habilitado, mfa_secret)
     VALUES (NULL, 'superadmin.prueba@sisso-test.com', $1, 'Superadmin Prueba', 'superadmin', true, $2)`,
    [passwordHash, secretoCifrado]
  );
  tokenSuperadmin = await iniciarSesionCompleta('superadmin.prueba@sisso-test.com', datos.passwordPrueba, datos.secretoTotp);
});

after(async () => {
  detenerServidor();
  await limpiar();
});

// ------------------------------------------------------------
// Lectura de catalogos: abierta a cualquier autenticado.
// ------------------------------------------------------------
test('N16-P0: cualquier rol autenticado puede listar el catalogo de sectores', async () => {
  for (const token of [tokenAdminA, tokenMedicoA, tokenSsoA, tokenThA]) {
    const { status, datos: cuerpo } = await peticion('GET', '/catalogo-sectores', token);
    assert.equal(status, 200, JSON.stringify(cuerpo));
    assert.ok(Array.isArray(cuerpo.sectores) && cuerpo.sectores.length > 0);
  }
});

test('N16-P0: sin token, listar el catalogo de sectores es rechazado (401)', async () => {
  const { status } = await peticion('GET', '/catalogo-sectores', null);
  assert.equal(status, 401);
});

test('N16-P0: cualquier rol autenticado puede listar el catalogo de paises/normativa', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/catalogo-paises', tokenThA);
  assert.equal(status, 200, JSON.stringify(cuerpo));
  const ecuador = cuerpo.paises.find((p) => p.clave === 'ecuador');
  assert.ok(ecuador, 'Ecuador debe existir en el catalogo sembrado por las migraciones.');
  // N16-C-16-03: ya no debe afirmar cobertura absoluta.
  assert.ok(
    !/completamente desarrollado/i.test(ecuador.descripcion_estado || ''),
    'La descripcion de Ecuador no debe afirmar cobertura normativa absoluta.'
  );
});

// ------------------------------------------------------------
// Escritura de catalogos: exclusiva de superadmin.
// ------------------------------------------------------------
test('N16-P0: admin de organizacion NO puede editar el catalogo global de sectores (403)', async () => {
  const { status } = await peticion('PUT', '/catalogo-sectores/salud', tokenAdminA, { descripcion: 'intento no autorizado' });
  assert.equal(status, 403);
});

test('N16-P0: medico/sso/th NO pueden editar ni cambiar estado del catalogo de sectores (403)', async () => {
  for (const token of [tokenMedicoA, tokenSsoA, tokenThA]) {
    const r1 = await peticion('PUT', '/catalogo-sectores/salud', token, { descripcion: 'intento no autorizado' });
    assert.equal(r1.status, 403);
    const r2 = await peticion('PATCH', '/catalogo-sectores/salud/estado', token, { activo: false });
    assert.equal(r2.status, 403);
  }
});

test('N16-P0: superadmin SI puede editar el catalogo global de sectores, y queda auditado', async () => {
  const { status, datos: cuerpo } = await peticion('PUT', '/catalogo-sectores/salud', tokenSuperadmin, {
    descripcion: 'Descripcion actualizada por prueba N16-P0',
  });
  assert.equal(status, 200, JSON.stringify(cuerpo));

  const auditRes = await queryComoSuperadmin(
    `SELECT id FROM auditoria WHERE accion = 'actualizar_catalogo_sector' AND detalle->>'clave' = 'salud' ORDER BY creado_en DESC LIMIT 1`
  );
  assert.equal(auditRes.rows.length, 1, 'La edicion del catalogo de sectores por superadmin debe quedar auditada.');
});

test('N16-P0: admin de organizacion NO puede editar el catalogo global de paises/normativa (403)', async () => {
  const { status } = await peticion('PUT', '/catalogo-paises/ecuador', tokenAdminA, { descripcion_estado: 'intento no autorizado' });
  assert.equal(status, 403);
});

// ------------------------------------------------------------
// PUT /organizacion/perfil-sectorial: solo admin de la propia
// organizacion (nunca sso/medico/th, y jamas afecta a otra org).
// ------------------------------------------------------------
test('N16-P0: sso/medico/th NO pueden aplicar la configuracion sectorial (403)', async () => {
  for (const token of [tokenMedicoA, tokenSsoA, tokenThA]) {
    const { status } = await peticion('PUT', '/organizacion/perfil-sectorial', token, {
      sectorClave: 'salud', numeroTrabajadoresDeclarado: 20, riesgosPresentes: [],
    });
    assert.equal(status, 403);
  }
});

test('N16-P0: un sectorClave inexistente es rechazado (400), no se aplica silenciosamente', async () => {
  const { status } = await peticion('PUT', '/organizacion/perfil-sectorial', tokenAdminA, {
    sectorClave: 'sector-que-no-existe', numeroTrabajadoresDeclarado: 10, riesgosPresentes: [],
  });
  assert.equal(status, 400);
});

test('N16-P0: un paisNormativoClave inexistente es rechazado (400)', async () => {
  const { status } = await peticion('PUT', '/organizacion/perfil-sectorial', tokenAdminA, {
    sectorClave: 'salud', numeroTrabajadoresDeclarado: 10, riesgosPresentes: [], paisNormativoClave: 'pais-inventado',
  });
  assert.equal(status, 400);
});

test('N16-P0: admin de A aplica configuracion sectorial; el perfil de B queda intacto (aislamiento)', async () => {
  const { status, datos: cuerpo } = await peticion('PUT', '/organizacion/perfil-sectorial', tokenAdminA, {
    sectorClave: 'construccion', numeroTrabajadoresDeclarado: 35, riesgosPresentes: ['Trabajo en altura'],
  });
  assert.equal(status, 200, JSON.stringify(cuerpo));
  assert.equal(cuerpo.organizacion?.sector_empresarial_clave, 'construccion');

  const perfilB = await peticion('GET', '/organizacion', tokenAdminB);
  assert.equal(perfilB.status, 200);
  assert.equal(
    perfilB.datos.organizacion?.sector_empresarial_clave ?? null,
    null,
    'Aplicar el configurador en la organizacion A nunca debe tocar el perfil de la organizacion B.'
  );

  const auditRes = await queryComoSuperadmin(
    `SELECT id FROM auditoria WHERE accion = 'aplicar_configuracion_sectorial' AND organizacion_id = $1 ORDER BY creado_en DESC LIMIT 1`,
    [datos.orgAId]
  );
  assert.equal(auditRes.rows.length, 1, 'Aplicar la configuracion sectorial debe quedar auditado con la organizacion correcta.');
});
