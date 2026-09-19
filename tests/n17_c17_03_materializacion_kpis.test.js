// ============================================================
// Auditoria N.17, C-17-03 -- septimo y ULTIMO tipo materializado:
// 'kpi'. Con este archivo se cierra por completo C-17-03: los 7
// tipos del motor sectorial (area, puesto, epp, riesgo, examen,
// herramienta_ergonomica, kpi) ya materializan su objeto real al
// aceptar/modificar una propuesta.
//
// 'kpi' es exclusivo del rol admin (ver ROLES_POR_TIPO).
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

function buscarPropuestaKpi(propuestas, claveItem) {
  const encontrada = propuestas.find((p) => p.tipo === 'kpi' && p.clave_item === claveItem);
  assert.ok(encontrada, `Debia existir una propuesta de tipo 'kpi' con clave_item '${claveItem}'.`);
  return encontrada;
}

test('C-17-03: aceptar una propuesta de kpi crea la fila real en kpis_organizacion con su meta', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=kpi', tokenAdminA);
  const propuesta = buscarPropuestaKpi(listado.datos.propuestas, 'Cumplimiento EMO anual');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 200, JSON.stringify(confirmar.datos));
  assert.equal(confirmar.datos.propuesta.aplicado, true);
  assert.equal(confirmar.datos.propuesta.entidad_materializada_tabla, 'kpis_organizacion');

  const filaReal = await queryComoSuperadmin(
    `SELECT nombre, meta, organizacion_id FROM kpis_organizacion WHERE id = $1`,
    [confirmar.datos.propuesta.entidad_materializada_id]
  );
  assert.equal(filaReal.rows[0].nombre, 'Cumplimiento EMO anual');
  assert.equal(filaReal.rows[0].meta, '100%');
  assert.equal(filaReal.rows[0].organizacion_id, datos.orgAId);

  const listadoReal = await peticion('GET', '/kpis-organizacion', tokenAdminA);
  assert.equal(listadoReal.status, 200);
  assert.ok(listadoReal.datos.kpis.some((k) => k.nombre === 'Cumplimiento EMO anual'));
});

test('C-17-03: aceptar una propuesta de kpi cuyo nombre YA existe reutiliza la fila, no la duplica', async () => {
  const preexistente = await queryComoSuperadmin(
    `INSERT INTO kpis_organizacion (organizacion_id, nombre, meta, origen)
     VALUES ($1, 'Tasa de accidentes biologicos', '< 1 por 100 trab/año (meta interna mas estricta)', 'manual')
     RETURNING id`,
    [datos.orgAId]
  );

  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=kpi', tokenAdminA);
  const propuesta = buscarPropuestaKpi(listado.datos.propuestas, 'Tasa de accidentes biologicos');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 200, JSON.stringify(confirmar.datos));
  assert.equal(confirmar.datos.propuesta.entidad_materializada_id, preexistente.rows[0].id);

  const filaReal = await queryComoSuperadmin(`SELECT meta FROM kpis_organizacion WHERE id = $1`, [preexistente.rows[0].id]);
  assert.equal(filaReal.rows[0].meta, '< 1 por 100 trab/año (meta interna mas estricta)',
    'Reutilizar NO debe pisar la meta mas estricta que la organizacion ya habia adoptado.');
});

test('C-17-03: rechazar una propuesta de kpi NUNCA crea nada en kpis_organizacion', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=kpi', tokenAdminA);
  const propuesta = buscarPropuestaKpi(listado.datos.propuestas, 'Cobertura de vacunacion Hep B');

  const rechazar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'rechazar' }
  );
  assert.equal(rechazar.status, 200, JSON.stringify(rechazar.datos));
  assert.equal(rechazar.datos.propuesta.aplicado, false);

  const filaReal = await queryComoSuperadmin(
    `SELECT id FROM kpis_organizacion WHERE organizacion_id = $1 AND nombre = 'Cobertura de vacunacion Hep B'`,
    [datos.orgAId]
  );
  assert.equal(filaReal.rows.length, 0);
});

test('C-17-03: modificar una propuesta de kpi con una meta explicita materializa esa meta, no la original', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=kpi', tokenAdminA);
  const propuesta = buscarPropuestaKpi(listado.datos.propuestas, 'Casos de lumbalgia ocupacional');

  const modificar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA,
    { accion: 'modificar', datosModificados: { nombre: 'Casos de lumbalgia ocupacional', meta: '< 2%' } }
  );
  assert.equal(modificar.status, 200, JSON.stringify(modificar.datos));

  const filaEditada = await queryComoSuperadmin(
    `SELECT meta FROM kpis_organizacion WHERE id = $1`,
    [modificar.datos.propuesta.entidad_materializada_id]
  );
  assert.equal(filaEditada.rows[0].meta, '< 2%');
});
