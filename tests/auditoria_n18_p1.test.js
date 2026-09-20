// ============================================================
// Auditoria N.18 -- pruebas de las correcciones P1/P2 del backend:
//   M18-01/02  sin SELECT * (allowlist) en capacitaciones/certificados
//   M18-03     la importacion masiva avisa que la columna aptitud se ignora
//   G18-04     estado explicito del contenido sectorial
//   G18-05     verificacion formal de la norma de un examen (solo medico)
//   G18-06     KPI: meta vs valor real, desviacion, cumplimiento, tendencia
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { iniciarServidor, detenerServidor } = require('./helpers/servidor');
const { iniciarSesionCompleta, peticion } = require('./helpers/cliente');
const { sembrar, limpiar } = require('./helpers/seed');
const { queryComoSuperadmin } = require('../src/db/pool');
const bcrypt = require('bcryptjs');
const { encriptar } = require('../src/utils/crypto');

let datos;
let tAdmin, tMedico, tSso, tTh, tAdminB, tSuper;
let limiteOriginalPlanInicial;

before(async () => {
  await limpiar();
  datos = await sembrar();
  await iniciarServidor();
  const login = (u) => iniciarSesionCompleta(u.email, datos.passwordPrueba, datos.secretoTotp);
  tAdmin = await login(datos.usuarios.admin);
  tMedico = await login(datos.usuarios.medico);
  tSso = await login(datos.usuarios.sso);
  tTh = await login(datos.usuarios.th);
  tAdminB = await login(datos.usuarios.adminB);

  const hash = await bcrypt.hash(datos.passwordPrueba, 10);
  await queryComoSuperadmin(
    `INSERT INTO usuarios (organizacion_id, email, password_hash, nombre_completo, rol, mfa_habilitado, mfa_secret)
     VALUES (NULL, 'superadmin.prueba@sisso-test.com', $1, 'Superadmin Prueba', 'superadmin', true, $2)`,
    [hash, encriptar(datos.secretoTotp)]
  );
  tSuper = await iniciarSesionCompleta('superadmin.prueba@sisso-test.com', datos.passwordPrueba, datos.secretoTotp);
});

after(async () => {
  await queryComoSuperadmin(`UPDATE organizaciones SET plan_id = NULL WHERE id = $1`, [datos.orgAId]);
  if (limiteOriginalPlanInicial !== undefined) {
    await queryComoSuperadmin(`UPDATE planes SET limite_trabajadores = $1 WHERE codigo = 'inicial'`, [limiteOriginalPlanInicial]);
  }
  // restaurar el estado del catalogo global que las pruebas modifican
  await queryComoSuperadmin(
    `UPDATE catalogo_sectores SET estado_contenido = 'borrador_sin_validar', contenido_validado_por = NULL, contenido_validado_en = NULL WHERE clave = 'oficina'`
  );
  detenerServidor();
  await limpiar();
});

// ------------------------------------------------------------
// M18-01 / M18-02
// ------------------------------------------------------------
test('M18-01/02: ningun controlador usa SELECT * sin alias (allowlist explicita)', () => {
  const dir = path.join(__dirname, '..', 'src', 'controllers');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/SELECT\s+\*\s+FROM/i.test(t), `${f}: SELECT * FROM sin allowlist de columnas`);
  }
});

test('M18-01: GET /capacitaciones/:id no expone columnas internas (organizacion_id, creado_por, finalidad)', async () => {
  const c = await queryComoSuperadmin(
    `INSERT INTO capacitaciones (organizacion_id, nombre, tema, instructor, fecha, horas_duracion, creado_por)
     VALUES ($1, 'Cap N18', 'tema', 'Instr', CURRENT_DATE, 2, $2) RETURNING id`,
    [datos.orgAId, datos.usuarios.admin.id]
  );
  const { status, datos: cuerpo } = await peticion('GET', `/capacitaciones/${c.rows[0].id}`, tAdmin);
  assert.equal(status, 200, JSON.stringify(cuerpo));
  const cap = cuerpo.capacitacion;
  for (const k of ['id', 'nombre', 'tema', 'instructor', 'fecha', 'horas_duracion']) assert.ok(k in cap, `falta ${k}`);
  for (const k of ['organizacion_id', 'creado_por', 'finalidad_tratamiento_codigo']) assert.ok(!(k in cap), `no debe exponer ${k}`);
  // otra organizacion no la ve
  const cruzado = await peticion('GET', `/capacitaciones/${c.rows[0].id}`, tAdminB);
  assert.equal(cruzado.status, 404);
});

