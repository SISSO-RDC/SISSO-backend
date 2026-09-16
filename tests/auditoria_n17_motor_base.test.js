// ============================================================
// CREADO en Auditoria N.16 -> N.17 (P1, lote "motor base"). Cubre
// el motor de propuestas/confirmaciones del configurador sectorial
// (migration_083, configuracionSectorialController.js), que la
// propia Auditoria N.16 (G-16-07) exige probar de forma dedicada:
//
//   - Generacion: requiere sector ya configurado; crea una propuesta
//     "pendiente" por cada elemento del catalogo del sector.
//   - Idempotencia / no sobrescritura: generar dos veces NUNCA
//     duplica, y NUNCA revive una propuesta ya rechazada.
//   - Autorizacion por TIPO de propuesta (no solo por ruta): examen
//     exclusivo de medico; riesgo/herramienta_ergonomica exclusivos
//     de sso; area/puesto/epp/kpi exclusivos de admin.
//   - Aislamiento multi-tenant: las propuestas de A nunca aparecen
//     para B, y B no puede confirmar una propuesta de A aunque
//     conozca su ID (IDOR).
//   - Una propuesta ya revisada no se puede volver a revisar (409).
//   - El historial de confirmaciones queda registrado.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { iniciarServidor, detenerServidor } = require('./helpers/servidor');
const { iniciarSesionCompleta, peticion } = require('./helpers/cliente');
const { sembrar, limpiar } = require('./helpers/seed');
const { queryComoSuperadmin } = require('../src/db/pool');

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

  // El motor exige un sector ya configurado -- se aplica aqui una
  // vez para toda la suite (organizacion A = 'salud', que trae los
  // 7 tipos de sugerencia con datos reales en el seed de migration_077).
  const aplicar = await peticion('PUT', '/organizacion/perfil-sectorial', tokenAdminA, {
    sectorClave: 'salud', numeroTrabajadoresDeclarado: 50, riesgosPresentes: [],
  });
  assert.equal(aplicar.status, 200, JSON.stringify(aplicar.datos));
});

after(async () => {
  detenerServidor();
  await limpiar();
});

// ------------------------------------------------------------
// Generacion: requiere sector configurado.
// ------------------------------------------------------------
test('N17-motor-base: generar propuestas sin sector configurado es rechazado (400)', async () => {
  const { status, datos: cuerpo } = await peticion('POST', '/configuracion-sectorial/propuestas/generar', tokenAdminB, {});
  assert.equal(status, 400, JSON.stringify(cuerpo));
});

test('N17-motor-base: sso/medico/th NO pueden generar propuestas (403)', async () => {
  for (const token of [tokenMedicoA, tokenSsoA, tokenThA]) {
    const { status } = await peticion('POST', '/configuracion-sectorial/propuestas/generar', token, {});
    assert.equal(status, 403);
  }
});

let propuestasGeneradas;

test('N17-motor-base: admin genera propuestas a partir del sector configurado', async () => {
  const { status, datos: cuerpo } = await peticion('POST', '/configuracion-sectorial/propuestas/generar', tokenAdminA, {});
  assert.equal(status, 201, JSON.stringify(cuerpo));
  assert.ok(cuerpo.generadas > 0, 'Debe generar al menos una propuesta para el sector salud.');
  assert.equal(cuerpo.omitidas, 0, 'La primera generacion no debe omitir nada (nada existia antes).');

  const tiposEsperados = ['area', 'riesgo', 'examen', 'herramienta_ergonomica', 'epp', 'kpi'];
  const tiposObtenidos = new Set(cuerpo.propuestas.map((p) => p.tipo));
  for (const tipo of tiposEsperados) {
    assert.ok(tiposObtenidos.has(tipo), `Debe proponer al menos un elemento de tipo "${tipo}" para el sector salud.`);
  }
  propuestasGeneradas = cuerpo.propuestas;
});

test('N17-motor-base: generar de nuevo es idempotente -- no duplica lo ya propuesto', async () => {
  const { status, datos: cuerpo } = await peticion('POST', '/configuracion-sectorial/propuestas/generar', tokenAdminA, {});
  assert.equal(status, 201, JSON.stringify(cuerpo));
  assert.equal(cuerpo.generadas, 0, 'La segunda generacion no debe crear propuestas nuevas.');
  assert.ok(cuerpo.omitidas > 0);
});

// ------------------------------------------------------------
// Listado: org-scoped.
// ------------------------------------------------------------
test('N17-motor-base: listar propuestas devuelve solo las de la propia organizacion', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/configuracion-sectorial/propuestas', tokenAdminA);
  assert.equal(status, 200, JSON.stringify(cuerpo));
  assert.ok(cuerpo.propuestas.length >= propuestasGeneradas.length);

  const listaB = await peticion('GET', '/configuracion-sectorial/propuestas', tokenAdminB);
  assert.equal(listaB.status, 200);
  assert.equal(listaB.datos.propuestas.length, 0, 'La organizacion B no tiene sector configurado; no debe ver propuestas de A.');
});

test('N17-motor-base: th NO puede listar ni confirmar propuestas (403)', async () => {
  const listar = await peticion('GET', '/configuracion-sectorial/propuestas', tokenThA);
  assert.equal(listar.status, 403);
});

test('N17-motor-base: tipo/estado invalidos en el listado son rechazados (400)', async () => {
  const r1 = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=diagnostico', tokenAdminA);
  assert.equal(r1.status, 400);
  const r2 = await peticion('GET', '/configuracion-sectorial/propuestas?estado=aprobada', tokenAdminA);
  assert.equal(r2.status, 400);
});

