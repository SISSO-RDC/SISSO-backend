#!/usr/bin/env node
/**
 * seed_demo_lotes.js — Llena los modulos que quedaron vacios en la
 * empresa demo YA EXISTENTE tras los Lotes 1-4 (Sep 2026): contratistas,
 * competencias, quimicos, permisos de trabajo, emergencias, obligaciones
 * legales y auditorias. Tambien intenta poblar "Normas de examenes"
 * regenerando y confirmando las propuestas sectoriales pendientes (ese
 * catalogo es materializado, no tiene un POST directo).
 *
 * NO crea trabajadores ni usuarios nuevos: reutiliza los que ya existen
 * en la organizacion (via seed_demo.js / seed_demo_continuar.js).
 *
 * USO:
 *   ADMIN_EMAIL=admin.demoXXXXX@sisso-demo.com \
 *   ADMIN_PASSWORD='...' \
 *   MEDICO_EMAIL=medico.demoXXXXX@sisso-demo.com \
 *   MEDICO_PASSWORD='Demo-Sisso-2026!' \
 *   node seed_demo_lotes.js
 *
 * MEDICO_EMAIL/MEDICO_PASSWORD son opcionales: sin ellos, todo el
 * script corre igual, excepto el paso 8 (Normas de examenes), que
 * exige confirmar con rol medico y quedara marcado como pendiente.
 *
 * Requiere Node 18+ (usa fetch nativo). Correr desde el Codespace.
 */

const BASE_URL = (process.env.BASE_URL || 'https://sissso-backend.onrender.com/api').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
// Opcionales: solo hacen falta para el paso 8 (Normas de examenes), porque
// confirmar una propuesta de tipo "examen" es una decision clinica
// reservada al rol medico (ver ROLES_POR_TIPO en configuracionSectorialController.js).
const MEDICO_EMAIL = process.env.MEDICO_EMAIL;
const MEDICO_PASSWORD = process.env.MEDICO_PASSWORD || 'Demo-Sisso-2026!';

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Faltan ADMIN_EMAIL / ADMIN_PASSWORD como variables de entorno.');
  process.exit(1);
}

// PDF minimo valido, reutilizado del resto de scripts de siembra (sirve
// como SDS/documento/plan de ejemplo en cualquier campo que pida PDF).
const PDF_DEMO_B64 =
  'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDEwMF0vUmVzb3VyY2VzPDwvRm9udDw8L0YxIDQgMCBSPj4+Pi9Db250ZW50cyA1IDAgUj4+ZW5kb2JqCjQgMCBvYmo8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+PmVuZG9iago1IDAgb2JqPDwvTGVuZ3RoIDU1Pj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiAxMCA1MCBUZCAoRG9jdW1lbnRvIGRlbW8gU0lTU08pIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKdHJhaWxlcjw8L1NpemUgNi9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjAKJSVFT0YK';

// PNG de 1x1 pixel, para los campos que exigen imagen (ej. firmaBase64
// en permisos-trabajo: la politica 'firma' rechaza PDF, solo IMAGENES).
const PNG_DEMO_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// ------------------------------------------------------------
// Utilidades (identicas a seed_demo_continuar.js)
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
function fechaEnDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}
function cedulaFalsa() {
  return `17${rndInt(10, 99)}${rndInt(100000, 999999)}`;
}

