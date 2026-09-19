// ============================================================
// Auditoria N.17, C-17-03 -- segundo tipo materializado: 'puesto'.
// Ver n17_c17_03_materializacion_areas.test.js para el primero
// ('area') y para la explicacion general del hallazgo.
//
// Este archivo cubre ademas el hallazgo de datos encontrado al
// implementar este lote: catalogo_sectores.puestos_frecuentes
// estaba vacio en los 14 sectores (ver migration_085) -- sin la
// migracion 085, /propuestas/generar nunca produciria una sola
// propuesta de tipo 'puesto' para probar.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { iniciarServidor, detenerServidor } = require('./helpers/servidor');
const { iniciarSesionCompleta, peticion } = require('./helpers/cliente');
const { sembrar, limpiar } = require('./helpers/seed');
const { queryComoSuperadmin } = require('../src/db/pool');

let datos;
let tokenAdminA;

before(async () => {
  await limpiar();
  datos = await sembrar();
  await iniciarServidor();

  tokenAdminA = await iniciarSesionCompleta(datos.usuarios.admin.email, datos.passwordPrueba, datos.secretoTotp);

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

function buscarPropuestaPuesto(propuestas, claveItem) {
  const encontrada = propuestas.find((p) => p.tipo === 'puesto' && p.clave_item === claveItem);
  assert.ok(encontrada, `Debia existir una propuesta de tipo 'puesto' con clave_item '${claveItem}'.`);
  return encontrada;
}

test('C-17-03: migration_085 -- el sector salud SI genera propuestas de tipo puesto (antes el catalogo estaba vacio)', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=puesto', tokenAdminA);
  assert.equal(listado.status, 200);
  assert.ok(listado.datos.propuestas.length > 0,
    'Sin migration_085, puestos_frecuentes estaba vacio y esto habria dado 0 propuestas.');
});

test('C-17-03: aceptar una propuesta de puesto crea la fila real en puestos_trabajo, con el area sugerida', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=puesto', tokenAdminA);
  const propuesta = buscarPropuestaPuesto(listado.datos.propuestas, 'Medico general');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 200, JSON.stringify(confirmar.datos));
  assert.equal(confirmar.datos.propuesta.aplicado, true);
  assert.equal(confirmar.datos.propuesta.entidad_materializada_tabla, 'puestos_trabajo');
  assert.ok(confirmar.datos.propuesta.entidad_materializada_id);

  const filaReal = await queryComoSuperadmin(
    `SELECT nombre_puesto, area, organizacion_id FROM puestos_trabajo WHERE id = $1`,
    [confirmar.datos.propuesta.entidad_materializada_id]
  );
  assert.equal(filaReal.rows.length, 1);
  assert.equal(filaReal.rows[0].nombre_puesto, 'Medico general');
  assert.equal(filaReal.rows[0].area, 'Consultorios');
  assert.equal(filaReal.rows[0].organizacion_id, datos.orgAId);
});

test('C-17-03: aceptar una propuesta de puesto cuyo nombre YA existe en puestos_trabajo reutiliza la fila, no la duplica', async () => {
  // 'Enfermero/a' se crea a mano ANTES de aceptar la propuesta
  // correspondiente, simulando que la organizacion ya la habia
  // dado de alta manualmente por /puestos-trabajo (como ya podian
  // hacer desde antes de este lote).
  const preexistente = await queryComoSuperadmin(
    `INSERT INTO puestos_trabajo (organizacion_id, nombre_puesto, area, creado_por)
     VALUES ($1, 'Enfermero/a', 'Emergencias', $2) RETURNING id`,
    [datos.orgAId, datos.usuarios.admin.id]
  );
  const idPreexistente = preexistente.rows[0].id;

  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=puesto', tokenAdminA);
  const propuesta = buscarPropuestaPuesto(listado.datos.propuestas, 'Enfermero/a');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 200, JSON.stringify(confirmar.datos));
  assert.equal(confirmar.datos.propuesta.entidad_materializada_id, idPreexistente,
    'Debe reutilizar el puesto ya existente con ese nombre, no crear un duplicado.');

  const conteo = await queryComoSuperadmin(
    `SELECT count(*)::int AS n FROM puestos_trabajo WHERE organizacion_id = $1 AND lower(nombre_puesto) = lower('Enfermero/a')`,
    [datos.orgAId]
  );
  assert.equal(conteo.rows[0].n, 1);
});

test('C-17-03: rechazar una propuesta de puesto NUNCA crea nada en puestos_trabajo', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=puesto', tokenAdminA);
  const propuesta = buscarPropuestaPuesto(listado.datos.propuestas, 'Anestesiologo');

  const rechazar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'rechazar' }
  );
  assert.equal(rechazar.status, 200, JSON.stringify(rechazar.datos));
  assert.equal(rechazar.datos.propuesta.aplicado, false);

  const filaReal = await queryComoSuperadmin(
    `SELECT id FROM puestos_trabajo WHERE organizacion_id = $1 AND nombre_puesto = 'Anestesiologo'`,
    [datos.orgAId]
  );
  assert.equal(filaReal.rows.length, 0);
});

test('C-17-03: modificar una propuesta de puesto materializa el nombre y el area EDITADOS', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=puesto', tokenAdminA);
  const propuesta = buscarPropuestaPuesto(listado.datos.propuestas, 'Camillero');

  const modificar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA,
    { accion: 'modificar', datosModificados: { nombre: 'Camillero de UCI', area: 'UCI / Cuidados intensivos' } }
  );
  assert.equal(modificar.status, 200, JSON.stringify(modificar.datos));
  assert.equal(modificar.datos.propuesta.aplicado, true);

  const filaEditada = await queryComoSuperadmin(
    `SELECT nombre_puesto, area FROM puestos_trabajo WHERE id = $1`,
    [modificar.datos.propuesta.entidad_materializada_id]
  );
  assert.equal(filaEditada.rows[0].nombre_puesto, 'Camillero de UCI');
  assert.equal(filaEditada.rows[0].area, 'UCI / Cuidados intensivos');
});
