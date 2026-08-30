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

const { query, pool, queryComoSuperadmin } = require('../src/db/pool');
const { ejecutarConContexto } = require('../src/utils/contextoSolicitud');
const { sembrar, limpiar } = require('./helpers/seed');
const { detectarContraindicaciones } = require('../src/aptitud/motorContraindicaciones');

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

// ------------------------------------------------------------
// CORRIGE el hallazgo CRITICO C12-01 (Auditoria Integral N.12):
// catalogo_exposiciones y reglas_contraindicacion tienen filas con
// organizacion_id NULL con significado explicito de "catalogo
// global compartido". migration_045 las bloqueaba con la politica
// generica; migration_058 las corrige. Estas pruebas verifican:
//   1. Un usuario de CUALQUIER organizacion ve las reglas globales
//      (ademas de las suyas propias, si las tuviera), y NUNCA ve
//      las de otra organizacion.
//   2. El motor de contraindicaciones SI detecta un caso de regla
//      global conocido (epilepsia + trabajo en alturas) usando
//      exactamente las filas que RLS deja pasar -- no solo que la
//      politica "permita" filas NULL, sino que el flujo de negocio
//      completo (RLS -> consulta del controlador -> motor) funcione.
//   3. Salvaguarda de regresion: si una migracion futura reintroduce
//      la politica generica sobre estas dos tablas, la prueba falla
//      en vez de descubrirse en produccion (correccion obligatoria
//      C12-01, punto 5).
// ------------------------------------------------------------
test('RLS C12-01: organizacion A ve reglas de contraindicacion globales (organizacion_id NULL) y las suyas propias, nunca las de B', async () => {
  await new Promise((resolve, reject) => {
    ejecutarConContexto(
      { organizacionId: datos.orgAId, usuarioId: null, esSuperadmin: false },
      async () => {
        try {
          const resultado = await query(
            `SELECT id, organizacion_id, exposicion_codigo, codigo_cie10_patron
             FROM reglas_contraindicacion
             WHERE activa = true AND (organizacion_id IS NULL OR organizacion_id = $1)`,
            [datos.orgAId]
          );
          assert.ok(resultado.rows.length > 0, 'Con la correccion C12-01, deberian verse las reglas globales sembradas por migration_006 (antes de la correccion esto devolvia 0 filas).');
          assert.ok(
            resultado.rows.every((r) => r.organizacion_id === null || r.organizacion_id === datos.orgAId),
            'Ninguna fila devuelta deberia pertenecer a otra organizacion distinta de A.'
          );
          const hayGlobales = resultado.rows.some((r) => r.organizacion_id === null);
          assert.ok(hayGlobales, 'Debe incluir al menos una regla global (organizacion_id IS NULL), que es exactamente lo que C12-01 encontro bloqueado.');
          resolve();
        } catch (err) {
          reject(err);
        }
      }
    );
  });
});

test('RLS C12-01: sin contexto de organizacion (peticion no autenticada), las reglas globales NO se filtran (fail-closed, no fail-open)', async () => {
  await new Promise((resolve, reject) => {
    ejecutarConContexto(
      { organizacionId: null, usuarioId: null, esSuperadmin: false },
      async () => {
        try {
          const resultado = await query(`SELECT id FROM reglas_contraindicacion WHERE organizacion_id IS NULL`);
          assert.strictEqual(resultado.rows.length, 0, 'Sin organizacion en contexto ni superadmin, ninguna fila -- global o no -- debe ser visible.');
          resolve();
        } catch (err) {
          reject(err);
        }
      }
    );
  });
});

