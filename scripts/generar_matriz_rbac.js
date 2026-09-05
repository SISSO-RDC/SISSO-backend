#!/usr/bin/env node
'use strict';

// ============================================================
// CIERRA hallazgo CRITICO C15-02 de la Auditoria Integral N.15
// (P0): "falta una matriz formal rol x endpoint x dato x accion".
//
// Este script NO mantiene un documento aparte que alguien tiene que
// acordarse de actualizar cada vez que se agrega o cambia una ruta
// (ese es, precisamente, el modo en que una matriz de este tipo se
// desactualiza en silencio). En su lugar, INTROSPECCIONA la
// aplicacion Express real: recorre cada archivo de rutas, lee su
// router.stack (la estructura interna de Express) y extrae, para
// cada endpoint:
//   - Metodo HTTP y path completo (incluye el prefijo con el que
//     index.js monta ese router).
//   - Que rol(es) puede llamarlo -- leido de la propiedad
//     `.rolesPermitidos` que ahora deja `autorizar()` en la funcion
//     middleware que devuelve (ver src/middleware/auth.js). Si una
//     ruta protegida con `autenticar` NO tiene ningun `autorizar(...)`
//     en su cadena, se documenta explicitamente como "cualquier rol
//     autenticado" -- y si una ruta NO tiene ni siquiera `autenticar`,
//     se marca en mayusculas como "PUBLICA (sin autenticacion)" para
//     que cualquier ruta publica por descuido salte a la vista en la
//     revision, en vez de quedar oculta en un archivo de rutas entre
//     decenas de otras.
//
// La columna "dato/accion" es una clasificacion automatica basada en
// el nombre del recurso y del metodo HTTP (ver CLASIFICACION_RECURSOS
// abajo) -- es deliberadamente conservadora: cuando un recurso no
// esta en la lista, se marca "(sin clasificar -- revisar)" en vez de
// adivinar, para que la matriz nunca reporte con falsa confianza una
// clasificacion que nadie verifico.
//
// Uso:
//   node scripts/generar_matriz_rbac.js            -> imprime en stdout
//   node scripts/generar_matriz_rbac.js --escribir  -> escribe docs/MATRIZ_RBAC.md
//   node scripts/generar_matriz_rbac.js --verificar -> falla (exit 1) si
//       docs/MATRIZ_RBAC.md no coincide con lo que generaria ahora mismo
//       (usado en CI: ver .github/workflows/ci.yml -- evita que la matriz
//       se desactualice respecto de las rutas reales sin que nadie lo note)
// ============================================================

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ARCHIVO_INDEX = path.join(RAIZ, 'src', 'index.js');
const ARCHIVO_SALIDA = path.join(RAIZ, 'docs', 'MATRIZ_RBAC.md');

