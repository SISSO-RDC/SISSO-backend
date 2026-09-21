// Auditoria N.19 (G19-03 y G19-04): las respuestas ya no dependen de
// `SELECT tabla.*`. Cada tabla cuyo detalle se devuelve completo tiene una
// allowlist explicita (src/db/columnasExplicitas.js) y esta prueba obliga a
// que toda columna nueva se clasifique de forma consciente.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { COLUMNAS, columnas } = require('../src/db/columnasExplicitas');
const { POLITICA_POR_TABLA } = require('../src/utils/politicaMinimizacion');
const { queryComoSuperadmin, pool } = require('../src/db/pool');

const SRC = path.join(__dirname, '..', 'src');
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ').replace(/\s\/\/.*$/gm, ' ');

test('G19-04: ningun archivo de src usa SELECT *, tabla.* ni RETURNING * (salvo migrate.js)', () => {
  const hallazgos = [];
  (function recorrer(dir) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) { recorrer(p); continue; }
      if (!f.endsWith('.js')) continue;
      const rel = path.relative(SRC, p);
      if (rel === path.join('db', 'migrate.js')) continue;
      const codigo = sinComentarios(fs.readFileSync(p, 'utf8'));
      // Solo dentro de cadenas SQL: SELECT * / SELECT alias.* / , alias.* / RETURNING *
      if (/\bSELECT\s+(DISTINCT\s+)?\*/i.test(codigo)
        || /\bSELECT\s+(DISTINCT\s+)?[a-z_][a-z0-9_]*\.\*/i.test(codigo)
        || /,\s*[a-z_][a-z0-9_]*\.\*\s*(,|FROM\b)/i.test(codigo)
        || /\bRETURNING\s+\*/i.test(codigo)) {
        hallazgos.push(rel);
      }
    }
  })(SRC);
  assert.deepEqual(hallazgos, [], `usan comodin en SELECT/RETURNING: ${hallazgos.join(', ')}`);
});

test('G19-03: columnas() genera la lista explicita y rechaza tablas o alias no validos', () => {
  const lista = columnas('ausencias', 'a');
  assert.ok(lista.startsWith('a.id,'));
  assert.ok(!lista.includes('*'));
  assert.ok(!columnas('ausencias', 'a', { excluir: ['id'] }).includes('a.id,'));
  assert.throws(() => columnas('tabla_inexistente', 'x'), /sin allowlist/);
  assert.throws(() => columnas('ausencias', 'a; DROP TABLE x'), /alias invalido/);
});

test('G19-03: toda columna bloqueada por la politica de minimizacion esta en noExpuestas', () => {
  for (const [tabla, def] of Object.entries(COLUMNAS)) {
    const bloqueadas = (POLITICA_POR_TABLA[tabla] && POLITICA_POR_TABLA[tabla].camposBloqueadosSiempre) || [];
    for (const col of bloqueadas) {
      assert.ok(def.noExpuestas.includes(col), `${tabla}.${col} esta bloqueada por politica pero figura como expuesta`);
      assert.ok(!def.expuestas.includes(col), `${tabla}.${col} no debe estar en expuestas`);
    }
  }
});

test('G19-03: la allowlist coincide exactamente con el esquema real (ninguna columna sin clasificar)', async () => {
  try {
    for (const [tabla, def] of Object.entries(COLUMNAS)) {
      const r = await queryComoSuperadmin(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [tabla]
      );
      const reales = new Set(r.rows.map((x) => x.column_name));
      assert.ok(reales.size > 0, `la tabla ${tabla} no existe en el esquema`);
      const clasificadas = new Set([...def.expuestas, ...def.noExpuestas]);
      const sinClasificar = [...reales].filter((c) => !clasificadas.has(c));
      const inexistentes = [...clasificadas].filter((c) => !reales.has(c));
      assert.deepEqual(sinClasificar, [],
        `${tabla}: columnas nuevas SIN clasificar -> agreguelas a 'expuestas' o 'noExpuestas' en src/db/columnasExplicitas.js: ${sinClasificar.join(', ')}`);
      assert.deepEqual(inexistentes, [], `${tabla}: la allowlist lista columnas que ya no existen (provocaria 500): ${inexistentes.join(', ')}`);
      const dup = def.expuestas.filter((c) => def.noExpuestas.includes(c));
      assert.deepEqual(dup, [], `${tabla}: columnas en expuestas Y noExpuestas: ${dup.join(', ')}`);
    }
  } finally {
    await pool.end();
  }
});