// ------------------------------------------------------------
// M18-03
// ------------------------------------------------------------
test('M18-03: importar con columna aptitud avisa que se ignora y deja al trabajador en pendiente', async () => {
  const { status, datos: cuerpo } = await peticion('POST', '/trabajadores/importar', tAdmin, {
    trabajadores: [
      { nombreCompleto: 'Imp Uno', documento: 'N18-IMP-1', aptitud: 'apto' },
      { nombreCompleto: 'Imp Dos', documento: 'N18-IMP-2', aptitud: '' },
      { nombreCompleto: 'Imp Tres', documento: 'N18-IMP-3', aptitud: 'no_apto' },
    ],
  });
  assert.equal(status, 200, JSON.stringify(cuerpo));
  assert.equal(cuerpo.resumen.creados, 3);
  assert.equal(cuerpo.advertencias.length, 1);
  assert.equal(cuerpo.advertencias[0].codigo, 'COLUMNA_APTITUD_IGNORADA');
  assert.equal(cuerpo.advertencias[0].filas, 2);
  const filas = await queryComoSuperadmin(`SELECT aptitud FROM trabajadores WHERE documento LIKE 'N18-IMP-%'`);
  assert.ok(filas.rows.length === 3 && filas.rows.every((r) => r.aptitud === 'pendiente'));
});

test('M18-03: sin columna aptitud no hay advertencias', async () => {
  const { status, datos: cuerpo } = await peticion('POST', '/trabajadores/importar', tAdmin, {
    trabajadores: [{ nombreCompleto: 'Imp Cuatro', documento: 'N18-IMP-4' }],
  });
  assert.equal(status, 200);
  assert.deepEqual(cuerpo.advertencias, []);
});

// ------------------------------------------------------------
// G18-04
// ------------------------------------------------------------
test('G18-04: el catalogo declara la cobertura de contenido por dimension (sin inventarla)', async () => {
  const { status, datos: cuerpo } = await peticion('GET', '/catalogo-sectores', tAdmin);
  assert.equal(status, 200);
  const salud = cuerpo.sectores.find((s) => s.clave === 'salud');
  const constr = cuerpo.sectores.find((s) => s.clave === 'construccion');
  const puestos = (s) => s.cobertura_contenido.dimensiones.find((d) => d.tipo === 'puesto');
  assert.equal(puestos(salud).estado, 'con_contenido');
  assert.equal(puestos(constr).estado, 'sin_contenido');
  assert.ok(constr.cobertura_contenido.dimensionesSinContenido.includes('puesto'));
  assert.equal(constr.cobertura_contenido.completo, false);
  for (const s of cuerpo.sectores) assert.equal(s.estado_contenido, 'borrador_sin_validar', `${s.clave} no debe figurar validado`);
});

test('G18-04: /generar informa los tipos sin contenido y que el contenido no esta validado', async () => {
  const aplicar = await peticion('PUT', '/organizacion/perfil-sectorial', tAdmin, {
    sectorClave: 'construccion', numeroTrabajadoresDeclarado: 20, riesgosPresentes: [],
  });
  assert.equal(aplicar.status, 200, JSON.stringify(aplicar.datos));
  const gen = await peticion('POST', '/configuracion-sectorial/propuestas/generar', tAdmin, {});
  assert.equal(gen.status, 201, JSON.stringify(gen.datos));
  const codigos = gen.datos.advertencias.map((a) => a.codigo);
  assert.ok(codigos.includes('SECTOR_SIN_CONTENIDO_PARA_TIPOS'));
  assert.ok(codigos.includes('CONTENIDO_SECTORIAL_SIN_VALIDAR'));
  const sinContenido = gen.datos.advertencias.find((a) => a.codigo === 'SECTOR_SIN_CONTENIDO_PARA_TIPOS');
  assert.ok(sinContenido.tipos.includes('puesto'));
  assert.equal(gen.datos.propuestas.filter((p) => p.tipo === 'puesto').length, 0);
});

