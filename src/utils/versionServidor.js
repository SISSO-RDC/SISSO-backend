// ============================================================
// CORRIGE hallazgo CRITICO C15-04 de la Auditoria Integral N.15
// (P0): el campo "version" de GET /api/salud era un string escrito
// a mano en src/index.js (ej. '2026-09-02-auditoria-n14') que
// alguien tenia que acordarse de actualizar en CADA entrega. Ya se
// demostro en la practica (Auditoria N.14) que ese paso manual se
// olvida: Render seguia sirviendo codigo pre-N.12 mientras
// /api/salud ya declaraba una version mas reciente, lo cual
// invalida el proposito mismo del campo (confirmar en segundos que
// Render sirve el ultimo codigo desplegado).
//
// Esta funcion resuelve la version SIN intervencion humana en cada
// entrega, en orden de preferencia:
//
//   1. RENDER_GIT_COMMIT: Render fija esta variable automaticamente
//      en cada build a partir del commit real que goo a desplegar,
//      dado que el repo SISSO-RDC/SISSO-backend en GitHub es la
//      fuente que Render construye (ver el flujo de despliegue de
//      SISSO: reemplazar el repo con el ZIP entregado y disparar
//      un redeploy). Es la fuente MAS confiable posible: si esto
//      esta presente, es literalmente el commit que Render
//      construyo, no una inferencia.
//   2. `git rev-parse --short HEAD` ejecutado localmente: util en
//      desarrollo local o en CI, donde SI hay un repositorio git
//      real presente aunque no se este en Render.
//   3. Si ninguna de las dos esta disponible (por ejemplo, un ZIP
//      desplegado sin metadatos de git ni variable de Render), se
//      devuelve 'commit-desconocido' de forma EXPLICITA -- nunca se
//      inventa un valor ni se cae de vuelta silenciosamente a un
//      string fijo, que es exactamente el problema que este cambio
//      corrige.
//
// Se combina con la version semantica de package.json (campo
// "version") y se calcula UNA sola vez al arrancar el proceso (no
// en cada peticion): el commit desplegado no cambia mientras el
// proceso esta vivo, y evitar un `execSync` por peticion es tanto
// mas simple como mas barato.
// ============================================================

const { execSync } = require('child_process');
const path = require('path');

function resolverCommit() {
  if (process.env.RENDER_GIT_COMMIT) {
    return { commit: process.env.RENDER_GIT_COMMIT.slice(0, 12), fuente: 'RENDER_GIT_COMMIT' };
  }
  try {
    const salida = execSync('git rev-parse --short HEAD', {
      cwd: path.join(__dirname, '..', '..'),
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    });
    return { commit: salida.toString().trim(), fuente: 'git rev-parse (local)' };
  } catch {
    return { commit: 'commit-desconocido', fuente: 'ninguna (ZIP sin metadatos de git ni RENDER_GIT_COMMIT)' };
  }
}

function calcularVersionServidor() {
  // require() de package.json en vez de leerlo con fs: Node cachea
  // el resultado, y ya es la forma que el resto del proyecto usa
  // para leer sus propios metadatos.
  const packageJson = require('../../package.json');
  const { commit, fuente } = resolverCommit();
  return {
    version: `${packageJson.version}+${commit}`,
    commit,
    fuenteCommit: fuente,
    iniciadoEn: new Date().toISOString(),
  };
}

// Se calcula una sola vez al cargar el modulo (arranque del
// proceso), no en cada peticion -- ver comentario de cabecera.
const VERSION_SERVIDOR = calcularVersionServidor();

module.exports = { VERSION_SERVIDOR, calcularVersionServidor };
