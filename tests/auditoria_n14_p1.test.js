// ============================================================
// CREADO en Auditoria N.14 (G14-12, P1: pruebas para hallazgos
// nuevos). Complementa auditoria_n14_p0.test.js con cobertura de
// tres hallazgos GRAVES adicionales:
//   - G14-01: admin no puede leer evaluaciones psicosociales
//     individuales, solo el resumen agregado.
//   - G14-09: el retest confirmatorio de audiometria exige que el
//     examen este marcado es_retest_confirmatorio=true antes de
//     poder documentar la decision medica.
//   - G14-10: una medicion de higiene industrial vinculada al
//     catalogo toma el limite/unidad/norma del catalogo (no del
//     cliente) y queda marcada limite_verificable_en_catalogo=true.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { iniciarServidor, detenerServidor } = require('./helpers/servidor');
const { iniciarSesionCompleta, peticion } = require('./helpers/cliente');
const { sembrar, limpiar } = require('./helpers/seed');
const { queryComoSuperadmin } = require('../src/db/pool');

let datos;
let tokenAdminA, tokenMedicoA, tokenSsoA;
let evaluacionPsicosocialId;
let catalogoLimiteRuidoId;

before(async () => {
  await limpiar();
  datos = await sembrar();
  await iniciarServidor();

  tokenAdminA = await iniciarSesionCompleta(datos.usuarios.admin.email, datos.passwordPrueba, datos.secretoTotp);
  tokenMedicoA = await iniciarSesionCompleta(datos.usuarios.medico.email, datos.passwordPrueba, datos.secretoTotp);
  tokenSsoA = await iniciarSesionCompleta(datos.usuarios.sso.email, datos.passwordPrueba, datos.secretoTotp);

  const catRes = await queryComoSuperadmin(
    `SELECT id FROM catalogo_limites_higiene WHERE agente = 'ruido_continuo_8h' AND fecha_vigencia_hasta IS NULL LIMIT 1`
  );
  catalogoLimiteRuidoId = catRes.rows[0]?.id || null;
});

after(async () => {
  detenerServidor();
  await limpiar();
});

// ------------------------------------------------------------
// G14-01
// ------------------------------------------------------------
test('G14-01: sso puede crear una evaluacion psicosocial individual', async () => {
  const { status, datos: cuerpo } = await peticion('POST', '/riesgo-psicosocial/evaluaciones', tokenSsoA, {
    tipoEvaluacion: 'individual',
    trabajadorId: datos.trabajadorAId,
    area: 'Produccion',
    metodo: 'ISTAS21',
    fechaEvaluacion: '2026-06-01',
    nivelRiesgo: 'alto',
  });
  assert.equal(status, 201, JSON.stringify(cuerpo));
  evaluacionPsicosocialId = cuerpo.evaluacion.id;
});

test('G14-01: admin NO puede listar evaluaciones psicosociales individuales (403)', async () => {
  const { status } = await peticion('GET', '/riesgo-psicosocial/evaluaciones', tokenAdminA);
  assert.equal(status, 403);
});

test('G14-01: admin NO puede leer el detalle de una evaluacion psicosocial individual (403)', async () => {
  const { status } = await peticion('GET', `/riesgo-psicosocial/evaluaciones/${evaluacionPsicosocialId}`, tokenAdminA);
  assert.equal(status, 403);
});

test('G14-01: admin SI puede ver el resumen agregado de riesgo psicosocial', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/riesgo-psicosocial/evaluaciones/resumen-agregado', tokenAdminA);
  assert.equal(status, 200, JSON.stringify(cuerpo));
  assert.ok(Array.isArray(cuerpo.resumen));
  // Con 1 sola evaluacion en el area, debe quedar redactada por
  // k-anonimato (menos de 5 evaluaciones en el area).
  const filaArea = cuerpo.resumen.find((f) => f.area === 'Produccion');
  assert.ok(filaArea);
  assert.equal(filaArea.redactado, true);
});

test('G14-01: medico SI puede leer el detalle de la evaluacion individual', async () => {
  const { status, datos: cuerpo } = await peticion('GET', `/riesgo-psicosocial/evaluaciones/${evaluacionPsicosocialId}`, tokenMedicoA);
  assert.equal(status, 200, JSON.stringify(cuerpo));
  assert.equal(cuerpo.evaluacion.id, evaluacionPsicosocialId);
});