test('G18-04: solo superadmin valida; validar exige quien y cuando; editar contenido revoca la validacion', async () => {
  const denegado = await peticion('PUT', '/catalogo-sectores/oficina', tAdmin, { estado_contenido: 'validado' });
  assert.equal(denegado.status, 403);

  const sinDatos = await peticion('PUT', '/catalogo-sectores/oficina', tSuper, { estado_contenido: 'validado' });
  assert.equal(sinDatos.status, 400);

  const invalido = await peticion('PUT', '/catalogo-sectores/oficina', tSuper, { estado_contenido: 'aprobado' });
  assert.equal(invalido.status, 400);

  const ok = await peticion('PUT', '/catalogo-sectores/oficina', tSuper, {
    estado_contenido: 'validado', contenido_validado_por: 'Dr. Prueba (SSO)', contenido_validado_en: '2026-09-20',
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.datos));
  let det = await peticion('GET', '/catalogo-sectores/oficina', tAdmin);
  assert.equal(det.datos.sector.estado_contenido, 'validado');
  assert.equal(det.datos.sector.contenido_validado_por, 'Dr. Prueba (SSO)');

  // cambiar contenido sin decidir el estado => vuelve a borrador
  const edita = await peticion('PUT', '/catalogo-sectores/oficina', tSuper, { areas: ['Recepción', 'Sala de juntas'] });
  assert.equal(edita.status, 200, JSON.stringify(edita.datos));
  det = await peticion('GET', '/catalogo-sectores/oficina', tAdmin);
  assert.equal(det.datos.sector.estado_contenido, 'borrador_sin_validar');
  assert.equal(det.datos.sector.contenido_validado_por, null);
});

// ------------------------------------------------------------
// G18-05
// ------------------------------------------------------------
let examenId;
test('G18-05: los examenes existentes figuran no_verificada y la API lo declara', async () => {
  const e = await queryComoSuperadmin(
    `INSERT INTO examenes_organizacion (organizacion_id, nombre, tipo, frecuencia, norma_referencia)
     VALUES ($1, 'Audiometría N18', 'Sugerido por sector', 'Anual', NULL) RETURNING id`,
    [datos.orgAId]
  );
  examenId = e.rows[0].id;
  const { status, datos: cuerpo } = await peticion('GET', '/examenes-organizacion', tAdmin);
  assert.equal(status, 200);
  const fila = cuerpo.examenes.find((x) => x.id === examenId);
  assert.equal(fila.estado_verificacion, 'no_verificada');
  assert.equal(fila.vigencia_norma, 'no_verificada');
});

test('G18-05: solo el medico verifica la norma; admin/sso/th reciben 403', async () => {
  const cuerpo = { verificada: true, fuenteNorma: 'Instrumento de prueba', jurisdiccion: 'Ecuador', articuloReferencia: 'Art. 1', fechaValidacion: '2026-09-01' };
  for (const t of [tAdmin, tSso, tTh]) {
    const r = await peticion('PUT', `/examenes-organizacion/${examenId}/verificacion`, t, cuerpo);
    assert.equal(r.status, 403);
  }
});

test('G18-05: verificar exige fuente, jurisdiccion, articulo y fecha (400 si falta alguno)', async () => {
  const base = { verificada: true, fuenteNorma: 'Instrumento de prueba', jurisdiccion: 'Ecuador', articuloReferencia: 'Art. 1', fechaValidacion: '2026-09-01' };
  for (const campo of ['fuenteNorma', 'jurisdiccion', 'articuloReferencia', 'fechaValidacion']) {
    const c = { ...base }; delete c[campo];
    const r = await peticion('PUT', `/examenes-organizacion/${examenId}/verificacion`, tMedico, c);
    assert.equal(r.status, 400, `debio rechazar sin ${campo}: ${JSON.stringify(r.datos)}`);
  }
  const noBool = await peticion('PUT', `/examenes-organizacion/${examenId}/verificacion`, tMedico, { verificada: 'si' });
  assert.equal(noBool.status, 400);
});

