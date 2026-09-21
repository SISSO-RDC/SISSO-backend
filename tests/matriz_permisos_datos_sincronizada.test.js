// ============================================================
// Auditoria N.18, M18-06: "la matriz de rutas se genera
// automaticamente, pero la tabla de permisos de datos requiere
// mantenimiento manual". docs/MATRIZ_PERMISOS_DATOS.md ya declaraba
// esta prueba como pendiente (N.12). Ahora contrasta la tabla contra
// las rutas REALES (misma introspeccion que docs/MATRIZ_RBAC.md):
//   1. Todo endpoint concreto citado en la tabla EXISTE (metodo + ruta).
//   2. Ningun rol citado en la tabla queda BLOQUEADO por la ruta: si la
//      tabla dice que TH recibe algo pero la ruta solo admite
//      admin/medico, la tabla miente (o la ruta cambio).
// No exige lo inverso (la propia tabla declara que no es exhaustiva).
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { generarMatriz } = require('../scripts/generar_matriz_rbac');

const DOC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'MATRIZ_PERMISOS_DATOS.md'), 'utf8');

const ROL_POR_SIGLA = { AD: 'admin', SSO: 'sso', ME: 'medico', TH: 'th' };

function normalizarRuta(r) {
  return r.replace(/\/+$/, '').replace(/:[A-Za-z_]+/g, ':p') || '/';
}

// Filas de datos de la tabla principal -> { modulo, endpoints:[{metodo,ruta}], roles:[...] }
function filasDeLaTabla() {
  const filas = [];
  for (const linea of DOC.split('\n')) {
    if (!linea.startsWith('| ') || linea.startsWith('| Módulo') || linea.startsWith('|---')) continue;
    const celdas = linea.split('|').map((c) => c.trim()).slice(1, -1);
    if (celdas.length < 3) continue;
    const [modulo, endpointCelda, rolCelda] = celdas;
    const endpoints = [];
    for (const m of endpointCelda.matchAll(/`([^`]+)`/g)) {
      const trozo = m[1];
      const par = /^((?:GET|POST|PUT|PATCH|DELETE)(?:\/(?:GET|POST|PUT|PATCH|DELETE))*)\s+(\/api\/\S+)$/.exec(trozo);
      if (!par) continue;              // comodines (*), '...', 'CRUD', 'superadmin/*': no verificables
      if (par[2].includes('*') || par[2].includes('...')) continue;
      for (const metodo of par[1].split('/')) endpoints.push({ metodo, ruta: par[2] });
    }
    const roles = [];
    for (const sigla of Object.keys(ROL_POR_SIGLA)) {
      if (new RegExp(`(^|[^A-Za-z])${sigla}([^A-Za-z]|$)`).test(rolCelda)) roles.push(ROL_POR_SIGLA[sigla]);
    }
    filas.push({ modulo, endpoints, roles, rolCelda, linea });
  }
  return filas;
}

const rutasReales = generarMatriz().flatMap((g) => g.filas);

function buscarRuta(metodo, ruta) {
  const objetivo = normalizarRuta(ruta);
  return rutasReales.filter((r) => r.metodo === metodo && normalizarRuta(r.ruta) === objetivo);
}

test('M18-06: la tabla de permisos de datos se pudo leer y cita endpoints verificables', () => {
  const filas = filasDeLaTabla();
  const total = filas.reduce((n, f) => n + f.endpoints.length, 0);
  assert.ok(filas.length >= 20, `se esperaban >=20 filas, hay ${filas.length}`);
  assert.ok(total >= 15, `se esperaban >=15 endpoints concretos verificables, hay ${total}`);
});

test('M18-06: todo endpoint concreto de docs/MATRIZ_PERMISOS_DATOS.md existe en las rutas reales', () => {
  const inexistentes = [];
  for (const f of filasDeLaTabla()) {
    for (const e of f.endpoints) {
      if (buscarRuta(e.metodo, e.ruta).length === 0) inexistentes.push(`${f.modulo}: ${e.metodo} ${e.ruta}`);
    }
  }
  assert.deepStrictEqual(inexistentes, [], 'La tabla cita endpoints que ya no existen (o cambiaron de ruta). Actualice docs/MATRIZ_PERMISOS_DATOS.md.');
});

test('M18-06: ningun rol citado en la tabla queda bloqueado por la ruta correspondiente', () => {
  const contradicciones = [];
  for (const f of filasDeLaTabla()) {
    if (f.roles.length === 0) continue;
    for (const e of f.endpoints) {
      for (const real of buscarRuta(e.metodo, e.ruta)) {
        const texto = real.roles;
        if (/cualquier rol|PUBLICA/i.test(texto)) continue; // sin restriccion de rol en la ruta
        const permitidos = texto.split(',').map((x) => x.trim());
        const bloqueados = f.roles.filter((r) => !permitidos.includes(r));
        if (bloqueados.length > 0) {
          contradicciones.push(`${f.modulo}: ${e.metodo} ${e.ruta} -> la tabla cita ${bloqueados.join('/')} pero la ruta solo admite [${permitidos.join(', ')}]`);
        }
      }
    }
  }
  assert.deepStrictEqual(contradicciones, []);
});

test('M18-06: el verificador detecta un endpoint inexistente y un rol bloqueado (sanidad)', () => {
  assert.strictEqual(buscarRuta('GET', '/api/no-existe/ninguno').length, 0);
  const restringida = rutasReales.find((r) => !/cualquier rol|PUBLICA/i.test(r.roles) && !r.roles.includes('th'));
  assert.ok(restringida, 'debe existir al menos una ruta restringida que excluya a TH');
});
