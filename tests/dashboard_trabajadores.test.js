// ============================================================
// Pruebas de contenido (no solo status) para GET /api/dashboard/resumen
// y minimizacion de datos en GET /api/trabajadores.
//
// CORRIGE:
//   - C-N08-01 (CRITICO/BLOQUEANTE): la Auditoria N.08 exige
//     explicitamente "pruebas de contenido, no solo status" para el
//     dashboard, dado que el endpoint respondia 200 para todos los
//     roles y el problema estaba en el CONTENIDO del JSON, no en el
//     codigo de estado HTTP.
//   - M-N08-01: "Falta de pruebas del dashboard por rol".
//   - G-N08-02: minimizacion de datos personales en /api/trabajadores.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { iniciarServidor, detenerServidor } = require('./helpers/servidor');
const { iniciarSesionCompleta, peticion } = require('./helpers/cliente');
const { sembrar, limpiar } = require('./helpers/seed');
const { queryComoSuperadmin } = require('../src/db/pool');

let datos;
let tokenAdminA, tokenMedicoA, tokenSsoA, tokenThA;

before(async () => {
  await limpiar();
  datos = await sembrar();
  await iniciarServidor();

  tokenAdminA = await iniciarSesionCompleta(datos.usuarios.admin.email, datos.passwordPrueba, datos.secretoTotp);
  tokenMedicoA = await iniciarSesionCompleta(datos.usuarios.medico.email, datos.passwordPrueba, datos.secretoTotp);
  tokenSsoA = await iniciarSesionCompleta(datos.usuarios.sso.email, datos.passwordPrueba, datos.secretoTotp);
  tokenThA = await iniciarSesionCompleta(datos.usuarios.th.email, datos.passwordPrueba, datos.secretoTotp);

  // El trabajador de prueba necesita una EMO proxima a vencer (para
  // poblar emosProximas) y un registro en historial_aptitud_medica
  // (para poblar la rama 'aptitud' de actividadReciente) -- sin
  // esto, el dashboard responderia arrays vacios y las pruebas de
  // "no debe aparecer el campo aptitud" serian trivialmente ciertas
  // sin haber probado nada real.
  await queryComoSuperadmin(
    `UPDATE trabajadores SET fecha_vencimiento = CURRENT_DATE + 10, sexo = 'M', fecha_nacimiento = '1990-01-01', talla_cm = 175, peso_kg = 80
     WHERE id = $1`,
    [datos.trabajadorAId]
  );
  await queryComoSuperadmin(
    `INSERT INTO historial_aptitud_medica (organizacion_id, trabajador_id, medico_id, aptitud, puesto_evaluado, justificacion_clinica)
     VALUES ($1, $2, $3, 'no_apto', 'Operador de planta', 'Justificacion clinica de prueba con contenido suficiente.')`,
    [datos.orgAId, datos.trabajadorAId, datos.usuarios.medico.id]
  );
});

after(async () => {
  detenerServidor();
  await limpiar();
});

// ------------------------------------------------------------
// DASHBOARD: emosProximas -- solo medico ve el campo "aptitud".
// ------------------------------------------------------------
for (const [rol, token] of [['admin', () => tokenAdminA], ['sso', () => tokenSsoA], ['th', () => tokenThA]]) {
  test(`DASHBOARD: ${rol} NO recibe el campo "aptitud" en emosProximas`, async () => {
    const { status, datos: cuerpo } = await peticion('GET', '/dashboard/resumen', token());
    assert.equal(status, 200);
    assert.ok(cuerpo.emosProximas.length > 0, 'la siembra de prueba debe producir al menos una EMO proxima a vencer.');
    for (const fila of cuerpo.emosProximas) {
      assert.ok(!Object.prototype.hasOwnProperty.call(fila, 'aptitud'), `${rol} no debe recibir "aptitud" en emosProximas.`);
    }
  });
}

test('DASHBOARD: medico SI recibe el campo "aptitud" en emosProximas', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/dashboard/resumen', tokenMedicoA);
  assert.equal(status, 200);
  assert.ok(cuerpo.emosProximas.length > 0);
  assert.ok(cuerpo.emosProximas.every((f) => Object.prototype.hasOwnProperty.call(f, 'aptitud')), 'medico debe recibir "aptitud" en emosProximas.');
});