test('G18-05: el medico verifica, queda vigente, y una vigencia pasada figura vencida', async () => {
  const r = await peticion('PUT', `/examenes-organizacion/${examenId}/verificacion`, tMedico, {
    verificada: true, fuenteNorma: 'Instrumento de prueba', jurisdiccion: 'Ecuador', articuloReferencia: 'Art. 1',
    fechaValidacion: '2026-09-01', vigenteHasta: '2099-12-31', frecuencia: 'Semestral',
  });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  let lista = await peticion('GET', '/examenes-organizacion', tAdmin);
  let fila = lista.datos.examenes.find((x) => x.id === examenId);
  assert.equal(fila.estado_verificacion, 'verificada');
  assert.equal(fila.vigencia_norma, 'verificada_vigente');
  assert.equal(fila.frecuencia, 'Semestral');
  assert.ok(fila.verificado_por_nombre);

  await queryComoSuperadmin(`UPDATE examenes_organizacion SET vigente_hasta = '2020-01-01' WHERE id = $1`, [examenId]);
  lista = await peticion('GET', '/examenes-organizacion', tAdmin);
  fila = lista.datos.examenes.find((x) => x.id === examenId);
  assert.equal(fila.vigencia_norma, 'verificada_vencida');

  const auditoria = await queryComoSuperadmin(`SELECT COUNT(*)::int AS n FROM auditoria WHERE accion = 'verificar_norma_examen' AND entidad_id = $1`, [examenId]);
  assert.equal(auditoria.rows[0].n, 1);
});

test('G18-05: aislamiento tenant (otra organizacion recibe 404) y retirar la verificacion la limpia', async () => {
  // el medico de B no existe en la siembra; el admin de B no puede (403), y el medico de A no ve examenes de B
  const otro = await queryComoSuperadmin(
    `INSERT INTO examenes_organizacion (organizacion_id, nombre) VALUES ($1, 'Examen de B') RETURNING id`, [datos.orgBId]
  );
  const cruzado = await peticion('PUT', `/examenes-organizacion/${otro.rows[0].id}/verificacion`, tMedico, {
    verificada: true, fuenteNorma: 'Instrumento de prueba', jurisdiccion: 'Ecuador', articuloReferencia: 'Art. 1', fechaValidacion: '2026-09-01',
  });
  assert.equal(cruzado.status, 404);

  const retirar = await peticion('PUT', `/examenes-organizacion/${examenId}/verificacion`, tMedico, { verificada: false });
  assert.equal(retirar.status, 200, JSON.stringify(retirar.datos));
  const fila = await queryComoSuperadmin(`SELECT estado_verificacion, fuente_norma, norma_referencia FROM examenes_organizacion WHERE id = $1`, [examenId]);
  assert.equal(fila.rows[0].estado_verificacion, 'no_verificada');
  assert.equal(fila.rows[0].fuente_norma, null);
  assert.equal(fila.rows[0].norma_referencia, null);
});

test('G18-05: la base de datos rechaza una "verificada" sin fuente (CHECK)', async () => {
  await assert.rejects(
    queryComoSuperadmin(`UPDATE examenes_organizacion SET estado_verificacion = 'verificada' WHERE id = $1`, [examenId]),
    /examenes_organizacion_verificacion_chk/
  );
});

