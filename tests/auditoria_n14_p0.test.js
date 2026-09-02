// ============================================================
// CREADO en Auditoria N.14 (G14-12, P1: pruebas para los hallazgos
// P0/P1 nuevos). Cubre el comportamiento END-TO-END (HTTP real, sin
// mocks) de las dos correcciones criticas mas dificiles de verificar
// solo leyendo el codigo:
//   - C14-02: un puesto SIN exposiciones registradas ("PUESTO_SIN_MATRIZ")
//     debe bloquear el registro de aptitud igual que "SIN_PUESTO",
//     y el bloqueo debe levantarse SOLO tras una confirmacion
//     explicita (confirmar-sin-exposiciones) o tras registrar una
//     exposicion real.
//   - C14-05: 'admin' no puede retirar una regla GLOBAL de
//     contraindicacion (solo 'medico' puede); 'admin' SI puede
//     retirar una regla propia de su organizacion.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { iniciarServidor, detenerServidor } = require('./helpers/servidor');
const { iniciarSesionCompleta, peticion } = require('./helpers/cliente');
const { sembrar, limpiar } = require('./helpers/seed');
const { queryComoSuperadmin } = require('../src/db/pool');

let datos;
let tokenMedicoA, tokenAdminA;
let puestoSinMatrizId;
let reglaGlobalId, reglaOrgAId;

before(async () => {
  await limpiar();
  datos = await sembrar();
  await iniciarServidor();

  tokenMedicoA = await iniciarSesionCompleta(datos.usuarios.medico.email, datos.passwordPrueba, datos.secretoTotp);
  tokenAdminA = await iniciarSesionCompleta(datos.usuarios.admin.email, datos.passwordPrueba, datos.secretoTotp);

  const puestoRes = await queryComoSuperadmin(
    `INSERT INTO puestos_trabajo (organizacion_id, nombre_puesto, creado_por)
     VALUES ($1, 'Puesto de prueba sin matriz', $2) RETURNING id`,
    [datos.orgAId, datos.usuarios.admin.id]
  );
  puestoSinMatrizId = puestoRes.rows[0].id;
  await queryComoSuperadmin(
    `UPDATE trabajadores SET puesto_trabajo_id = $1 WHERE id = $2`,
    [puestoSinMatrizId, datos.trabajadorAId]
  );

  const reglaGlobalRes = await queryComoSuperadmin(
    `INSERT INTO reglas_contraindicacion
       (organizacion_id, nombre, codigo_cie10_patron, tipo_coincidencia, exposicion_codigo, severidad, descripcion_riesgo, estado)
     VALUES (NULL, 'Regla global de prueba', 'Z00', 'exacto', 'ruido', 'relativa', 'Riesgo de prueba', 'aprobada')
     RETURNING id`
  );
  reglaGlobalId = reglaGlobalRes.rows[0].id;

  const reglaOrgARes = await queryComoSuperadmin(
    `INSERT INTO reglas_contraindicacion
       (organizacion_id, nombre, codigo_cie10_patron, tipo_coincidencia, exposicion_codigo, severidad, descripcion_riesgo, estado, autor_id)
     VALUES ($1, 'Regla propia de org A', 'Z01', 'exacto', 'quimico', 'relativa', 'Riesgo de prueba org A', 'aprobada', $2)
     RETURNING id`,
    [datos.orgAId, datos.usuarios.admin.id]
  );
  reglaOrgAId = reglaOrgARes.rows[0].id;
});

after(async () => {
  detenerServidor();
  await limpiar();
});

// ------------------------------------------------------------
// C14-02
// ------------------------------------------------------------
test('C14-02: registrar aptitud (no "no_apto") para un trabajador con PUESTO_SIN_MATRIZ es rechazado (409)', async () => {
  const { status, datos: cuerpo } = await peticion('POST', `/aptitud/trabajadores/${datos.trabajadorAId}/registrar`, tokenMedicoA, {
    aptitud: 'apto',
    puestoEvaluado: 'Puesto de prueba sin matriz',
    diagnosticosCie10: [],
    exposicionesPuesto: [],
    justificacionClinica: 'Evaluacion de prueba con justificacion suficientemente larga.',
  });
  assert.equal(status, 409, JSON.stringify(cuerpo));
  assert.equal(cuerpo.evaluacionIncompleta, true);
  assert.equal(cuerpo.estadoMatrizExposicion, 'PUESTO_SIN_MATRIZ');
});

test('C14-02: confirmar-sin-exposiciones exige un motivo de al menos 15 caracteres', async () => {
  const { status } = await peticion('PATCH', `/puestos-trabajo/${puestoSinMatrizId}/confirmar-sin-exposiciones`, tokenAdminA, { motivo: 'corto' });
  assert.equal(status, 400);
});

test('C14-02: tras confirmar-sin-exposiciones, el puesto pasa a PUESTO_CON_MATRIZ_VALIDADA y el registro de aptitud ya no se bloquea', async () => {
  const confirmar = await peticion('PATCH', `/puestos-trabajo/${puestoSinMatrizId}/confirmar-sin-exposiciones`, tokenAdminA, {
    motivo: 'Puesto administrativo de oficina, sin exposicion a ruido/quimicos/alturas verificado en sitio.',
  });
  assert.equal(confirmar.status, 200);
  assert.equal(confirmar.datos.puesto.matriz_exposicion_confirmada_sin_riesgo, true);

  const { status, datos: cuerpo } = await peticion('POST', `/aptitud/trabajadores/${datos.trabajadorAId}/registrar`, tokenMedicoA, {
    aptitud: 'apto',
    puestoEvaluado: 'Puesto de prueba sin matriz',
    diagnosticosCie10: [],
    exposicionesPuesto: [],
    justificacionClinica: 'Evaluacion de prueba tras confirmacion de matriz, con texto suficiente.',
  });
  assert.equal(status, 201, JSON.stringify(cuerpo));
});

// ------------------------------------------------------------
// C14-05
// ------------------------------------------------------------
test('C14-05: admin NO puede retirar una regla GLOBAL de contraindicacion (403)', async () => {
  const { status, datos: cuerpo } = await peticion('PATCH', `/aptitud/reglas/${reglaGlobalId}/retirar`, tokenAdminA, {
    motivo: 'Intento de retiro por admin de una regla global.',
  });
  assert.equal(status, 403);
  assert.match(cuerpo.error, /medico/i);
});

test('C14-05: medico SI puede retirar una regla GLOBAL de contraindicacion', async () => {
  const { status, datos: cuerpo } = await peticion('PATCH', `/aptitud/reglas/${reglaGlobalId}/retirar`, tokenMedicoA, {
    motivo: 'Retiro justificado por revision clinica del medico ocupacional.',
  });
  assert.equal(status, 200, JSON.stringify(cuerpo));
  assert.equal(cuerpo.regla.estado, 'retirada');
});

test('C14-05: admin SI puede retirar una regla propia de su organizacion (no global)', async () => {
  const { status, datos: cuerpo } = await peticion('PATCH', `/aptitud/reglas/${reglaOrgAId}/retirar`, tokenAdminA, {
    motivo: 'Retiro de regla propia de la organizacion por admin.',
  });
  assert.equal(status, 200, JSON.stringify(cuerpo));
  assert.equal(cuerpo.regla.estado, 'retirada');
});
