// ============================================================
// CREADO en Auditoria N.17, hallazgo CRITICO C-17-03: "el motor
// todavia PROPONE y registra decisiones, pero no materializa
// automaticamente las propuestas aceptadas en las entidades
// reales". Este archivo cubre el primer tipo materializado
// ('area', elegido por el usuario) -- ver MATERIALIZADORES en
// configuracionSectorialController.js y migration_084.
//
//   - Aceptar una propuesta de tipo 'area' SI crea la fila real en
//     areas_organizacion (no solo cambia el estado de la propuesta).
//   - La propuesta queda con aplicado=true y con la referencia
//     (entidad_materializada_tabla/id) al objeto creado.
//   - Aceptar dos propuestas de 'area' que resultan en el MISMO
//     nombre (organizacion_id, nombre) NUNCA duplica la fila --
//     reutiliza la existente (indicacion explicita de C-17-03: "no
//     duplicar elementos existentes").
//   - Modificar una propuesta de 'area' materializa el nombre
//     EDITADO, no el original propuesto.
//   - Rechazar una propuesta de 'area' NUNCA crea nada en
//     areas_organizacion.
//   (La confirmacion de que los OTROS tipos aun sin materializador
//   no se ven afectados vivio aqui mientras C-17-03 estuvo a medio
//   camino -- con los 7 tipos ya materializados, ver el archivo de
//   pruebas propio de cada tipo, incluido
//   n17_c17_03_materializacion_kpis.test.js para el ultimo.)
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
});

after(async () => {
  detenerServidor();
  await limpiar();
});

function buscarPropuestaArea(propuestas, claveItem) {
  const encontrada = propuestas.find((p) => p.tipo === 'area' && p.clave_item === claveItem);
  assert.ok(encontrada, `Debia existir una propuesta de tipo 'area' con clave_item '${claveItem}'.`);
  return encontrada;
}

test('C-17-03: aceptar una propuesta de area crea la fila real en areas_organizacion', async () => {
  const generar = await peticion('POST', '/configuracion-sectorial/propuestas/generar', tokenAdminA, {});
  assert.equal(generar.status, 201, JSON.stringify(generar.datos));

  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=area', tokenAdminA);
  const propuesta = buscarPropuestaArea(listado.datos.propuestas, 'Emergencias');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 200, JSON.stringify(confirmar.datos));
  assert.equal(confirmar.datos.propuesta.aplicado, true,
    'C-17-03: aceptar una propuesta de area debe dejarla aplicado=true (materializada), no solo "aceptada".');
  assert.equal(confirmar.datos.propuesta.entidad_materializada_tabla, 'areas_organizacion');
  assert.ok(confirmar.datos.propuesta.entidad_materializada_id, 'Debe quedar el id del area real creada.');

  const filaReal = await queryComoSuperadmin(
    `SELECT id, nombre, organizacion_id, origen FROM areas_organizacion WHERE id = $1`,
    [confirmar.datos.propuesta.entidad_materializada_id]
  );
  assert.equal(filaReal.rows.length, 1, 'La fila real en areas_organizacion debe existir de verdad, no solo la referencia.');
  assert.equal(filaReal.rows[0].nombre, 'Emergencias');
  assert.equal(filaReal.rows[0].organizacion_id, datos.orgAId);
  assert.equal(filaReal.rows[0].origen, 'sectorial');

  const areasListadas = await peticion('GET', '/areas-organizacion', tokenAdminA);
  assert.equal(areasListadas.status, 200);
  assert.ok(
    areasListadas.datos.areas.some((a) => a.nombre === 'Emergencias'),
    'GET /areas-organizacion debe reflejar el area recien materializada.'
  );
});

test('C-17-03: rechazar una propuesta de area NUNCA crea nada en areas_organizacion', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=area', tokenAdminA);
  const propuesta = buscarPropuestaArea(listado.datos.propuestas, 'Quirofano');

  const rechazar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'rechazar' }
  );
  assert.equal(rechazar.status, 200, JSON.stringify(rechazar.datos));
  assert.equal(rechazar.datos.propuesta.aplicado, false);
  assert.equal(rechazar.datos.propuesta.entidad_materializada_id, null);

  const filaReal = await queryComoSuperadmin(
    `SELECT id FROM areas_organizacion WHERE organizacion_id = $1 AND nombre = 'Quirofano'`,
    [datos.orgAId]
  );
  assert.equal(filaReal.rows.length, 0, 'Rechazar jamas debe crear una fila real.');
});

test('C-17-03: modificar una propuesta de area materializa el nombre EDITADO, no el propuesto originalmente', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=area', tokenAdminA);
  const propuesta = buscarPropuestaArea(listado.datos.propuestas, 'Farmacia');

  const modificar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA,
    { accion: 'modificar', datosModificados: 'Farmacia Central' }
  );
  assert.equal(modificar.status, 200, JSON.stringify(modificar.datos));
  assert.equal(modificar.datos.propuesta.aplicado, true);

  const filaOriginal = await queryComoSuperadmin(
    `SELECT id FROM areas_organizacion WHERE organizacion_id = $1 AND nombre = 'Farmacia'`,
    [datos.orgAId]
  );
  assert.equal(filaOriginal.rows.length, 0, 'No debe materializarse el nombre propuesto original cuando se modifico.');

  const filaEditada = await queryComoSuperadmin(
    `SELECT id FROM areas_organizacion WHERE id = $1 AND nombre = 'Farmacia Central'`,
    [modificar.datos.propuesta.entidad_materializada_id]
  );
  assert.equal(filaEditada.rows.length, 1, 'Debe materializarse el nombre EDITADO.');
});

test('C-17-03: aceptar una propuesta cuyo nombre YA existe como area real reutiliza la fila, no la duplica', async () => {
  // 'Administracion' todavia esta pendiente (no se toco en los tests
  // anteriores) -- se crea a mano una fila real con ese mismo nombre
  // ANTES de aceptar la propuesta, simulando que la organizacion ya
  // tenia esa area por otra via.
  const preexistente = await queryComoSuperadmin(
    `INSERT INTO areas_organizacion (organizacion_id, nombre, origen)
     VALUES ($1, 'Administracion', 'manual') RETURNING id`,
    [datos.orgAId]
  );
  const idPreexistente = preexistente.rows[0].id;

  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=area', tokenAdminA);
  const propuesta = buscarPropuestaArea(listado.datos.propuestas, 'Administracion');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 200, JSON.stringify(confirmar.datos));
  assert.equal(
    confirmar.datos.propuesta.entidad_materializada_id, idPreexistente,
    'C-17-03: debe reutilizar la fila real ya existente con ese nombre, no crear una segunda.'
  );

  const conteo = await queryComoSuperadmin(
    `SELECT count(*)::int AS n FROM areas_organizacion WHERE organizacion_id = $1 AND nombre = 'Administracion'`,
    [datos.orgAId]
  );
  assert.equal(conteo.rows[0].n, 1, 'Nunca debe quedar mas de una fila real para el mismo nombre de area.');
});