// Clasificacion manual, deliberadamente explicita, del tipo de dato
// que maneja cada prefijo de recurso. "clinico_individual" = datos
// de salud identificables de una persona especifica (el nivel mas
// sensible de este sistema). "operativo_individual" = datos
// identificables pero no clinicos (ej. datos de contacto). "agregado"
// = estadisticas/indicadores sin identificar a nadie. "catalogo" =
// configuracion o listas de referencia compartidas. "administrativo"
// = gestion de cuentas/organizacion/pagos.
const CLASIFICACION_RECURSOS = {
  'auth': 'administrativo (sesion/credenciales)',
  'trabajadores': 'operativo_individual (con campos antropometricos restringidos)',
  'superadmin': 'administrativo (plataforma, fuera del modelo de roles de organizacion)',
  'ergonomia': 'clinico_individual (evaluaciones NIOSH/Nordico por trabajador)',
  'aptitud': 'clinico_individual (aptitud medica, reglas de contraindicacion)',
  'consentimientos': 'operativo_individual (consentimientos informados)',
  'dashboard': 'agregado + fragmentos individuales proyectados por rol',
  'audiometria': 'clinico_individual',
  'espirometria': 'clinico_individual',
  'historia-clinica': 'clinico_individual (exclusivo medico)',
  'visiometria': 'clinico_individual',
  'nordico': 'clinico_individual (cuestionario ergonomico)',
  'niosh': 'clinico_individual (evaluacion ergonomica)',
  'puestos-trabajo': 'catalogo',
  'organizacion': 'administrativo',
  'alertas': 'operativo_individual (con fragmento clinico condicional)',
  'matriz-riesgos': 'catalogo (IPER)',
  'indicadores': 'agregado',
  'ausentismo': 'operativo_individual (con diagnostico CIE-10 restringido a medico)',
  'reportes': 'agregado',
  'capacitaciones': 'operativo_individual',
  'certificados': 'clinico_individual (certificado de aptitud) / operativo (otros)',
  'enfermedad-profesional': 'clinico_individual',
  'restricciones-medicas': 'clinico_individual',
  'matriz-medico-puesto': 'catalogo',
  'vigilancia-salud': 'clinico_individual',
  'accidentes': 'operativo_individual (con fragmento clinico restringido)',
  'usuarios': 'administrativo (cuentas de la organizacion)',
  'capa': 'operativo_individual',
  'inspecciones': 'operativo_individual',
  'riesgo-psicosocial': 'clinico_individual (evaluacion individual) / agregado (resumen)',
  'higiene-industrial': 'catalogo + mediciones operativas',
  'epp': 'operativo_individual',
  'pagos': 'administrativo (facturacion, PayPhone)',
  'finalidades-tratamiento': 'catalogo (gobierno de datos)',
  'solicitudes-titular': 'operativo_individual (derechos ARCO/habeas data)',
  'incidentes-seguridad': 'operativo_individual',
  'puesto-exposiciones': 'catalogo',
  'ejemplo': 'N/A (ruta de ejemplo/diagnostico, no expone datos de negocio)',
};

function extraerMontajes() {
  const contenido = fs.readFileSync(ARCHIVO_INDEX, 'utf8');
  const regex = /app\.use\('([^']+)',\s*(\w+)\)/g;
  const montajes = [];
  let m;
  while ((m = regex.exec(contenido)) !== null) {
    montajes.push({ prefijo: m[1], variable: m[2] });
  }
  return montajes;
}

function extraerRequires() {
  const contenido = fs.readFileSync(ARCHIVO_INDEX, 'utf8');
  const regex = /const\s+(\w+)\s*=\s*require\('(\.\/routes\/[^']+)'\)/g;
  const mapa = {};
  let m;
  while ((m = regex.exec(contenido)) !== null) {
    mapa[m[1]] = m[2];
  }
  return mapa;
}

function describirRolesDeCapa(capa) {
  // Cada capa de router.stack.route.stack es un middleware. Buscamos
  // si alguno es la funcion `autorizar(...)` (marcada con
  // .rolesPermitidos) y si hay algun middleware que verifique una
  // sesion real (token).
  //
  // CORREGIDO durante la propia generacion de esta matriz: la
  // primera version de este script incluia `contextoInterno` en la
  // lista de "cuenta como autenticado", lo cual es un error --
  // `contextoInterno` (ver src/middleware/auth.js) solo fija el
  // contexto de base de datos como superadmin para ejecutar
  // operaciones internas; NO verifica ningun token. Con ese error,
  // /api/auth/login, /api/auth/bootstrap-superadmin y
  // /api/auth/recuperar-superadmin (que a proposito NO requieren
  // sesion previa, porque son los endpoints que la CREAN) aparecian
  // como "cualquier rol autenticado" en vez de "PUBLICA" -- exactamente
  // el tipo de error silencioso que esta matriz existe para prevenir
  // en el resto del codigo, asi que se documenta aqui tambien.
  let autenticado = false;
  let roles = null;
  for (const capaMw of capa) {
    const fn = capaMw.handle;
    if (typeof fn.rolesPermitidos !== 'undefined') {
      roles = fn.rolesPermitidos;
    }
    if (/^(autenticar|autenticarOMfaPendiente)$/.test(fn.name)) {
      autenticado = true;
    }
  }
  if (!autenticado) return 'PUBLICA (sin autenticacion) -- revisar si es intencional';
  if (roles && roles.length > 0) return roles.join(', ');
  return 'cualquier rol autenticado (sin restriccion de rol)';
}

