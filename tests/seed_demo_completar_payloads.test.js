// Verifica que los datos que genera seed_demo_completar.js sean aceptados por
// los validadores y motores REALES del backend (no requiere Postgres).
// Si un validador cambia (ej. un enum nuevo), este test falla ANTES de que el
// script de completado de la empresa demo falle en produccion.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'seed_demo_completar.js'), 'utf8');
const ctx = { Math, Date };
vm.createContext(ctx);
vm.runInContext(
  src.slice(src.indexOf('function rnd(arr)'), src.indexOf('function fechaHace')) +
  'function fechaHace(d){const x=new Date();x.setDate(x.getDate()-d);return x.toISOString().slice(0,10);}\n' +
  src.slice(src.indexOf('// Generadores'), src.indexOf('// Definicion de modulos')) +
  ';this.G={posturaReba,posturaRula,regionesNordico,audiometriaNormal,espirometriaNormal,visiometriaNormal,niosh};',
  ctx
);
const G = ctx.G;
const v = require('../src/middleware/validacion.js');
const N = 200;

async function pasaValidador(cadena, body) {
  const req = { body, params: {}, query: {}, headers: {}, cookies: {} };
  let rechazo = null;
  const res = { status() { return this; }, json(j) { rechazo = JSON.stringify(j); return this; } };
  for (const mw of cadena) {
    let siguio = false;
    await new Promise((r) => { const p = mw(req, res, () => { siguio = true; r(); }); Promise.resolve(p).then(() => { if (!siguio) r(); }); });
    if (!siguio) break;
  }
  return rechazo;
}

test('seed_demo_completar: REBA, RULA, NIOSH, espirometria, visiometria y nordico pasan los validadores reales', async () => {
  for (let i = 0; i < N; i++) {
    const casos = [
      ['REBA', v.validarCrearEvaluacionReba, G.posturaReba()],
      ['RULA', v.validarCrearEvaluacionRula, G.posturaRula()],
      ['NIOSH', v.validarRegistrarNiosh, G.niosh()],
      ['espirometria', v.validarRegistrarEspirometria, G.espirometriaNormal()],
      ['visiometria', v.validarRegistrarVisiometria, G.visiometriaNormal()],
      ['nordico', v.validarRegistrarNordico, { regiones: G.regionesNordico(), fechaAplicacion: '2026-09-01' }],
    ];
    for (const [nombre, cadena, body] of casos) {
      const rechazo = await pasaValidador(cadena, body);
      assert.strictEqual(rechazo, null, `${nombre} rechazado: ${rechazo}`);
    }
  }
});

test('seed_demo_completar: nordico, RULA, NIOSH y audiometria son calculables por los motores reales', () => {
  const nord = require('../src/nordico/nordico.js');
  const rula = require('../src/ergonomia/rula.js');
  const niosh = require('../src/niosh/niosh.js');
  const aud = require('../src/audiometria/audiometria.js');
  const snake = (o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase()), x]));
  for (let i = 0; i < N; i++) {
    assert.deepStrictEqual(nord.validarRegionesNordico(G.regionesNordico()), []);
    const p = G.posturaRula();
    assert.doesNotThrow(() => rula.calcularRula({ ...snake(p), piernas_bien_apoyadas: p.piernasBienApoyadas !== false }));
    const n = G.niosh();
    const r = niosh.calcularNiosh({ horizontal: n.horizontalCm, vertical: n.verticalCm, distanciaVertical: n.distanciaVerticalCm, anguloAsimetria: n.anguloAsimetria, frecuencia: n.frecuenciaPorMin, duracion: n.duracion, calidadAgarre: n.calidadAgarre, pesoCarga: n.pesoCargaKg });
    assert.notStrictEqual(r.clasificacion, 'no_calculable');
    assert.doesNotThrow(() => aud.calcularAudiometria(G.audiometriaNormal(), null, 35));
  }
});

test('seed_demo_completar: usa las rutas reales de RULA (/ergonomia/rula/...)', () => {
  assert.ok(!/['`]\/rula\//.test(src), 'RULA debe consumirse bajo /ergonomia/rula');
  assert.ok(src.includes('/ergonomia/rula/sesiones'));
});
