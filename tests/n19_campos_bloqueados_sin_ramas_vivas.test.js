// Auditoria N.19 (C19-01, lado backend): los campos bloqueados por la
// Sentencia 59-19-IN/24 (religion, habitos toxicos, antecedentes
// gineco-obstetricos y reproductivos) solo pueden aparecer en la politica
// de minimizacion y en el controlador que los fuerza a NULL. Ningun PDF,
// catalogo ni validador debe seguir con una rama viva que los imprima o
// los ofrezca. Sin base de datos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const PERMITIDOS = new Set([
  path.join('controllers', 'historiaClinicaController.js'), // los fuerza a NULL al registrar
  path.join('utils', 'politicaMinimizacion.js'),            // define el bloqueo
]);
const TERMINOS = /religion|religiones|habitos_toxicos|habitostoxicos|ginecobstetric|ginecologicos_examenes|ginecologicosexamenes|reproductivos_masculinos|reproductivosmasculinos/i;

const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ').replace(/\s\/\/.*$/gm, ' ');

test('C19-01: ningun PDF, catalogo ni validador conserva ramas de campos bloqueados', () => {
  const hallazgos = [];
  (function recorrer(dir) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) { if (f !== 'db') recorrer(p); continue; }
      if (!f.endsWith('.js')) continue;
      const rel = path.relative(SRC, p);
      if (PERMITIDOS.has(rel)) continue;
      if (TERMINOS.test(sinComentarios(fs.readFileSync(p, 'utf8')))) hallazgos.push(rel);
    }
  })(SRC);
  assert.deepEqual(hallazgos, [], `referencias vivas a campos bloqueados en: ${hallazgos.join(', ')}`);
});

test('C19-01: el catalogo de historia clinica ya no expone RELIGIONES', () => {
  const cat = require('../src/historiaClinica/catalogosRiesgo');
  assert.equal(cat.RELIGIONES, undefined);
  assert.ok(Array.isArray(cat.LATERALIDADES), 'el resto del catalogo se conserva');
});
