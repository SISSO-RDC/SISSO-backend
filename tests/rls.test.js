// ============================================================
// Prueba dedicada al hallazgo GRAVE G3: demuestra que RLS es una
// SEGUNDA barrera real, no solo teorica. Las pruebas de
// seguridad.test.js ya prueban que la API (con sus controladores
// bien escritos) aisla correctamente -- pero eso no prueba que RLS
// este haciendo algo, porque el filtro WHERE organizacion_id del
// controlador ya alcanzaria por si solo.
//
// Esta prueba se salta el controlador por completo: ejecuta una
// consulta SQL DELIBERADAMENTE SIN "WHERE organizacion_id = ..."
// (el error humano exacto que la auditoria advierte que podria
// cometer un desarrollador futuro), usando directamente
// db/pool.js con un contexto de organizacion fijado a mano. Si RLS
// funciona de verdad, esa consulta "con el bug" solo debe devolver
// filas de la organizacion en contexto -- si RLS no estuviera
// activo (o el rol de conexion tuviera BYPASSRLS/fuera dueño sin
// FORCE), devolveria filas de TODAS las organizaciones.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { query, pool } = require('../src/db/pool');
const { ejecutarConContexto } = require('../src/utils/contextoSolicitud');
const { sembrar, limpiar } = require('./helpers/seed');

let datos;

before(async () => {
  await limpiar();
  datos = await sembrar();
});

after(async () => {
  await limpiar();
  await pool.end();
});

test('RLS: una consulta SIN "WHERE organizacion_id" (el bug exacto que teme la auditoria) sigue aislada gracias a la politica de base de datos', async () => {
  await new Promise((resolve, reject) => {
    ejecutarConContexto(
      { organizacionId: datos.orgAId, usuarioId: null, esSuperadmin: false },
      async () => {
        try {
          // Deliberadamente SIN organizacion_id en el WHERE -- esto es
          // lo que un controlador con un bug real ejecutaria.
          const resultado = await query('SELECT id, organizacion_id FROM trabajadores');
          const idsDevueltos = resultado.rows.map((r) => r.id);

          assert.ok(idsDevueltos.includes(datos.trabajadorAId), 'Deberia incluir al trabajador de la propia organizacion (A).');
          assert.ok(!idsDevueltos.includes(datos.trabajadorBId), 'RLS deberia haber ocultado al trabajador de la organizacion B, aunque la consulta no lo filtrara explicitamente.');
          assert.ok(
            resultado.rows.every((r) => r.organizacion_id === datos.orgAId),
            'Ninguna fila devuelta deberia pertenecer a una organizacion distinta de la que esta en contexto.'
          );
          resolve();
        } catch (err) {
          reject(err);
        }
      }
    );
  });
});

test('RLS: sin NINGUN contexto de organizacion ni superadmin, una consulta sin WHERE no devuelve nada de ninguna organizacion', async () => {
  await new Promise((resolve, reject) => {
    ejecutarConContexto(
      { organizacionId: null, usuarioId: null, esSuperadmin: false },
      async () => {
        try {
          const resultado = await query('SELECT id FROM trabajadores');
          const idsDevueltos = resultado.rows.map((r) => r.id);
          assert.ok(!idsDevueltos.includes(datos.trabajadorAId), 'Sin contexto de organizacion ni superadmin, no deberia ver nada de A.');
          assert.ok(!idsDevueltos.includes(datos.trabajadorBId), 'Sin contexto de organizacion ni superadmin, no deberia ver nada de B.');
          resolve();
        } catch (err) {
          reject(err);
        }
      }
    );
  });
});

test('RLS: con es_superadmin=true, una consulta sin WHERE si ve filas de ambas organizaciones (comportamiento esperado)', async () => {
  await new Promise((resolve, reject) => {
    ejecutarConContexto(
      { organizacionId: null, usuarioId: null, esSuperadmin: true },
      async () => {
        try {
          const resultado = await query('SELECT id FROM trabajadores WHERE id = ANY($1::uuid[])', [[datos.trabajadorAId, datos.trabajadorBId]]);
          const idsDevueltos = resultado.rows.map((r) => r.id);
          assert.ok(idsDevueltos.includes(datos.trabajadorAId), 'El superadmin deberia ver al trabajador de A.');
          assert.ok(idsDevueltos.includes(datos.trabajadorBId), 'El superadmin deberia ver tambien al trabajador de B.');
          resolve();
        } catch (err) {
          reject(err);
        }
      }
    );
  });
});