// ------------------------------------------------------------
// Confirmacion: autorizacion FINA por tipo de propuesta.
// ------------------------------------------------------------
function buscar(tipo) {
  const p = propuestasGeneradas.find((x) => x.tipo === tipo);
  assert.ok(p, `Debe existir una propuesta generada de tipo "${tipo}" para esta prueba.`);
  return p;
}

test('N17-motor-base: solo medico puede confirmar una propuesta de tipo "examen"', async () => {
  const propuesta = buscar('examen');
  for (const token of [tokenAdminA, tokenSsoA]) {
    const { status } = await peticion('PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, token, { accion: 'aceptar' });
    assert.equal(status, 403, 'admin/sso no deben poder decidir sobre un examen (juicio clinico).');
  }
  const { status, datos: cuerpo } = await peticion('PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenMedicoA, { accion: 'aceptar' });
  assert.equal(status, 200, JSON.stringify(cuerpo));
  assert.equal(cuerpo.propuesta.estado, 'aceptada');
});

test('N17-motor-base: solo sso puede confirmar una propuesta de tipo "riesgo"', async () => {
  const propuesta = buscar('riesgo');
  for (const token of [tokenAdminA, tokenMedicoA]) {
    const { status } = await peticion('PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, token, { accion: 'aceptar' });
    assert.equal(status, 403);
  }
  const { status } = await peticion('PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenSsoA, { accion: 'rechazar', comentario: 'No aplica a esta empresa.' });
  assert.equal(status, 200);
});

test('N17-motor-base: solo admin puede confirmar una propuesta de tipo "area" (rechaza sso/medico)', async () => {
  const propuesta = buscar('area');
  for (const token of [tokenSsoA, tokenMedicoA]) {
    const { status } = await peticion('PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, token, { accion: 'aceptar' });
    assert.equal(status, 403);
  }
  const { status } = await peticion('PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'aceptar' });
  assert.equal(status, 200);
});

test('N17-motor-base: modificar exige datosModificados (400 si falta)', async () => {
  const propuesta = buscar('epp');
  const { status } = await peticion('PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'modificar' });
  assert.equal(status, 400);
});

test('N17-motor-base: modificar con datosModificados guarda el dato editado', async () => {
  const propuesta = buscar('epp');
  const { status, datos: cuerpo } = await peticion('PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, {
    accion: 'modificar',
    datosModificados: { nombreEditado: 'Guantes de nitrilo reforzados' },
    comentario: 'Se ajusta la especificacion para esta empresa.',
  });
  assert.equal(status, 200, JSON.stringify(cuerpo));
  assert.equal(cuerpo.propuesta.estado, 'modificada');
  assert.equal(cuerpo.propuesta.datos_confirmados?.nombreEditado, 'Guantes de nitrilo reforzados');
});

test('N17-motor-base: una propuesta ya revisada no se puede volver a revisar (409)', async () => {
  const propuesta = buscar('area'); // ya aceptada en la prueba anterior
  const { status } = await peticion('PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'rechazar' });
  assert.equal(status, 409);
});

test('N17-motor-base: rechazar una propuesta y volver a generar NO la revive (respeta la decision)', async () => {
  const rechazada = buscar('riesgo'); // rechazada en una prueba anterior
  const { status, datos: cuerpo } = await peticion('POST', '/configuracion-sectorial/propuestas/generar', tokenAdminA, {});
  assert.equal(status, 201, JSON.stringify(cuerpo));

  const listado = await peticion('GET', `/configuracion-sectorial/propuestas?tipo=riesgo`, tokenAdminA);
  const mismaFila = listado.datos.propuestas.find((p) => p.id === rechazada.id);
  assert.ok(mismaFila, 'La fila original debe seguir existiendo.');
  assert.equal(mismaFila.estado, 'rechazada', 'Regenerar no debe revertir una decision ya tomada.');
});

// ------------------------------------------------------------
// Aislamiento multi-tenant (IDOR): B no puede tocar propuestas de A.
// ------------------------------------------------------------
test('N17-motor-base: la organizacion B no puede confirmar una propuesta de A aunque conozca su ID (404)', async () => {
  const propuesta = buscar('kpi');
  const { status } = await peticion('PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminB, { accion: 'aceptar' });
  assert.equal(status, 404, 'Debe comportarse como si no existiera para una organizacion ajena, nunca 403 (no debe confirmar ni la existencia del recurso).');
});

// ------------------------------------------------------------
// Historial de confirmaciones (G-16-07: auditoria de cambios).
// ------------------------------------------------------------
test('N17-motor-base: cada confirmacion queda en el historial append-only', async () => {
  const propuesta = buscar('area'); // aceptada mas arriba
  const historial = await queryComoSuperadmin(
    `SELECT accion FROM confirmaciones_configuracion_sectorial WHERE propuesta_id = $1 ORDER BY creado_en`,
    [propuesta.id]
  );
  const acciones = historial.rows.map((r) => r.accion);
  assert.deepEqual(acciones, ['generada', 'aceptada']);
});

test('N17-motor-base: generar y confirmar quedan registrados en la auditoria general', async () => {
  const generarAuditado = await queryComoSuperadmin(
    `SELECT id FROM auditoria WHERE accion = 'generar_propuestas_configuracion_sectorial' ORDER BY creado_en DESC LIMIT 1`
  );
  assert.equal(generarAuditado.rows.length, 1);

  const confirmarAuditado = await queryComoSuperadmin(
    `SELECT id FROM auditoria WHERE accion = 'confirmar_propuesta_configuracion_sectorial' ORDER BY creado_en DESC LIMIT 1`
  );
  assert.equal(confirmarAuditado.rows.length, 1);
});