test('C12-01: el motor de contraindicaciones detecta el caso global conocido (epilepsia + trabajo en alturas) con las filas que RLS permite ver para la organizacion A', async () => {
  await new Promise((resolve, reject) => {
    ejecutarConContexto(
      { organizacionId: datos.orgAId, usuarioId: null, esSuperadmin: false },
      async () => {
        try {
          const reglasRes = await query(
            `SELECT id, nombre, codigo_cie10_patron, tipo_coincidencia, exposicion_codigo,
                    severidad, descripcion_riesgo, sugerencia_accion, fuente_referencia
             FROM reglas_contraindicacion
             WHERE activa = true AND (organizacion_id IS NULL OR organizacion_id = $1)`,
            [datos.orgAId]
          );

          const alertas = detectarContraindicaciones(['G40'], ['trabajo_alturas'], reglasRes.rows);
          assert.ok(
            alertas.some((a) => a.nombre.toLowerCase().includes('epilepsia') && a.exposicionCoincidente === 'trabajo_alturas'),
            'El motor deberia generar la alerta de referencia "Epilepsia activa + trabajo en alturas" usando la regla global.'
          );
          assert.ok(alertas.some((a) => a.severidad === 'absoluta'), 'La alerta de epilepsia + alturas es de severidad absoluta segun migration_006.');
          resolve();
        } catch (err) {
          reject(err);
        }
      }
    );
  });
});

test('C12-01 (salvaguarda de regresion): catalogo_exposiciones y reglas_contraindicacion NO deben tener la politica generica "aislamiento_tenant"', async () => {
  const resultado = await queryComoSuperadmin(
    `SELECT tablename, policyname FROM pg_policies
     WHERE tablename IN ('catalogo_exposiciones', 'reglas_contraindicacion')
       AND policyname = 'aislamiento_tenant'`
  );
  assert.strictEqual(
    resultado.rows.length, 0,
    'Si esto falla, una migracion posterior volvio a aplicar la politica generica sobre los catalogos globales y C12-01 se reabrio.'
  );
});

// ------------------------------------------------------------
// CORRIGE el hallazgo GRAVE G12-08: auditoria_pendiente ahora tiene
// RLS (migration_059). Verifica que una organizacion normal no
// puede leer la cola de respaldo (ni la suya ni la de otra), y que
// el superadmin si puede -- que es exactamente como operan
// verBacklogAuditoria/drenarAuditoria en superadminController.js.
// ------------------------------------------------------------
test('G12-08: auditoria_pendiente esta protegida por RLS -- una organizacion normal no puede leerla, el superadmin si', async () => {
  const filaId = await (async () => {
    const insertRes = await queryComoSuperadmin(
      `INSERT INTO auditoria_pendiente (organizacion_id, usuario_id, accion, error_original)
       VALUES ($1, NULL, 'prueba_g12_08', 'error simulado para la prueba')
       RETURNING id`,
      [datos.orgAId]
    );
    return insertRes.rows[0].id;
  })();

  await new Promise((resolve, reject) => {
    ejecutarConContexto(
      { organizacionId: datos.orgAId, usuarioId: null, esSuperadmin: false },
      async () => {
        try {
          const resultado = await query(`SELECT id FROM auditoria_pendiente WHERE id = $1`, [filaId]);
          assert.strictEqual(resultado.rows.length, 0, 'Una organizacion normal (ni siquiera la dueña de la fila) no deberia poder leer auditoria_pendiente directamente -- esa lectura es exclusiva de superadmin via los endpoints dedicados.');
          resolve();
        } catch (err) {
          reject(err);
        }
      }
    );
  });

  const comoSuperadmin = await queryComoSuperadmin(`SELECT id FROM auditoria_pendiente WHERE id = $1`, [filaId]);
  assert.strictEqual(comoSuperadmin.rows.length, 1, 'El superadmin si debe poder leer auditoria_pendiente (drenaje/backlog).');

  await queryComoSuperadmin(`DELETE FROM auditoria_pendiente WHERE id = $1`, [filaId]).catch(() => {
    // Sin politica DELETE definida, esto puede fallar incluso para
    // superadmin -- es el comportamiento esperado (nadie borra estas
    // filas via RLS); se ignora en la limpieza de la prueba.
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
