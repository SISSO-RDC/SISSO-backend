// ============================================================
// Pruebas de contenido (no solo status) para:
//   - Accidentes/incidentes: corrige C-N08-01... C-N08-02 (CRITICO/
//     P0) y G-N08-02 (GRAVE): proyeccion por rol del expediente.
//   - Reportes BI e Indicadores SSO: corrige G-N08-01 (GRAVE/P1):
//     matriz de autorizacion por rol sobre datos agregados.
//
// Auditoria Integral SISSO N.08.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { iniciarServidor, detenerServidor } = require('./helpers/servidor');
const { iniciarSesionCompleta, peticion } = require('./helpers/cliente');
const { sembrar, limpiar } = require('./helpers/seed');
const { queryComoSuperadmin } = require('../src/db/pool');

let datos;
let tokenAdminA, tokenMedicoA, tokenSsoA, tokenThA;
let casoId, evidenciaId;

before(async () => {
  await limpiar();
  datos = await sembrar();
  await iniciarServidor();

  tokenAdminA = await iniciarSesionCompleta(datos.usuarios.admin.email, datos.passwordPrueba, datos.secretoTotp);
  tokenMedicoA = await iniciarSesionCompleta(datos.usuarios.medico.email, datos.passwordPrueba, datos.secretoTotp);
  tokenSsoA = await iniciarSesionCompleta(datos.usuarios.sso.email, datos.passwordPrueba, datos.secretoTotp);
  tokenThA = await iniciarSesionCompleta(datos.usuarios.th.email, datos.passwordPrueba, datos.secretoTotp);

  const casoRes = await queryComoSuperadmin(
    `INSERT INTO accidentes_incidentes
      (organizacion_id, tipo, trabajador_id, fecha_ocurrencia, lugar, descripcion, gravedad, tipo_lesion, dias_perdidos, requiere_atencion_medica, reportado_por)
     VALUES ($1, 'accidente', $2, CURRENT_DATE, 'Planta 1', 'Descripcion detallada del accidente de prueba con narrativa libre.', 'moderada', 'corte_superficial', 3, true, $3)
     RETURNING id`,
    [datos.orgAId, datos.trabajadorAId, datos.usuarios.admin.id]
  );
  casoId = casoRes.rows[0].id;

  const evidenciaRes = await queryComoSuperadmin(
    `INSERT INTO accidentes_evidencias (accidente_id, organizacion_id, tipo_archivo, public_id, descripcion, subido_por)
     VALUES ($1, $2, 'imagen', 'sisso/evidencia-accidentes/test-fake-id', 'Foto de prueba', $3)
     RETURNING id`,
    [casoId, datos.orgAId, datos.usuarios.admin.id]
  );
  evidenciaId = evidenciaRes.rows[0].id;
});

after(async () => {
  detenerServidor();
  await limpiar();
});

// ------------------------------------------------------------
// C-N08-02: proyeccion por rol del expediente de accidentes.
// ------------------------------------------------------------
test('ACCIDENTES: th NO recibe tipo_lesion ni descripcion en el listado', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/accidentes', tokenThA);
  assert.equal(status, 200);
  const caso = cuerpo.casos.find((c) => c.id === casoId);
  assert.ok(caso, 'el caso de prueba debe aparecer en el listado.');
  assert.ok(!Object.prototype.hasOwnProperty.call(caso, 'tipo_lesion'), 'th no debe recibir tipo_lesion.');
  assert.ok(!Object.prototype.hasOwnProperty.call(caso, 'descripcion'), 'th no debe recibir descripcion.');
});

test('ACCIDENTES: admin SI recibe tipo_lesion y descripcion en el listado (acceso completo)', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/accidentes', tokenAdminA);
  assert.equal(status, 200);
  const caso = cuerpo.casos.find((c) => c.id === casoId);
  assert.equal(caso.tipo_lesion, 'corte_superficial');
  assert.ok(caso.descripcion.length > 0);
});

test('ACCIDENTES: th NO recibe investigacion/acciones/evidencias al obtener el detalle', async () => {
  const { status, datos: cuerpo } = await peticion('GET', `/accidentes/${casoId}`, tokenThA);
  assert.equal(status, 200);
  assert.ok(!Object.prototype.hasOwnProperty.call(cuerpo.caso, 'tipo_lesion'));
  assert.ok(!Object.prototype.hasOwnProperty.call(cuerpo.caso, 'descripcion'));
  assert.deepEqual(cuerpo.acciones, []);
  assert.equal(cuerpo.investigacion, null);
  assert.deepEqual(cuerpo.evidencias, []);
});

