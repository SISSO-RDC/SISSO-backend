// ============================================================
// CREADO en Auditoria N.14 (hallazgo CRITICO C14-04, P0 y G14-12,
// P1): demuestra que el gobierno de finalidad de tratamiento es un
// INVARIANTE verificable, no solo documentacion. Consulta
// information_schema directamente (no un mock, no una lista
// mantenida a mano) para confirmar que:
//   1. Cada tabla listada en gobierno_datos_inventario
//      (migration_069) tiene su columna de finalidad en NOT NULL.
//   2. Intentar insertar una fila sin finalidad_tratamiento_codigo
//      en una tabla sensible real (evaluaciones_ocupacionales)
//      falla a nivel de base de datos.
//   3. No existe ninguna tabla marcada 'sensible' o 'personal' en
//      el inventario cuya columna de finalidad sea nullable (evita
//      que un futuro ALTER TABLE ... DROP NOT NULL pase
//      desapercibido).
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { query, pool, queryComoSuperadmin } = require('../src/db/pool');
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

test('Gobierno de datos: toda tabla del inventario tiene su columna de finalidad en NOT NULL', async () => {
  const inventario = await query(`SELECT tabla, columna_finalidad, categoria_datos FROM gobierno_datos_inventario`);
  assert.ok(inventario.rows.length >= 20, 'El inventario de gobierno de datos deberia cubrir al menos las 20+ tablas sensibles/personales conocidas.');

  for (const fila of inventario.rows) {
    const res = await query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = $1 AND column_name = $2`,
      [fila.tabla, fila.columna_finalidad]
    );
    assert.equal(res.rows.length, 1, `La tabla ${fila.tabla} deberia tener la columna ${fila.columna_finalidad}.`);
    assert.equal(
      res.rows[0].is_nullable, 'NO',
      `La tabla ${fila.tabla} (categoria: ${fila.categoria_datos}) tiene ${fila.columna_finalidad} NULLABLE -- el gobierno de datos NO esta siendo forzado por la base de datos (C14-04).`
    );
  }
});

test('Gobierno de datos: la base de datos RECHAZA insertar una evaluacion ocupacional sin finalidad_tratamiento_codigo', async () => {
  // Se usa queryComoSuperadmin (igual que tests/helpers/seed.js) para
  // aislar lo que se quiere probar aqui -- el constraint NOT NULL --
  // de la politica RLS de contexto de sesion, que ya tiene su propia
  // cobertura dedicada en tests/rls.test.js.
  await assert.rejects(
    queryComoSuperadmin(
      `INSERT INTO evaluaciones_ocupacionales (organizacion_id, trabajador_id, medico_id, tipo_evaluacion, fecha_atencion, finalidad_tratamiento_codigo)
       VALUES ($1, $2, $3, 'ingreso', CURRENT_DATE, NULL)`,
      [datos.orgAId, datos.trabajadorAId, datos.usuarios.medico.id]
    ),
    /null value|violates not-null/i,
    'Insertar NULL explicito en finalidad_tratamiento_codigo deberia ser rechazado por la base de datos, no solo evitado por convencion de la aplicacion.'
  );
});

test('Gobierno de datos: ninguna tabla sensible/personal del inventario quedo con finalidad nullable', async () => {
  const res = await query(`
    SELECT gi.tabla
    FROM gobierno_datos_inventario gi
    JOIN information_schema.columns c
      ON c.table_name = gi.tabla AND c.column_name = gi.columna_finalidad
    WHERE gi.categoria_datos IN ('sensible', 'personal') AND c.is_nullable = 'YES'
  `);
  assert.equal(res.rows.length, 0, `Tablas sensibles/personales con finalidad nullable: ${res.rows.map((r) => r.tabla).join(', ')}`);
});
