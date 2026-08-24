// ============================================================
// Suite de pruebas RBAC/IDOR clinico: corrige el hallazgo GRAVE
// G-N07-03 de la Auditoria Integral SISSO -- Backend N.07
// ("cobertura de pruebas de autorizacion insuficiente frente a la
// superficie clinica"). seguridad.test.js ya prueba Historia
// Clinica a fondo; este archivo amplia la matriz rol x endpoint a
// los modulos que la auditoria señalo explicitamente como no
// cubiertos: aptitud, restricciones medicas, enfermedad
// profesional, audiometria/espirometria/visiometria, certificados
// y ausentismo.
//
// Mismo patron que el resto del suite: arranca el servidor real
// como proceso hijo y ataca por HTTP, sin mockear nada.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { iniciarServidor, detenerServidor } = require('./helpers/servidor');
const { iniciarSesionCompleta, peticion } = require('./helpers/cliente');
const { sembrar, limpiar } = require('./helpers/seed');
const { queryComoSuperadmin } = require('../src/db/pool');

let datos;
let tokenAdminA, tokenMedicoA, tokenSsoA, tokenThA;
let ausenciaConDiagnosticoId;

before(async () => {
  await limpiar();
  datos = await sembrar();
  await iniciarServidor();

  tokenAdminA = await iniciarSesionCompleta(datos.usuarios.admin.email, datos.passwordPrueba, datos.secretoTotp);
  tokenMedicoA = await iniciarSesionCompleta(datos.usuarios.medico.email, datos.passwordPrueba, datos.secretoTotp);
  tokenSsoA = await iniciarSesionCompleta(datos.usuarios.sso.email, datos.passwordPrueba, datos.secretoTotp);
  tokenThA = await iniciarSesionCompleta(datos.usuarios.th.email, datos.passwordPrueba, datos.secretoTotp);

  // Ausencia con diagnostico CIE-10, insertada directamente (bypass
  // RLS via queryComoSuperadmin) para probar minimizarDatosClinicos
  // sin depender de que el endpoint de creacion funcione primero.
  // catalogo_cie10 es una tabla GLOBAL (no organizacion_id-scoped,
  // ver migration_007) que en un entorno de pruebas limpio esta
  // vacia -- normalmente la llena scripts/cargar_cie10.js. Se
  // inserta aqui el codigo minimo necesario para satisfacer la FK
  // de ausencias.diagnostico_cie10.
  await queryComoSuperadmin(
    `INSERT INTO catalogo_cie10 (codigo, descripcion, nivel) VALUES ('J00', 'Rinofaringitis aguda [resfriado comun]', 4)
     ON CONFLICT (codigo) DO NOTHING`
  );
  const ausenciaRes = await queryComoSuperadmin(
    `INSERT INTO ausencias (organizacion_id, trabajador_id, tipo, subsidiado_iess, fecha_inicio, fecha_fin, diagnostico_cie10, numero_certificado, registrado_por)
     VALUES ($1, $2, 'enfermedad_general', false, CURRENT_DATE - 2, CURRENT_DATE, 'J00', 'CERT-TEST-001', $3)
     RETURNING id`,
    [datos.orgAId, datos.trabajadorAId, datos.usuarios.medico.id]
  );
  ausenciaConDiagnosticoId = ausenciaRes.rows[0].id;
});

after(async () => {
  detenerServidor();
  await limpiar();
});

// ------------------------------------------------------------
// Aptitud medica: rutas de catalogo (admin+medico) vs. rutas de
// datos clinicos de un trabajador especifico (SOLO medico).
// ------------------------------------------------------------
test('APTITUD: sso no puede acceder a catalogo de reglas de contraindicacion', async () => {
  const { status } = await peticion('GET', '/aptitud/reglas', tokenSsoA);
  assert.equal(status, 403);
});

test('APTITUD: th no puede acceder a catalogo de reglas de contraindicacion', async () => {
  const { status } = await peticion('GET', '/aptitud/reglas', tokenThA);
  assert.equal(status, 403);
});

test('APTITUD: admin SI puede acceder al catalogo de reglas (no es dato clinico individual)', async () => {
  const { status } = await peticion('GET', '/aptitud/reglas', tokenAdminA);
  assert.equal(status, 200);
});

test('APTITUD: admin NO puede acceder al historial de aptitud de un trabajador (dato clinico individual)', async () => {
  const { status } = await peticion('GET', `/aptitud/trabajadores/${datos.trabajadorAId}/historial`, tokenAdminA);
  assert.equal(status, 403);
});

test('APTITUD: sso NO puede acceder al historial de aptitud de un trabajador', async () => {
  const { status } = await peticion('GET', `/aptitud/trabajadores/${datos.trabajadorAId}/historial`, tokenSsoA);
  assert.equal(status, 403);
});

test('APTITUD: medico SI puede acceder al historial de aptitud de un trabajador', async () => {
  const { status } = await peticion('GET', `/aptitud/trabajadores/${datos.trabajadorAId}/historial`, tokenMedicoA);
  assert.equal(status, 200);
});

