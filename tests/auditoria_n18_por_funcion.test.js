// ============================================================
// Auditoria N.18, G18-02 (P1): "la auditoria automatica es todavia de
// nivel ARCHIVO -- no garantiza que cada funcion sensible especifica
// invoque registrarAuditoria ni que la llamada este dentro de la
// transaccion correcta. Implementar analisis AST".
//
// Esta prueba analiza el AST (acorn) de TODOS los controladores y
// verifica, por FUNCION:
//   1. Toda funcion de nivel superior que ejecuta una escritura SQL
//      (INSERT / UPDATE / DELETE, via query(), client.query() o
//      queryComoSuperadmin()) llama a registrarAuditoria, salvo las
//      EXCEPCIONES_JUSTIFICADAS (cada una con su motivo).
//   2. Toda escritura hecha con client.query() dentro de un callback
//      de withTransaction(...) tiene, DENTRO DEL MISMO callback, una
//      llamada a registrarAuditoria que recibe ese mismo `client`
//      (misma transaccion: si la auditoria falla, se revierte la
//      escritura; si la escritura falla, no queda auditoria falsa).
//   3. Las excepciones no envejecen: si una funcion exceptuada ya
//      audita o ya no escribe, la prueba falla y obliga a retirarla
//      de la lista (evita una lista de excepciones que solo crece).
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const DIR = path.join(__dirname, '..', 'src', 'controllers');

// 'archivo.js:funcion' -> motivo por el que NO audita.
const EXCEPCIONES_JUSTIFICADAS = {
  'alertasController.js:sincronizarAlertasAdministrativas':
    'Sincronizacion derivada: recalcula alertas a partir de datos ya auditados en su origen; no es una accion de la persona usuaria.',
  'alertasController.js:sincronizarAlertasClinicas':
    'Igual que la anterior: alertas derivadas de registros clinicos que ya se auditan al crearse.',
  'authController.js:iniciarConfiguracionMfa':
    'Solo guarda un secreto TOTP PENDIENTE (aun no activo); la activacion real la audita confirmarMfa.',
  'eppController.js:listarEntregas':
    'Lectura que ademas marca como "vencido" las entregas cuya fecha ya paso (transicion derivada del tiempo, no una decision de la persona usuaria).',
};

