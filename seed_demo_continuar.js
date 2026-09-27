#!/usr/bin/env node
/**
 * seed_demo_continuar.js — Continua llenando una empresa demo que YA
 * EXISTE (con trabajadores, puestos y usuarios ya creados), en vez de
 * crear una empresa nueva. Usalo cuando una corrida de seed_demo.js se
 * corto a mitad de camino (ej. se reinicio el Codespace).
 *
 * Llena: aptitud/EMO, ergonomia REBA, accidentes+CAPA, inspecciones,
 * riesgo psicosocial, EPP, capacitaciones, ausentismo, KPIs, documentos
 * de control, higiene industrial y matriz de riesgos -- sobre los
 * trabajadores que ya existen en la organizacion.
 *
 * USO:
 *   ADMIN_EMAIL=admin.demoXXXXX@sisso-demo.com \
 *   ADMIN_PASSWORD='...' \
 *   MEDICO_EMAIL=medico.demoXXXXX@sisso-demo.com \
 *   MEDICO_PASSWORD='Demo-Sisso-2026!' \
 *   SSO_EMAIL=sso.demoXXXXX@sisso-demo.com \
 *   SSO_PASSWORD='Demo-Sisso-2026!' \
 *   node seed_demo_continuar.js
 *
 * Los emails son los que ya viste en Configuracion > Usuarios de la
 * organizacion. Si no reseteaste medico/sso desde el panel, su
 * password sigue siendo la que puso el primer script: Demo-Sisso-2026!
 * (la de admin sí la reseteaste tú desde el panel de superadmin, usa
 * esa nueva).
 *
 * Requiere Node 18+ (usa fetch nativo). Correr desde el Codespace.
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

const PDF_DEMO_B64 =
  'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDEwMF0vUmVzb3VyY2VzPDwvRm9udDw8L0YxIDQgMCBSPj4+Pi9Db250ZW50cyA1IDAgUj4+ZW5kb2JqCjQgMCBvYmo8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+PmVuZG9iago1IDAgb2JqPDwvTGVuZ3RoIDU1Pj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiAxMCA1MCBUZCAoRG9jdW1lbnRvIGRlbW8gU0lTU08pIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKdHJhaWxlcjw8L1NpemUgNi9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjAKJSVFT0YK';

// ------------------------------------------------------------
// Utilidades (identicas a seed_demo.js)
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

const AREAS_SALUD = ['Emergencias', 'UCI / Cuidados intensivos', 'Quirofano', 'Laboratorio clinico', 'Farmacia', 'Rayos X / Imagenes', 'Consultorios', 'Lavanderia', 'Cocina y nutricion', 'Administracion'];

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

async function main() {
  console.log(`Base URL: ${BASE_URL}`);

  const tokenAdmin = await loginConMfa(ADMIN_EMAIL, ADMIN_PASSWORD);
  anotar('login', true, 'admin autenticado');
  const loginAdminInfo = await api(tokenAdmin, 'GET', '/auth/perfil', undefined).catch(() => null);

  let tokenMedico = null;
  if (MEDICO_EMAIL) {
    try { tokenMedico = await loginConMfa(MEDICO_EMAIL, MEDICO_PASSWORD); anotar('login', true, 'medico autenticado'); }
    catch (e) { anotar('login', false, `medico: ${e.message}`); }
  }
  let tokenSso = null;
  let ssoUsuarioId = null;
  if (SSO_EMAIL) {
    try {
      tokenSso = await loginConMfa(SSO_EMAIL, SSO_PASSWORD);
      anotar('login', true, 'sso autenticado');
      const perfilSso = await api(tokenSso, 'GET', '/auth/perfil', undefined).catch(() => null);
      ssoUsuarioId = perfilSso && perfilSso.usuario ? perfilSso.usuario.id : null;
    }
    catch (e) { anotar('login', false, `sso: ${e.message}`); }
  }

  const loginAdmin = { usuario: loginAdminInfo && loginAdminInfo.usuario ? loginAdminInfo.usuario : { id: null } };

  // Trabajadores ya existentes en la organizacion
  const listaTrabajadores = await api(tokenAdmin, 'GET', '/trabajadores', undefined);
  const trabajadores = listaTrabajadores.trabajadores || listaTrabajadores.data || [];
  console.log(`Trabajadores encontrados en la organizacion: ${trabajadores.length}`);
  if (!trabajadores.length) {
    console.error('No hay trabajadores en esta organizacion. Corre primero seed_demo.js completo.');
    process.exit(1);
  }

  // 7b) Vincular cada trabajador a un puesto real del catalogo -----------------
  // NUEVO: hasta ahora no existia forma de conectar un trabajador con
  // el catalogo de puestos_trabajo (ver fix en trabajadoresController).
  // Sin este vinculo, Aptitud rechaza con 409 "no tiene un puesto de
  // trabajo asignado". Se empareja por nombre de puesto + area.
  try {
    const catalogoPuestos = await api(tokenAdmin, 'GET', '/puestos-trabajo', undefined);
    const puestos = catalogoPuestos.puestos || catalogoPuestos.data || [];
    let vinculados = 0;
    for (const t of trabajadores) {
      const match = puestos.find((p) => p.nombrePuesto === t.puesto || p.nombre_puesto === t.puesto)
        || puestos.find((p) => p.area === t.area);
      if (!match) continue;
      try {
        await api(tokenAdmin, 'PATCH', `/trabajadores/${t.id}/puesto`, { puestoTrabajoId: match.id });
        t.puestoTrabajoId = match.id;
        vinculados++;
      } catch (e) {
        anotar('vinculo_puesto', false, `${t.nombreCompleto || t.id}: ${e.message}`);
      }
    }
    anotar('vinculo_puesto', true, `${vinculados}/${trabajadores.length} trabajadores vinculados a un puesto del catalogo`);
  } catch (e) {
    anotar('vinculo_puesto', false, e.message);
  }

  // 8) Aptitud (EMO de ingreso) para cada trabajador, como medico ---------
  if (tokenMedico) {
    let okAptitud = 0;
    for (const t of trabajadores) {
      try {
        await api(tokenMedico, 'POST', `/aptitud/trabajadores/${t.id}/registrar`, {
          aptitud: 'apto',
          puestoEvaluado: t.puesto || 'Puesto general',
          diagnosticosCie10: [],
          exposicionesPuesto: [],
          justificacionClinica: 'Evaluacion preocupacional sin hallazgos relevantes. Trabajador apto para el puesto evaluado.',
          restricciones: null,
          vigenciaHasta: fechaHace(-300),
        });
        okAptitud++;
      } catch (e) {
        anotar('aptitud', false, `${t.nombreCompleto || t.id}: ${e.message}`);
      }
    }
    anotar('aptitud', true, `${okAptitud}/${trabajadores.length} dictamenes de aptitud registrados`);
  } else {
    anotar('aptitud', false, 'no se pudo autenticar como medico, se omite');
  }

  // 9) Ergonomia: sesiones + REBA para una muestra -------------------------
  if (tokenSso) {
    const muestra = trabajadores.slice(0, Math.min(15, trabajadores.length));
    let okReba = 0;
    for (const t of muestra) {
      try {
        const sesion = await api(tokenSso, 'POST', '/ergonomia/sesiones', {
          trabajadorId: t.id,
          puestoEvaluado: t.puesto || 'Puesto general',
          tareaObservada: 'Movilizacion y atencion directa de pacientes',
          fechaEvaluacion: fechaHace(rndInt(1, 150)),
          notasGenerales: 'Evaluacion de rutina del programa de vigilancia ergonomica.',
        });
        const sesionId = sesion.sesion ? sesion.sesion.id : sesion.id;
        await api(tokenSso, 'POST', `/ergonomia/sesiones/${sesionId}/reba`, {
          nombrePostura: 'Postura habitual de atencion al paciente',
          tronco: 'flexion_20_60',
          cuello: 'flexion_0_20',
          piernas: 'soporte_bilateral_estable',
          cargaFuerza: 'menor_5kg',
          brazoDerecho: 'flexion_45_90',
          antebrazoDerecho: 'flexion_60_100',
          munecaDerecha: 'flexion_0_15',
          brazoIzquierdo: 'flexion_45_90',
          antebrazoIzquierdo: 'flexion_60_100',
          munecaIzquierda: 'flexion_0_15',
          agarre: 'bueno',
          actividadPosturasEstaticas: true,
        });
        okReba++;
      } catch (e) {
        anotar('ergonomia', false, `${t.nombreCompleto || t.id}: ${e.message}`);
      }
    }
    anotar('ergonomia', true, `${okReba}/${muestra.length} evaluaciones REBA registradas`);
  }

  // 10) Accidentes / incidentes ---------------------------------------------
  if (tokenSso) {
    const tiposAccidente = ['accidente', 'incidente', 'casi_accidente'];
    const descripciones = [
      'Pinchazo con aguja al desechar material corto-punzante.',
      'Resbalón en piso húmedo del pasillo de quirófano.',
      'Contacto con superficie caliente en cocina.',
      'Golpe leve al trasladar camilla por pasillo estrecho.',
      'Exposición breve a salpicadura de fluido corporal en rostro (con protección).',
      'Casi caída por cable suelto en sala de espera, reportado antes de que ocurriera.',
    ];
    let okAcc = 0;
    for (let i = 0; i < 6; i++) {
      const t = rnd(trabajadores);
      const tipo = tiposAccidente[i % tiposAccidente.length];
      try {
        const caso = await api(tokenSso, 'POST', '/accidentes', {
          tipo,
          trabajadorId: tipo === 'casi_accidente' ? undefined : t.id,
          fechaOcurrencia: fechaHace(rndInt(5, 170)),
          horaOcurrencia: '10:30',
          lugar: t.area || 'Area general',
          descripcion: descripciones[i],
          gravedad: rnd(['leve', 'moderada']),
          tipoLesion: tipo === 'casi_accidente' ? null : rnd(['herida_cortante', 'contusion', 'ninguna']),
          diasPerdidos: 0,
          requiereAtencionMedica: false,
        });
        const casoId = caso.caso ? caso.caso.id : caso.id;
        await api(tokenSso, 'POST', `/accidentes/${casoId}/investigacion`, {
          metodoInvestigacion: 'Arbol de causas',
          causasInmediatas: 'Falta de atencion / condicion insegura puntual.',
          causasBasicas: 'Procedimiento existente pero no reforzado en la induccion.',
          factoresContribuyentes: 'Carga de trabajo alta en el turno.',
          fechaInvestigacion: fechaHace(rndInt(1, 4)),
        });
        okAcc++;
      } catch (e) {
        anotar('accidentes', false, e.message);
      }
    }
    anotar('accidentes', true, `${okAcc}/6 casos registrados con investigacion`);
  }

  // 11) CAPA independientes ---------------------------------------------------
  if (tokenSso) {
    let okCapa = 0;
    for (let i = 0; i < 5; i++) {
      try {
        await api(tokenSso, 'POST', '/capa', {
          origenTipo: 'inspeccion',
          origenDescripcion: 'Hallazgo de auditoria interna de bioseguridad',
          tipo: i % 2 === 0 ? 'correctiva' : 'preventiva',
          hallazgo: 'Contenedor de cortopunzantes sin senalizacion adecuada.',
          descripcionAccion: 'Reemplazar senalizacion y reforzar capacitacion al personal del area.',
          responsableId: ssoUsuarioId,
          fechaLimite: fechaHace(-30),
        });
        okCapa++;
      } catch (e) {
        anotar('capa', false, e.message);
      }
    }
    anotar('capa', true, `${okCapa}/5 acciones CAPA creadas`);
  }

  // 12) Inspecciones -----------------------------------------------------------
  if (tokenSso) {
    let okInsp = 0;
    for (let i = 0; i < 10; i++) {
      try {
        const insp = await api(tokenSso, 'POST', '/inspecciones', {
          tipo: rnd(['planeada', 'no_planeada']),
          area: rnd(AREAS_SALUD),
          inspectorId: ssoUsuarioId,
          fechaProgramada: fechaHace(rndInt(1, 120)),
        });
        const inspId = insp.inspeccion ? insp.inspeccion.id : insp.id;
        await api(tokenSso, 'POST', `/inspecciones/${inspId}/items`, { item: 'Extintores vigentes y accesibles', cumple: 'si' });
        await api(tokenSso, 'POST', `/inspecciones/${inspId}/items`, { item: 'Rutas de evacuacion despejadas', cumple: Math.random() > 0.2 ? 'si' : 'no' });
        okInsp++;
      } catch (e) {
        anotar('inspecciones', false, e.message);
      }
    }
    anotar('inspecciones', true, `${okInsp}/10 inspecciones creadas`);
  }

  // 13) Riesgo psicosocial -------------------------------------------------------
  if (tokenSso) {
    const muestra = trabajadores.slice(0, Math.min(30, trabajadores.length));
    let okRp = 0;
    for (const t of muestra) {
      try {
        await api(tokenSso, 'POST', '/riesgo-psicosocial/evaluaciones', {
          tipoEvaluacion: 'individual',
          trabajadorId: t.id,
          area: t.area,
          metodo: 'Cuestionario CoPsoQ-Istas21 (breve)',
          fechaEvaluacion: fechaHace(rndInt(5, 150)),
          puntajeGlobal: rndInt(20, 70),
          nivelRiesgo: rnd(['bajo', 'medio', 'alto']),
          observacionesGenerales: 'Evaluacion periodica del programa de riesgo psicosocial.',
        });
        okRp++;
      } catch (e) {
        anotar('riesgo_psicosocial', false, `${t.nombreCompleto || t.id}: ${e.message}`);
      }
    }
    anotar('riesgo_psicosocial', true, `${okRp}/${muestra.length} evaluaciones registradas`);
  }

  // 14) EPP: catalogo + entregas --------------------------------------------------
  if (tokenSso) {
    const catalogoEpp = [
      { nombre: 'Guantes de nitrilo', tipo: 'manos', vidaUtilMeses: 1 },
      { nombre: 'Mascarilla N95', tipo: 'respiratorio', vidaUtilMeses: 3 },
      { nombre: 'Bata desechable', tipo: 'cuerpo', vidaUtilMeses: 1 },
      { nombre: 'Gafas protectoras', tipo: 'ojos', vidaUtilMeses: 12 },
      { nombre: 'Calzado antideslizante', tipo: 'pies', vidaUtilMeses: 12 },
    ];
    const itemsCreados = [];
    for (const item of catalogoEpp) {
      try {
        const r = await api(tokenSso, 'POST', '/epp/catalogo', item);
        itemsCreados.push(r.item || r);
      } catch (e) {
        anotar('epp_catalogo', false, `${item.nombre}: ${e.message}`);
      }
    }
    anotar('epp_catalogo', true, `${itemsCreados.length}/${catalogoEpp.length} items de catalogo EPP creados`);

    let okEntregas = 0;
    for (const t of trabajadores) {
      const eppItem = rnd(itemsCreados);
      if (!eppItem) continue;
      try {
        await api(tokenSso, 'POST', '/epp/entregas', {
          trabajadorId: t.id,
          eppId: eppItem.id,
          fechaEntrega: fechaHace(rndInt(1, 90)),
          cantidad: 1,
          motivo: 'entrega_inicial',
        });
        okEntregas++;
      } catch (e) {
        anotar('epp_entregas', false, `${t.nombreCompleto || t.id}: ${e.message}`);
      }
    }
    anotar('epp_entregas', true, `${okEntregas}/${trabajadores.length} entregas de EPP registradas`);
  }

  // 15) Capacitaciones -----------------------------------------------------------
  {
    const temas = [
      'Bioseguridad y manejo de cortopunzantes', 'Uso correcto de EPP', 'Plan de emergencias y evacuacion',
      'Prevencion de riesgo ergonomico en movilizacion de pacientes', 'Manejo de desechos hospitalarios',
      'Primeros auxilios basicos', 'Prevencion del burnout laboral', 'Higiene de manos (OMS)',
    ];
    let okCap = 0;
    for (const tema of temas) {
      try {
        await api(tokenAdmin, 'POST', '/capacitaciones', {
          nombre: tema,
          tema,
          instructor: 'Capacitador interno SSO',
          fecha: fechaHace(rndInt(5, 170)),
          horasDuracion: rndInt(1, 4),
          asistentes: trabajadores.slice(0, rndInt(10, 30)).map((t) => t.id),
        });
        okCap++;
      } catch (e) {
        anotar('capacitaciones', false, `${tema}: ${e.message}`);
      }
    }
    anotar('capacitaciones', true, `${okCap}/${temas.length} capacitaciones registradas`);
  }

  // 16) Ausentismo (repartido en ~6 meses) -----------------------------------------
  if (tokenSso) {
    let okAus = 0;
    const N = 40;
    for (let i = 0; i < N; i++) {
      const t = rnd(trabajadores);
      const inicio = rndInt(5, 175);
      const dias = rndInt(1, 5);
      try {
        await api(tokenSso, 'POST', '/ausentismo', {
          trabajadorId: t.id,
          tipo: rnd(['enfermedad_general', 'accidente_trabajo', 'permiso_con_sueldo', 'permiso_sin_sueldo']),
          fechaInicio: fechaHace(inicio),
          fechaFin: fechaHace(inicio - dias),
        });
        okAus++;
      } catch (e) {
        anotar('ausentismo', false, e.message);
      }
    }
    anotar('ausentismo', true, `${okAus}/${N} registros de ausentismo creados`);
  }

  // 17) KPIs: vincular metas + registrar mediciones ---------------------------------
  try {
    const kpis = await api(tokenAdmin, 'GET', '/kpis-organizacion', undefined);
    const listaKpis = kpis.kpis || kpis.data || [];
    const INDICADORES_VALIDOS = [
      'cobertura_emo_vigente_pct', 'aptitud_apto_pct', 'cobertura_audiometria_pct',
      'cobertura_espirometria_pct', 'cobertura_visiometria_pct',
      'audiometria_anormal_pct', 'espirometria_anormal_pct', 'visiometria_anormal_pct',
    ];
    let vinculados = 0;
    for (let i = 0; i < listaKpis.length; i++) {
      const k = listaKpis[i];
      try {
        await api(tokenAdmin, 'PUT', `/kpis-organizacion/${k.id}/vinculo`, {
          indicadorClave: INDICADORES_VALIDOS[i % INDICADORES_VALIDOS.length],
          metaOperador: '>=',
          metaValor: 90,
        });
        vinculados++;
      } catch (e) {
        anotar('kpis', false, `vincular ${k.id}: ${e.message}`);
      }
    }
    anotar('kpis', true, `${vinculados}/${listaKpis.length} KPIs vinculados a una meta`);
    try {
      await api(tokenAdmin, 'POST', '/kpis-organizacion/mediciones', {});
      anotar('kpis', true, 'medicion de hoy registrada');
    } catch (e) {
      anotar('kpis', false, `registrar medicion: ${e.message}`);
    }
  } catch (e) {
    anotar('kpis', false, e.message);
  }

  // 18) Documentos de control ------------------------------------------------------
  if (tokenSso) {
    const docs = [
      { titulo: 'Politica de Seguridad y Salud Ocupacional', categoria: 'politica', numeroDocumento: 'POL-001' },
      { titulo: 'Procedimiento de manejo de cortopunzantes', categoria: 'procedimiento', numeroDocumento: 'PROC-001' },
      { titulo: 'Instructivo de uso de EPP por area', categoria: 'instructivo', numeroDocumento: 'INST-001' },
      { titulo: 'Formato de reporte de incidentes', categoria: 'formato', numeroDocumento: 'FORM-001' },
    ];
    let okDoc = 0;
    for (const d of docs) {
      try {
        await api(tokenSso, 'POST', '/documentos-control', {
          titulo: d.titulo,
          categoria: d.categoria,
          numeroDocumento: d.numeroDocumento,
          propietarioId: loginAdmin.usuario.id,
          requiereAcuse: true,
          archivoBase64: PDF_DEMO_B64,
        });
        okDoc++;
      } catch (e) {
        anotar('documentos_control', false, `${d.titulo}: ${e.message}`);
      }
    }
    anotar('documentos_control', true, `${okDoc}/${docs.length} documentos cargados`);
  }

  // 19) Higiene industrial -----------------------------------------------------------
  if (tokenSso) {
    const mediciones = [
      { tipoMedicion: 'ruido', area: 'Lavanderia', parametro: 'Nivel de ruido', valorMedido: 78, unidad: 'dB', limitePermisible: 85 },
      { tipoMedicion: 'iluminacion', area: 'Quirofano', parametro: 'Iluminancia', valorMedido: 480, unidad: 'lux', limitePermisible: 500 },
      { tipoMedicion: 'estres_termico', area: 'Cocina y nutricion', parametro: 'Temperatura ambiente', valorMedido: 29, unidad: '°C', limitePermisible: 30 },
    ];
    let okHig = 0;
    for (const m of mediciones) {
      try {
        await api(tokenSso, 'POST', '/higiene-industrial/mediciones', { ...m, fechaMedicion: fechaHace(rndInt(5, 100)) });
        okHig++;
      } catch (e) {
        anotar('higiene_industrial', false, `${m.area}: ${e.message}`);
      }
    }
    anotar('higiene_industrial', true, `${okHig}/${mediciones.length} mediciones registradas`);
  }

  // 20) Matriz de riesgos --------------------------------------------------------------
  if (tokenSso) {
    const items = [
      { tipoPeligro: 'biologico', peligroEspecifico: 'Exposicion a fluidos corporales', proceso: 'Atencion clinica', probabilidad: 3, consecuencia: 4 },
      { tipoPeligro: 'ergonomico', peligroEspecifico: 'Movilizacion manual de pacientes', proceso: 'Cuidado de pacientes', probabilidad: 4, consecuencia: 3 },
      { tipoPeligro: 'quimico', peligroEspecifico: 'Exposicion a desinfectantes', proceso: 'Limpieza y desinfeccion', probabilidad: 2, consecuencia: 3 },
      { tipoPeligro: 'psicosocial', peligroEspecifico: 'Sobrecarga en turnos nocturnos', proceso: 'Atencion 24/7', probabilidad: 3, consecuencia: 3 },
    ];
    let okMat = 0;
    for (const it of items) {
      try {
        await api(tokenSso, 'POST', '/matriz-riesgos', it);
        okMat++;
      } catch (e) {
        anotar('matriz_riesgos', false, `${it.peligroEspecifico}: ${e.message}`);
      }
    }
    anotar('matriz_riesgos', true, `${okMat}/${items.length} items de matriz de riesgos creados`);
  }

  // ------------------------------------------------------------
  // Resumen final
  // ------------------------------------------------------------
  console.log('\n================ RESUMEN ================');
  console.log(`OK (${reporte.ok.length}):`);
  reporte.ok.forEach((l) => console.log(' ✓ ' + l));
  console.log(`\nERRORES (${reporte.error.length}):`);
  reporte.error.forEach((l) => console.log(' ✗ ' + l));
  console.log('===========================================\n');
}

main().catch((e) => {
  console.error('Fallo inesperado:', e);
  process.exit(1);
});
