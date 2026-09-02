// ============================================================
// Controlador de Reportes BI.
//
// A diferencia de Indicadores SSO (foto fija de "ahora, ultimos
// 12 meses, sin filtros"), este modulo arma el mismo tipo de
// panorama pero FILTRABLE por rango de fechas (el frontend
// calcula desde/hasta segun año, trimestre o rango personalizado)
// y por area de trabajo, y se puede consumir de 3 formas:
//   - GET /resumen  -> JSON, para pintar los graficos en pantalla
//     y para que el frontend arme el Excel del lado del cliente
//     (SheetJS), sin duplicar logica de agregacion en el backend.
//   - GET /pdf      -> el mismo resumen, formateado como informe
//     PDF listo para presentar a gerencia (pdfkit, mismo patron
//     que certificados/consentimientos).
//   - GET /areas    -> catalogo de areas existentes, para el
//     selector de filtro (se toma de trabajadores.area, no hay
//     tabla de areas propia en el sistema).
//
// calcularResumen() es la UNICA fuente de la agregacion: tanto
// el endpoint JSON como el PDF la llaman, para que pantalla,
// Excel y PDF nunca muestren numeros distintos entre si.
//
// Nota sobre "por organizacion": cada usuario ya esta aislado a
// su propia organizacion_id por el JWT (multi-tenant), igual que
// el resto del sistema. No existe un modo "ver todas las
// organizaciones" dentro de esta app (eso vive en el panel de
// superadmin, que es otro repositorio); aqui "organizacion" se
// aplica automaticamente, no es un filtro que el usuario elija.
//
// Nota sobre matriz de riesgos: es una foto del ESTADO ACTUAL de
// los peligros identificados (no un evento con fecha), y no tiene
// vinculo directo y confiable con "area" (se enlaza opcionalmente
// a un puesto de trabajo). Por eso se muestra siempre completa,
// sin aplicar los filtros de fecha/area del resto del reporte;
// se documenta asi en el propio JSON de respuesta.
// ============================================================
const { query } = require('../db/pool');
const { etiquetaTipo: etiquetaTipoAusencia } = require('../ausentismo/ausentismo');
const { generarPdfReporteBI } = require('../reportes/pdfReporteBI');
const { UMBRAL_K_ANONIMATO } = require('../utils/kAnonimato');

function pct(numerador, denominador) {
  if (!denominador || denominador === 0) return 0;
  return Math.round((numerador / denominador) * 1000) / 10;
}

// ------------------------------------------------------------
// GET /api/reportes/areas
// ------------------------------------------------------------
async function obtenerAreas(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const resultado = await query(
      `SELECT DISTINCT area FROM trabajadores
       WHERE organizacion_id = $1 AND activo = true AND area IS NOT NULL AND area <> ''
       ORDER BY area`,
      [orgId]
    );
    return res.json({ areas: resultado.rows.map((f) => f.area) });
  } catch (err) {
    console.error('Error en obtenerAreas:', err);
    return res.status(500).json({ error: 'Error interno al obtener las areas.' });
  }
}

