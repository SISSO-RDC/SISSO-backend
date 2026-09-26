#!/usr/bin/env node
/**
 * seed_demo.js — Crea una empresa DEMO ficticia en SISSO, completamente
 * llena (trabajadores, EMOs, ergonomia, accidentes, CAPA, inspecciones,
 * riesgo psicosocial, EPP, capacitaciones, ausentismo, KPIs, documentos,
 * higiene industrial, matriz de riesgos) simulando ~6 meses de operacion.
 *
 * Corre contra la API REAL (no toca la base de datos directo), asi que
 * de paso ejercita la logica real y expone cualquier bug de validacion.
 * Cada llamada esta en su propio try/catch: un fallo puntual no detiene
 * el resto, y al final se imprime un resumen de OK/ERROR por modulo.
 *
 * USO:
 *   BASE_URL=https://sissso-backend.onrender.com/api \
 *   SUPERADMIN_EMAIL=sisso.rdc@gmail.com \
 *   SUPERADMIN_PASSWORD='...' \
 *   SUPERADMIN_TOTP=123456 \
 *   node seed_demo.js
 *
 * SUPERADMIN_TOTP solo hace falta si esa cuenta ya tiene MFA activado
 * (con MFA ahora opcional, muchas cuentas nuevas no lo tienen).
 *
 * Requiere Node 18+ (usa fetch nativo). Correr desde el Codespace.
 */

const BASE_URL = (process.env.BASE_URL || 'https://sissso-backend.onrender.com/api').replace(/\/$/, '');
const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL;
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;
const SUPERADMIN_TOTP = process.env.SUPERADMIN_TOTP || null;

if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD) {
  console.error('Faltan SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD como variables de entorno.');
  process.exit(1);
}

const PDF_DEMO_B64 =
  'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDEwMF0vUmVzb3VyY2VzPDwvRm9udDw8L0YxIDQgMCBSPj4+Pi9Db250ZW50cyA1IDAgUj4+ZW5kb2JqCjQgMCBvYmo8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+PmVuZG9iago1IDAgb2JqPDwvTGVuZ3RoIDU1Pj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiAxMCA1MCBUZCAoRG9jdW1lbnRvIGRlbW8gU0lTU08pIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKdHJhaWxlcjw8L1NpemUgNi9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjAKJSVFT0YK';

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
function cedulaFalsa() {
  // Cedula ecuatoriana con forma valida (10 digitos), NO se valida
  // el digito verificador real -- alcanza para datos de demo.
  return `17${rndInt(10, 99)}${rndInt(100000, 999999)}`;
}

const NOMBRES_M = ['Carlos', 'Luis', 'Andres', 'Diego', 'Jose', 'Miguel', 'Fernando', 'Pablo', 'Ricardo', 'Santiago', 'Xavier', 'Jorge', 'Marco', 'Esteban', 'Rafael'];
const NOMBRES_F = ['Maria', 'Ana', 'Gabriela', 'Andrea', 'Carolina', 'Veronica', 'Paola', 'Diana', 'Silvia', 'Monica', 'Johanna', 'Cristina', 'Valeria', 'Fernanda', 'Lorena'];
const APELLIDOS = ['Pérez', 'Rodríguez', 'González', 'Vega', 'Chávez', 'Morales', 'Suárez', 'Torres', 'Vásquez', 'Jiménez', 'Ortiz', 'Herrera', 'Castro', 'Rojas', 'Salazar', 'Mendoza', 'Guerrero', 'Andrade', 'Cevallos', 'Zambrano'];

function nombreCompleto() {
  const esHombre = Math.random() < 0.45;
  const nombre = esHombre ? rnd(NOMBRES_M) : rnd(NOMBRES_F);
  return { nombreCompleto: `${nombre} ${rnd(APELLIDOS)} ${rnd(APELLIDOS)}`, sexo: esHombre ? 'M' : 'F' };
}