// ------------------------------------------------------------
// G14-09
// ------------------------------------------------------------
test('G14-09: documentar-decision-retest-sts sobre un examen que NO es retest confirmatorio devuelve 404', async () => {
  const examenRes = await queryComoSuperadmin(
    `INSERT INTO examenes_audiometria (organizacion_id, trabajador_id, medico_id, fecha_examen, es_basal, baseline_vigente)
     VALUES ($1, $2, $3, CURRENT_DATE, true, true) RETURNING id`,
    [datos.orgAId, datos.trabajadorAId, datos.usuarios.medico.id]
  );
  const examenId = examenRes.rows[0].id;

  const { status, datos: cuerpo } = await peticion('PATCH', `/audiometria/${examenId}/decision-retest-sts`, tokenMedicoA, {
    stsConfirmado: true,
    decision: 'Se confirma el STS tras revision del retest.',
  });
  assert.equal(status, 404, JSON.stringify(cuerpo));
});

test('G14-09: documentar-decision-retest-sts SI funciona sobre un examen marcado es_retest_confirmatorio=true', async () => {
  const original = await queryComoSuperadmin(
    `INSERT INTO examenes_audiometria (organizacion_id, trabajador_id, medico_id, fecha_examen, es_basal, baseline_vigente)
     VALUES ($1, $2, $3, CURRENT_DATE - 30, true, false) RETURNING id`,
    [datos.orgAId, datos.trabajadorAId, datos.usuarios.medico.id]
  );
  const originalId = original.rows[0].id;

  const retest = await queryComoSuperadmin(
    `INSERT INTO examenes_audiometria (organizacion_id, trabajador_id, medico_id, fecha_examen, es_retest_confirmatorio, examen_original_retest_id)
     VALUES ($1, $2, $3, CURRENT_DATE, true, $4) RETURNING id`,
    [datos.orgAId, datos.trabajadorAId, datos.usuarios.medico.id, originalId]
  );
  const retestId = retest.rows[0].id;

  const { status, datos: cuerpo } = await peticion('PATCH', `/audiometria/${retestId}/decision-retest-sts`, tokenMedicoA, {
    stsConfirmado: false,
    decision: 'El retest NO confirma el STS original; se atribuye a variabilidad tecnica.',
  });
  assert.equal(status, 200, JSON.stringify(cuerpo));
  assert.equal(cuerpo.examen.sts_confirmado_en_retest, false);
});

// ------------------------------------------------------------
// G14-10
// ------------------------------------------------------------
test('G14-10: el catalogo de limites de higiene expone al menos el limite de ruido continuo 8h', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/higiene-industrial/catalogo-limites', tokenSsoA);
  assert.equal(status, 200, JSON.stringify(cuerpo));
  const ruido = cuerpo.catalogo.find((c) => c.agente === 'ruido_continuo_8h');
  assert.ok(ruido, 'Se esperaba encontrar el limite semilla de ruido_continuo_8h en el catalogo.');
});

test('G14-10: una medicion vinculada al catalogo toma el limite del catalogo, no el enviado por el cliente', async () => {
  if (!catalogoLimiteRuidoId) {
    // La semilla de migration_072 no esta presente en este entorno
    // de pruebas (por ejemplo, si se corrio ON CONFLICT DO NOTHING
    // contra un catalogo ya modificado) -- se omite sin fallar.
    return;
  }
  const { status, datos: cuerpo } = await peticion('POST', '/higiene-industrial/mediciones', tokenSsoA, {
    tipoMedicion: 'ruido',
    area: 'Planta',
    parametro: 'Nivel de ruido continuo',
    valorMedido: 90,
    fechaMedicion: '2026-06-01',
    catalogoLimiteId: catalogoLimiteRuidoId,
    // limitePermisible enviado deliberadamente distinto al del
    // catalogo (200), para comprobar que se IGNORA en favor del
    // catalogo (85, ver semilla de migration_072).
    limitePermisible: 200,
    unidad: 'unidad-incorrecta',
  });
  assert.equal(status, 201, JSON.stringify(cuerpo));
  assert.equal(cuerpo.medicion.limite_verificable_en_catalogo, true);
  // 90 dBA > 85 dBA (limite del catalogo) -> no cumple, a pesar de
  // que el cliente envio un limite de 200 (con el cual si cumpliria).
  assert.equal(cuerpo.medicion.cumple, false);
});