function introspeccionarRouter(router, prefijo) {
  const filas = [];
  // CORREGIDO durante la propia generacion de esta matriz: la
  // primera version de esta funcion ignoraba por completo los
  // middlewares aplicados con `router.use(autenticar, autorizar(...))`
  // a nivel de TODO el router (patron usado por ej. en
  // superadminRoutes.js: "router.use(autenticar, autorizar('superadmin'))"
  // antes de declarar cada ruta individual) -- solo miraba
  // `capa.route.stack` (los middlewares de CADA ruta individual).
  // Como resultado, cada endpoint de /api/superadmin/* aparecia como
  // "PUBLICA" en la primera corrida, un falso positivo grave que
  // habria sido un error serio reportar sin verificar contra el
  // codigo fuente real. La correccion: recorrer router.stack EN
  // ORDEN y acumular los middlewares de `.use()` que aparecen ANTES
  // de cada `capa.route` (Express los aplica a toda ruta declarada
  // despues, dentro del mismo router) como parte de la cadena
  // efectiva de esa ruta.
  let middlewaresDeUsoAcumulados = [];
  for (const capa of router.stack) {
    if (!capa.route) {
      // Un layer de router.use(...) sin path propio (patron usado en
      // este proyecto): sus argumentos individuales viven en
      // capa.handle si es una unica funcion, pero Express tambien
      // permite pasar varias funciones a router.use(); en ese caso
      // Express crea un layer POR CADA funcion, asi que basta con
      // acumular capa.handle de cada layer no-route en orden.
      middlewaresDeUsoAcumulados.push(capa.handle);
      continue;
    }
    const rutaCompleta = (prefijo + capa.route.path).replace(/\/{2,}/g, '/');
    const metodos = Object.keys(capa.route.methods).filter((m) => capa.route.methods[m]);
    const cadenaEfectiva = [
      ...middlewaresDeUsoAcumulados.map((handle) => ({ handle })),
      ...capa.route.stack,
    ];
    for (const metodo of metodos) {
      filas.push({
        metodo: metodo.toUpperCase(),
        ruta: rutaCompleta,
        roles: describirRolesDeCapa(cadenaEfectiva),
      });
    }
  }
  return filas;
}

function recurso(prefijo) {
  // '/api/riesgo-psicosocial' -> 'riesgo-psicosocial'
  const partes = prefijo.split('/').filter(Boolean);
  return partes[1] || partes[0] || prefijo;
}

function generarMatriz() {
  const montajes = extraerMontajes();
  const requires = extraerRequires();
  const filasPorRecurso = [];

  for (const { prefijo, variable } of montajes) {
    const rutaModulo = requires[variable];
    if (!rutaModulo) continue;
    const router = require(path.join(RAIZ, 'src', rutaModulo.replace('./', '')));
    const filas = introspeccionarRouter(router, prefijo);
    const rec = recurso(prefijo);
    filasPorRecurso.push({
      recurso: rec,
      prefijo,
      clasificacion: CLASIFICACION_RECURSOS[rec] || '(sin clasificar -- revisar)',
      filas,
    });
  }
  return filasPorRecurso;
}