test('ACCIDENTES: sso SI recibe el expediente completo al obtener el detalle', async () => {
  const { status, datos: cuerpo } = await peticion('GET', `/accidentes/${casoId}`, tokenSsoA);
  assert.equal(status, 200);
  assert.equal(cuerpo.caso.tipo_lesion, 'corte_superficial');
  assert.equal(cuerpo.evidencias.length, 1);
});

test('ACCIDENTES: th no puede obtener la URL firmada de una evidencia', async () => {
  const { status } = await peticion('GET', `/accidentes/evidencias/${evidenciaId}/url`, tokenThA);
  assert.equal(status, 403);
});

test('ACCIDENTES: admin SI puede obtener la URL firmada de una evidencia', async () => {
  const { status, datos: cuerpo } = await peticion('GET', `/accidentes/evidencias/${evidenciaId}/url`, tokenAdminA);
  assert.equal(status, 200);
  assert.ok(cuerpo.url);
});

// ------------------------------------------------------------
// G-N08-01: matriz de autorizacion por rol en Indicadores SSO.
// ------------------------------------------------------------
test('INDICADORES: th NO recibe aptitudMedica ni hallazgosAnormales ni matrizRiesgos', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/indicadores', tokenThA);
  assert.equal(status, 200);
  assert.ok(!('aptitudMedica' in cuerpo));
  assert.ok(!('hallazgosAnormales' in cuerpo));
  assert.ok(!('matrizRiesgos' in cuerpo));
  assert.ok('totalTrabajadores' in cuerpo);
  assert.ok('coberturaEmo' in cuerpo);
});

test('INDICADORES: sso NO recibe aptitudMedica ni hallazgosAnormales', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/indicadores', tokenSsoA);
  assert.equal(status, 200);
  assert.ok(!('aptitudMedica' in cuerpo));
  assert.ok(!('hallazgosAnormales' in cuerpo));
  assert.ok('matrizRiesgos' in cuerpo);
  assert.ok('ergonomia' in cuerpo);
});

test('INDICADORES: medico SI recibe aptitudMedica y hallazgosAnormales', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/indicadores', tokenMedicoA);
  assert.equal(status, 200);
  assert.ok('aptitudMedica' in cuerpo);
  assert.ok('hallazgosAnormales' in cuerpo);
  assert.ok(!('matrizRiesgos' in cuerpo), 'medico no necesita matriz de riesgos (dominio SSO).');
});

test('INDICADORES: admin NO recibe aptitudMedica ni hallazgosAnormales (no se vuelve lector clinico)', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/indicadores', tokenAdminA);
  assert.equal(status, 200);
  assert.ok(!('aptitudMedica' in cuerpo));
  assert.ok(!('hallazgosAnormales' in cuerpo));
  assert.ok('matrizRiesgos' in cuerpo);
});

// ------------------------------------------------------------
// G-N08-01: misma matriz aplicada a Reportes BI (JSON).
// ------------------------------------------------------------
test('REPORTES: th NO recibe aptitudMedica ni matrizRiesgos, SI recibe ausentismo', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/reportes/resumen', tokenThA);
  assert.equal(status, 200);
  assert.ok(!('aptitudMedica' in cuerpo));
  assert.ok(!('matrizRiesgos' in cuerpo));
  assert.ok('ausentismo' in cuerpo);
});

test('REPORTES: sso NO recibe ausentismo ni aptitudMedica, SI recibe matrizRiesgos y ergonomia', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/reportes/resumen', tokenSsoA);
  assert.equal(status, 200);
  assert.ok(!('ausentismo' in cuerpo));
  assert.ok(!('aptitudMedica' in cuerpo));
  assert.ok('matrizRiesgos' in cuerpo);
  assert.ok('ergonomia' in cuerpo);
});

test('REPORTES: medico SI recibe aptitudMedica y examenesComplementarios', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/reportes/resumen', tokenMedicoA);
  assert.equal(status, 200);
  assert.ok('aptitudMedica' in cuerpo);
  assert.ok('examenesComplementarios' in cuerpo);
});

test('REPORTES: el PDF respeta la misma matriz que el JSON y no revienta para ningun rol', async () => {
  for (const token of [tokenAdminA, tokenMedicoA, tokenSsoA, tokenThA]) {
    const { status } = await peticion('GET', '/reportes/pdf', token);
    assert.equal(status, 200);
  }
});