const AREAS_SALUD = ['Emergencias', 'UCI / Cuidados intensivos', 'Quirofano', 'Laboratorio clinico', 'Farmacia', 'Rayos X / Imagenes', 'Consultorios', 'Lavanderia', 'Cocina y nutricion', 'Administracion'];
const PUESTOS_POR_AREA = {
  'Emergencias': ['Médico de emergencias', 'Enfermero/a de emergencias', 'Auxiliar de enfermería'],
  'UCI / Cuidados intensivos': ['Médico intensivista', 'Enfermero/a de UCI'],
  'Quirofano': ['Cirujano', 'Anestesiólogo', 'Instrumentista quirúrgico'],
  'Laboratorio clinico': ['Bioquímico', 'Auxiliar de laboratorio'],
  'Farmacia': ['Químico farmacéutico', 'Auxiliar de farmacia'],
  'Rayos X / Imagenes': ['Tecnólogo en radiología'],
  'Consultorios': ['Médico general', 'Enfermero/a de consulta externa'],
  'Lavanderia': ['Operario de lavandería'],
  'Cocina y nutricion': ['Nutricionista', 'Auxiliar de cocina'],
  'Administracion': ['Asistente administrativo', 'Recursos humanos', 'Contador'],
};

// ------------------------------------------------------------
// main
// ------------------------------------------------------------
async function main() {
  console.log(`Base URL: ${BASE_URL}`);

  // 1) Login superadmin ------------------------------------------------
  let loginSuper;
  try {
    loginSuper = await api(null, 'POST', '/auth/login', { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD });
    // El login responde 200 OK con { requiereMfa: true, mfaToken } cuando
    // la cuenta tiene MFA habilitado -- NO es un error HTTP, asi que no
    // cae en el catch de abajo. Hay que revisarlo explicitamente aqui.
    if (loginSuper && loginSuper.requiereMfa) {
      if (!SUPERADMIN_TOTP) {
        console.error('La cuenta superadmin tiene MFA activo. Vuelve a correr con SUPERADMIN_TOTP=<codigo de 6 digitos actual>.');
        process.exit(1);
      }
      loginSuper = await api(null, 'POST', '/auth/mfa/verificar-login', { mfaToken: loginSuper.mfaToken, codigo: SUPERADMIN_TOTP });
    }
  } catch (e) {
    // Este otro caso (rol con MFA OBLIGATORIO no configurado aun) SI
    // llega como error 403 con mfaToken adentro.
    if (e.status === 403 && e.data && e.data.mfaToken) {
      if (!SUPERADMIN_TOTP) {
        console.error('La cuenta superadmin tiene MFA activo. Vuelve a correr con SUPERADMIN_TOTP=<codigo de 6 digitos actual>.');
        process.exit(1);
      }
      loginSuper = await api(null, 'POST', '/auth/mfa/verificar-login', { mfaToken: e.data.mfaToken, codigo: SUPERADMIN_TOTP });
    } else {
      console.error('No se pudo iniciar sesion como superadmin:', e.message);
      process.exit(1);
    }
  }
  if (!loginSuper || !loginSuper.accessToken) {
    console.error('Login de superadmin no devolvio un accessToken. Respuesta recibida:', JSON.stringify(loginSuper));
    process.exit(1);
  }
  const tokenSuper = loginSuper.accessToken;
  anotar('login', true, 'superadmin autenticado');

  // 2) Crear empresa + admin -------------------------------------------
  const sufijo = Date.now().toString().slice(-5);
  const nombreEmpresa = 'Hospital Metropolitano del Valle (DEMO)';
  const emailAdmin = `admin.demo${sufijo}@sisso-demo.com`;
  let empresa;
  try {
    empresa = await api(tokenSuper, 'POST', '/superadmin/empresas', {
      nombreEmpresa,
      rucNit: '1790000000001',
      nombreAdmin: 'Patricia Andrade',
      email: emailAdmin,
      planCodigo: 'corporativo', // 'inicial' tope 10 trabajadores, 'crecimiento' tope 50 -- con 80 hace falta 'corporativo' (sin límite)
    });
    anotar('empresa', true, `creada "${nombreEmpresa}" (${empresa.organizacion.codigo}), admin ${emailAdmin} / pass temporal: ${empresa.passwordTemporal}`);
  } catch (e) {
    console.error('No se pudo crear la empresa demo:', e.message);
    process.exit(1);
  }

  // 3) Login admin + cambio de password obligatorio ---------------------
  let loginAdmin = await api(null, 'POST', '/auth/login', { email: emailAdmin, password: empresa.passwordTemporal });
  let tokenAdmin = loginAdmin.accessToken;
  const PASSWORD_DEMO = 'Demo-Sisso-2026!';
  if (loginAdmin.usuario.requiereCambioPassword) {
    await api(tokenAdmin, 'PUT', '/auth/cambiar-password', { passwordActual: empresa.passwordTemporal, passwordNueva: PASSWORD_DEMO });
    loginAdmin = await api(null, 'POST', '/auth/login', { email: emailAdmin, password: PASSWORD_DEMO });
    tokenAdmin = loginAdmin.accessToken;
  }
  anotar('empresa', true, 'password del admin cambiada, sesion lista');

  // 4) Crear usuarios medico / sso / th ----------------------------------
  const credenciales = { admin: { email: emailAdmin, password: PASSWORD_DEMO } };
  for (const [rol, nombre] of [['medico', 'Dra. Fernanda Salazar'], ['sso', 'Ing. Ricardo Torres'], ['th', 'Lic. Gabriela Ortiz']]) {
    const email = `${rol}.demo${sufijo}@sisso-demo.com`;
    try {
      await api(tokenAdmin, 'POST', '/auth/registrar-usuario-interno', { nombreCompleto: nombre, email, password: PASSWORD_DEMO, rol });
      credenciales[rol] = { email, password: PASSWORD_DEMO };
      anotar('usuarios', true, `creado usuario ${rol}: ${email}`);
    } catch (e) {
      anotar('usuarios', false, `usuario ${rol}: ${e.message}`);
    }
  }
  async function login(rol) {
    const c = credenciales[rol];
    const r = await api(null, 'POST', '/auth/login', { email: c.email, password: c.password });
    return r.accessToken;
  }
  const tokenMedico = credenciales.medico ? await login('medico') : null;
  const tokenSso = credenciales.sso ? await login('sso') : null;
  const perfilSso = tokenSso ? await api(tokenSso, 'GET', '/auth/perfil', undefined).catch(() => null) : null;
  const ssoUsuarioId = perfilSso && perfilSso.usuario ? perfilSso.usuario.id : null;

  // 5) Perfil sectorial (salud) -------------------------------------------
  const NUM_TRABAJADORES = 80;
  try {
    await api(tokenAdmin, 'PUT', '/organizacion/perfil-sectorial', {
      sectorClave: 'salud',
      numeroTrabajadoresDeclarado: NUM_TRABAJADORES,
      riesgosPresentes: ['Riesgo biologico', 'Riesgo quimico', 'Riesgo ergonomico', 'Riesgo psicosocial', 'Riesgo fisico'],
      actividadEconomicaDesc: 'Actividades de hospitales',
    });
    anotar('sector', true, 'perfil sectorial "salud" aplicado');
  } catch (e) {
    anotar('sector', false, e.message);
  }

  // 6) Generar y aceptar TODAS las propuestas sectoriales -----------------
  try {
    await api(tokenAdmin, 'POST', '/configuracion-sectorial/propuestas/generar', {});
    const listado = await api(tokenAdmin, 'GET', '/configuracion-sectorial/propuestas', undefined);
    const propuestas = listado.propuestas || listado.data || [];
    let aceptadas = 0;
    for (const p of propuestas) {
      try {
        await api(tokenAdmin, 'PUT', `/configuracion-sectorial/propuestas/${p.id}/confirmar`, { accion: 'aceptar' });
        aceptadas++;
      } catch (e) {
        anotar('propuestas', false, `propuesta ${p.id} (${p.tipo || '?'}): ${e.message}`);
      }
    }
    anotar('propuestas', true, `${aceptadas}/${propuestas.length} propuestas sectoriales aceptadas (puestos, riesgos, examenes, EPP, KPIs)`);
  } catch (e) {
    anotar('propuestas', false, e.message);
  }

  // 7) Crear ~80 trabajadores (importacion masiva) -------------------------
  const trabajadoresPayload = [];
  for (let i = 0; i < NUM_TRABAJADORES; i++) {
    const area = rnd(AREAS_SALUD);
    const puesto = rnd(PUESTOS_POR_AREA[area]);
    const { nombreCompleto: nombre, sexo } = nombreCompleto();
    const antiguedadDias = rndInt(30, 540); // hasta ~18 meses, simula "meses trabajando"
    trabajadoresPayload.push({
      nombreCompleto: nombre,
      documento: cedulaFalsa(),
      area,
      puesto,
      fechaEmo: fechaHace(antiguedadDias),
      fechaVencimiento: fechaHace(antiguedadDias - 365),
      sexo,
      fechaNacimiento: `${rndInt(1965, 2002)}-${String(rndInt(1, 12)).padStart(2, '0')}-${String(rndInt(1, 28)).padStart(2, '0')}`,
      tallaCm: rndInt(155, 185),
      pesoKg: rndInt(55, 95),
    });
  }
  let trabajadores = [];
  try {
    const r = await api(tokenAdmin, 'POST', '/trabajadores/importar', { trabajadores: trabajadoresPayload });
    trabajadores = r.trabajadores || r.creados || [];
    anotar('trabajadores', true, `${trabajadores.length || NUM_TRABAJADORES} trabajadores importados`);
  } catch (e) {
    anotar('trabajadores', false, `importacion masiva fallo (${e.message}), probando de a uno...`);
    for (const t of trabajadoresPayload) {
      try {
        const r = await api(tokenAdmin, 'POST', '/trabajadores', t);
        trabajadores.push(r.trabajador || r);
      } catch (e2) {
        anotar('trabajadores', false, `${t.nombreCompleto}: ${e2.message}`);
      }
    }
  }
  if (!trabajadores.length) {
    try {
      const lista = await api(tokenAdmin, 'GET', '/trabajadores', undefined);
      trabajadores = lista.trabajadores || lista.data || [];
    } catch { /* seguimos sin trabajadores */ }
  }
  console.log(`Trabajadores disponibles para el resto del seed: ${trabajadores.length}`);

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
          tipo: rnd(['seguridad', 'orden_y_limpieza', 'epp']),
          area: rnd(AREAS_SALUD),
          inspectorId: ssoUsuarioId,
          fechaProgramada: fechaHace(rndInt(1, 120)),
        });
        const inspId = insp.inspeccion ? insp.inspeccion.id : insp.id;
        await api(tokenSso, 'POST', `/inspecciones/${inspId}/items`, { item: 'Extintores vigentes y accesibles', cumple: true });
        await api(tokenSso, 'POST', `/inspecciones/${inspId}/items`, { item: 'Rutas de evacuacion despejadas', cumple: Math.random() > 0.2 });
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
    // El backend solo acepta uno de estos codigos fijos (confirmado por el
    // propio error 400 del endpoint) -- no hay forma de derivarlo del
    // nombre libre del KPI sugerido, asi que se van asignando en orden.
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
  console.log(`Empresa demo: ${nombreEmpresa} (codigo ${empresa.organizacion.codigo})`);
  console.log(`Admin: ${emailAdmin} / ${PASSWORD_DEMO}`);
  for (const rol of ['medico', 'sso', 'th']) {
    if (credenciales[rol]) console.log(`${rol}: ${credenciales[rol].email} / ${credenciales[rol].password}`);
  }
  console.log(`\nOK (${reporte.ok.length}):`);
  reporte.ok.forEach((l) => console.log(' ✓ ' + l));
  console.log(`\nERRORES (${reporte.error.length}):`);
  reporte.error.forEach((l) => console.log(' ✗ ' + l));
  console.log('===========================================\n');
}

main().catch((e) => {
  console.error('Fallo inesperado:', e);
  process.exit(1);
});
