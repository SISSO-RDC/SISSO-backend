// ============================================================
// Regresion de produccion (reportada por el usuario, 04/09/2026):
// los 4 endpoints de registro de Historia Clinica Ocupacional
// (preocupacional, periodica, reintegro, retiro) devolvian SIEMPRE
// 500 "Error interno al registrar la evaluacion..." -- ninguna
// prueba de la suite llamaba a estos endpoints de punta a punta, asi
// que un ReferenceError real (banderasRojas declarada con `const`
// dentro del try{} que envuelve la transaccion, pero usada despues
// de que ese bloque ya habia cerrado) nunca fue detectado hasta que
// una persona lo encontro usando la aplicacion real.
//
// Esta prueba cierra ese hueco de cobertura: llama a los 4 endpoints
// reales, con el servidor real, con un payload minimo pero realista
// (sin datos obligatorios especiales, como los enviaria el
// formulario con la mayoria de campos vacios), y exige 201 -- no solo
// "no 500", sino la forma exacta de la respuesta que el frontend
// espera (evaluacion.id y banderasRojas).
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { iniciarServidor, detenerServidor } = require('./helpers/servidor');
const { iniciarSesionCompleta, peticion } = require('./helpers/cliente');
const { sembrar, limpiar } = require('./helpers/seed');

let datos;
let tokenMedicoA;

before(async () => {
  await limpiar();
  datos = await sembrar();
  await iniciarServidor();
  tokenMedicoA = await iniciarSesionCompleta(datos.usuarios.medico.email, datos.passwordPrueba, datos.secretoTotp);
});

after(async () => {
  detenerServidor();
  await limpiar();
});

// Payload minimo comun a los 4 tipos: casi todo vacio/null, como lo
// enviaria un formulario recien abierto donde el medico solo lleno
// un par de campos -- este es exactamente el caso que revento en
// produccion (ver el reporte original).
function payloadBase() {
  return {
    fechaAtencion: '2026-09-04',
    horaAtencion: '10:00',
    puestoTrabajoCiuo: 'j92972',
    areaTrabajo: 'Produccion',
    presionArterialSistolica: null,
    presionArterialDiastolica: null,
    temperaturaC: null,
    frecuenciaCardiaca: null,
    saturacionOxigeno: null,
    frecuenciaRespiratoria: null,
    pesoKg: null,
    tallaCm: null,
    perimetroAbdominalCm: null,
    resultadosExamenes: [],
    diagnosticos: [],
  };
}

function assertRespuestaExitosa(status, cuerpo, tipoEsperado) {
  assert.equal(status, 201, `Se esperaba 201, se obtuvo ${status}: ${JSON.stringify(cuerpo)}`);
  assert.ok(cuerpo.evaluacion?.id, 'La respuesta debe incluir evaluacion.id');
  assert.equal(cuerpo.evaluacion.tipo_evaluacion, tipoEsperado);
  assert.ok(cuerpo.banderasRojas, 'La respuesta debe incluir banderasRojas (motor de la Auditoria N.13, G-05)');
  assert.equal(typeof cuerpo.banderasRojas.requiereRevisionPrioritaria, 'boolean');
}

test('HISTORIA CLINICA: registrar preocupacional con payload minimo responde 201 (no 500)', async () => {
  const { status, datos: cuerpo } = await peticion(
    'POST', `/historia-clinica/trabajadores/${datos.trabajadorAId}/preocupacional`, tokenMedicoA, payloadBase()
  );
  assertRespuestaExitosa(status, cuerpo, 'preocupacional_inicio');
});

test('HISTORIA CLINICA: registrar periodica con payload minimo responde 201 (no 500)', async () => {
  const { status, datos: cuerpo } = await peticion(
    'POST', `/historia-clinica/trabajadores/${datos.trabajadorAId}/periodica`, tokenMedicoA, payloadBase()
  );
  assertRespuestaExitosa(status, cuerpo, 'periodica');
});

test('HISTORIA CLINICA: registrar reintegro con payload minimo responde 201 (no 500)', async () => {
  const { status, datos: cuerpo } = await peticion(
    'POST', `/historia-clinica/trabajadores/${datos.trabajadorAId}/reintegro`, tokenMedicoA, payloadBase()
  );
  assertRespuestaExitosa(status, cuerpo, 'reintegro');
});

test('HISTORIA CLINICA: registrar retiro con payload minimo responde 201 (no 500)', async () => {
  const { status, datos: cuerpo } = await peticion(
    'POST', `/historia-clinica/trabajadores/${datos.trabajadorAId}/retiro`, tokenMedicoA, payloadBase()
  );
  assertRespuestaExitosa(status, cuerpo, 'retiro');
});