// ------------------------------------------------------------
// Restricciones medicas: emitir/prorrogar/modificar/levantar SOLO
// medico; leer medico+sso+th; admin fuera de todo el modulo.
// ------------------------------------------------------------
test('RESTRICCIONES: admin no puede emitir una restriccion medica', async () => {
  const { status } = await peticion('POST', `/restricciones-medicas/trabajadores/${datos.trabajadorAId}`, tokenAdminA, {
    tipo: 'no_levantar_peso', descripcion: 'prueba', vigenciaHasta: '2027-01-01',
  });
  assert.equal(status, 403);
});

test('RESTRICCIONES: sso no puede emitir una restriccion medica', async () => {
  const { status } = await peticion('POST', `/restricciones-medicas/trabajadores/${datos.trabajadorAId}`, tokenSsoA, {
    tipo: 'no_levantar_peso', descripcion: 'prueba', vigenciaHasta: '2027-01-01',
  });
  assert.equal(status, 403);
});

test('RESTRICCIONES: admin no puede ni siquiera leer restricciones de un trabajador', async () => {
  const { status } = await peticion('GET', `/restricciones-medicas/trabajadores/${datos.trabajadorAId}`, tokenAdminA);
  assert.equal(status, 403, 'admin queda fuera de todo el modulo de restricciones medicas, incluida la lectura.');
});

test('RESTRICCIONES: sso SI puede leer restricciones de un trabajador (proyeccion operativa)', async () => {
  const { status } = await peticion('GET', `/restricciones-medicas/trabajadores/${datos.trabajadorAId}`, tokenSsoA);
  assert.equal(status, 200);
});

// ------------------------------------------------------------
// Enfermedad profesional: detalle clinico SOLO medico; vista
// preventiva agregada SOLO sso, y es una ruta explicitamente
// distinta (nunca el mismo payload).
// ------------------------------------------------------------
test('ENFERMEDAD PROFESIONAL: sso no puede crear un caso (detalle clinico)', async () => {
  const { status } = await peticion('POST', `/enfermedad-profesional/trabajadores/${datos.trabajadorAId}`, tokenSsoA, {
    diagnostico: 'prueba',
  });
  assert.equal(status, 403);
});

test('ENFERMEDAD PROFESIONAL: admin no puede listar casos de un trabajador', async () => {
  const { status } = await peticion('GET', `/enfermedad-profesional/trabajadores/${datos.trabajadorAId}`, tokenAdminA);
  assert.equal(status, 403);
});

test('ENFERMEDAD PROFESIONAL: th no puede acceder a la vista preventiva SSO (es exclusiva de sso, no de todo el equipo SST)', async () => {
  const { status } = await peticion('GET', '/enfermedad-profesional/vista-preventiva-sso', tokenThA);
  assert.equal(status, 403);
});

test('ENFERMEDAD PROFESIONAL: medico no puede acceder a la vista preventiva SSO (ruta exclusiva de sso)', async () => {
  const { status } = await peticion('GET', '/enfermedad-profesional/vista-preventiva-sso', tokenMedicoA);
  assert.equal(status, 403);
});

test('ENFERMEDAD PROFESIONAL: sso SI puede acceder a su vista preventiva agregada', async () => {
  const { status } = await peticion('GET', '/enfermedad-profesional/vista-preventiva-sso', tokenSsoA);
  assert.equal(status, 200);
});

// ------------------------------------------------------------
// Audiometria / Espirometria / Visiometria: registrar y ver
// DETALLE completo SOLO medico; sso puede ver el LISTADO resumido
// pero no el detalle por examen; admin/th fuera por completo.
// ------------------------------------------------------------
for (const modulo of ['audiometria', 'espirometria', 'visiometria']) {
  test(`${modulo.toUpperCase()}: admin no puede listar examenes de un trabajador`, async () => {
    const { status } = await peticion('GET', `/${modulo}/trabajadores/${datos.trabajadorAId}`, tokenAdminA);
    assert.equal(status, 403);
  });

  test(`${modulo.toUpperCase()}: th no puede listar examenes de un trabajador`, async () => {
    const { status } = await peticion('GET', `/${modulo}/trabajadores/${datos.trabajadorAId}`, tokenThA);
    assert.equal(status, 403);
  });

  test(`${modulo.toUpperCase()}: sso SI puede listar examenes (version resumida, sin detalle clinico)`, async () => {
    const { status } = await peticion('GET', `/${modulo}/trabajadores/${datos.trabajadorAId}`, tokenSsoA);
    assert.equal(status, 200);
  });

  test(`${modulo.toUpperCase()}: sso no puede registrar un examen nuevo`, async () => {
    const { status } = await peticion('POST', `/${modulo}/trabajadores/${datos.trabajadorAId}`, tokenSsoA, {});
    assert.equal(status, 403);
  });
}

