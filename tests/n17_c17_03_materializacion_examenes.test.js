// ============================================================
// Auditoria N.17, C-17-03 -- quinto tipo materializado: 'examen'.
// Ver n17_c17_03_materializacion_riesgos.test.js para el patron de
// tabla nueva analogo (examenes_organizacion sigue el mismo
// criterio -- ver migration_087 para por que NO se usa
// audiometria/espirometria/visiometria/historia_clinica).
//
// 'examen' es exclusivo del rol medico (ver ROLES_POR_TIPO).
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { iniciarServidor, detenerServidor } = require('./helpers/servidor');
const { iniciarSesionCompleta, peticion } = require('./helpers/cliente');
const { sembrar, limpiar } = require('./helpers/seed');
const { queryComoSuperadmin } = require('../src/db/pool');

let datos;
let tokenAdminA;
let tokenMedicoA;

before(async () => {
  await limpiar();
  datos = await sembrar();
  await iniciarServidor();

  tokenAdminA = await iniciarSesionCompleta(datos.usuarios.admin.email, datos.passwordPrueba, datos.secretoTotp);
  tokenMedicoA = await iniciarSesionCompleta(datos.usuarios.medico.email, datos.passwordPrueba, datos.secretoTotp);

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

function buscarPropuestaExamen(propuestas, claveItem) {
  const encontrada = propuestas.find((p) => p.tipo === 'examen' && p.clave_item === claveItem);
  assert.ok(encontrada, `Debia existir una propuesta de tipo 'examen' con clave_item '${claveItem}'.`);
  return encontrada;
}

test('C-17-03: aceptar (medico) una propuesta de examen crea la fila real con tipo/frecuencia, sin norma inventada', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=examen', tokenMedicoA);
  const propuesta = buscarPropuestaExamen(listado.datos.propuestas, 'Radiografia de torax');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenMedicoA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 200, JSON.stringify(confirmar.datos));
  assert.equal(confirmar.datos.propuesta.aplicado, true);
  assert.equal(confirmar.datos.propuesta.entidad_materializada_tabla, 'examenes_organizacion');

  const filaReal = await queryComoSuperadmin(
    `SELECT nombre, tipo, frecuencia, norma_referencia, organizacion_id FROM examenes_organizacion WHERE id = $1`,
    [confirmar.datos.propuesta.entidad_materializada_id]
  );
  assert.equal(filaReal.rows[0].nombre, 'Radiografia de torax');
  assert.equal(filaReal.rows[0].tipo, 'Sugerido por sector');
  assert.equal(filaReal.rows[0].frecuencia, 'Ingreso + cada 2 anios');
  assert.equal(filaReal.rows[0].norma_referencia, null,
    'El catalogo sectorial trae normaReferencia:null -- nunca se debe inventar una norma.');
  assert.equal(filaReal.rows[0].organizacion_id, datos.orgAId);

  const listadoReal = await peticion('GET', '/examenes-organizacion', tokenMedicoA);
  assert.equal(listadoReal.status, 200);
  assert.ok(listadoReal.datos.examenes.some((e) => e.nombre === 'Radiografia de torax'));
});

test("C-17-03: admin NO puede confirmar una propuesta de examen (403) -- sigue siendo exclusivo de medico", async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=examen', tokenMedicoA);
  const propuesta = buscarPropuestaExamen(listado.datos.propuestas, 'Hemograma completo');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenAdminA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 403);

  const filaReal = await queryComoSuperadmin(
    `SELECT id FROM examenes_organizacion WHERE organizacion_id = $1 AND nombre = 'Hemograma completo'`,
    [datos.orgAId]
  );
  assert.equal(filaReal.rows.length, 0);
});

test('C-17-03: aceptar una propuesta de examen cuyo nombre YA existe reutiliza la fila, no la duplica', async () => {
  const preexistente = await queryComoSuperadmin(
    `INSERT INTO examenes_organizacion (organizacion_id, nombre, tipo, frecuencia, norma_referencia, origen)
     VALUES ($1, 'Audiometria tonal', 'Condicionado a exposición', 'Semestral', 'Acuerdo Ministerial 1404', 'manual')
     RETURNING id`,
    [datos.orgAId]
  );

  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=examen', tokenMedicoA);
  const propuesta = buscarPropuestaExamen(listado.datos.propuestas, 'Audiometria tonal');

  const confirmar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenMedicoA, { accion: 'aceptar' }
  );
  assert.equal(confirmar.status, 200, JSON.stringify(confirmar.datos));
  assert.equal(confirmar.datos.propuesta.entidad_materializada_id, preexistente.rows[0].id);

  const filaReal = await queryComoSuperadmin(`SELECT frecuencia, norma_referencia FROM examenes_organizacion WHERE id = $1`, [preexistente.rows[0].id]);
  assert.equal(filaReal.rows[0].frecuencia, 'Semestral',
    'Reutilizar NO debe pisar la frecuencia/norma que el medico ya habia definido a mano.');
  assert.equal(filaReal.rows[0].norma_referencia, 'Acuerdo Ministerial 1404');
});

test('C-17-03: rechazar una propuesta de examen NUNCA crea nada en examenes_organizacion', async () => {
  const listado = await peticion('GET', '/configuracion-sectorial/propuestas?tipo=examen', tokenMedicoA);
  const propuesta = buscarPropuestaExamen(listado.datos.propuestas, 'Evaluacion psicologica');

  const rechazar = await peticion(
    'PUT', `/configuracion-sectorial/propuestas/${propuesta.id}/confirmar`, tokenMedicoA, { accion: 'rechazar' }
  );
  assert.equal(rechazar.status, 200, JSON.stringify(rechazar.datos));
  assert.equal(rechazar.datos.propuesta.aplicado, false);

  const filaReal = await queryComoSuperadmin(
    `SELECT id FROM examenes_organizacion WHERE organizacion_id = $1 AND nombre = 'Evaluacion psicologica'`,
    [datos.orgAId]
  );
  assert.equal(filaReal.rows.length, 0);
});

test('C-17-03: la base de datos rechaza un tipo de examen fuera de los 3 valores establecidos (no reintroduce "Obligatorio")', async () => {
  await assert.rejects(
    queryComoSuperadmin(
      `INSERT INTO examenes_organizacion (organizacion_id, nombre, tipo) VALUES ($1, 'Prueba X', 'Obligatorio')`,
      [datos.orgAId]
    ),
    /violates check constraint/,
  );
});