// ------------------------------------------------------------
// G18-06
// ------------------------------------------------------------
let kpiEmo; let kpiAnormal; let kpiSinVinculo;
test('G18-06: KPI sin vinculo figura sin_vinculo (nunca cumplido) y la lista ofrece los indicadores enlazables', async () => {
  const ins = async (nombre) => (await queryComoSuperadmin(
    `INSERT INTO kpis_organizacion (organizacion_id, nombre, meta) VALUES ($1, $2, '< 5%') RETURNING id`, [datos.orgAId, nombre]
  )).rows[0].id;
  kpiEmo = await ins('KPI EMO N18');
  kpiAnormal = await ins('KPI Audiometría anormal N18');
  kpiSinVinculo = await ins('KPI libre N18');

  const lista = await peticion('GET', '/kpis-organizacion', tAdmin);
  assert.equal(lista.status, 200);
  assert.ok(lista.datos.indicadoresEnlazables.length === 8);

  const comp = await peticion('GET', '/kpis-organizacion/comparativo', tAdmin);
  assert.equal(comp.status, 200, JSON.stringify(comp.datos));
  const k = comp.datos.kpis.find((x) => x.id === kpiSinVinculo);
  assert.equal(k.estado, 'sin_vinculo');
  assert.equal(k.vinculo, null);
});

test('G18-06: solo admin vincula; valida indicador, operador y meta; aislamiento tenant', async () => {
  const cuerpo = { indicadorClave: 'cobertura_emo_vigente_pct', metaOperador: '>=', metaValor: 80 };
  for (const t of [tMedico, tSso, tTh]) {
    assert.equal((await peticion('PUT', `/kpis-organizacion/${kpiEmo}/vinculo`, t, cuerpo)).status, 403);
  }
  assert.equal((await peticion('PUT', `/kpis-organizacion/${kpiEmo}/vinculo`, tAdmin, { ...cuerpo, indicadorClave: 'inventado' })).status, 400);
  assert.equal((await peticion('PUT', `/kpis-organizacion/${kpiEmo}/vinculo`, tAdmin, { ...cuerpo, metaOperador: '!=' })).status, 400);
  assert.equal((await peticion('PUT', `/kpis-organizacion/${kpiEmo}/vinculo`, tAdmin, { ...cuerpo, metaValor: 150 })).status, 400);
  assert.equal((await peticion('PUT', `/kpis-organizacion/no-es-uuid/vinculo`, tAdmin, cuerpo)).status, 400);
  assert.equal((await peticion('PUT', `/kpis-organizacion/${kpiEmo}/vinculo`, tAdminB, cuerpo)).status, 404);

  const ok = await peticion('PUT', `/kpis-organizacion/${kpiEmo}/vinculo`, tAdmin, cuerpo);
  assert.equal(ok.status, 200, JSON.stringify(ok.datos));
  const ok2 = await peticion('PUT', `/kpis-organizacion/${kpiAnormal}/vinculo`, tAdmin, { indicadorClave: 'audiometria_anormal_pct', metaOperador: '<', metaValor: 5 });
  assert.equal(ok2.status, 200, JSON.stringify(ok2.datos));
});

test('G18-06: comparativo entrega meta, valor, desviacion y cumplimiento; cada rol ve solo lo que ya ve en indicadores', async () => {
  const indic = await peticion('GET', '/indicadores', tAdmin);
  const valorReal = indic.datos.coberturaEmo.porcentajeVigente;

  const comp = await peticion('GET', '/kpis-organizacion/comparativo', tAdmin);
  const emo = comp.datos.kpis.find((x) => x.id === kpiEmo);
  assert.equal(emo.valorActual, valorReal, 'el valor debe ser exactamente el de /api/indicadores');
  assert.equal(emo.vinculo.valorMeta, 80);
  assert.equal(emo.desviacion, Math.round((valorReal - 80) * 10) / 10);
  assert.equal(emo.estado, valorReal >= 80 ? 'cumple' : 'no_cumple');
  assert.equal(emo.tendencia, 'sin_historial');

  // admin NO ve hallazgos anormales en /indicadores => tampoco aqui
  const anAdmin = comp.datos.kpis.find((x) => x.id === kpiAnormal);
  assert.equal(anAdmin.estado, 'no_disponible_para_su_rol');
  assert.ok(!('valorActual' in anAdmin) && !('historial' in anAdmin));

  // el medico si lo ve; sin examenes cargados => sin_datos (no "0 %" ni "cumple")
  const compMed = await peticion('GET', '/kpis-organizacion/comparativo', tMedico);
  const anMed = compMed.datos.kpis.find((x) => x.id === kpiAnormal);
  assert.equal(anMed.estado, 'sin_datos');

  // th solo ve coberturaEmo
  const compTh = await peticion('GET', '/kpis-organizacion/comparativo', tTh);
  assert.equal(compTh.datos.kpis.find((x) => x.id === kpiEmo).estado === 'no_disponible_para_su_rol', false);
  assert.equal(compTh.datos.kpis.find((x) => x.id === kpiAnormal).estado, 'no_disponible_para_su_rol');

  // otra organizacion no ve estos KPIs
  const compB = await peticion('GET', '/kpis-organizacion/comparativo', tAdminB);
  assert.ok(!compB.datos.kpis.some((x) => x.id === kpiEmo));
});