// ------------------------------------------------------------
// Agregacion central. filtros = { desde, hasta, area } (todos
// opcionales; sin filtros = todo el historico de la organizacion).
// ------------------------------------------------------------
async function calcularResumen(orgId, filtros) {
  const { desde, hasta, area } = filtros;

  // Condiciones para tablas donde el filtro de fecha aplica sobre
  // un unico campo de fecha (examenes, cuestionarios) y el area se
  // filtra via join a trabajadores.
  function condicionesEvento(aliasOrganizacion, aliasFecha, aliasArea) {
    const cond = [`${aliasOrganizacion} = $1`];
    const val = [orgId];
    if (desde) { val.push(desde); cond.push(`${aliasFecha} >= $${val.length}`); }
    if (hasta) { val.push(hasta); cond.push(`${aliasFecha} <= $${val.length}`); }
    if (area) { val.push(area); cond.push(`${aliasArea} = $${val.length}`); }
    return { cond, val };
  }

  // ---- Trabajadores (filtrado solo por area; "activo" siempre) ----
  const condTrab = ['organizacion_id = $1', 'activo = true'];
  const valTrab = [orgId];
  if (area) { valTrab.push(area); condTrab.push(`area = $${valTrab.length}`); }
  const whereTrab = condTrab.join(' AND ');

  const totalTrabajadoresRes = await query(`SELECT COUNT(*) AS total FROM trabajadores WHERE ${whereTrab}`, valTrab);
  const totalTrabajadores = parseInt(totalTrabajadoresRes.rows[0].total, 10);

  const emoRes = await query(
    `SELECT
       COUNT(*) FILTER (WHERE fecha_vencimiento IS NOT NULL AND fecha_vencimiento >= CURRENT_DATE) AS vigente,
       COUNT(*) FILTER (WHERE fecha_vencimiento IS NOT NULL AND fecha_vencimiento < CURRENT_DATE) AS vencido,
       COUNT(*) FILTER (WHERE fecha_vencimiento IS NULL) AS sin_fecha
     FROM trabajadores WHERE ${whereTrab}`,
    valTrab
  );

  const aptitudRes = await query(
    `SELECT
       COUNT(*) FILTER (WHERE aptitud = 'apto') AS apto,
       COUNT(*) FILTER (WHERE aptitud = 'con_restricciones') AS con_restricciones,
       COUNT(*) FILTER (WHERE aptitud = 'no_apto') AS no_apto,
       COUNT(*) FILTER (WHERE aptitud = 'pendiente') AS pendiente
     FROM trabajadores WHERE ${whereTrab}`,
    valTrab
  );

  // ---- Examenes complementarios (audiometria, espirometria, visiometria) ----
  async function resumenExamen(tabla, condicionAnormal) {
    const alias = 'organizacion_id';
    const cond = ['e.organizacion_id = $1'];
    const val = [orgId];
    if (desde) { val.push(desde); cond.push(`e.fecha_examen >= $${val.length}`); }
    if (hasta) { val.push(hasta); cond.push(`e.fecha_examen <= $${val.length}`); }
    if (area) { val.push(area); cond.push(`t.area = $${val.length}`); }
    const whereSql = cond.join(' AND ');

    const resultado = await query(
      `SELECT
         COUNT(DISTINCT e.trabajador_id) AS trabajadores_cubiertos,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE ${condicionAnormal}) AS anormales
       FROM ${tabla} e JOIN trabajadores t ON t.id = e.trabajador_id
       WHERE ${whereSql}`,
      val
    );
    const f = resultado.rows[0];
    return {
      trabajadoresCubiertos: parseInt(f.trabajadores_cubiertos, 10),
      porcentajeCobertura: pct(parseInt(f.trabajadores_cubiertos, 10), totalTrabajadores),
      total: parseInt(f.total, 10),
      anormales: parseInt(f.anormales, 10),
      porcentajeAnormales: pct(parseInt(f.anormales, 10), parseInt(f.total, 10)),
    };
  }

  const audiometria = await resumenExamen('examenes_audiometria', '(e.sts_od_positivo = true OR e.sts_oi_positivo = true)');
  const espirometria = await resumenExamen('examenes_espirometria', "(e.patron IS NOT NULL AND e.patron NOT IN ('normal', 'no_clasificable'))");
  const visiometria = await resumenExamen('examenes_visiometria', "(e.aptitud_definida IN ('requiere_evaluacion_oftalmologica', 'no_apto') OR e.vision_monocular_severa = true)");

  // ---- Ausentismo ----
  {
    const cond = ['a.organizacion_id = $1'];
    const val = [orgId];
    if (desde) { val.push(desde); cond.push(`a.fecha_fin >= $${val.length}`); }
    if (hasta) { val.push(hasta); cond.push(`a.fecha_inicio <= $${val.length}`); }
    if (area) { val.push(area); cond.push(`t.area = $${val.length}`); }
    const whereSql = cond.join(' AND ');

    var totalesAusentismoRes = await query(
      `SELECT COUNT(*) AS total_ausencias, COALESCE(SUM(a.dias_calendario), 0) AS total_dias
       FROM ausencias a JOIN trabajadores t ON t.id = a.trabajador_id WHERE ${whereSql}`,
      val
    );
    var porTipoAusentismoRes = await query(
      `SELECT a.tipo, COUNT(*) AS ausencias, COALESCE(SUM(a.dias_calendario), 0) AS dias
       FROM ausencias a JOIN trabajadores t ON t.id = a.trabajador_id WHERE ${whereSql}
       GROUP BY a.tipo ORDER BY dias DESC`,
      val
    );
  }

  // ---- Matriz de riesgos (sin filtro de fecha/area, ver nota arriba) ----
  const matrizRes = await query(
    `SELECT clasificacion, COUNT(*) AS cantidad FROM matriz_riesgos
     WHERE organizacion_id = $1 AND activo = true GROUP BY clasificacion`,
    [orgId]
  );
  const clasificacionesMatriz = ['trivial', 'tolerable', 'moderado', 'importante', 'intolerable'];
  const porClasificacionMatriz = {};
  let totalMatriz = 0;
  let altoRiesgoMatriz = 0;
  for (const fila of matrizRes.rows) {
    const cantidad = parseInt(fila.cantidad, 10);
    const clave = fila.clasificacion || 'sin_clasificar';
    porClasificacionMatriz[clave] = cantidad;
    totalMatriz += cantidad;
    if (clave === 'importante' || clave === 'intolerable') altoRiesgoMatriz += cantidad;
  }
  for (const c of clasificacionesMatriz) if (!(c in porClasificacionMatriz)) porClasificacionMatriz[c] = 0;

  // ---- Ergonomia: Nordico y NIOSH ----
  const { cond: condNordico, val: valNordico } = condicionesEvento('c.organizacion_id', 'c.fecha_aplicacion', 't.area');
  const nordicoRes = await query(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE c.requiere_atencion_prioritaria = true) AS prioritarios
     FROM cuestionarios_nordicos c JOIN trabajadores t ON t.id = c.trabajador_id
     WHERE ${condNordico.join(' AND ')}`,
    valNordico
  );

  const { cond: condNiosh, val: valNiosh } = condicionesEvento('n.organizacion_id', 'n.fecha_evaluacion', 't.area');
  const nioshRes = await query(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE n.clasificacion IN ('riesgo_alto', 'riesgo_muy_alto')) AS alto_riesgo
     FROM evaluaciones_niosh n JOIN trabajadores t ON t.id = n.trabajador_id
     WHERE ${condNiosh.join(' AND ')}`,
    valNiosh
  );

  // ---- Consentimientos ----
  {
    const cond = ['c.organizacion_id = $1'];
    const val = [orgId];
    if (desde) { val.push(desde); cond.push(`c.creado_en::date >= $${val.length}`); }
    if (hasta) { val.push(hasta); cond.push(`c.creado_en::date <= $${val.length}`); }
    if (area) { val.push(area); cond.push(`t.area = $${val.length}`); }
    var consentimientosRes = await query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE c.metodo_firma = 'electronica') AS electronica,
              COUNT(*) FILTER (WHERE c.metodo_firma = 'fisica_escaneada') AS fisica,
              COUNT(*) FILTER (WHERE c.revocado = true) AS revocados
       FROM consentimientos_firmados c JOIN trabajadores t ON t.id = c.trabajador_id
       WHERE ${cond.join(' AND ')}`,
      val
    );
  }

  const aptitud = aptitudRes.rows[0];
  const emo = emoRes.rows[0];
  const totalesAus = totalesAusentismoRes.rows[0];
  const cons = consentimientosRes.rows[0];
  const totalConsentimientos = parseInt(cons.total, 10);
  const nordico = nordicoRes.rows[0];
  const niosh = nioshRes.rows[0];

  const resumenCompleto = {
    filtrosAplicados: { desde: desde || null, hasta: hasta || null, area: area || null },

    trabajadores: { total: totalTrabajadores },

    coberturaEmo: {
      vigente: parseInt(emo.vigente, 10),
      vencido: parseInt(emo.vencido, 10),
      sinFecha: parseInt(emo.sin_fecha, 10),
      porcentajeVigente: pct(parseInt(emo.vigente, 10), totalTrabajadores),
    },

    aptitudMedica: {
      apto: parseInt(aptitud.apto, 10),
      conRestricciones: parseInt(aptitud.con_restricciones, 10),
      noApto: parseInt(aptitud.no_apto, 10),
      pendiente: parseInt(aptitud.pendiente, 10),
      porcentajeApto: pct(parseInt(aptitud.apto, 10), totalTrabajadores),
    },

    examenesComplementarios: { audiometria, espirometria, visiometria },

    ausentismo: {
      totalAusencias: parseInt(totalesAus.total_ausencias, 10),
      totalDias: parseInt(totalesAus.total_dias, 10),
      porTipo: porTipoAusentismoRes.rows.map((f) => ({
        tipo: f.tipo, etiqueta: etiquetaTipoAusencia(f.tipo),
        ausencias: parseInt(f.ausencias, 10), dias: parseInt(f.dias, 10),
      })),
    },

    matrizRiesgos: {
      nota: 'Estado actual de la matriz (no se filtra por fecha ni área: ver documentación del endpoint).',
      total: totalMatriz,
      porcentajeAltoRiesgo: pct(altoRiesgoMatriz, totalMatriz),
      porClasificacion: porClasificacionMatriz,
    },

    ergonomia: {
      nordico: {
        total: parseInt(nordico.total, 10),
        prioritarios: parseInt(nordico.prioritarios, 10),
        porcentaje: pct(parseInt(nordico.prioritarios, 10), parseInt(nordico.total, 10)),
      },
      niosh: {
        total: parseInt(niosh.total, 10),
        altoRiesgo: parseInt(niosh.alto_riesgo, 10),
        porcentaje: pct(parseInt(niosh.alto_riesgo, 10), parseInt(niosh.total, 10)),
      },
    },

    consentimientos: {
      total: totalConsentimientos,
      electronica: parseInt(cons.electronica, 10),
      fisica: parseInt(cons.fisica, 10),
      revocados: parseInt(cons.revocados, 10),
      porcentajeRevocados: pct(parseInt(cons.revocados, 10), totalConsentimientos),
    },
  };

  return redactarPorGrupoPequeno(resumenCompleto, totalTrabajadores, Boolean(area));
}

// CORREGIDO en Auditoria N.08 (hallazgo GRAVE G-N08-01, P1): antes,
// cualquier rol autenticado recibia calcularResumen() completo --
// tanto por JSON (/resumen) como por PDF (/pdf), ya que ambos
// llaman a la misma funcion. Se aplica aqui la misma proyeccion por
// rol que indicadoresController.js (ver su comentario de cabecera
// para la matriz completa), justo antes de redactar por
// k-anonimato, para que JSON y PDF respeten siempre la misma
// matriz sin duplicar la logica.
const APTITUD_MEDICA_VACIA_RPT = { apto: 0, conRestricciones: 0, noApto: 0, pendiente: 0, porcentajeApto: 0 };
const EXAMEN_VACIO_RPT = { trabajadoresCubiertos: 0, porcentajeCobertura: 0, total: 0, anormales: 0, porcentajeAnormales: 0 };
const EXAMENES_COMPLEMENTARIOS_VACIOS = { audiometria: EXAMEN_VACIO_RPT, espirometria: EXAMEN_VACIO_RPT, visiometria: EXAMEN_VACIO_RPT };
const AUSENTISMO_VACIO = { totalAusencias: 0, totalDias: 0, porTipo: [] };
const MATRIZ_RIESGOS_VACIA_RPT = {
  nota: 'No disponible para tu rol.',
  total: 0,
  porcentajeAltoRiesgo: 0,
  porClasificacion: { trivial: 0, tolerable: 0, moderado: 0, importante: 0, intolerable: 0 },
};
const ERGONOMIA_VACIA_RPT = {
  nordico: { total: 0, prioritarios: 0, porcentaje: 0 },
  niosh: { total: 0, altoRiesgo: 0, porcentaje: 0 },
};
const CONSENTIMIENTOS_VACIO_RPT = { total: 0, electronica: 0, fisica: 0, revocados: 0, porcentajeRevocados: 0 };

// CORREGIDO tras reporte de la persona usuaria (26/08/2026): mismo
// problema y misma solucion que proyectarIndicadoresSegunRol() en
// indicadoresController.js -- ver el comentario completo alli. En
// resumen: antes se OMITIA la clave completa de cada seccion no
// autorizada para el rol (ej. `ausentismo` no existia para 'medico'
// ni 'sso'), y el frontend (reportes-bi.js) no verificaba su
// existencia antes de leer subpropiedades como
// `resumen.ausentismo.totalAusencias`, lo que lo hacia fallar con
// "Cannot read properties of undefined". Ahora se devuelve un
// placeholder en cero con `_restringido: true` en vez de omitir la
// clave. El dato real sigue sin viajar para roles no autorizados.
function proyectarResumenSegunRol(resumen, rol) {
  const { filtrosAplicados, grupoPequenoRedactado, trabajadores, coberturaEmo, aptitudMedica, examenesComplementarios, ausentismo, matrizRiesgos, ergonomia, consentimientos } = resumen;
  const base = { filtrosAplicados, ...(grupoPequenoRedactado ? { grupoPequenoRedactado } : {}), trabajadores, coberturaEmo };

  if (rol === 'medico') {
    return {
      ...base, aptitudMedica, examenesComplementarios, consentimientos,
      ausentismo: { ...AUSENTISMO_VACIO, _restringido: true },
      matrizRiesgos: { ...MATRIZ_RIESGOS_VACIA_RPT, _restringido: true },
      ergonomia: { ...ERGONOMIA_VACIA_RPT, _restringido: true },
    };
  }
  if (rol === 'sso') {
    return {
      ...base, matrizRiesgos, ergonomia, consentimientos,
      aptitudMedica: { ...APTITUD_MEDICA_VACIA_RPT, _restringido: true },
      examenesComplementarios: { ...EXAMENES_COMPLEMENTARIOS_VACIOS, _restringido: true },
      ausentismo: { ...AUSENTISMO_VACIO, _restringido: true },
    };
  }
  if (rol === 'th') {
    return {
      ...base, ausentismo,
      aptitudMedica: { ...APTITUD_MEDICA_VACIA_RPT, _restringido: true },
      examenesComplementarios: { ...EXAMENES_COMPLEMENTARIOS_VACIOS, _restringido: true },
      matrizRiesgos: { ...MATRIZ_RIESGOS_VACIA_RPT, _restringido: true },
      ergonomia: { ...ERGONOMIA_VACIA_RPT, _restringido: true },
      consentimientos: { ...CONSENTIMIENTOS_VACIO_RPT, _restringido: true },
    };
  }
  // admin: gestion empresarial, sin convertirse en lector clinico.
  return {
    ...base, matrizRiesgos, ausentismo, consentimientos,
    aptitudMedica: { ...APTITUD_MEDICA_VACIA_RPT, _restringido: true },
    examenesComplementarios: { ...EXAMENES_COMPLEMENTARIOS_VACIOS, _restringido: true },
    ergonomia: { ...ERGONOMIA_VACIA_RPT, _restringido: true },
  };
}

// CORREGIDO (hallazgo MODERADO de la auditoria: "evitar inferencias
// en indicadores de grupos pequeños"). Cuando el reporte se filtra
// por un area especifica y esa area tiene muy pocos trabajadores,
// desgloses como "aptitud: 1 apto, 0 no aptos" o "auditometria: 1
// anormal de 1" equivalen en la practica a revelar el estado
// clinico-adyacente de UNA persona identificable (quien sabe cuantos
// trabajadores tiene esa area puede deducir de quien se trata),
// aunque el dato se presente como un agregado. Se aplica el
// principio de k-anonimato: con menos de UMBRAL_K_ANONIMATO
// trabajadores en el grupo filtrado, se redactan los desgloses mas
// sensibles y se deja unicamente el conteo total (que ya era visible
// de todas formas en el selector de areas).
//
// CORREGIDO en Auditoria N.14 (hallazgo GRAVE G14-03, P1): la
// condicion `!huboFiltroDeArea` hacia que una organizacion pequeña
// completa (ej. 3 trabajadores en TODA la organizacion, sin filtrar
// por area) nunca pasara por esta redaccion -- el k-anonimato solo
// se aplicaba cuando el usuario elegia filtrar por area, no cuando
// el universo COMPLETO ya era mas chico que el umbral. Se redacta
// siempre que el grupo (filtrado o no) sea menor al umbral.
// (Umbral centralizado en src/utils/kAnonimato.js -- import arriba.)

function redactarPorGrupoPequeno(resumen, totalTrabajadoresEnGrupo, huboFiltroDeArea) {
  if (totalTrabajadoresEnGrupo >= UMBRAL_K_ANONIMATO) {
    return resumen;
  }

  const nota = huboFiltroDeArea
    ? `Desglose oculto: el área filtrada tiene ${totalTrabajadoresEnGrupo} trabajador(es), menos del mínimo de ${UMBRAL_K_ANONIMATO} requerido para mostrar este detalle sin riesgo de identificar a una persona en particular.`
    : `Desglose oculto: la organización tiene ${totalTrabajadoresEnGrupo} trabajador(es) en total, menos del mínimo de ${UMBRAL_K_ANONIMATO} requerido para mostrar este detalle sin riesgo de identificar a una persona en particular.`;

  // CORREGIDO en Auditoria N.12 (hallazgo GRAVE G12-11, P1): esta
  // funcion solo redactaba aptitudMedica/examenesComplementarios/
  // ergonomia. Los desgloses de ausentismo por tipo (ej. "1 licencia
  // por maternidad" en un area de 2 personas) y el conteo de
  // consentimientos revocados en un grupo pequeño exponen el mismo
  // tipo de riesgo de reidentificacion y hasta ahora quedaban fuera
  // de la supresion, aunque `ausentismo`/`consentimientos` SI llegan
  // a roles como 'th' y 'admin' (ver proyectarResumenSegunRol).
  return {
    ...resumen,
    grupoPequenoRedactado: true,
    aptitudMedica: { redactado: true, nota },
    examenesComplementarios: { redactado: true, nota },
    ergonomia: { redactado: true, nota },
    ausentismo: resumen.ausentismo
      ? { totalAusencias: resumen.ausentismo.totalAusencias, totalDias: resumen.ausentismo.totalDias, porTipo: [], redactado: true, nota }
      : resumen.ausentismo,
    consentimientos: resumen.consentimientos
      ? { total: resumen.consentimientos.total, redactado: true, nota }
      : resumen.consentimientos,
  };
}

// ------------------------------------------------------------
// GET /api/reportes/resumen
// ------------------------------------------------------------
async function obtenerResumen(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const resumen = await calcularResumen(orgId, {
      desde: req.query.desde || null,
      hasta: req.query.hasta || null,
      area: req.query.area || null,
    });
    return res.json(proyectarResumenSegunRol(resumen, req.usuario.rol));
  } catch (err) {
    console.error('Error en obtenerResumen (reportes BI):', err);
    return res.status(500).json({ error: 'Error interno al calcular el reporte.' });
  }
}

// ------------------------------------------------------------
// GET /api/reportes/pdf
// ------------------------------------------------------------
async function exportarPdf(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const filtros = {
      desde: req.query.desde || null,
      hasta: req.query.hasta || null,
      area: req.query.area || null,
    };
    const resumenCompleto = await calcularResumen(orgId, filtros);
    // Mismo criterio que /resumen: el PDF de gerencia no debe mostrar
    // mas de lo que el rol que lo genera veria en pantalla.
    const resumen = proyectarResumenSegunRol(resumenCompleto, req.usuario.rol);

    const orgRes = await query(`SELECT nombre FROM organizaciones WHERE id = $1`, [orgId]);
    const nombreOrganizacion = orgRes.rows[0]?.nombre || 'SISSO';

    const doc = generarPdfReporteBI(resumen, nombreOrganizacion);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="reporte-bi-sso.pdf"');
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error('Error en exportarPdf (reportes BI):', err);
    return res.status(500).json({ error: 'Error interno al generar el PDF.' });
  }
}

module.exports = { obtenerAreas, obtenerResumen, exportarPdf };