// ------------------------------------------------------------
// DASHBOARD: actividadReciente -- ningun rol no-medico debe recibir
// una entrada con tipo='aptitud' (la union con
// historial_aptitud_medica debe estar fuera del SQL, no solo
// filtrada despues).
// ------------------------------------------------------------
for (const [rol, token] of [['admin', () => tokenAdminA], ['sso', () => tokenSsoA], ['th', () => tokenThA]]) {
  test(`DASHBOARD: actividadReciente de ${rol} jamas contiene una entrada tipo='aptitud'`, async () => {
    const { status, datos: cuerpo } = await peticion('GET', '/dashboard/resumen', token());
    assert.equal(status, 200);
    const algunaAptitud = cuerpo.actividadReciente.some((a) => a.tipo === 'aptitud');
    assert.equal(algunaAptitud, false, `${rol} no debe recibir ninguna entrada de aptitud en actividadReciente.`);
  });
}

test('DASHBOARD: actividadReciente de medico SI puede contener una entrada tipo=\'aptitud\'', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/dashboard/resumen', tokenMedicoA);
  assert.equal(status, 200);
  const algunaAptitud = cuerpo.actividadReciente.some((a) => a.tipo === 'aptitud');
  assert.equal(algunaAptitud, true, 'la siembra de prueba inserto un registro en historial_aptitud_medica; medico debe verlo en actividadReciente.');
});

// ------------------------------------------------------------
// DASHBOARD: distribucionAptitud es agregada (conteo por
// categoria), nunca identifica a un trabajador -- se mantiene igual
// para todos los roles, y se prueba explicitamente que ninguna fila
// trae nombre_completo/trabajador.
// ------------------------------------------------------------
test('DASHBOARD: distribucionAptitud nunca incluye identidad de un trabajador (para ningun rol)', async () => {
  for (const [, token] of [['admin', tokenAdminA], ['sso', tokenSsoA], ['th', tokenThA], ['medico', tokenMedicoA]]) {
    const { status, datos: cuerpo } = await peticion('GET', '/dashboard/resumen', token);
    assert.equal(status, 200);
    for (const fila of cuerpo.distribucionAptitud) {
      assert.ok(!('nombre_completo' in fila) && !('trabajador' in fila), 'distribucionAptitud debe ser siempre agregada, nunca nominal.');
    }
  }
});

// ------------------------------------------------------------
// TRABAJADORES: minimizacion de datos antropometricos (G-N08-02).
// admin/th los conservan (los administran legitimamente, ver
// trabajadoresRoutes.js); sso no tiene ninguna necesidad
// documentada ni permiso de escritura sobre ellos.
// ------------------------------------------------------------
test('TRABAJADORES: sso NO recibe datos antropometricos (sexo/fecha_nacimiento/talla/peso) al listar', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/trabajadores', tokenSsoA);
  assert.equal(status, 200);
  const trabajador = cuerpo.trabajadores.find((t) => t.id === datos.trabajadorAId);
  assert.ok(trabajador, 'el trabajador de prueba debe aparecer en el listado.');
  for (const campo of ['sexo', 'fecha_nacimiento', 'talla_cm', 'peso_kg']) {
    assert.ok(!Object.prototype.hasOwnProperty.call(trabajador, campo), `sso no debe recibir "${campo}".`);
  }
});

test('TRABAJADORES: admin SI recibe datos antropometricos (los administra legitimamente)', async () => {
  const { status, datos: cuerpo } = await peticion('GET', `/trabajadores/${datos.trabajadorAId}`, tokenAdminA);
  assert.equal(status, 200);
  assert.equal(cuerpo.trabajador.sexo, 'M');
  assert.equal(cuerpo.trabajador.talla_cm, 175);
});

test('TRABAJADORES: th SI recibe datos antropometricos (los administra legitimamente)', async () => {
  const { status, datos: cuerpo } = await peticion('GET', `/trabajadores/${datos.trabajadorAId}`, tokenThA);
  assert.equal(status, 200);
  assert.equal(cuerpo.trabajador.sexo, 'M');
});

test('TRABAJADORES: medico recibe el conjunto completo, incluida aptitud', async () => {
  const { status, datos: cuerpo } = await peticion('GET', `/trabajadores/${datos.trabajadorAId}`, tokenMedicoA);
  assert.equal(status, 200);
  assert.equal(cuerpo.trabajador.sexo, 'M');
  assert.ok(Object.prototype.hasOwnProperty.call(cuerpo.trabajador, 'aptitud'));
});

test('TRABAJADORES: admin/th NO reciben el campo "aptitud" (sin cambios respecto a la version anterior)', async () => {
  const { status, datos: cuerpo } = await peticion('GET', `/trabajadores/${datos.trabajadorAId}`, tokenAdminA);
  assert.equal(status, 200);
  assert.ok(!Object.prototype.hasOwnProperty.call(cuerpo.trabajador, 'aptitud'));
});
