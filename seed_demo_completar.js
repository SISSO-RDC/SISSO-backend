#!/usr/bin/env node
/**
 * seed_demo_completar.js -- AUDITA y COMPLETA la empresa demo para que
 * TODOS los trabajadores tengan TODAS las evaluaciones/examenes.
 *
 * Es idempotente: por cada trabajador y cada modulo consulta si ya hay
 * un registro; solo crea lo que FALTA. Se puede correr cuantas veces
 * haga falta (no duplica). Al final vuelve a medir y muestra cobertura.
 *
 * Modulos cubiertos (por trabajador):
 *   aptitud (EMO), REBA, RULA, NIOSH, Nordico, espirometria,
 *   audiometria, visiometria, riesgo psicosocial, entrega de EPP.
 * Solo se REPORTAN (no se rellenan, porque son registros legales con
 * firma del trabajador/medico): historia clinica y consentimientos.
 *
 * USO (desde el Codespace, igual que seed_demo_continuar.js):
 *   ADMIN_EMAIL=... ADMIN_PASSWORD='...' \
 *   MEDICO_EMAIL=... MEDICO_PASSWORD='...' \
 *   SSO_EMAIL=... SSO_PASSWORD='...' \
 *   node seed_demo_completar.js
 *
 *   Solo diagnostico (no escribe nada):  SOLO_DIAGNOSTICO=1 node seed_demo_completar.js
 */

const BASE_URL = (process.env.BASE_URL || 'https://sissso-backend.onrender.com/api').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const MEDICO_EMAIL = process.env.MEDICO_EMAIL;
const MEDICO_PASSWORD = process.env.MEDICO_PASSWORD || 'Demo-Sisso-2026!';
const SSO_EMAIL = process.env.SSO_EMAIL;
const SSO_PASSWORD = process.env.SSO_PASSWORD || 'Demo-Sisso-2026!';

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Faltan ADMIN_EMAIL / ADMIN_PASSWORD como variables de entorno.');
  process.exit(1);
}


// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------
const reporte = { ok: [], error: [] };
function anotar(modulo, ok, detalle) {
  (ok ? reporte.ok : reporte.error).push(`[${modulo}] ${detalle}`);
}

