// ============================================================
// CIERRA hallazgo GRAVE G15-01 de la Auditoria Integral N.15:
// "ausencia de prueba integral de todas las rutas sensibles".
//
// Esta prueba NO llama a la API por HTTP (no necesita servidor ni
// base de datos): reutiliza la MISMA introspeccion real del arbol
// de rutas de Express que usa scripts/generar_matriz_rbac.js (cierra
// C15-02), para no mantener una segunda copia de la logica que
// pueda divergir de la matriz publicada.
//
// Que garantiza esta prueba, automaticamente, para las ~215 rutas
// reales de la aplicacion, sin que nadie tenga que enumerarlas a
// mano ni acordarse de agregar una fila cuando se crea una ruta
// nueva:
//
//   1. Ninguna ruta queda "PUBLICA" (sin ningun middleware de
//      autenticacion) a menos que su path este en la lista explicita
//      RUTAS_PUBLICAS_APROBADAS de abajo. Si alguien agrega una ruta
//      nueva y se olvida el `autenticar`, esta prueba la detecta el
//      mismo dia, no en la proxima auditoria externa.
//   2. Cada entrada de RUTAS_PUBLICAS_APROBADAS realmente existe en
//      el codigo (si se elimina una ruta publica del codigo sin
//      actualizar esta lista, la prueba tambien falla -- evita que
//      la lista de "excepciones aprobadas" acumule entradas muertas
//      que ya nadie puede justificar).
// ============================================================

const test = require('node:test');
const assert = require('node:assert');
const { generarMatriz } = require('../scripts/generar_matriz_rbac');

// Cada excepcion debe tener una razon de una linea -- si no se puede
// explicar en una linea por que una ruta no necesita autenticacion,
// probablemente si la necesita.
const RUTAS_PUBLICAS_APROBADAS = {
  'POST /api/auth/login': 'es el endpoint que CREA la sesion; no puede exigir una sesion previa.',
  'POST /api/auth/refrescar': 'usa el refresh token en cookie HttpOnly, no un access token Bearer; protegido por verificarOrigenCookie (Origin/Referer), no por autenticar.',
  'POST /api/auth/logout': 'idem refrescar: cookie HttpOnly + verificarOrigenCookie.',
  'POST /api/auth/bootstrap-superadmin': 'protegido por BOOTSTRAP_SECRET (secreto de un solo uso), no por JWT -- es el endpoint que crea la PRIMERA cuenta de una instalacion nueva.',
  'POST /api/auth/recuperar-superadmin': 'protegido por RECOVERY_SECRET, mismo motivo que bootstrap.',
  'POST /api/auth/mfa/verificar-login': 'usa el mfaToken corto de 5 minutos del flujo de login con MFA, no un access token -- ver autenticarOMfaPendiente.',
  'POST /api/solicitudes-titular/publico': 'formulario publico de derechos ARCO/habeas data: el titular de los datos, por definicion, no tiene ni deberia necesitar una cuenta en el sistema para ejercerlos.',
};

test('G15-01: ninguna ruta de la aplicacion es publica salvo la lista explicita y justificada de excepciones', () => {
  const grupos = generarMatriz();
  const encontradasPublicas = new Set();
  const noAprobadas = [];

  for (const grupo of grupos) {
    for (const fila of grupo.filas) {
      if (fila.roles.startsWith('PUBLICA')) {
        const clave = `${fila.metodo} ${fila.ruta}`;
        encontradasPublicas.add(clave);
        if (!(clave in RUTAS_PUBLICAS_APROBADAS)) {
          noAprobadas.push(clave);
        }
      }
    }
  }

  if (noAprobadas.length > 0) {
    assert.fail(
      'Se encontraron rutas SIN autenticacion que no estan en la lista aprobada ' +
      '(agregalas a RUTAS_PUBLICAS_APROBADAS en este archivo con una justificacion, ' +
      'o corrige la ruta para que exija `autenticar`):\n  - ' + noAprobadas.join('\n  - ')
    );
  }

  // Simetria inversa: si una excepcion aprobada ya NO existe como
  // ruta publica en el codigo (se elimino la ruta, o se le agrego
  // autenticacion), se exige limpiar la lista -- una excepcion de
  // seguridad "aprobada" que ya no aplica a nada real no debe
  // quedar dando vueltas en el repositorio.
  const aprobadasObsoletas = Object.keys(RUTAS_PUBLICAS_APROBADAS).filter((clave) => !encontradasPublicas.has(clave));
  assert.deepEqual(
    aprobadasObsoletas,
    [],
    'Las siguientes excepciones de RUTAS_PUBLICAS_APROBADAS ya no corresponden a ninguna ' +
    'ruta publica real (se elimino la ruta o ya exige autenticacion) -- retiralas de la lista: ' +
    aprobadasObsoletas.join(', ')
  );
});

test('G15-01: toda ruta que modifica datos (POST/PUT/PATCH/DELETE) fuera de la lista publica exige un rol especifico o sesion valida', () => {
  // Cobertura complementaria: no solo "tiene autenticar", sino que
  // el patron general del proyecto (autorizar por rol para escritura
  // sensible) se mantiene visible via la matriz -- esta prueba no
  // reemplaza el juicio humano sobre CUAL rol es el correcto (eso lo
  // cubren las pruebas RBAC especificas de cada modulo), solo evita
  // el caso extremo de una escritura que quedo sin ningun control.
  const grupos = generarMatriz();
  let totalEscrituras = 0;

  for (const grupo of grupos) {
    for (const fila of grupo.filas) {
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(fila.metodo)) continue;
      const clave = `${fila.metodo} ${fila.ruta}`;
      if (clave in RUTAS_PUBLICAS_APROBADAS) continue;
      totalEscrituras++;
      assert.notEqual(
        fila.roles.startsWith('PUBLICA'),
        true,
        `${clave} modifica datos y no exige autenticacion ni esta en la lista de excepciones aprobadas.`
      );
    }
  }

  // Sanity check: si esto llega a 0, algo esta mal en la introspeccion
  // (la aplicacion definitivamente tiene decenas de rutas de escritura).
  assert.ok(totalEscrituras > 50, `Se esperaban mas de 50 rutas de escritura, se encontraron ${totalEscrituras} -- revisar la introspeccion.`);
});
