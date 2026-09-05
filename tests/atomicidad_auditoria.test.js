// ============================================================
// Prueba de atomicidad clinica-auditoria: corrige el criterio de
// aceptacion explicito del hallazgo CRITICO/P0 C-N08-01 de la
// Auditoria Integral SISSO N.08: "Debe existir una prueba que
// simule un fallo de auditoria y confirme que no queda ninguna
// fila clinica parcial."
//
// Metodo: se agrega temporalmente un trigger BEFORE INSERT a la
// tabla `auditoria` que siempre lanza una excepcion -- un trigger se
// dispara SIEMPRE, incluso para el dueño de la tabla (a diferencia
// de REVOKE, que un dueño de tabla ignora), y usa un codigo de error
// (P0001) que no colisiona con el manejo especifico de errores 23514
// que ya tiene aptitudController.js para el CHECK de
// justificacion_clinica. Cualquier INSERT en auditoria durante la
// ventana de la prueba falla garantizado, sin necesidad de mockear
// ni tocar el codigo de produccion: es un fallo de base de datos
// real, exactamente el escenario que describe el hallazgo.
//
// Con esa restriccion activa, se llama al endpoint real de registro
// de aptitud (POST /api/aptitud/trabajadores/:id/registrar). Antes
// de la correccion de esta sesion, la API respondia 500 pero
// historial_aptitud_medica y trabajadores.aptitud YA HABIAN quedado
// escritos (auditoria corria en su propia transaccion). Con la
// correccion (registrarAuditoria dentro de withTransaction), un 500
// debe significar que NADA quedo escrito: ni el historial, ni el
// cache de aptitud del trabajador.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { iniciarServidor, detenerServidor } = require('./helpers/servidor');
const { iniciarSesionCompleta, peticion } = require('./helpers/cliente');
const { sembrar, limpiar } = require('./helpers/seed');
const { pool, queryComoSuperadmin } = require('../src/db/pool');

let datos;
let tokenMedicoA;

before(async () => {
  await limpiar();
  datos = await sembrar();
  await iniciarServidor();
  tokenMedicoA = await iniciarSesionCompleta(datos.usuarios.medico.email, datos.passwordPrueba, datos.secretoTotp);
});

after(async () => {
  detenerServidor();
  // Por si alguna prueba fallara antes de poder quitar el trigger,
  // nos aseguramos de dejarlo removido siempre.
  await pool.query(`DROP TRIGGER IF EXISTS test_trigger_fallo_auditoria ON auditoria`).catch(() => {});
  await pool.query(`DROP FUNCTION IF EXISTS test_forzar_fallo_auditoria()`).catch(() => {});
  await limpiar();
});