test('G18-06: mediciones -- solo roles permitidos, una por dia, y la tendencia compara con la anterior', async () => {
  assert.equal((await peticion('POST', '/kpis-organizacion/mediciones', tTh, {})).status, 403);

  const r1 = await peticion('POST', '/kpis-organizacion/mediciones', tAdmin, {});
  assert.equal(r1.status, 201, JSON.stringify(r1.datos));
  assert.ok(r1.datos.guardadas.some((g) => g.id === kpiEmo));
  assert.ok(r1.datos.omitidas.some((o) => o.id === kpiAnormal && o.motivo === 'no_disponible_para_su_rol'));
  await peticion('POST', '/kpis-organizacion/mediciones', tAdmin, {}); // repetir el mismo dia no duplica
  const n = await queryComoSuperadmin(`SELECT COUNT(*)::int AS n FROM kpis_organizacion_mediciones WHERE kpi_id = $1`, [kpiEmo]);
  assert.equal(n.rows[0].n, 1);

  // simular una medicion de AYER peor/mejor y verificar la tendencia
  const hoy = (await peticion('GET', '/kpis-organizacion/comparativo', tAdmin)).datos.kpis.find((x) => x.id === kpiEmo).valorActual;
  await queryComoSuperadmin(`DELETE FROM kpis_organizacion_mediciones WHERE kpi_id = $1`, [kpiEmo]);
  await queryComoSuperadmin(
    `INSERT INTO kpis_organizacion_mediciones (organizacion_id, kpi_id, fecha_medicion, valor, meta_operador, meta_valor, cumple)
     VALUES ($1, $2, CURRENT_DATE - 1, $3, '>=', 80, false)`,
    [datos.orgAId, kpiEmo, hoy - 10]
  );
  let comp = await peticion('GET', '/kpis-organizacion/comparativo', tAdmin);
  let emo = comp.datos.kpis.find((x) => x.id === kpiEmo);
  assert.equal(emo.tendencia, 'mejora'); // meta '>=': subir es mejorar
  assert.equal(emo.historial.length, 1);

  await queryComoSuperadmin(`UPDATE kpis_organizacion_mediciones SET valor = $2 WHERE kpi_id = $1`, [kpiEmo, hoy + 10]);
  comp = await peticion('GET', '/kpis-organizacion/comparativo', tAdmin);
  emo = comp.datos.kpis.find((x) => x.id === kpiEmo);
  assert.equal(emo.tendencia, 'empeora');

  await queryComoSuperadmin(`UPDATE kpis_organizacion_mediciones SET valor = $2 WHERE kpi_id = $1`, [kpiEmo, hoy]);
  comp = await peticion('GET', '/kpis-organizacion/comparativo', tAdmin);
  assert.equal(comp.datos.kpis.find((x) => x.id === kpiEmo).tendencia, 'estable');
});

