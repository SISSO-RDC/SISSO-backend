// ============================================================
// AVANZA hallazgo GRAVE G15-05 de la Auditoria Integral N.15:
// "la auditoria y trazabilidad aun dependen de disciplina de los
// controladores -- un endpoint futuro puede olvidar registrar una
// lectura/escritura sensible".
//
// Una solucion completa (interceptor/middleware automatico que
// registre auditoria sin que cada controlador tenga que acordarse)
// es un cambio de arquitectura mayor que excede el alcance de esta
// entrega. Esta prueba es la red de seguridad minima viable mientras
// tanto: verifica, a nivel de ARCHIVO de controlador (no de cada
// funcion individual -- esa granularidad exigiria parsear el AST),
// que todo controlador que expone al menos una ruta de escritura
// (POST/PUT/PATCH/DELETE) sobre un recurso clasificado como
// clinico_individual en la matriz RBAC (ver CLASIFICACION_RECURSOS
// de scripts/generar_matriz_rbac.js) contenga AL MENOS UNA llamada a
// registrarAuditoria en algun punto del archivo.
//
// Esto no garantiza que la funcion CORRECTA registre auditoria (para
// eso se necesitan las pruebas especificas de cada modulo, como
// tests/atomicidad_auditoria.test.js), pero si detecta el caso mas
// grave: un controlador clinico completo que nunca llama a
// registrarAuditoria en absoluto, lo cual seria una señal fuerte de
// que se olvido por completo, no solo en una funcion.
// ============================================================

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { generarMatriz, extraerMontajes, extraerRequires, CLASIFICACION_RECURSOS } = require('../scripts/generar_matriz_rbac');

const RAIZ = path.join(__dirname, '..', 'src');

// Controladores excluidos deliberadamente, con su justificacion --
// mismo patron que las listas de excepciones de los otros tests de
// esta entrega (inventario_rutas_seguras, k_anonimato_centralizado).
const EXCEPCIONES_JUSTIFICADAS = {
  // (ninguna por ahora: todo controlador clinico con escritura
  // deberia poder justificar al menos una llamada a registrarAuditoria)
};

function nombreRecurso(prefijo) {
  const partes = prefijo.split('/').filter(Boolean);
  return partes[1] || partes[0] || prefijo;
}

test('G15-05: todo controlador con rutas de escritura sobre un recurso clinico_individual llama a registrarAuditoria al menos una vez', () => {
  const montajes = extraerMontajes();
  const requires = extraerRequires();
  const grupos = generarMatriz();

  const sinAuditoria = [];

  for (const grupo of grupos) {
    const clasificacion = CLASIFICACION_RECURSOS[nombreRecurso(grupo.prefijo)] || '';
    if (!clasificacion.startsWith('clinico_individual')) continue;

    const tieneEscritura = grupo.filas.some((f) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(f.metodo));
    if (!tieneEscritura) continue;

    // Ubicar el archivo de rutas correspondiente a este prefijo, y
    // desde alli el/los controlador(es) que importa (por convencion
    // de nombres: XxxRoutes.js requiere ../controllers/XxxController).
    const montaje = montajes.find((m) => m.prefijo === grupo.prefijo);
    if (!montaje) continue;
    const rutaArchivoRoutes = requires[montaje.variable];
    if (!rutaArchivoRoutes) continue;
    if (rutaArchivoRoutes in EXCEPCIONES_JUSTIFICADAS) continue;

    const contenidoRoutes = fs.readFileSync(path.join(RAIZ, rutaArchivoRoutes.replace('./', '') + '.js'), 'utf8');
    const controladoresImportados = [...contenidoRoutes.matchAll(/require\('(\.\.\/controllers\/\w+)'\)/g)].map((m) => m[1]);

    let algunoTieneAuditoria = false;
    for (const rutaControlador of controladoresImportados) {
      const rutaAbsoluta = path.join(RAIZ, rutaControlador.replace('../', '') + '.js');
      if (!fs.existsSync(rutaAbsoluta)) continue;
      const contenidoControlador = fs.readFileSync(rutaAbsoluta, 'utf8');
      if (/registrarAuditoria/.test(contenidoControlador)) {
        algunoTieneAuditoria = true;
        break;
      }
    }

    if (!algunoTieneAuditoria && controladoresImportados.length > 0) {
      sinAuditoria.push(`${grupo.prefijo} (${controladoresImportados.join(', ')})`);
    }
  }

  assert.deepEqual(
    sinAuditoria,
    [],
    'Los siguientes recursos clinico_individual tienen rutas de escritura pero su(s) ' +
    'controlador(es) nunca llaman a registrarAuditoria en todo el archivo -- revisar si ' +
    'realmente no necesitan auditoria o si se olvido registrarla: ' + sinAuditoria.join('; ')
  );
});
