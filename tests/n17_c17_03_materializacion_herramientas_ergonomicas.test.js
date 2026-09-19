// ============================================================
// Auditoria N.17, C-17-03 -- sexto tipo materializado:
// 'herramienta_ergonomica'. Ver
// n17_c17_03_materializacion_areas.test.js para la explicacion
// general y n17_c17_03_materializacion_riesgos.test.js para el
// patron de tabla nueva analogo (herramientas_ergonomicas_
// organizacion sigue el mismo criterio -- ver migration_088 para
// por que NO se usan evaluaciones_reba/rula/niosh).
//
// 'herramienta_ergonomica' es exclusivo del rol sso (ver
// ROLES_POR_TIPO).
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

function buscarPropuestaHerramienta(propuestas, claveItem) {
  const encontrada = propuestas.find((p) => p.tipo === 'herramienta_ergonomica' && p.clave_item === claveItem);
  assert.ok(encontrada, `Debia existir una propuesta de tipo 'herramienta_ergonomica' con clave_item '${claveItem}'.`);
  return encontrada;
}

test('C-17-03: aceptar (sso) una propuesta de herramienta_ergonomica crea la fila real en herramientas_ergonomicas_organizacion', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=herramienta_ergonomica', tokenSsoA);
  const propuesta = buscarPropuestaHerramienta(listado.datos.propuestas, 'Cuestionario Nordico');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenSsoA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 200, JSON.stringify(confirmar.datos));
  assert.equal(confirmar.datos.propuesta.aplicado, true);
  assert.equal(confirmar.datos.propuesta.entidad_materializada_tabla, 'herramientas_ergonomicas_organizacion');

  const filaReal = await queryComoSuperadmin(
    `SELECT nombre, organizacion_id FROM herramientas_ergonomicas_organizacion WHERE id = $1`,
    [confirmar.datos.propuesta.entidad_materializada_id]
  );
  assert.equal(filaReal.rows[0].nombre, 'Cuestionario Nordico');
  assert.equal(filaReal.rows[0].organizacion_id, datos.orgAId);

  const listadoReal = await peticion('GET', '/herramientas-ergonomicas-organizacion', tokenSsoA);
  assert.equal(listadoReal.status, 200);
  assert.ok(listadoReal.datos.herramientas.some((h) => h.nombre === 'Cuestionario Nordico'));
});

test("C-17-03: admin NO puede confirmar una propuesta de herramienta_ergonomica (403) -- sigue siendo exclusivo de sso", async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=herramienta_ergonomica', tokenSsoA);
  const propuesta = buscarPropuestaHerramienta(listado.datos.propuestas, 'RULA (trabajo en quirofano)');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 403);

  const filaReal = await queryComoSuperadmin(
    `SELECT id FROM herramientas_ergonomicas_organizacion WHERE organizacion_id = $1 AND nombre = 'RULA (trabajo en quirofano)'`,
    [datos.orgAId]
  );
  assert.equal(filaReal.rows.length, 0);
});

test('C-17-03: aceptar una propuesta de herramienta_ergonomica cuyo nombre YA existe reutiliza la fila, no la duplica', async () => {
  const preexistente = await queryComoSuperadmin(
    `INSERT INTO herramientas_ergonomicas_organizacion (organizacion_id, nombre, descripcion, origen)
     VALUES ($1, 'Analisis de carga postural', 'Definido a mano por el equipo SSO', 'manual') RETURNING id`,
    [datos.orgAId]
  );

  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=herramienta_ergonomica', tokenSsoA);
  const propuesta = buscarPropuestaHerramienta(listado.datos.propuestas, 'Analisis de carga postural');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenSsoA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 200, JSON.stringify(confirmar.datos));
  assert.equal(confirmar.datos.propuesta.entidad_materializada_id, preexistente.rows[0].id);

  const filaReal = await queryComoSuperadmin(`SELECT descripcion FROM herramientas_ergonomicas_organizacion WHERE id = $1`, [preexistente.rows[0].id]);
  assert.equal(filaReal.rows[0].descripcion, 'Definido a mano por el equipo SSO',
    'Reutilizar NO debe pisar la descripcion que el equipo SSO ya habia definido.');
});

test('C-17-03: rechazar una propuesta de herramienta_ergonomica NUNCA crea nada en herramientas_ergonomicas_organizacion', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=herramienta_ergonomica', tokenSsoA);
  const propuesta = buscarPropuestaHerramienta(listado.datos.propuestas, 'Evaluacion bipedestacion prolongada');

  const rechazar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenSsoA, { accion: 'rechazar' }
  );
  assert.equal(rechazar.status, 200, JSON.stringify(rechazar.datos));
  assert.equal(rechazar.datos.propuesta.aplicado, false);

  const filaReal = await queryComoSuperadmin(
    `SELECT id FROM herramientas_ergonomicas_organizacion WHERE organizacion_id = $1 AND nombre = 'Evaluacion bipedestacion prolongada'`,
    [datos.orgAId]
  );
  assert.equal(filaReal.rows.length, 0);
});

test('C-17-03: modificar una propuesta de herramienta_ergonomica materializa el nombre EDITADO', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=herramienta_ergonomica', tokenSsoA);
  const propuesta = buscarPropuestaHerramienta(listado.datos.propuestas, 'REBA (movilizacion pacientes)');

  const modificar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenSsoA,
    { accion: 'modificar', datosModificados: 'REBA (movilizacion de pacientes bariatricos)' }
  );
  assert.equal(modificar.status, 200, JSON.stringify(modificar.datos));

  const filaEditada = await queryComoSuperadmin(
    `SELECT nombre FROM herramientas_ergonomicas_organizacion WHERE id = $1`,
    [modificar.datos.propuesta.entidad_materializada_id]
  );
  assert.equal(filaEditada.rows[0].nombre, 'REBA (movilizacion de pacientes bariatricos)');
});
