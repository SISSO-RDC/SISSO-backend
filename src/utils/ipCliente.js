// ============================================================
// CREADO en Auditoria N.19 (hallazgo GRAVE G19-10).
//
// Antes, la IP de origen que se guarda en `auditoria` y en
// `refresh_tokens` se leia directamente de la cabecera
// X-Forwarded-For. Esa cabecera la escribe QUIEN ENVIA la peticion:
// cualquier cliente podia mandar "X-Forwarded-For: 1.2.3.4" y
// falsear su IP en la bitacora. Ademas ip_origen es VARCHAR(64): una
// cabecera larga (o una cadena de varios saltos) hacia fallar el
// INSERT, y como la auditoria clinica corre dentro de la transaccion,
// esa falla podia convertirse en un 500 provocado por el cliente.
//
// Ahora la IP sale de `req.ip`, que Express calcula segun la
// configuracion explicita de `trust proxy`: solo se confia en la
// cantidad de proxies que la infraestructura REAL agrega. El valor se
// controla con la variable TRUST_PROXY (ver .env.example).
// ============================================================

// Traduce TRUST_PROXY al valor que espera `app.set('trust proxy', ...)`.
//  - sin definir: 1 salto en produccion (el balanceador de Render);
//    false fuera de produccion (sin proxy, no se confia en nada).
//  - "false" / "0": no confiar en ninguna cabecera (conexion directa).
//  - numero N: confiar en exactamente N saltos de proxy.
//  - lista de subredes/palabras clave de Express ("loopback, 10.0.0.0/8").
//  - "true" NO se acepta: confiar en toda la cadena permite falsear la IP.
function configurarTrustProxy(valor, esProduccion) {
  const porDefecto = esProduccion ? 1 : false;
  if (valor === undefined || valor === null || String(valor).trim() === '') return porDefecto;
  const v = String(valor).trim();
  if (/^(false|no|0)$/i.test(v)) return false;
  if (/^\d+$/.test(v)) return Number(v);
  if (/^true$/i.test(v)) {
    console.warn('ADVERTENCIA: TRUST_PROXY=true no esta permitido (permite falsear la IP de origen). Se usa el valor por defecto.');
    return porDefecto;
  }
  return v;
}

// IP del cliente para bitacoras. Nunca lee X-Forwarded-For directamente.
// Siempre cabe en VARCHAR(64) (una IPv6 mide a lo sumo 45 caracteres).
function obtenerIpCliente(req) {
  if (!req) return null;
  const cruda = req.ip || (req.socket && req.socket.remoteAddress) || null;
  if (!cruda) return null;
  return String(cruda).replace(/^::ffff:/i, '').slice(0, 64);
}

module.exports = { configurarTrustProxy, obtenerIpCliente };
