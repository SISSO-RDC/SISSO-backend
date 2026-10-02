// ============================================================
// Contexto de la peticion HTTP actual, propagado a traves de todo
// el codigo asincrono sin necesitar pasarlo como parametro por
// cada funcion (AsyncLocalStorage es exactamente para esto).
//
// CORRIGE el hallazgo GRAVE G3 de la Auditoria Integral 2026-08-22:
// "RLS sigue siendo opcional... el aislamiento depende
// fundamentalmente del backend/controladores/queries". Este archivo
// es la pieza que permite activar Row-Level Security de PostgreSQL
// como SEGUNDA barrera de aislamiento, SIN modificar ninguno de los
// ~50 controladores existentes: middleware/auth.js guarda aqui el
// organizacion_id/usuario_id ya verificado del JWT, y db/pool.js lo
// lee para fijar variables de sesion de Postgres (SET LOCAL) antes
// de cada consulta. Los controladores siguen llamando query() y
// withTransaction() exactamente igual que siempre.
// ============================================================
const { AsyncLocalStorage } = require('node:async_hooks');

const almacen = new AsyncLocalStorage();

/**
 * Ejecuta `callback` con el contexto de peticion disponible para
 * todo el codigo asincrono que se ejecute dentro (incluyendo
 * llamadas a query()/withTransaction() en cualquier controlador).
 */
function ejecutarConContexto(datosContexto, callback) {
  almacen.run(datosContexto, callback);
}

/**
 * Devuelve el contexto de la peticion actual, o undefined si se
 * esta ejecutando fuera de una peticion HTTP (scripts de migracion,
 * seeds de prueba, tareas internas) -- en ese caso db/pool.js NO
 * aplica ningun scoping de sesion, exactamente el mismo
 * comportamiento que tenia antes de esta correccion.
 */
function obtenerContexto() {
  return almacen.getStore();
}

module.exports = { ejecutarConContexto, obtenerContexto };
