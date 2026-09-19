// ============================================================
// Auditoria N.17, C-17-03 -- cuarto tipo materializado: 'riesgo'.
// Ver n17_c17_03_materializacion_areas.test.js para la explicacion
// general y para el patron de tabla nueva (riesgos_organizacion
// sigue el mismo criterio que areas_organizacion, no el de
// puesto/epp -- ver migration_086 para por que NO se usa
// matriz_riesgos).
//
// 'riesgo' es exclusivo del rol sso (ver ROLES_POR_TIPO), no admin.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { iniciarServidor, detenerServidor } = require('./helpers/servidor');
const { iniciarSesionCompleta, peticion } = require('./helpers/cliente');
const { sembrar, limpiar } = require('./helpers/seed');
const { queryComoSuperadmin } = require('../src/db/pool');

let datos;
let tokenAdminA;
let tokenSsoA;

before(async () => {
  await limpiar();
  datos = await sembrar();
  await iniciarServidor();

  tokenAdminA = await iniciarSesionCompleta(datos.usuarios.admin.email, datos.passwordPrueba, datos.secretoTotp);
  tokenSsoA = await iniciarSesionCompleta(datos.usuarios.sso.email, datos.passwordPrueba, datos.secretoTotp);

  const aplicar = await peticion('PUT', '/organizacion/perfil-sectorial', tokenAdminA, {
    sectorClave: 'salud', numeroTrabajadoresDeclarado: 50, riesgosPresentes: [],
  });
  assert.equal(aplicar.status, 200, JSON.stringify(aplicar.datos));

  const generar = await peticion('POST', '/configuracion-sectorial/propuestas/generar', tokenAdminA, {});
  assert.equal(generar.status, 201, JSON.stringify(generar.datos));
});

after(async () => {
  detenerServidor();
  await limpiar();
});

function buscarPropuestaRiesgo(propuestas, claveItem) {
  const encontrada = propuestas.find((p) => p.tipo === 'riesgo' && p.clave_item === claveItem);
  assert.ok(encontrada, `Debia existir una propuesta de tipo 'riesgo' con clave_item '${claveItem}'.`);
  return encontrada;
}

test('C-17-03: aceptar (sso) una propuesta de riesgo crea la fila real en riesgos_organizacion con su nivel', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=riesgo', tokenSsoA);
  const propuesta = buscarPropuestaRiesgo(listado.datos.propuestas, 'Riesgo biologico');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenSsoA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 200, JSON.stringify(confirmar.datos));
  assert.equal(confirmar.datos.propuesta.aplicado, true);
  assert.equal(confirmar.datos.propuesta.entidad_materializada_tabla, 'riesgos_organizacion');

  const filaReal = await queryComoSuperadmin(
    `SELECT nombre, nivel, descripcion, organizacion_id FROM riesgos_organizacion WHERE id = $1`,
    [confirmar.datos.propuesta.entidad_materializada_id]
  );
  assert.equal(filaReal.rows[0].nombre, 'Riesgo biologico');
  assert.equal(filaReal.rows[0].nivel, 'alto');
  assert.ok(filaReal.rows[0].descripcion);
  assert.equal(filaReal.rows[0].organizacion_id, datos.orgAId);

  const listadoReal = await peticion('GET', '/riesgos-organizacion', tokenSsoA);
  assert.equal(listadoReal.status, 200);
  assert.ok(listadoReal.datos.riesgos.some((r) => r.nombre === 'Riesgo biologico'));
});

test('C-17-03: admin NO puede confirmar una propuesta de riesgo (403) -- sigue siendo exclusivo de sso', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=riesgo', tokenAdminA);
  const propuesta = buscarPropuestaRiesgo(listado.datos.propuestas, 'Riesgo quimico');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 403);

  const filaReal = await queryComoSuperadmin(
    `SELECT id FROM riesgos_organizacion WHERE organizacion_id = $1 AND nombre = 'Riesgo quimico'`,
    [datos.orgAId]
  );
  assert.equal(filaReal.rows.length, 0, 'Un 403 nunca debe dejar un objeto materializado a medias.');
});

test('C-17-03: aceptar una propuesta de riesgo cuyo nombre YA existe reutiliza la fila, no la duplica', async () => {
  const preexistente = await queryComoSuperadmin(
    `INSERT INTO riesgos_organizacion (organizacion_id, nombre, nivel, origen)
     VALUES ($1, 'Riesgo ergonomico', 'medio', 'manual') RETURNING id`,
    [datos.orgAId]
  );

  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=riesgo', tokenSsoA);
  const propuesta = buscarPropuestaRiesgo(listado.datos.propuestas, 'Riesgo ergonomico');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenSsoA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 200, JSON.stringify(confirmar.datos));
  assert.equal(confirmar.datos.propuesta.entidad_materializada_id, preexistente.rows[0].id);

  const conteo = await queryComoSuperadmin(
    `SELECT count(*)::int AS n FROM riesgos_organizacion WHERE organizacion_id = $1 AND nombre = 'Riesgo ergonomico'`,
    [datos.orgAId]
  );
  assert.equal(conteo.rows[0].n, 1);
});

test('C-17-03: rechazar una propuesta de riesgo NUNCA crea nada en riesgos_organizacion', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=riesgo', tokenSsoA);
  const propuesta = buscarPropuestaRiesgo(listado.datos.propuestas, 'Riesgo psicosocial');

  const rechazar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenSsoA, { accion: 'rechazar' }
  );
  assert.equal(rechazar.status, 200, JSON.stringify(rechazar.datos));
  assert.equal(rechazar.datos.propuesta.aplicado, false);

  const filaReal = await queryComoSuperadmin(
    `SELECT id FROM riesgos_organizacion WHERE organizacion_id = $1 AND nombre = 'Riesgo psicosocial'`,
    [datos.orgAId]
  );
  assert.equal(filaReal.rows.length, 0);
});
