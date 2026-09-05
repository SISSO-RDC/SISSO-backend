// ============================================================
// CIERRA hallazgo GRAVE G15-06 de la Auditoria Integral N.15:
// "reportes y dashboard requieren mantenimiento permanente del
// k-anonimato -- convertir la supresion en una biblioteca
// obligatoria y prohibir respuestas analiticas sensibles que no
// pasen por ella".
//
// Ya existe una biblioteca centralizada (src/utils/kAnonimato.js,
// creada en Auditoria N.14). El problema que sigue abierto es que
// NADA impide que un controlador nuevo (o uno viejo, como paso con
// riesgoPsicosocialController.js -- ver la correccion de esta misma
// entrega) reimplemente el umbral como un literal "5" hardcodeado en
// vez de importarlo. Esta prueba es esa "prohibicion" en forma
// ejecutable: escanea cada controlador que MENCIONA conceptos de
// k-anonimato/redaccion por grupo pequeño y exige que tambien
// importe el modulo centralizado -- si alguien agrega una nueva
// metrica agregada con su propia logica de supresion "inspirada en"
// la centralizada en vez de importarla, esta prueba falla en CI el
// mismo dia, no en la proxima auditoria.
// ============================================================

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', 'src');
const RUTA_MODULO_CENTRAL = path.join(RAIZ, 'utils', 'kAnonimato.js');

// Palabras que, si aparecen en un archivo de controlador o de
// generacion de reportes, indican que ese archivo TOMA DECISIONES de
// supresion por grupo pequeño (no solo las muestra). Deliberadamente
// amplio: preferible una alerta de mas (un archivo que las use en un
// comentario sin logica propia) que una omision.
const SEÑALES_DE_LOGICA_K_ANONIMATO = [/k-anonim/i, /kAnonimato/, /K_ANONIMATO/, /grupo\s*pequeñ/i];

function listarArchivosJs(dir) {
  const resultado = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const rutaCompleta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      resultado.push(...listarArchivosJs(rutaCompleta));
    } else if (entrada.name.endsWith('.js')) {
      resultado.push(rutaCompleta);
    }
  }
  return resultado;
}

// Excepciones explicitas y justificadas: archivos que MENCIONAN
// conceptos de k-anonimato (en comentarios o porque leen un campo
// como `redactado`) pero nunca TOMAN la decision de umbral ellos
// mismos -- solo renderizan una bandera que otro modulo ya calculo.
// Igual que RUTAS_PUBLICAS_APROBADAS en tests/inventario_rutas_seguras.test.js,
// cada entrada exige una justificacion de una linea.
const EXCEPCIONES_JUSTIFICADAS = {
  'reportes/pdfReporteBI.js': 'solo LEE el campo `redactado`/`_restringido` que reportesController.js ya calculo; nunca compara un conteo contra ningun umbral por si mismo (verificado: no contiene ninguna comparacion numerica junto a estas palabras clave).',
};

test('G15-06: todo archivo que implementa logica de k-anonimato/grupo-pequeño importa el umbral centralizado, ninguno lo reimplementa suelto', () => {
  const archivosSospechosos = listarArchivosJs(path.join(RAIZ, 'controllers'))
    .concat(listarArchivosJs(path.join(RAIZ, 'reportes')))
    .filter((archivo) => path.resolve(archivo) !== path.resolve(RUTA_MODULO_CENTRAL));

  const sinImportarModuloCentral = [];

  for (const archivo of archivosSospechosos) {
    const rutaRelativa = path.relative(RAIZ, archivo);
    if (rutaRelativa in EXCEPCIONES_JUSTIFICADAS) continue;

    const contenido = fs.readFileSync(archivo, 'utf8');
    const mencionaConcepto = SEÑALES_DE_LOGICA_K_ANONIMATO.some((regex) => regex.test(contenido));
    if (!mencionaConcepto) continue;

    const importaModuloCentral = /require\(['"].*utils\/kAnonimato['"]\)/.test(contenido);
    if (!importaModuloCentral) {
      sinImportarModuloCentral.push(rutaRelativa);
    }
  }

  assert.deepEqual(
    sinImportarModuloCentral,
    [],
    'Los siguientes archivos mencionan logica de k-anonimato/grupo pequeño pero NO importan ' +
    'src/utils/kAnonimato.js -- probablemente reimplementaron el umbral como un literal suelto ' +
    '(exactamente el riesgo de G15-06): ' + sinImportarModuloCentral.join(', ')
  );
});

test('G15-06: ningun controlador compara un conteo contra el literal "5" en una condicion que menciona grupo/redaccion (deberia usar UMBRAL_K_ANONIMATO)', () => {
  // Complementa la prueba anterior: aun importando el modulo, es
  // posible dejar un segundo literal "5" a mano por descuido (copiar-
  // pegar una condicion antes de terminar de reemplazarla). Se busca
  // el patron literal "< 5" o ">= 5" en la misma linea que las
  // palabras clave de redaccion.
  const archivos = listarArchivosJs(path.join(RAIZ, 'controllers'));
  const lineasSospechosas = [];

  for (const archivo of archivos) {
    const lineas = fs.readFileSync(archivo, 'utf8').split('\n');
    lineas.forEach((linea, indice) => {
      const pareceUmbralHardcodeado = /(<|>=)\s*5\b/.test(linea) && /redac|grupo\s*pequeñ|k-anonim/i.test(linea);
      if (pareceUmbralHardcodeado) {
        lineasSospechosas.push(`${path.relative(RAIZ, archivo)}:${indice + 1}`);
      }
    });
  }

  assert.deepEqual(
    lineasSospechosas,
    [],
    'Se encontraron comparaciones con el literal "5" hardcodeado en lineas relacionadas con ' +
    'redaccion por grupo pequeño -- usar UMBRAL_K_ANONIMATO de src/utils/kAnonimato.js en su lugar: ' +
    lineasSospechosas.join(', ')
  );
});