// ------------------------------------------------------------
// Certificados: el de capacitacion sigue abierto a
// admin/sso/th (documento de gestion); el de aptitud individual
// quedo restringido a medico en esta sesion (C3 de la Auditoria
// N.07 detallada) porque revela un dato clinico.
// ------------------------------------------------------------
test('CERTIFICADOS: admin no puede generar el certificado de aptitud individual (dato clinico)', async () => {
  const { status } = await peticion('GET', `/certificados/aptitud/${datos.trabajadorAId}`, tokenAdminA);
  assert.equal(status, 403);
});

test('CERTIFICADOS: sso no puede generar el certificado de aptitud individual', async () => {
  const { status } = await peticion('GET', `/certificados/aptitud/${datos.trabajadorAId}`, tokenSsoA);
  assert.equal(status, 403);
});

test('CERTIFICADOS: th no puede generar el certificado de aptitud individual', async () => {
  const { status } = await peticion('GET', `/certificados/aptitud/${datos.trabajadorAId}`, tokenThA);
  assert.equal(status, 403);
});

test('CERTIFICADOS: medico SI puede generar el certificado de aptitud individual (no da 403)', async () => {
  const { status } = await peticion('GET', `/certificados/aptitud/${datos.trabajadorAId}`, tokenMedicoA);
  assert.notEqual(status, 403, 'medico es el unico rol autorizado para este certificado; no deberia recibir 403.');
});

// ------------------------------------------------------------
// Ausentismo: minimizarDatosClinicos() debe ocultar
// diagnostico_cie10/numero_certificado a todos menos medico (C4 de
// la Auditoria N.07 detallada, retiro la excepcion que antes tenia
// sso).
// ------------------------------------------------------------
test('AUSENTISMO: sso NO recibe el campo diagnostico_cie10 al obtener una ausencia', async () => {
  const { status, datos: cuerpo } = await peticion('GET', `/ausentismo/${ausenciaConDiagnosticoId}`, tokenSsoA);
  assert.equal(status, 200);
  assert.ok(!Object.prototype.hasOwnProperty.call(cuerpo.ausencia, 'diagnostico_cie10'), 'sso no debe recibir diagnostico_cie10 en el payload JSON.');
});

test('AUSENTISMO: admin NO recibe el campo diagnostico_cie10 al obtener una ausencia', async () => {
  const { status, datos: cuerpo } = await peticion('GET', `/ausentismo/${ausenciaConDiagnosticoId}`, tokenAdminA);
  assert.equal(status, 200);
  assert.ok(!Object.prototype.hasOwnProperty.call(cuerpo.ausencia, 'diagnostico_cie10'), 'admin no debe recibir diagnostico_cie10 en el payload JSON.');
});

test('AUSENTISMO: th NO recibe el campo diagnostico_cie10 al obtener una ausencia', async () => {
  const { status, datos: cuerpo } = await peticion('GET', `/ausentismo/${ausenciaConDiagnosticoId}`, tokenThA);
  assert.equal(status, 200);
  assert.ok(!Object.prototype.hasOwnProperty.call(cuerpo.ausencia, 'diagnostico_cie10'), 'th no debe recibir diagnostico_cie10 en el payload JSON.');
});

test('AUSENTISMO: medico SI recibe el campo diagnostico_cie10 al obtener una ausencia', async () => {
  const { status, datos: cuerpo } = await peticion('GET', `/ausentismo/${ausenciaConDiagnosticoId}`, tokenMedicoA);
  assert.equal(status, 200);
  assert.equal(cuerpo.ausencia.diagnostico_cie10, 'J00');
});

test('AUSENTISMO: sso no puede obtener la URL firmada del certificado escaneado (dato clinico)', async () => {
  const { status } = await peticion('GET', `/ausentismo/${ausenciaConDiagnosticoId}/certificado-url`, tokenSsoA);
  assert.equal(status, 403);
});

// ------------------------------------------------------------
// Alertas: solo medico ve/gestiona alertas clinicas nominales (C5
// de la Auditoria N.07 detallada, retiro la excepcion que antes
// tenia sso).
// ------------------------------------------------------------
test('ALERTAS: sso NO recibe incluyeClinicas=true en el listado de alertas', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/alertas', tokenSsoA);
  assert.equal(status, 200);
  assert.equal(cuerpo.incluyeClinicas, false, 'sso ya no debe recibir alertas clinicas nominales.');
});

test('ALERTAS: medico SI recibe incluyeClinicas=true en el listado de alertas', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/alertas', tokenMedicoA);
  assert.equal(status, 200);
  assert.equal(cuerpo.incluyeClinicas, true);
});

test('ALERTAS: el listado de sso jamas contiene una alerta con es_clinica=true', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/alertas', tokenSsoA);
  assert.equal(status, 200);
  const algunaClinica = (cuerpo.alertas || []).some((a) => a.es_clinica === true);
  assert.equal(algunaClinica, false, 'ninguna alerta clinica deberia aparecer en el listado que ve sso.');
});