const ESCRITURA = /\b(INSERT\s+INTO|UPDATE\s+[\w."]+\s+SET|DELETE\s+FROM)\b/i;

function textoSql(nodo) {
  if (!nodo) return '';
  if (nodo.type === 'Literal' && typeof nodo.value === 'string') return nodo.value;
  if (nodo.type === 'TemplateLiteral') return nodo.quasis.map((q) => q.value.cooked).join(' ? ');
  return '';
}
function nombreLlamada(c) {
  if (c.callee.type === 'Identifier') return { nombre: c.callee.name, objeto: null };
  if (c.callee.type === 'MemberExpression' && c.callee.property.type === 'Identifier') {
    return { nombre: c.callee.property.name, objeto: c.callee.object.type === 'Identifier' ? c.callee.object.name : null };
  }
  return { nombre: '', objeto: null };
}
function esEscrituraSql(c) {
  const { nombre } = nombreLlamada(c);
  return ['query', 'queryComoSuperadmin'].includes(nombre) && ESCRITURA.test(textoSql(c.arguments[0]));
}
function pasaClient(c) {
  const arg = c.arguments[0];
  return !!arg && arg.type === 'ObjectExpression' && arg.properties.some((p) => p.type === 'Property'
    && ((p.key.name === 'client' || p.key.value === 'client')));
}

function funcionesDeNivelSuperior(ast) {
  const fns = [];
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration') fns.push({ nombre: n.id.name, nodo: n });
    else if (n.type === 'VariableDeclaration') {
      for (const d of n.declarations) {
        if (d.init && /Function/.test(d.init.type) && d.id.type === 'Identifier') fns.push({ nombre: d.id.name, nodo: d.init });
      }
    }
  }
  return fns;
}

function analizar(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
  return funcionesDeNivelSuperior(ast).map(({ nombre, nodo }) => {
    let escribe = false;
    let audita = false;
    const transacciones = [];
    walk.full(nodo.body, (x) => {
      if (x.type !== 'CallExpression') return;
      const { nombre: n } = nombreLlamada(x);
      if (esEscrituraSql(x)) escribe = true;
      if (n === 'registrarAuditoria') audita = true;
      if (n === 'withTransaction' && x.arguments[0] && /Function/.test(x.arguments[0].type)) {
        const cb = x.arguments[0];
        const clientParam = cb.params[0] && cb.params[0].type === 'Identifier' ? cb.params[0].name : 'client';
        let escrituraEnTx = false;
        let auditaConClient = false;
        walk.full(cb.body, (y) => {
          if (y.type !== 'CallExpression') return;
          const info = nombreLlamada(y);
          if (info.nombre === 'query' && info.objeto === clientParam && ESCRITURA.test(textoSql(y.arguments[0]))) escrituraEnTx = true;
          if (info.nombre === 'registrarAuditoria' && pasaClient(y)) auditaConClient = true;
        });
        transacciones.push({ escrituraEnTx, auditaConClient });
      }
    });
    return { nombre, escribe, audita, transacciones };
  });
}

const archivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
const resultados = archivos.flatMap((f) => {
  const fns = analizar(fs.readFileSync(path.join(DIR, f), 'utf8'));
  return fns.map((r) => ({ archivo: f, clave: `${f}:${r.nombre}`, ...r }));
});

test('G18-02: se analizaron los controladores (sanidad del analizador)', () => {
  assert.ok(archivos.length > 40, `se esperaban >40 controladores, hay ${archivos.length}`);
  const conEscritura = resultados.filter((r) => r.escribe);
  assert.ok(conEscritura.length > 100, `se esperaban >100 funciones con escritura, hay ${conEscritura.length}`);
});

test('G18-02: toda funcion con escritura SQL llama a registrarAuditoria (salvo excepciones justificadas)', () => {
  const sinAuditoria = resultados.filter((r) => r.escribe && !r.audita && !(r.clave in EXCEPCIONES_JUSTIFICADAS));
  assert.deepStrictEqual(sinAuditoria.map((r) => r.clave), [],
    'Estas funciones escriben en la base sin registrar auditoria. Agregue registrarAuditoria (dentro de la misma transaccion) o, si de verdad no corresponde, una excepcion JUSTIFICADA en esta prueba.');
});

test('G18-02: toda escritura con client dentro de withTransaction va acompanada de registrarAuditoria({..., client}) en la MISMA transaccion', () => {
  const malas = [];
  for (const r of resultados) {
    if (r.clave in EXCEPCIONES_JUSTIFICADAS) continue;
    for (const t of r.transacciones) {
      if (t.escrituraEnTx && !t.auditaConClient) malas.push(r.clave);
    }
  }
  assert.deepStrictEqual([...new Set(malas)], [],
    'Escritura transaccional cuyo registro de auditoria no esta en la misma transaccion (falta pasar `client` a registrarAuditoria).');
});

test('G18-02: las excepciones justificadas siguen siendo necesarias (no envejecen)', () => {
  for (const clave of Object.keys(EXCEPCIONES_JUSTIFICADAS)) {
    const r = resultados.find((x) => x.clave === clave);
    assert.ok(r, `${clave}: la funcion exceptuada ya no existe; retire la excepcion.`);
    assert.ok(r.escribe, `${clave}: ya no escribe; retire la excepcion.`);
    assert.ok(!r.audita, `${clave}: ya audita; retire la excepcion.`);
  }
});

test('G18-02: el analizador detecta una escritura sin auditoria y una auditoria fuera de la transaccion', () => {
  const sinAud = analizar(`async function f(req,res){ await query('INSERT INTO t (a) VALUES ($1)', [1]); }`)[0];
  assert.ok(sinAud.escribe && !sinAud.audita);
  const fuera = analizar(`async function g(req,res){
    await withTransaction(async (client) => { await client.query('UPDATE t SET a = 1'); });
    await registrarAuditoria({ accion: 'x' });
  }`)[0];
  assert.ok(fuera.audita && fuera.transacciones[0].escrituraEnTx && !fuera.transacciones[0].auditaConClient);
  const bien = analizar(`async function h(req,res){
    await withTransaction(async (c) => { await c.query('DELETE FROM t'); await registrarAuditoria({ accion: 'x', client: c }); });
  }`)[0];
  assert.ok(bien.transacciones[0].escrituraEnTx && bien.transacciones[0].auditaConClient);
});
