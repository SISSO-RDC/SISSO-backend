// ============================================================
// CIERRA hallazgo GRAVE G15-03 de la Auditoria Integral N.15:
// "el diseno depende de Origin/Referer + CORS para reducir CSRF
// porque la cookie de refresh token es cross-site (SameSite=None)
// -- crear pruebas negativas de Origin/Referer para refrescar/logout".
//
// verificarOrigenCookie() (src/middleware/auth.js) SOLO aplica su
// logica cuando NODE_ENV === 'production' -- en desarrollo/test deja
// pasar todo, a proposito, para no trabar el flujo local del equipo.
// Eso significa que levantar el servidor de pruebas normal (que
// corre con NODE_ENV=test) NUNCA ejercita esta proteccion por HTTP.
// En vez de forzar todo el servidor a NODE_ENV=production (lo cual
// cambiaria de paso otro comportamiento -- formato de logs de
// morgan, etc. -- y podria esconder fallas de un test en otro), esta
// suite prueba la funcion DIRECTAMENTE como lo que es: un middleware
// puro de Express (req, res, next) => ..., con req/res sintetizados
// y NODE_ENV/CORS_ORIGINS controlados explicitamente para cada caso,
// restaurando el entorno real al terminar cada prueba.
// ============================================================

const test = require('node:test');
const assert = require('node:assert');
const { verificarOrigenCookie } = require('../src/middleware/auth');

function crearReq({ origin, referer } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (referer) headers.referer = referer;
  return { headers };
}

function crearResEspia() {
  const res = {
    statusCode: null,
    body: null,
    status(codigo) { this.statusCode = codigo; return this; },
    json(cuerpo) { this.body = cuerpo; return this; },
  };
  return res;
}

