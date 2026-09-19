// ============================================================
// Auditoria N.17, C-17-03 -- tercer tipo materializado: 'epp'.
// Ver n17_c17_03_materializacion_areas.test.js para el primero y
// n17_c17_03_materializacion_puestos.test.js para el segundo.
//
// A diferencia de 'puesto', el catalogo sectorial epp_sugerido YA
// estaba poblado (13 de 14 sectores) antes de este lote -- no hizo
// falta ninguna migracion de datos, solo el materializador.
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

function buscarPropuestaEpp(propuestas, claveItem) {
  const encontrada = propuestas.find((p) => p.tipo === 'epp' && p.clave_item === claveItem);
  assert.ok(encontrada, `Debia existir una propuesta de tipo 'epp' con clave_item '${claveItem}'.`);
  return encontrada;
}

test("C-17-03: aceptar una propuesta de epp crea la fila real en catalogo_epp con tipo='Sugerido por sector'", async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=epp', tokenAdminA);
  const propuesta = buscarPropuestaEpp(listado.datos.propuestas, 'Mascarilla N95');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 200, JSON.stringify(confirmar.datos));
  assert.equal(confirmar.datos.propuesta.aplicado, true);
  assert.equal(confirmar.datos.propuesta.entidad_materializada_tabla, 'catalogo_epp');
  assert.ok(confirmar.datos.propuesta.entidad_materializada_id);

  const filaReal = await queryComoSuperadmin(
    `SELECT nombre, tipo, organizacion_id FROM catalogo_epp WHERE id = $1`,
    [confirmar.datos.propuesta.entidad_materializada_id]
  );
  assert.equal(filaReal.rows.length, 1);
  assert.equal(filaReal.rows[0].nombre, 'Mascarilla N95');
  assert.equal(filaReal.rows[0].tipo, 'Sugerido por sector',
    "El catalogo sectorial solo trae el nombre, sin tipo/norma verificada -- nunca se debe inventar una norma especifica.");
  assert.equal(filaReal.rows[0].organizacion_id, datos.orgAId);
});

test('C-17-03: aceptar una propuesta de epp cuyo nombre YA existe en catalogo_epp reutiliza la fila, no la duplica', async () => {
  const preexistente = await queryComoSuperadmin(
    `INSERT INTO catalogo_epp (organizacion_id, nombre, tipo, norma_referencia, creado_por)
     VALUES ($1, 'Gafas protectoras', 'Protección visual', 'ANSI Z87.1', $2) RETURNING id`,
    [datos.orgAId, datos.usuarios.admin.id]
  );
  const idPreexistente = preexistente.rows[0].id;

  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=epp', tokenAdminA);
  const propuesta = buscarPropuestaEpp(listado.datos.propuestas, 'Gafas protectoras');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 200, JSON.stringify(confirmar.datos));
  assert.equal(confirmar.datos.propuesta.entidad_materializada_id, idPreexistente,
    'Debe reutilizar el EPP ya existente (con su tipo/norma reales ya cargados), no crear un duplicado generico.');

  const filaReal = await queryComoSuperadmin(`SELECT tipo, norma_referencia FROM catalogo_epp WHERE id = $1`, [idPreexistente]);
  assert.equal(filaReal.rows[0].tipo, 'Protección visual',
    'Reutilizar NO debe pisar el tipo/norma que la organizacion ya tenia cargados a mano.');
  assert.equal(filaReal.rows[0].norma_referencia, 'ANSI Z87.1');
});

test('C-17-03: rechazar una propuesta de epp NUNCA crea nada en catalogo_epp', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=epp', tokenAdminA);
  const propuesta = buscarPropuestaEpp(listado.datos.propuestas, 'Bata / Mandil');

  const rechazar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'rechazar' }
  );
  assert.equal(rechazar.status, 200, JSON.stringify(rechazar.datos));
  assert.equal(rechazar.datos.propuesta.aplicado, false);

  const filaReal = await queryComoSuperadmin(
    `SELECT id FROM catalogo_epp WHERE organizacion_id = $1 AND nombre = 'Bata / Mandil'`,
    [datos.orgAId]
  );
  assert.equal(filaReal.rows.length, 0);
});

test('C-17-03: modificar una propuesta de epp con un tipo explicito respeta ese tipo (no usa el generico)', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=epp', tokenAdminA);
  const propuesta = buscarPropuestaEpp(listado.datos.propuestas, 'Calzado antideslizante');

  const modificar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA,
    { accion: 'modificar', datosModificados: { nombre: 'Calzado antideslizante tipo III', tipo: 'Protección de pies' } }
  );
  assert.equal(modificar.status, 200, JSON.stringify(modificar.datos));

  const filaEditada = await queryComoSuperadmin(
    `SELECT nombre, tipo FROM catalogo_epp WHERE id = $1`,
    [modificar.datos.propuesta.entidad_materializada_id]
  );
  assert.equal(filaEditada.rows[0].nombre, 'Calzado antideslizante tipo III');
  assert.equal(filaEditada.rows[0].tipo, 'Protección de pies');
});
