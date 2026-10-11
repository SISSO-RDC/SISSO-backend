// ============================================================
// CREADO en Auditoria N.19 (hallazgo GRAVE G19-12).
//
// La cache de autenticacion (estado de la organizacion y auth_epoch del
// usuario) es POR PROCESO: con mas de una instancia, una suspension, un
// cambio de rol o una revocacion de sesiones puede tardar hasta
// AUTH_CACHE_TTL_MS en llegar a las demas instancias. Hasta ahora eso
// solo estaba documentado ("poner 0 antes de escalar"); nada impedia que
// un operador escalara o subiera el TTL por accidente.
//
// Reglas que se hacen cumplir al arrancar:
//   1. AUTH_CACHE_TTL_MS entero entre 0 y 300000 (como antes).
//   2. Si el operador declara INSTANCIAS_MULTIPLES=true, el TTL DEBE ser 0;
//      de lo contrario el proceso se niega a arrancar (falla rapido, en vez
//      de arrancar con una ventana de revocacion no declarada).
//   3. Un TTL mayor que el default (20000) en produccion produce una
//      advertencia explicita en el log con la ventana maxima de revocacion.
//   4. El TTL efectivo se registra siempre al arrancar, para que un cambio
//      de configuracion sea visible en los logs de cada despliegue.
// ============================================================

const TTL_POR_DEFECTO_MS = 20 * 1000;
const TTL_MAXIMO_MS = 300000;

const esVerdadero = (v) => /^(true|1|si|yes)$/i.test(String(v || '').trim());

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ttlMs: number, multiInstancia: boolean, advertencias: string[]}}
 * @throws {Error} si el valor es invalido o contradice INSTANCIAS_MULTIPLES.
 */
function resolverConfigCacheAuth(env) {
  const crudo = env.AUTH_CACHE_TTL_MS;
  let ttlMs = TTL_POR_DEFECTO_MS;
  if (crudo !== undefined && crudo !== '') {
    const n = Number(crudo);
    if (!Number.isInteger(n) || n < 0 || n > TTL_MAXIMO_MS) {
      throw new Error(`AUTH_CACHE_TTL_MS invalido: debe ser un entero de 0 a ${TTL_MAXIMO_MS} (milisegundos).`);
    }
    ttlMs = n;
  }

  const multiInstancia = esVerdadero(env.INSTANCIAS_MULTIPLES);
  if (multiInstancia && ttlMs > 0) {
    throw new Error(
      `Configuracion insegura: INSTANCIAS_MULTIPLES=true con AUTH_CACHE_TTL_MS=${ttlMs}. ` +
      'La cache de autenticacion es por proceso: con varias instancias una suspension o revocacion ' +
      `tardaria hasta ${Math.round(ttlMs / 1000)} s en aplicarse en las demas. Defina AUTH_CACHE_TTL_MS=0.`
    );
  }

  const advertencias = [];
  if (ttlMs > TTL_POR_DEFECTO_MS && env.NODE_ENV === 'production') {
    advertencias.push(
      `AUTH_CACHE_TTL_MS=${ttlMs} supera el valor por defecto (${TTL_POR_DEFECTO_MS}): una suspension, ` +
      `cambio de rol o revocacion de sesiones puede tardar hasta ${Math.round(ttlMs / 1000)} s en reflejarse.`
    );
  }
  return { ttlMs, multiInstancia, advertencias };
}

module.exports = { resolverConfigCacheAuth, TTL_POR_DEFECTO_MS, TTL_MAXIMO_MS };