function ejecutarConEntorno({ nodeEnv, corsOrigins }, fn) {
  const nodeEnvOriginal = process.env.NODE_ENV;
  const corsOriginsOriginal = process.env.CORS_ORIGINS;
  process.env.NODE_ENV = nodeEnv;
  if (corsOrigins === undefined) delete process.env.CORS_ORIGINS;
  else process.env.CORS_ORIGINS = corsOrigins;
  try {
    return fn();
  } finally {
    process.env.NODE_ENV = nodeEnvOriginal;
    if (corsOriginsOriginal === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = corsOriginsOriginal;
  }
}

test('G15-03: en produccion, un Origin que NO esta en CORS_ORIGINS es rechazado (403) para rutas cookie-authenticated', () => {
  ejecutarConEntorno({ nodeEnv: 'production', corsOrigins: 'https://sisso-rdc.github.io' }, () => {
    const req = crearReq({ origin: 'https://sitio-malicioso.example' });
    const res = crearResEspia();
    let siguienteLlamado = false;
    verificarOrigenCookie(req, res, () => { siguienteLlamado = true; });

    assert.equal(siguienteLlamado, false, 'next() NUNCA debe llamarse con un origen no autorizado.');
    assert.equal(res.statusCode, 403);
  });
});

test('G15-03: en produccion, un Referer que NO esta en CORS_ORIGINS es rechazado (403) igual que un Origin invalido', () => {
  // Cubre exactamente el caso que el hallazgo menciona: un <form> o
  // fetch(mode:'no-cors') desde un sitio malicioso puede omitir el
  // header Origin en ciertas configuraciones, pero el navegador
  // siempre envia Referer -- por eso el middleware valida ambos.
  ejecutarConEntorno({ nodeEnv: 'production', corsOrigins: 'https://sisso-rdc.github.io' }, () => {
    const req = crearReq({ referer: 'https://sitio-malicioso.example/pagina-trampa.html' });
    const res = crearResEspia();
    let siguienteLlamado = false;
    verificarOrigenCookie(req, res, () => { siguienteLlamado = true; });

    assert.equal(siguienteLlamado, false);
    assert.equal(res.statusCode, 403);
  });
});

test('G15-03: en produccion, un Origin que SI esta en CORS_ORIGINS pasa (next() llamado, sin respuesta de error)', () => {
  ejecutarConEntorno({ nodeEnv: 'production', corsOrigins: 'https://sisso-rdc.github.io,https://app.sisso.ec' }, () => {
    const req = crearReq({ origin: 'https://app.sisso.ec' });
    const res = crearResEspia();
    let siguienteLlamado = false;
    verificarOrigenCookie(req, res, () => { siguienteLlamado = true; });

    assert.equal(siguienteLlamado, true);
    assert.equal(res.statusCode, null, 'no debe haberse escrito ninguna respuesta de error.');
  });
});

test('G15-03: en produccion, SIN CORS_ORIGINS configurada, cualquier Origin con header es rechazado (fail-closed, no fail-open)', () => {
  // Es el escenario exacto que el hallazgo teme: "una configuracion
  // incorrecta de CORS_ORIGINS" (ej. olvidarla en Render). El lado
  // seguro del error es romper el frontend, no aceptar cualquier
  // origen.
  ejecutarConEntorno({ nodeEnv: 'production', corsOrigins: undefined }, () => {
    const req = crearReq({ origin: 'https://sisso-rdc.github.io' });
    const res = crearResEspia();
    let siguienteLlamado = false;
    verificarOrigenCookie(req, res, () => { siguienteLlamado = true; });

    assert.equal(siguienteLlamado, false);
    assert.equal(res.statusCode, 403);
  });
});

test('G15-03: en produccion, una peticion SIN Origin ni Referer (Postman, apps moviles, health checks) pasa', () => {
  ejecutarConEntorno({ nodeEnv: 'production', corsOrigins: 'https://sisso-rdc.github.io' }, () => {
    const req = crearReq({});
    const res = crearResEspia();
    let siguienteLlamado = false;
    verificarOrigenCookie(req, res, () => { siguienteLlamado = true; });

    assert.equal(siguienteLlamado, true);
  });
});

test('G15-03: fuera de produccion (desarrollo/test), el middleware es permisivo a proposito (no traba el flujo local)', () => {
  ejecutarConEntorno({ nodeEnv: 'development', corsOrigins: undefined }, () => {
    const req = crearReq({ origin: 'https://cualquier-cosa.example' });
    const res = crearResEspia();
    let siguienteLlamado = false;
    verificarOrigenCookie(req, res, () => { siguienteLlamado = true; });

    assert.equal(siguienteLlamado, true);
  });
});

test('G15-03 (salvaguarda de regresion): las rutas /api/auth/refrescar y /api/auth/logout usan verificarOrigenCookie en su cadena de middlewares', () => {
  // Verifica, contra el codigo REAL de authRoutes.js (no una copia a
  // mano), que las dos rutas que dependen de la cookie
  // SameSite=None sigan teniendo este middleware en su cadena. Si
  // alguien reescribe authRoutes.js y olvida este middleware en una
  // de las dos, esta prueba lo detecta sin depender de un servidor
  // en modo produccion.
  const authRoutes = require('../src/routes/authRoutes');

  const rutasQueDebenTenerlo = ['POST /api/auth/refrescar', 'POST /api/auth/logout'];
  const encontradas = new Set();

  for (const capa of authRoutes.stack) {
    if (!capa.route) continue;
    const metodos = Object.keys(capa.route.methods).filter((m) => capa.route.methods[m]);
    const tieneVerificarOrigen = capa.route.stack.some((c) => c.handle.name === 'verificarOrigenCookie');
    if (tieneVerificarOrigen) {
      for (const metodo of metodos) {
        encontradas.add(`${metodo.toUpperCase()} /api/auth${capa.route.path}`);
      }
    }
  }

  for (const ruta of rutasQueDebenTenerlo) {
    assert.ok(encontradas.has(ruta), `${ruta} deberia usar el middleware verificarOrigenCookie y no lo tiene.`);
  }
});