test('G18-06: retirar el vinculo devuelve el KPI a sin_vinculo y la BD rechaza vinculos incompletos', async () => {
  const r = await peticion('PUT', `/kpis-organizacion/${kpiEmo}/vinculo`, tAdmin, { indicadorClave: null });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  const comp = await peticion('GET', '/kpis-organizacion/comparativo', tAdmin);
  assert.equal(comp.datos.kpis.find((x) => x.id === kpiEmo).estado, 'sin_vinculo');
  await assert.rejects(
    queryComoSuperadmin(`UPDATE kpis_organizacion SET indicador_clave = 'aptitud_apto_pct' WHERE id = $1`, [kpiEmo]),
    /kpis_organizacion_vinculo_chk/
  );
});

// ------------------------------------------------------------
// Hallazgo NUEVO de esta auditoria (no listado en el informe N.18):
// verificarLimitePlan() y importarMasivo() ejecutaban
//   SELECT ... FROM organizaciones o LEFT JOIN planes p ... FOR UPDATE
// y PostgreSQL rechaza FOR UPDATE sobre el lado nulable de un LEFT
// JOIN ("FOR UPDATE cannot be applied to the nullable side of an outer
// join") SIEMPRE, incluso con 0 filas. Resultado: alta de trabajador,
// alta de usuario interno e importacion masiva devolvian 500. Corregido
// con FOR UPDATE OF o. Ninguna prueba previa cubria estas rutas.
// ------------------------------------------------------------
test('LIMITE-PLAN: crear trabajador, crear usuario interno e importar funcionan (antes 500 por FOR UPDATE)', async () => {
  const t = await peticion('POST', '/trabajadores', tAdmin, { nombreCompleto: 'Alta Individual', documento: 'N18-ALTA-1' });
  assert.equal(t.status, 201, JSON.stringify(t.datos));

  const u = await peticion('POST', '/auth/registrar-usuario-interno', tAdmin, {
    nombreCompleto: 'Usuario Interno N18', email: 'interno.n18@sisso-test.com', password: 'ClaveSegura#2026-N18', rol: 'th',
  });
  assert.equal(u.status, 201, JSON.stringify(u.datos));
  await queryComoSuperadmin(`DELETE FROM usuarios WHERE email = 'interno.n18@sisso-test.com'`);
});

test('LIMITE-PLAN: el limite del plan se sigue respetando (alta individual e importacion masiva)', async () => {
  const activos = (await queryComoSuperadmin(
    `SELECT COUNT(*)::int AS n FROM trabajadores WHERE organizacion_id = $1 AND activo = true`, [datos.orgAId]
  )).rows[0].n;
  // Los codigos de plan estan restringidos por CHECK (inicial/crecimiento/corporativo):
  // se ajusta temporalmente el limite del plan 'inicial' y se restaura en after().
  const plan = await queryComoSuperadmin(`SELECT id, limite_trabajadores FROM planes WHERE codigo = 'inicial'`);
  limiteOriginalPlanInicial = plan.rows[0].limite_trabajadores;
  await queryComoSuperadmin(`UPDATE planes SET limite_trabajadores = $1 WHERE codigo = 'inicial'`, [activos + 1]);
  await queryComoSuperadmin(`UPDATE organizaciones SET plan_id = $2 WHERE id = $1`, [datos.orgAId, plan.rows[0].id]);

  const cabe = await peticion('POST', '/trabajadores', tAdmin, { nombreCompleto: 'Cabe Justo', documento: 'N18-PLAN-1' });
  assert.equal(cabe.status, 201, JSON.stringify(cabe.datos));
  const excede = await peticion('POST', '/trabajadores', tAdmin, { nombreCompleto: 'Excede', documento: 'N18-PLAN-2' });
  assert.equal(excede.status, 403, JSON.stringify(excede.datos));

  const masivo = await peticion('POST', '/trabajadores/importar', tAdmin, {
    trabajadores: [{ nombreCompleto: 'M1', documento: 'N18-PLAN-3' }, { nombreCompleto: 'M2', documento: 'N18-PLAN-4' }],
  });
  assert.equal(masivo.status, 403, JSON.stringify(masivo.datos));
  assert.equal(masivo.datos.codigo, 'LIMITE_PLAN_EXCEDIDO');
});