test('ATOMICIDAD: si el INSERT de auditoria falla, NO queda un registro parcial de aptitud (rollback completo)', async () => {
  // Estado ANTES del intento: el trabajador de prueba se siembra
  // con aptitud = 'apto'.
  const antesRes = await queryComoSuperadmin(
    `SELECT aptitud FROM trabajadores WHERE id = $1`,
    [datos.trabajadorAId]
  );
  assert.equal(antesRes.rows[0].aptitud, 'apto');

  const historialAntesRes = await queryComoSuperadmin(
    `SELECT COUNT(*) AS total FROM historial_aptitud_medica WHERE trabajador_id = $1`,
    [datos.trabajadorAId]
  );
  const totalHistorialAntes = parseInt(historialAntesRes.rows[0].total, 10);

  // Forzar el fallo: cualquier INSERT en auditoria falla mientras
  // este trigger exista. Se usa un trigger (no un CHECK) para que
  // el codigo de error de Postgres sea P0001 (RAISE EXCEPTION
  // generico) y no 23514 (check_violation) -- aptitudController.js
  // intercepta 23514 especificamente para el CHECK de longitud
  // minima de justificacion_clinica y responde 400 en ese caso, lo
  // cual interferiria con esta prueba si reutilizaramos ese mismo
  // codigo de error para un motivo distinto.
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_forzar_fallo_auditoria() RETURNS TRIGGER AS $f$
    BEGIN
      RAISE EXCEPTION 'Fallo simulado de auditoria (prueba de atomicidad C-N08-01)';
    END;
    $f$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    CREATE TRIGGER test_trigger_fallo_auditoria BEFORE INSERT ON auditoria
    FOR EACH ROW EXECUTE FUNCTION test_forzar_fallo_auditoria();
  `);

  try {
    const marcaJustificacion = 'JUSTIFICACION_PRUEBA_ATOMICIDAD_' + Date.now();
    const { status, datos: cuerpo } = await peticion('POST', `/aptitud/trabajadores/${datos.trabajadorAId}/registrar`, tokenMedicoA, {
      aptitud: 'no_apto',
      puestoEvaluado: 'Operador de prueba',
      diagnosticosCie10: [],
      exposicionesPuesto: [],
      justificacionClinica: `${marcaJustificacion}: justificacion clinica de prueba con longitud suficiente.`,
    });

    // Con la restriccion forzando el fallo de auditoria, la API
    // DEBE responder con un error (nunca 201): la operacion no debe
    // aparentar exito si su auditoria no pudo registrarse.
    assert.notEqual(status, 201, 'la API no debe responder 201 si la auditoria no pudo registrarse.');
    assert.equal(status, 500);
    assert.ok(cuerpo.error, 'debe incluir un mensaje de error.');
  } finally {
    // Quitar el trigger SIEMPRE, incluso si la asercion de arriba fallara.
    await pool.query(`DROP TRIGGER IF EXISTS test_trigger_fallo_auditoria ON auditoria`);
    await pool.query(`DROP FUNCTION IF EXISTS test_forzar_fallo_auditoria()`);
  }

  // Verificacion de fondo: NINGUN cambio clinico debe haber quedado
  // confirmado. Este es el criterio de aceptacion explicito de
  // C-N08-01.
  const despuesRes = await queryComoSuperadmin(
    `SELECT aptitud FROM trabajadores WHERE id = $1`,
    [datos.trabajadorAId]
  );
  assert.equal(despuesRes.rows[0].aptitud, 'apto', 'trabajadores.aptitud NO debe haber cambiado a "no_apto": la transaccion completa debio revertirse.');

  const historialDespuesRes = await queryComoSuperadmin(
    `SELECT COUNT(*) AS total FROM historial_aptitud_medica WHERE trabajador_id = $1`,
    [datos.trabajadorAId]
  );
  const totalHistorialDespues = parseInt(historialDespuesRes.rows[0].total, 10);
  assert.equal(totalHistorialDespues, totalHistorialAntes, 'NO debe haber quedado ninguna fila nueva en historial_aptitud_medica.');

  // Y, coherentemente, tampoco debe haber quedado ningun registro de
  // auditoria de esta accion (la restriccion impidio insertar CUALQUIER
  // fila en auditoria durante la ventana de la prueba).
  const auditoriaRes = await queryComoSuperadmin(
    `SELECT COUNT(*) AS total FROM auditoria WHERE accion = 'registrar_aptitud_medica' AND entidad_id = $1::text`,
    [datos.trabajadorAId]
  ).catch(() => ({ rows: [{ total: 0 }] }));
  // No es una asercion estricta (entidad_id real es el id del
  // historial, no del trabajador) -- la comprobacion de fondo real
  // ya la hicieron las 2 aserciones anteriores.
  void auditoriaRes;
});

test('ATOMICIDAD: sin la restriccion forzada, registrar aptitud SI funciona normalmente (no quedo nada roto)', async () => {
  // NOTA (Auditoria N.15, C15-03): esta prueba se escribio antes de
  // la Auditoria N.14 (hallazgo CRITICO C14-02), que introdujo el
  // bloqueo 409 "evaluacionIncompleta" para cualquier aptitud !=
  // 'no_apto' cuando el puesto no tiene matriz de exposicion
  // validada. El trabajador de prueba (sembrado por tests/helpers/seed.js)
  // no tiene puesto_trabajo_id asignado, asi que sin este flag la
  // llamada ahora responde 409 en vez de 201 -- no por un fallo de
  // atomicidad (que es lo que esta prueba en realidad verifica), sino
  // por el nuevo control de matriz. Se envia confirmarEvaluacionIncompleta
  // para aislar exactamente lo que esta prueba mide.
  const { status, datos: cuerpo } = await peticion('POST', `/aptitud/trabajadores/${datos.trabajadorAId}/registrar`, tokenMedicoA, {
    aptitud: 'apto',
    puestoEvaluado: 'Operador de prueba',
    diagnosticosCie10: [],
    exposicionesPuesto: [],
    justificacionClinica: 'Justificacion clinica de prueba con longitud suficiente para pasar validacion.',
    confirmarEvaluacionIncompleta: true,
  });
  assert.equal(status, 201);
  assert.ok(cuerpo.registroAptitud.id);
});