function renderizarMarkdown(filasPorRecurso) {
  const fecha = new Date().toISOString().slice(0, 10);
  let out = '';
  out += '# Matriz Rol x Endpoint x Dato x Accion -- SISSO backend\n\n';
  out += '> Generado automaticamente por `scripts/generar_matriz_rbac.js` a partir de las\n';
  out += '> rutas reales de la aplicacion (introspeccion de `router.stack` de Express),\n';
  out += '> NO escrito ni mantenido a mano. Corrige el hallazgo CRITICO C15-02 de la\n';
  out += '> Auditoria Integral N.15. Para regenerar tras agregar o modificar una ruta:\n';
  out += '>\n';
  out += '> ```\n> node scripts/generar_matriz_rbac.js --escribir\n> ```\n>\n';
  out += '> CI ejecuta `node scripts/generar_matriz_rbac.js --verificar` en cada push y\n';
  out += '> falla si este archivo no coincide con las rutas reales del repositorio --\n';
  out += '> es decir, es estructuralmente imposible que esta matriz quede desactualizada\n';
  out += '> sin que el pipeline lo marque en rojo.\n>\n';
  out += `> Ultima generacion: ${fecha}.\n\n`;

  let totalRutas = 0;
  let totalPublicas = 0;
  let totalSinRestriccionRol = 0;

  for (const grupo of filasPorRecurso) {
    out += `## \`${grupo.prefijo}\`\n\n`;
    out += `**Clasificacion del dato:** ${grupo.clasificacion}\n\n`;
    out += '| Metodo | Ruta | Rol(es) permitido(s) |\n';
    out += '|---|---|---|\n';
    for (const fila of grupo.filas) {
      totalRutas++;
      if (fila.roles.startsWith('PUBLICA')) totalPublicas++;
      if (fila.roles.startsWith('cualquier rol autenticado')) totalSinRestriccionRol++;
      out += `| ${fila.metodo} | \`${fila.ruta}\` | ${fila.roles} |\n`;
    }
    out += '\n';
  }

  const resumen =
    `\n---\n\n**Resumen:** ${totalRutas} endpoints documentados. ` +
    `${totalPublicas} sin autenticacion (revisar cada una individualmente mas arriba). ` +
    `${totalSinRestriccionRol} requieren sesion valida pero no restringen por rol especifico.\n`;

  return out + resumen;
}

function main() {
  const modo = process.argv[2];
  const filasPorRecurso = generarMatriz();
  const md = renderizarMarkdown(filasPorRecurso);

  if (modo === '--escribir') {
    fs.mkdirSync(path.dirname(ARCHIVO_SALIDA), { recursive: true });
    fs.writeFileSync(ARCHIVO_SALIDA, md);
    console.log(`Escrito: ${ARCHIVO_SALIDA}`);
    return;
  }

  if (modo === '--verificar') {
    if (!fs.existsSync(ARCHIVO_SALIDA)) {
      console.error(`ERROR: ${ARCHIVO_SALIDA} no existe. Ejecuta: node scripts/generar_matriz_rbac.js --escribir`);
      process.exit(1);
    }
    const actual = fs.readFileSync(ARCHIVO_SALIDA, 'utf8').replace(/Ultima generacion: \d{4}-\d{2}-\d{2}\./, 'Ultima generacion: FECHA.');
    const nuevo = md.replace(/Ultima generacion: \d{4}-\d{2}-\d{2}\./, 'Ultima generacion: FECHA.');
    if (actual !== nuevo) {
      console.error('ERROR: docs/MATRIZ_RBAC.md esta desactualizado respecto de las rutas reales.');
      console.error('Ejecuta "node scripts/generar_matriz_rbac.js --escribir" y confirma el archivo actualizado.');
      process.exit(1);
    }
    console.log('OK: docs/MATRIZ_RBAC.md coincide con las rutas reales del repositorio.');
    return;
  }

  console.log(md);
}

module.exports = { main, generarMatriz, extraerMontajes, extraerRequires, introspeccionarRouter, describirRolesDeCapa, CLASIFICACION_RECURSOS };

if (require.main === module) {
  main();
}