async function loginConMfa(email, password) {
  let login = await api(null, 'POST', '/auth/login', { email, password });
  if (login && login.requiereMfa) {
    console.error(`La cuenta ${email} tiene MFA activo -- este script no lo soporta. Desactivalo desde Mi Perfil o dime y ajusto el script.`);
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
  const token = await loginConMfa(ADMIN_EMAIL, ADMIN_PASSWORD);
  anotar('login', true, 'admin autenticado');

  let tokenMedico = null;
  if (MEDICO_EMAIL) {
    try { tokenMedico = await loginConMfa(MEDICO_EMAIL, MEDICO_PASSWORD); anotar('login', true, 'medico autenticado'); }
    catch (e) { anotar('login', false, `medico: ${e.message}`); }
  }

  const listaTrabajadores = await api(token, 'GET', '/trabajadores', undefined);
  const trabajadores = listaTrabajadores.trabajadores || listaTrabajadores.data || [];
  if (!trabajadores.length) {
    console.error('No hay trabajadores en esta organizacion. Corre primero seed_demo.js / seed_demo_continuar.js.');
    process.exit(1);
  }
  const listaUsuarios = await api(token, 'GET', '/usuarios', undefined).catch(() => ({ usuarios: [] }));
  const usuarios = listaUsuarios.usuarios || [];
  const responsableId = usuarios.length ? rnd(usuarios).id : null;
  console.log(`Trabajadores: ${trabajadores.length} | Usuarios internos: ${usuarios.length}`);

  // ============================================================
  // 1) CONTRATISTAS (Lote 3): 3 empresas contratistas, cada una con
  //    1-2 documentos (uno vencido a proposito, para ver el semaforo
  //    en rojo) y 2 trabajadores externos.
  // ============================================================
  const CONTRATISTAS_DEMO = [
    { razonSocial: 'Mantenimiento Electrico Andino S.A.', ruc: '1790011223001', actividad: 'Mantenimiento electrico e instalaciones' },
    { razonSocial: 'Limpieza Total Cia. Ltda.', ruc: '1790044556001', actividad: 'Limpieza y desinfeccion hospitalaria' },
    { razonSocial: 'Construcciones del Valle S.A.', ruc: '1790077889001', actividad: 'Obra civil y remodelaciones' },
  ];
  const contratistasCreados = [];
  for (const c of CONTRATISTAS_DEMO) {
    try {
      let contratista;
      try {
        const r = await api(token, 'POST', '/contratistas', {
          razonSocial: c.razonSocial, ruc: c.ruc, actividad: c.actividad,
          representanteLegal: 'Representante Legal Demo', telefonoContacto: '099' + rndInt(1000000, 9999999),
          correoContacto: `contacto@${c.razonSocial.split(' ')[0].toLowerCase()}.demo.com`,
        });
        contratista = r.contratista;
        anotar('contratistas', true, `${c.razonSocial} creado`);
      } catch (e) {
        if (e.status !== 409) throw e;
        // Ya existe (corrida anterior) -- recuperar su id por RUC para poder seguir con documentos/trabajadores.
        const existentes = await api(token, 'GET', '/contratistas', undefined);
        contratista = (existentes.contratistas || []).find((x) => x.ruc === c.ruc);
        anotar('contratistas', true, `${c.razonSocial} ya existía de una corrida anterior (reutilizado)`);
        if (!contratista) { anotar('contratistas', false, `${c.razonSocial}: existe por RUC pero no se encontró en el listado`); continue; }
      }
      contratistasCreados.push(contratista);

      // Un documento vigente y uno vencido (a proposito) por contratista.
      await api(token, 'POST', `/contratistas/${contratista.id}/documentos`, {
        tipo: 'poliza_responsabilidad_civil', numeroDocumento: `POL-${rndInt(1000, 9999)}`,
        fechaEmision: fechaHace(200), fechaVencimiento: fechaEnDias(rndInt(20, 200)), archivoBase64: PDF_DEMO_B64,
      });
      await api(token, 'POST', `/contratistas/${contratista.id}/documentos`, {
        tipo: 'certificado_seguridad_industrial', numeroDocumento: `CSI-${rndInt(1000, 9999)}`,
        fechaEmision: fechaHace(400), fechaVencimiento: fechaHace(rndInt(1, 30)), archivoBase64: PDF_DEMO_B64,
      });
      anotar('contratistas', true, `${c.razonSocial}: 2 documentos (1 vigente, 1 vencido)`);

      for (let i = 0; i < 2; i++) {
        await api(token, 'POST', `/contratistas/${contratista.id}/trabajadores`, {
          nombreCompleto: `Trabajador Externo ${c.razonSocial.split(' ')[0]} ${i + 1}`,
          cedula: cedulaFalsa(), cargo: i === 0 ? 'Tecnico' : 'Ayudante',
        });
      }
      anotar('contratistas', true, `${c.razonSocial}: 2 trabajadores externos`);
    } catch (e) { anotar('contratistas', false, `${c.razonSocial}: ${e.message}`); }
  }

  // ============================================================
  // 2) COMPETENCIAS (Lote 3): catalogo de 4 competencias + asignacion
  //    a 3 trabajadores propios y 1 trabajador de contratista.
  // ============================================================
  const COMPETENCIAS_DEMO = [
    { nombre: 'Trabajo en alturas', descripcion: 'Certificacion para trabajo en alturas > 1.8m', vigenciaMeses: 12 },
    { nombre: 'Espacios confinados', descripcion: 'Certificacion para ingreso a espacios confinados', vigenciaMeses: 12 },
    { nombre: 'Manejo de residuos hospitalarios', descripcion: 'Capacitacion en gestion de residuos peligrosos', vigenciaMeses: 24 },
    { nombre: 'Primeros auxilios', descripcion: 'Certificacion basica de primeros auxilios y RCP', vigenciaMeses: 24 },
  ];
  const competenciasCreadas = [];
  for (const c of COMPETENCIAS_DEMO) {
    try {
      const r = await api(token, 'POST', '/competencias/catalogo', c);
      competenciasCreadas.push(r.competencia);
      anotar('competencias', true, `catalogo: ${c.nombre}`);
    } catch (e) {
      if (e.status !== 409) { anotar('competencias', false, `catalogo ${c.nombre}: ${e.message}`); continue; }
      const existentes = await api(token, 'GET', '/competencias/catalogo', undefined);
      const existente = (existentes.competencias || []).find((x) => x.nombre === c.nombre);
      if (existente) { competenciasCreadas.push(existente); anotar('competencias', true, `catalogo: ${c.nombre} ya existía (reutilizado)`); }
      else anotar('competencias', false, `catalogo ${c.nombre}: existe pero no se encontró en el listado`);
    }
  }
  if (competenciasCreadas.length) {
    let asignadas = 0;
    for (const t of trabajadores.slice(0, 3)) {
      try {
        await api(token, 'POST', '/competencias/asignar', {
          competenciaId: rnd(competenciasCreadas).id, trabajadorId: t.id, fechaObtencion: fechaHace(rndInt(30, 300)),
        });
        asignadas++;
      } catch (e) { anotar('competencias', false, `asignar a ${t.nombreCompleto || t.id}: ${e.message}`); }
    }
    if (contratistasCreados.length) {
      try {
        const detalle = await api(token, 'GET', `/contratistas/${contratistasCreados[0].id}`, undefined);
        const trabajadorExterno = (detalle.trabajadores || [])[0];
        if (trabajadorExterno) {
          await api(token, 'POST', '/competencias/asignar', {
            competenciaId: rnd(competenciasCreadas).id, contratistaTrabajadorId: trabajadorExterno.id, fechaObtencion: fechaHace(60),
          });
          asignadas++;
        }
      } catch (e) { anotar('competencias', false, `asignar a trabajador externo: ${e.message}`); }
    }
    anotar('competencias', true, `${asignadas} asignaciones creadas`);
  }

  // ============================================================
  // 3) QUIMICOS (Lote 4): 4 quimicos tipicos de un hospital, con SDS.
  // ============================================================
  const QUIMICOS_DEMO = [
    { nombreComercial: 'Alcohol Antiseptico 70%', nombreQuimico: 'Etanol', numeroCas: '64-17-5', area: 'Farmacia', clasificacionGhs: ['inflamable'], cantidadAlmacenada: 40, unidadMedida: 'litros' },
    { nombreComercial: 'Hipoclorito de Sodio 5%', nombreQuimico: 'Hipoclorito de sodio', numeroCas: '7681-52-9', area: 'Limpieza', clasificacionGhs: ['corrosivo'], cantidadAlmacenada: 60, unidadMedida: 'litros' },
    { nombreComercial: 'Glutaraldehido 2%', nombreQuimico: 'Glutaraldehido', numeroCas: '111-30-8', area: 'Esterilizacion', clasificacionGhs: ['toxico', 'corrosivo'], cantidadAlmacenada: 15, unidadMedida: 'litros' },
    { nombreComercial: 'Oxido de Etileno', nombreQuimico: 'Oxido de etileno', numeroCas: '75-21-8', area: 'Esterilizacion', clasificacionGhs: ['inflamable', 'toxico', 'cancerigeno'], cantidadAlmacenada: 8, unidadMedida: 'kg' },
  ];
  for (const q of QUIMICOS_DEMO) {
    try {
      await api(token, 'POST', '/quimicos', {
        ...q, fabricante: 'Distribuidora Quimica Demo', sdsVersion: '1.0', sdsFechaEmision: fechaHace(180), sdsArchivoBase64: PDF_DEMO_B64,
      });
      anotar('quimicos', true, `${q.nombreComercial} creado con SDS`);
    } catch (e) { anotar('quimicos', false, `${q.nombreComercial}: ${e.message}`); }
  }

  // ============================================================
  // 4) PERMISOS DE TRABAJO (Lote 3): 2 permisos (uno aprobado, uno en
  //    borrador) con su JSA/AST y una firma en el aprobado.
  // ============================================================
  const PERMISOS_DEMO = [
    {
      tipo: 'electrico_loto', area: 'Cuarto electrico principal', descripcionTarea: 'Mantenimiento preventivo del tablero electrico principal con corte de energia.',
      pasos: [
        { paso: 'Verificar corte de energia', peligroIdentificado: 'Contacto electrico directo', medidaControl: 'Bloqueo y etiquetado (LOTO), verificar ausencia de tension', eppRequerido: 'Guantes dielectricos, casco con visor' },
        { paso: 'Intervenir tablero', peligroIdentificado: 'Arco electrico residual', medidaControl: 'Uso de herramienta aislada, distancia de seguridad', eppRequerido: 'Ropa antiarco' },
      ],
      aprobar: true,
    },
    {
      tipo: 'trabajo_altura', area: 'Fachada exterior, 3er piso', descripcionTarea: 'Limpieza de ventanas exteriores en fachada, trabajo en altura con linea de vida.',
      pasos: [
        { paso: 'Instalar linea de vida y anclaje', peligroIdentificado: 'Caida de altura', medidaControl: 'Punto de anclaje certificado, arnes de cuerpo completo', eppRequerido: 'Arnes, casco, linea de vida' },
      ],
      aprobar: false,
    },
  ];
  for (const p of PERMISOS_DEMO) {
    try {
      const r = await api(token, 'POST', '/permisos-trabajo', {
        tipo: p.tipo, area: p.area, descripcionTarea: p.descripcionTarea, pasos: p.pasos,
        fechaInicioPrevista: new Date(Date.now() + 2 * 86400000).toISOString(),
        fechaFinPrevista: new Date(Date.now() + 2 * 86400000 + 4 * 3600000).toISOString(),
      });
      anotar('permisos_trabajo', true, `${p.area} creado (${p.pasos.length} paso(s) JSA)`);
      if (p.aprobar) {
        await api(token, 'PATCH', `/permisos-trabajo/${r.permiso.id}/aprobar`, {});
        await api(token, 'POST', `/permisos-trabajo/${r.permiso.id}/firmas`, {
          trabajadorId: rnd(trabajadores).id, rolFirma: 'ejecutante', firmaBase64: PNG_DEMO_B64,
        });
        anotar('permisos_trabajo', true, `${p.area} aprobado`);
      }
    } catch (e) { anotar('permisos_trabajo', false, `${p.area}: ${e.message}`); }
  }

  // ============================================================
  // 5) EMERGENCIAS (Lote 4): 2 planes con 1 simulacro cada uno, y 5
  //    equipos criticos (uno con inspeccion vencida a proposito).
  // ============================================================
  const PLANES_DEMO = [
    { nombre: 'Plan de respuesta ante incendios', escenario: 'incendio', areaCobertura: 'Todo el edificio' },
    { nombre: 'Plan de evacuacion por sismo', escenario: 'sismo', areaCobertura: 'Todo el edificio' },
  ];
  for (const p of PLANES_DEMO) {
    try {
      const r = await api(token, 'POST', '/emergencias/planes', { ...p, archivoBase64: PDF_DEMO_B64 });
      anotar('emergencias', true, `plan "${p.nombre}" creado`);
      await api(token, 'POST', `/emergencias/planes/${r.plan.id}/simulacros`, {
        fechaRealizado: fechaHace(rndInt(30, 90)), asistentes: rndInt(40, 80), duracionMinutos: rndInt(15, 45),
        hallazgos: 'Tiempo de evacuacion superior al esperado en el ala sur; senaletica de punto de encuentro poco visible.',
      });
      anotar('emergencias', true, `simulacro de "${p.nombre}" registrado`);
    } catch (e) { anotar('emergencias', false, `plan ${p.nombre}: ${e.message}`); }
  }
  const EQUIPOS_DEMO = [
    { tipo: 'extintor', codigoIdentificacion: 'EXT-001', ubicacion: 'Pasillo principal, piso 1', vencido: false },
    { tipo: 'extintor', codigoIdentificacion: 'EXT-002', ubicacion: 'Quirofano', vencido: true },
    { tipo: 'gabinete_contraincendios', codigoIdentificacion: 'GAB-001', ubicacion: 'Escalera de emergencia', vencido: false },
    { tipo: 'dea', codigoIdentificacion: 'DEA-001', ubicacion: 'Recepcion', vencido: false },
    { tipo: 'ducha_lavaojos', codigoIdentificacion: 'DLO-001', ubicacion: 'Laboratorio clinico', vencido: false },
  ];
  for (const e2 of EQUIPOS_DEMO) {
    try {
      await api(token, 'POST', '/emergencias/equipos', {
        tipo: e2.tipo, codigoIdentificacion: e2.codigoIdentificacion, ubicacion: e2.ubicacion,
        fechaUltimaInspeccion: fechaHace(e2.vencido ? 400 : 60),
        fechaProximaInspeccion: e2.vencido ? fechaHace(30) : fechaEnDias(120),
      });
      anotar('emergencias', true, `equipo ${e2.codigoIdentificacion} creado`);
    } catch (e) { anotar('emergencias', false, `equipo ${e2.codigoIdentificacion}: ${e.message}`); }
  }

  // ============================================================
  // 6) OBLIGACIONES LEGALES (Lote 2): intenta generar la plantilla
  //    SISAT (requiere que el superadmin ya haya clasificado el nivel
  //    de riesgo SISAT de esta organizacion; si no, este paso no crea
  //    nada y lo dice claramente) + 3 obligaciones manuales genericas.
  // ============================================================
  try {
    const r = await api(token, 'POST', '/obligaciones-legales/generar-sisat', { fechaPublicacionRo: '2026-06-12' });
    anotar('obligaciones_legales', true, `plantilla SISAT: ${JSON.stringify(r).slice(0, 200)}`);
  } catch (e) {
    anotar('obligaciones_legales', false, `generar-sisat: ${e.message} (revisa si el superadmin ya clasifico el nivel_riesgo_sisat de esta organizacion)`);
  }
  const OBLIGACIONES_MANUALES = [
    { titulo: 'Reglamento Interno de Seguridad y Salud', descripcion: 'Elaborar y registrar el reglamento interno de SST ante el Ministerio del Trabajo.', jurisdiccion: 'Nacional', frecuencia: 'anual' },
    { titulo: 'Programa de vigilancia de la salud', descripcion: 'Mantener vigente el programa anual de vigilancia de la salud ocupacional.', jurisdiccion: 'Nacional', frecuencia: 'anual' },
    { titulo: 'Registro de accidentes e incidentes', descripcion: 'Reportar accidentes de trabajo al IESS dentro del plazo legal.', jurisdiccion: 'Nacional', frecuencia: 'unica' },
  ];
  for (const o of OBLIGACIONES_MANUALES) {
    try {
      await api(token, 'POST', '/obligaciones-legales', { ...o, responsableId, proximaFechaVencimiento: fechaEnDias(rndInt(15, 180)) });
      anotar('obligaciones_legales', true, `${o.titulo} creada`);
    } catch (e) { anotar('obligaciones_legales', false, `${o.titulo}: ${e.message}`); }
  }

  // ============================================================
  // 7) AUDITORIAS (Lote 2): 2 auditorias (interna programada, externa
  //    ya con un hallazgo) para que el modulo no se vea vacio.
  // ============================================================
  try {
    const rInt = await api(token, 'POST', '/auditorias', {
      tipo: 'interna', normaReferencia: 'ISO 45001', alcance: 'Auditoria interna anual del sistema de gestion de SST', auditorNombre: 'Equipo SSO interno', fechaProgramada: fechaEnDias(30),
    });
    anotar('auditorias', true, 'auditoria interna creada');

    const rExt = await api(token, 'POST', '/auditorias', {
      tipo: 'externa', normaReferencia: 'Reglamento SISAT', alcance: 'Auditoria externa de cumplimiento normativo', auditorNombre: 'Auditor Externo Demo', fechaProgramada: fechaHace(10),
    });
    await api(token, 'POST', `/auditorias/${rExt.auditoria.id}/hallazgos`, {
      tipo: 'observacion', descripcion: 'Falta actualizar la matriz de riesgos de dos puestos de trabajo nuevos.',
    });
    anotar('auditorias', true, 'auditoria externa + 1 hallazgo creados');
  } catch (e) { anotar('auditorias', false, e.message); }

  // ============================================================
  // 8) NORMAS DE EXAMENES: este catalogo se MATERIALIZA al aceptar
  //    propuestas sectoriales de tipo "examen" -- no tiene un POST
  //    directo. Se reintenta generar y confirmar por si quedaron
  //    propuestas pendientes de una corrida anterior.
  // ============================================================
  try {
    await api(token, 'POST', '/configuracion-sectorial/propuestas/generar', {});
    const listado = await api(token, 'GET', '/configuracion-sectorial/propuestas', undefined);
    const propuestas = listado.propuestas || listado.data || [];
    const propuestasExamen = propuestas.filter((p) => p.tipo === 'examen' && p.estado !== 'aceptada' && p.estado !== 'rechazada');

    if (!propuestasExamen.length) {
      anotar('normas_examenes', false, `no hay propuestas de tipo "examen" pendientes (${propuestas.length} propuestas totales encontradas). Este catalogo depende del perfil sectorial/exposiciones de la organizacion -- puede que este sector/config no genere examenes automaticos, o que ya se hayan confirmado/rechazado todas antes. Revisar manualmente en Configuracion > Perfil sectorial si se necesita contenido aqui.`);
    } else if (!tokenMedico) {
      anotar('normas_examenes', false, `hay ${propuestasExamen.length} propuesta(s) de examen pendientes, pero confirmarlas es una decision clinica reservada al rol medico -- vuelve a correr este script con MEDICO_EMAIL/MEDICO_PASSWORD para completar este paso.`);
    } else {
      let confirmadas = 0;
      for (const p of propuestasExamen) {
        try {
          await api(tokenMedico, 'PUT', `/configuracion-sectorial/propuestas/${p.id}/confirmar`, { accion: 'aceptar' });
          confirmadas++;
        } catch (e) { anotar('normas_examenes', false, `confirmar propuesta ${p.id}: ${e.message}`); }
      }
      anotar('normas_examenes', true, `${confirmadas}/${propuestasExamen.length} propuesta(s) de examen confirmadas por el medico -- revisa Salud ocupacional > Normas de examenes`);
    }
  } catch (e) { anotar('normas_examenes', false, e.message); }

  // ------------------------------------------------------------
  console.log('\n=== RESUMEN ===');
  console.log(`OK: ${reporte.ok.length}`);
  reporte.ok.forEach((l) => console.log('  ✓ ' + l));
  console.log(`ERROR: ${reporte.error.length}`);
  reporte.error.forEach((l) => console.log('  ✗ ' + l));
}

main().catch((e) => { console.error('Fallo no controlado:', e); process.exit(1); });