async function api(token, method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* respuesta vacia */ }
  if (!res.ok) {
    const detalles = data && data.detalles ? ` | detalles: ${JSON.stringify(data.detalles)}` : '';
    const err = new Error(`${method} ${path} -> ${res.status}: ${data && data.error ? data.error : JSON.stringify(data)}${detalles}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rndInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function fechaHace(diasAtras) {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  return d.toISOString().slice(0, 10);
}


async function loginConMfa(email, password) {
  let login = await api(null, 'POST', '/auth/login', { email, password });
  if (login && login.requiereMfa) {
    console.error(`La cuenta ${email} tiene MFA activo -- este script no lo soporta para usuarios internos. Desactivalo desde Mi Perfil o dime y ajusto el script.`);
    process.exit(1);
  }
  if (login.usuario && login.usuario.requiereCambioPassword) {
    console.error(`La cuenta ${email} todavia tiene la password temporal y pide cambiarla. Cambiala una vez desde la plataforma y vuelve a correr el script con la nueva.`);
    process.exit(1);
  }
  return login.accessToken;
}

const SOLO_DIAGNOSTICO = process.env.SOLO_DIAGNOSTICO === '1';
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// api() con reintento ante 429/502/503 (Render free se duerme / limita).
const apiBase = api;
async function apiR(token, method, path, body) {
  for (let intento = 1; ; intento++) {
    try { return await apiBase(token, method, path, body); }
    catch (e) {
      if ([429, 502, 503, 504].includes(e.status) && intento < 5) { await pausa(1500 * intento); continue; }
      throw e;
    }
  }
}

function lista(data, ...claves) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const c of claves) if (Array.isArray(data[c])) return data[c];
  const primera = Object.values(data).find(Array.isArray);
  return primera || [];
}
const nombreDe = (t) => t.nombreCompleto || t.nombre_completo || t.id;

// ------------------------------------------------------------
// Generadores de datos clinicamente plausibles (valores validos
// segun los validadores reales de cada modulo)
// ------------------------------------------------------------
function posturaReba() {
  return {
    nombrePostura: 'Postura habitual de la tarea',
    tronco: rnd(['erguido', 'flexion_0_20', 'flexion_0_20', 'flexion_20_60', 'flexion_mayor_60']),
    cuello: rnd(['flexion_0_20', 'flexion_0_20', 'flexion_mayor_20_o_extension']),
    piernas: rnd(['soporte_bilateral_estable', 'soporte_bilateral_estable', 'soporte_unilateral_inestable']),
    cargaFuerza: rnd(['menor_5kg', 'menor_5kg', 'entre_5_10kg', 'mayor_10kg']),
    brazoDerecho: rnd(['extension_20_o_flexion_0_20', 'extension_mayor_20_o_flexion_20_45', 'flexion_45_90', 'flexion_mayor_90']),
    antebrazoDerecho: rnd(['flexion_60_100', 'flexion_menor_60_o_mayor_100']),
    munecaDerecha: rnd(['flexion_0_15', 'flexion_mayor_15']),
    brazoIzquierdo: rnd(['extension_20_o_flexion_0_20', 'extension_mayor_20_o_flexion_20_45', 'flexion_45_90']),
    antebrazoIzquierdo: rnd(['flexion_60_100', 'flexion_menor_60_o_mayor_100']),
    munecaIzquierda: rnd(['flexion_0_15', 'flexion_mayor_15']),
    agarre: rnd(['bueno', 'bueno', 'regular', 'malo']),
    actividadPosturasEstaticas: Math.random() < 0.4,
  };
}

function posturaRula() {
  const brazo = () => rnd(['extension_20_a_flexion_20', 'extension_mayor_20_o_flexion_20_45', 'flexion_45_90']);
  const ante = () => rnd(['flexion_60_100', 'flexion_menor_60_o_mayor_100']);
  const mun = () => rnd(['posicion_neutra', 'flexion_o_extension_0_15', 'flexion_o_extension_mayor_15']);
  const giro = () => rnd(['rango_medio', 'rango_medio', 'rango_extremo']);
  return {
    nombrePostura: 'Postura habitual de trabajo con pantalla / instrumental',
    brazoDerecho: brazo(), antebrazoDerecho: ante(), munecaDerecha: mun(), munecaDerechaRotacion: giro(),
    brazoIzquierdo: brazo(), antebrazoIzquierdo: ante(), munecaIzquierda: mun(), munecaIzquierdaRotacion: giro(),
    grupoAFuerzaCarga: rnd(['menor_2kg_intermitente', 'menor_2kg_intermitente', 'entre_2_10kg_intermitente']),
    cuello: rnd(['flexion_0_10', 'flexion_10_20', 'flexion_mayor_20']),
    tronco: rnd(['erguido_o_sentado_apoyado', 'flexion_0_20', 'flexion_20_60']),
    piernasBienApoyadas: Math.random() < 0.85,
    grupoBFuerzaCarga: rnd(['menor_2kg_intermitente', 'menor_2kg_intermitente', 'entre_2_10kg_intermitente']),
  };
}

function regionesNordico() {
  const regiones = {};
  ['cuello', 'hombro', 'columna_dorsal', 'columna_lumbar', 'codo', 'cadera_pierna', 'rodilla', 'tobillo_pie', 'muneca_mano'].forEach((z) => {
    const molestia = Math.random() < 0.3;
    if (!molestia) { regiones[z] = { tuvoMolestias12Meses: false }; return; }
    const r = {
      tuvoMolestias12Meses: true,
      duracionEpisodio: rnd(['menos_1_hora', '1_a_24_horas', '1_a_7_dias']),
      tiempoTotal12Meses: rnd(['1_a_7_dias', '8_a_30_dias', 'mas_30_dias_no_seguidos']),
      tiempoImpedimentoTrabajo: rnd(['0_dias', '0_dias', '1_a_7_dias']),
      cambioPuestoTrabajo: false,
      recibioTratamiento: Math.random() < 0.4,
      molestiasUltimos7Dias: Math.random() < 0.4,
      intensidad: rndInt(1, 4),
    };
    if (['hombro', 'codo', 'cadera_pierna', 'rodilla', 'tobillo_pie', 'muneca_mano'].includes(z)) r.lado = rnd(['izquierdo', 'derecho', 'ambos']);
    regiones[z] = r;
  });
  return regiones;
}

function audiometriaNormal() {
  const o = { fechaExamen: fechaHace(rndInt(5, 120)), esBasal: true, observaciones: 'Audiometria tonal por via aerea, umbrales dentro de limites normales.' };
  [500, 1000, 2000, 3000, 4000, 6000, 8000].forEach((f) => {
    o[`ca_od_${f}`] = rnd([5, 10, 10, 15, 15, 20]);
    o[`ca_oi_${f}`] = rnd([5, 10, 10, 15, 15, 20]);
  });
  return o;
}

function espirometriaNormal() {
  const fvc = Math.round((3.4 + Math.random() * 1.4) * 100) / 100;
  const fev1 = Math.round(fvc * (0.78 + Math.random() * 0.08) * 100) / 100;
  return {
    fechaExamen: fechaHace(rndInt(5, 120)),
    fvcPre: fvc, fev1Pre: fev1,
    pefPre: Math.round((7 + Math.random() * 3) * 10) / 10,
    fef2575Pre: Math.round((3.5 + Math.random() * 1.5) * 10) / 10,
    observaciones: 'Espirometria simple sin hallazgos obstructivos ni restrictivos relevantes.',
  };
}

function visiometriaNormal() {
  const a = () => rnd([0.8, 1.0, 1.0]);
  return {
    fechaExamen: fechaHace(rndInt(5, 120)),
    odLejanaSinCorreccion: a(), oiLejanaSinCorreccion: a(), aoLejanaSinCorreccion: a(),
    odCercanaSinCorreccion: a(), oiCercanaSinCorreccion: a(), aoCercanaSinCorreccion: a(),
    usaCorreccionOptica: false,
    ishiharaLaminasCorrectas: 14, ishiharaLaminasTotales: 14,
    percepcionProfundidad: 'normal', balanceMuscular: 'ortoforia',
    aptitudDefinida: 'apto',
    observaciones: 'Agudeza visual y vision cromatica normales.',
  };
}

function niosh() {
  return {
    nombreTarea: 'Movilizacion manual de insumos y material medico',
    fechaEvaluacion: fechaHace(rndInt(5, 120)),
    horizontalCm: rndInt(25, 45), verticalCm: rndInt(60, 90), distanciaVerticalCm: rndInt(20, 50),
    anguloAsimetria: rnd([0, 0, 15, 30]),
    frecuenciaPorMin: rnd([0.5, 1, 2]),
    duracion: rnd(['corta', 'media']),
    calidadAgarre: rnd(['bueno', 'bueno', 'regular']),
    pesoCargaKg: rndInt(3, 12),
    tipoTarea: 'simple',
  };
}

// ------------------------------------------------------------
// Definicion de modulos: como saber si el trabajador YA lo tiene y
// como crearlo si falta. `token` indica con que rol se ejecuta.
// ------------------------------------------------------------
function definirModulos(ctx) {
  const { tokenMedico, tokenSso, tokenAdmin, eppPorTrabajador, eppCatalogo } = ctx;
  const tokErgo = tokenSso || tokenMedico;
  return [
    {
      clave: 'aptitud', etiqueta: 'Aptitud / EMO', token: tokenMedico, rol: 'medico',
      async tiene(t) { return lista(await apiR(tokenMedico, 'GET', `/aptitud/trabajadores/${t.id}/historial`), 'historial').length > 0; },
      async crear(t) {
        await apiR(tokenMedico, 'POST', `/aptitud/trabajadores/${t.id}/registrar`, {
          aptitud: 'apto', puestoEvaluado: t.puesto || 'Puesto general', diagnosticosCie10: [], exposicionesPuesto: [],
          justificacionClinica: 'Evaluacion ocupacional sin hallazgos relevantes. Trabajador apto para el puesto evaluado.',
          restricciones: null, vigenciaHasta: fechaHace(-300),
        });
      },
    },
    {
      clave: 'reba', etiqueta: 'REBA', token: tokErgo, rol: 'sso/medico',
      async tiene(t) {
        const s = lista(await apiR(tokErgo, 'GET', `/ergonomia/sesiones/trabajador/${t.id}`), 'sesiones');
        t._rebaVacia = s.find((x) => x.puntuacion_final_maxima === null || x.puntuacion_final_maxima === undefined);
        return s.some((x) => x.puntuacion_final_maxima !== null && x.puntuacion_final_maxima !== undefined);
      },
      async crear(t) {
        let sesionId = t._rebaVacia ? t._rebaVacia.id : null; // reutiliza una sesion "Sin posturas aun"
        if (!sesionId) {
          const ses = await apiR(tokErgo, 'POST', '/ergonomia/sesiones', {
            trabajadorId: t.id, puestoEvaluado: t.puesto || 'Puesto general',
            tareaObservada: 'Tarea principal del puesto', fechaEvaluacion: fechaHace(rndInt(1, 120)),
            notasGenerales: 'Evaluacion del programa de vigilancia ergonomica.',
          });
          sesionId = ses.sesion ? ses.sesion.id : ses.id;
        }
        await apiR(tokErgo, 'POST', `/ergonomia/sesiones/${sesionId}/reba`, posturaReba());
      },
    },
    {
      clave: 'rula', etiqueta: 'RULA', token: tokErgo, rol: 'sso/medico',
      async tiene(t) {
        const s = lista(await apiR(tokErgo, 'GET', `/ergonomia/rula/sesiones/trabajador/${t.id}`), 'sesiones');
        t._rulaVacia = s.find((x) => x.puntuacion_final_maxima === null || x.puntuacion_final_maxima === undefined);
        return s.some((x) => x.puntuacion_final_maxima !== null && x.puntuacion_final_maxima !== undefined);
      },
      async crear(t) {
        let sesionId = t._rulaVacia ? t._rulaVacia.id : null;
        if (!sesionId) {
          const ses = await apiR(tokErgo, 'POST', '/ergonomia/rula/sesiones', {
            trabajadorId: t.id, puestoEvaluado: t.puesto || 'Puesto general',
            tareaObservada: 'Trabajo sostenido con pantalla / instrumental', fechaEvaluacion: fechaHace(rndInt(1, 120)),
            notasGenerales: 'Evaluacion RULA del programa de vigilancia ergonomica.',
          });
          sesionId = ses.sesion ? ses.sesion.id : ses.id;
        }
        await apiR(tokErgo, 'POST', `/ergonomia/rula/sesiones/${sesionId}/evaluaciones`, posturaRula());
      },
    },
    {
      clave: 'niosh', etiqueta: 'NIOSH', token: tokErgo, rol: 'sso/medico',
      async tiene(t) { return lista(await apiR(tokErgo, 'GET', `/niosh/trabajadores/${t.id}`), 'evaluaciones').length > 0; },
      async crear(t) { await apiR(tokErgo, 'POST', `/niosh/trabajadores/${t.id}`, niosh()); },
    },
    {
      clave: 'nordico', etiqueta: 'Cuestionario Nordico', token: tokErgo, rol: 'sso/medico',
      async tiene(t) { return lista(await apiR(tokErgo, 'GET', `/nordico/trabajadores/${t.id}`), 'cuestionarios').length > 0; },
      async crear(t) {
        await apiR(tokErgo, 'POST', `/nordico/trabajadores/${t.id}`, {
          fechaAplicacion: fechaHace(rndInt(5, 120)), regiones: regionesNordico(),
          observacionesGenerales: 'Cuestionario aplicado en el programa de vigilancia musculoesqueletica.',
        });
      },
    },
    {
      clave: 'espirometria', etiqueta: 'Espirometria', token: tokenMedico, rol: 'medico',
      async tiene(t) { return lista(await apiR(tokenMedico, 'GET', `/espirometria/trabajadores/${t.id}`), 'examenes').length > 0; },
      async crear(t) { await apiR(tokenMedico, 'POST', `/espirometria/trabajadores/${t.id}`, espirometriaNormal()); },
    },
    {
      clave: 'audiometria', etiqueta: 'Audiometria', token: tokenMedico, rol: 'medico',
      async tiene(t) { return lista(await apiR(tokenMedico, 'GET', `/audiometria/trabajadores/${t.id}`), 'examenes').length > 0; },
      async crear(t) { await apiR(tokenMedico, 'POST', `/audiometria/trabajadores/${t.id}`, audiometriaNormal()); },
    },
    {
      clave: 'visiometria', etiqueta: 'Visiometria', token: tokenMedico, rol: 'medico',
      async tiene(t) { return lista(await apiR(tokenMedico, 'GET', `/visiometria/trabajadores/${t.id}`), 'examenes').length > 0; },
      async crear(t) { await apiR(tokenMedico, 'POST', `/visiometria/trabajadores/${t.id}`, visiometriaNormal()); },
    },
    {
      clave: 'psicosocial', etiqueta: 'Riesgo psicosocial', token: tokenSso, rol: 'sso',
      async tiene(t) { return lista(await apiR(tokenSso, 'GET', `/riesgo-psicosocial/evaluaciones?trabajadorId=${t.id}`), 'evaluaciones').length > 0; },
      async crear(t) {
        await apiR(tokenSso, 'POST', '/riesgo-psicosocial/evaluaciones', {
          tipoEvaluacion: 'individual', trabajadorId: t.id, area: t.area,
          metodo: 'Cuestionario CoPsoQ-Istas21 (breve)', fechaEvaluacion: fechaHace(rndInt(5, 120)),
          puntajeGlobal: rndInt(20, 70), nivelRiesgo: rnd(['bajo', 'bajo', 'medio', 'alto']),
          observacionesGenerales: 'Evaluacion periodica del programa de riesgo psicosocial.',
        });
      },
    },
    {
      clave: 'epp', etiqueta: 'Entrega de EPP', token: tokenAdmin, rol: 'admin',
      async tiene(t) { return eppPorTrabajador.has(t.id); },
      async crear(t) {
        const item = eppCatalogo[0];
        if (!item) throw new Error('el catalogo de EPP esta vacio');
        await apiR(tokenSso || tokenAdmin, 'POST', '/epp/entregas', {
          trabajadorId: t.id, eppId: item.id, fechaEntrega: fechaHace(rndInt(1, 90)), cantidad: 1, motivo: 'entrega_inicial',
        });
      },
    },
  ];
}

async function medir(modulos, trabajadores, etiquetaFase) {
  const faltantes = {}; // clave -> [trabajador]
  modulos.forEach((m) => { faltantes[m.clave] = []; });
  for (const t of trabajadores) {
    for (const m of modulos) {
      if (!m.token) continue; // sin credencial para ese rol: se informa aparte
      try { if (!(await m.tiene(t))) faltantes[m.clave].push(t); }
      catch (e) { anotar(m.clave, false, `${etiquetaFase}: no se pudo consultar a ${nombreDe(t)}: ${e.message}`); faltantes[m.clave].push(t); }
    }
  }
  return faltantes;
}

function imprimirCobertura(titulo, modulos, trabajadores, faltantes) {
  console.log(`\n=== ${titulo} (${trabajadores.length} trabajadores) ===`);
  for (const m of modulos) {
    if (!m.token) { console.log(`  ${m.etiqueta.padEnd(22)} SIN CREDENCIAL (${m.rol}) -- no se pudo medir`); continue; }
    const f = faltantes[m.clave].length; const ok = trabajadores.length - f;
    console.log(`  ${m.etiqueta.padEnd(22)} ${String(ok).padStart(3)}/${trabajadores.length}  ${f === 0 ? 'COMPLETO' : `faltan ${f}`}`);
  }
}

async function main() {
  console.log(`Base URL: ${BASE_URL}${SOLO_DIAGNOSTICO ? '  [SOLO DIAGNOSTICO]' : ''}`);
  const tokenAdmin = await loginConMfa(ADMIN_EMAIL, ADMIN_PASSWORD);
  const tokenMedico = MEDICO_EMAIL ? await loginConMfa(MEDICO_EMAIL, MEDICO_PASSWORD).catch((e) => { anotar('login', false, `medico: ${e.message}`); return null; }) : null;
  const tokenSso = SSO_EMAIL ? await loginConMfa(SSO_EMAIL, SSO_PASSWORD).catch((e) => { anotar('login', false, `sso: ${e.message}`); return null; }) : null;
  if (!tokenMedico) console.warn('AVISO: sin MEDICO_EMAIL/MEDICO_PASSWORD no se pueden completar aptitud, espirometria, audiometria ni visiometria.');
  if (!tokenSso) console.warn('AVISO: sin SSO_EMAIL/SSO_PASSWORD no se puede completar riesgo psicosocial ni EPP (se intenta ergonomia con el medico).');

  const lt = await apiR(tokenAdmin, 'GET', '/trabajadores', undefined);
  const trabajadores = lista(lt, 'trabajadores', 'data').filter((t) => t.activo !== false);
  console.log(`Trabajadores activos: ${trabajadores.length}`);
  if (!trabajadores.length) { console.error('No hay trabajadores.'); process.exit(1); }

  const ent = lista(await apiR(tokenAdmin, 'GET', '/epp/entregas', undefined), 'entregas');
  const eppPorTrabajador = new Set(ent.map((e) => e.trabajador_id || e.trabajadorId).filter(Boolean));
  const eppCatalogo = lista(await apiR(tokenAdmin, 'GET', '/epp/catalogo', undefined), 'items', 'catalogo');
  const ctx = { tokenAdmin, tokenMedico, tokenSso, eppPorTrabajador, eppCatalogo };
  const modulos = definirModulos(ctx);

  // Historia clinica y consentimientos: solo se reportan.
  let hc = null; let cons = null;
  if (tokenMedico) {
    hc = 0;
    for (const t of trabajadores) {
      try { if (lista(await apiR(tokenMedico, 'GET', `/historia-clinica/trabajadores/${t.id}`), 'evaluaciones', 'historias').length > 0) hc++; } catch { /* se omite */ }
    }
  }
  if (tokenSso || tokenMedico) {
    cons = 0;
    for (const t of trabajadores) {
      try { if (lista(await apiR(tokenSso || tokenMedico, 'GET', `/consentimientos/trabajadores/${t.id}`), 'consentimientos').length > 0) cons++; } catch { /* se omite */ }
    }
  }

  const antes = await medir(modulos, trabajadores, 'diagnostico');
  imprimirCobertura('COBERTURA ANTES', modulos, trabajadores, antes);
  if (hc !== null) console.log(`  ${'Historia clinica'.padEnd(22)} ${String(hc).padStart(3)}/${trabajadores.length}  (solo reporte)`);
  if (cons !== null) console.log(`  ${'Consentimientos'.padEnd(22)} ${String(cons).padStart(3)}/${trabajadores.length}  (solo reporte)`);

  if (!SOLO_DIAGNOSTICO) {
    for (const m of modulos) {
      if (!m.token) continue;
      const pend = antes[m.clave];
      let ok = 0;
      for (const t of pend) {
        try { await m.crear(t); ok++; }
        catch (e) { anotar(m.clave, false, `${nombreDe(t)}: ${e.message}`); }
      }
      if (pend.length) anotar(m.clave, true, `${ok}/${pend.length} registros creados`);
      console.log(`  [${m.etiqueta}] creados ${ok}/${pend.length}`);
    }
    const despues = await medir(modulos, trabajadores, 'verificacion');
    imprimirCobertura('COBERTURA DESPUES', modulos, trabajadores, despues);
  }

  console.log('\n--- OK ---'); reporte.ok.forEach((l) => console.log(l));
  console.log('\n--- ERRORES ---'); reporte.error.length ? reporte.error.forEach((l) => console.log(l)) : console.log('(ninguno)');
}

main().catch((e) => { console.error('Fallo inesperado:', e.message); process.exit(1); });
