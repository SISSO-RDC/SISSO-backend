// ============================================================
// Controlador de KPIs de la Organizacion (catalogo real, ver
// migration_089_materializacion_kpis.sql y migration_092).
//
// CREADO en Auditoria N.17 (C-17-03, septimo y ultimo tipo
// materializado): catalogo de METAS adoptadas.
//
// AMPLIADO en Auditoria N.18 (G18-06, P1): conecta la meta con el
// valor REAL que calcula /api/indicadores y entrega META, VALOR,
// DESVIACION, CUMPLIMIENTO y TENDENCIA:
//   - PUT  /:id/vinculo   (admin)  vincula un KPI con UNO de los
//     indicadores calculados (lista cerrada) y fija operador+meta.
//   - GET  /comparativo            meta vs valor actual + tendencia.
//   - POST /mediciones (admin/sso/medico) guarda la foto del dia.
//
// Reglas de diseno:
//  * El valor NO se recalcula aqui: se obtiene ejecutando el propio
//    obtenerIndicadores() -- con la MISMA proyeccion por rol y los
//    mismas reglas de supresion de cifras que /api/indicadores -- asi que un rol que no ve un
//    indicador (p.ej. admin no ve hallazgos anormales) tampoco ve
//    su valor, su desviacion ni su historial aqui.
//  * La meta en texto libre NO se interpreta. Sin vinculo explicito
//    el KPI figura "sin_vinculo": nunca se presenta como cumplido.
//  * Sin denominador (0 trabajadores / 0 examenes) => "sin_datos",
//    no "0 %" ni "cumple".
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { obtenerIndicadores } = require('./indicadoresController');

// Lista cerrada de indicadores enlazables. `valor` y `denominador` son
// rutas dentro de la respuesta (ya proyectada por rol) de /api/indicadores.
const INDICADORES_ENLAZABLES = {
  cobertura_emo_vigente_pct: { descripcion: 'Cobertura de EMO vigente (%)', valor: ['coberturaEmo', 'porcentajeVigente'], denominador: ['totalTrabajadores'] },
  aptitud_apto_pct: { descripcion: 'Trabajadores aptos (%)', valor: ['aptitudMedica', 'porcentajeApto'], denominador: ['totalTrabajadores'] },
  cobertura_audiometria_pct: { descripcion: 'Cobertura de audiometría (%)', valor: ['coberturaExamenes', 'audiometria', 'porcentaje'], denominador: ['totalTrabajadores'] },
  cobertura_espirometria_pct: { descripcion: 'Cobertura de espirometría (%)', valor: ['coberturaExamenes', 'espirometria', 'porcentaje'], denominador: ['totalTrabajadores'] },
  cobertura_visiometria_pct: { descripcion: 'Cobertura de visiometría (%)', valor: ['coberturaExamenes', 'visiometria', 'porcentaje'], denominador: ['totalTrabajadores'] },
  audiometria_anormal_pct: { descripcion: 'Audiometrías con hallazgo anormal (%)', valor: ['hallazgosAnormales', 'audiometria', 'porcentaje'], denominador: ['hallazgosAnormales', 'audiometria', 'total'] },
  espirometria_anormal_pct: { descripcion: 'Espirometrías con hallazgo anormal (%)', valor: ['hallazgosAnormales', 'espirometria', 'porcentaje'], denominador: ['hallazgosAnormales', 'espirometria', 'total'] },
  visiometria_anormal_pct: { descripcion: 'Visiometrías con hallazgo anormal (%)', valor: ['hallazgosAnormales', 'visiometria', 'porcentaje'], denominador: ['hallazgosAnormales', 'visiometria', 'total'] },
};
const OPERADORES = ['<', '<=', '>', '>=', '='];

function leerRuta(objeto, ruta) {
  let actual = objeto;
  for (const k of ruta) {
    if (actual === null || actual === undefined || typeof actual !== 'object' || !(k in actual)) return undefined;
    actual = actual[k];
  }
  return actual;
}

function cumpleMeta(valor, operador, meta) {
  switch (operador) {
    case '<': return valor < meta;
    case '<=': return valor <= meta;
    case '>': return valor > meta;
    case '>=': return valor >= meta;
    default: return valor === meta;
  }
}

// 'mejora' si el valor se acerco a cumplir la meta respecto del anterior.
function tendenciaEntre(anterior, actual, operador, meta) {
  if (anterior === undefined || anterior === null) return 'sin_historial';
  if (actual === anterior) return 'estable';
  if (operador === '<' || operador === '<=') return actual < anterior ? 'mejora' : 'empeora';
  if (operador === '>' || operador === '>=') return actual > anterior ? 'mejora' : 'empeora';
  return Math.abs(actual - meta) < Math.abs(anterior - meta) ? 'mejora' : 'empeora';
}

// Ejecuta obtenerIndicadores() reutilizando EXACTAMENTE su calculo y su
// proyeccion por rol, capturando la respuesta en lugar de enviarla.
function indicadoresParaEsteUsuario(req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(codigo) { this.statusCode = codigo; return this; },
      json(cuerpo) {
        if (this.statusCode >= 400) reject(new Error(`indicadores respondio ${this.statusCode}`));
        else resolve(cuerpo);
        return this;
      },
    };
    Promise.resolve(obtenerIndicadores(req, res)).catch(reject);
  });
}

// Valor actual de un KPI vinculado, o el motivo por el que no hay.
function valorDeKpi(indicadores, kpi) {
  const def = INDICADORES_ENLAZABLES[kpi.indicador_clave];
  if (!def) return { estado: 'sin_vinculo' };
  const valor = leerRuta(indicadores, def.valor);
  if (valor === undefined || typeof valor !== 'number') return { estado: 'no_disponible_para_su_rol' };
  const denominador = leerRuta(indicadores, def.denominador);
  if (typeof denominador === 'number' && denominador === 0) return { estado: 'sin_datos' };
  return { estado: 'ok', valor };
}

// ------------------------------------------------------------
// GET /api/kpis-organizacion
// ------------------------------------------------------------
async function listar(req, res) {
  try {
    const resultado = await query(
      `SELECT k.id, k.nombre, k.meta, k.descripcion, k.activo, k.origen, k.creado_en,
              k.indicador_clave, k.meta_operador, k.meta_valor,
              u.nombre_completo AS creado_por_nombre
       FROM kpis_organizacion k
       LEFT JOIN usuarios u ON u.id = k.creado_por
       WHERE k.organizacion_id = $1
       ORDER BY k.nombre`,
      [req.usuario.organizacionId]
    );
    return res.json({ kpis: resultado.rows, indicadoresEnlazables: Object.entries(INDICADORES_ENLAZABLES).map(([clave, d]) => ({ clave, descripcion: d.descripcion })) });
  } catch (err) {
    console.error('Error en listar (kpis de la organizacion):', err);
    return res.status(500).json({ error: 'Error interno al listar los KPIs de la organización.' });
  }
}

// ------------------------------------------------------------
// PUT /api/kpis-organizacion/:id/vinculo   (solo admin)
// body: { indicadorClave: '...', metaOperador: '<', metaValor: 5 }
//       { indicadorClave: null } retira el vinculo.
// ------------------------------------------------------------
async function vincular(req, res) {
  const orgId = req.usuario.organizacionId;
  const { indicadorClave, metaOperador, metaValor } = req.body || {};

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return res.status(400).json({ error: 'id de KPI inválido.' });
  }

  if (indicadorClave === null) {
    // retirar
  } else {
    if (!INDICADORES_ENLAZABLES[indicadorClave]) {
      return res.status(400).json({ error: `indicadorClave inválido. Valores permitidos: ${Object.keys(INDICADORES_ENLAZABLES).join(', ')} (o null para retirar el vínculo).` });
    }
    if (!OPERADORES.includes(metaOperador)) {
      return res.status(400).json({ error: `metaOperador inválido. Valores permitidos: ${OPERADORES.join(' ')}.` });
    }
    if (typeof metaValor !== 'number' || !Number.isFinite(metaValor) || metaValor < 0 || metaValor > 100) {
      return res.status(400).json({ error: 'metaValor debe ser un número entre 0 y 100 (los indicadores enlazables son porcentajes).' });
    }
  }

  try {
    const resultado = await withTransaction(async (client) => {
      const actualizado = await client.query(
        `UPDATE kpis_organizacion
            SET indicador_clave = $3, meta_operador = $4, meta_valor = $5
          WHERE id = $1 AND organizacion_id = $2
          RETURNING id, nombre, meta, indicador_clave, meta_operador, meta_valor`,
        [req.params.id, orgId,
          indicadorClave === null ? null : indicadorClave,
          indicadorClave === null ? null : metaOperador,
          indicadorClave === null ? null : metaValor]
      );
      if (actualizado.rows.length === 0) return null;
      await registrarAuditoria({
        organizacionId: orgId,
        usuarioId: req.usuario.id,
        accion: indicadorClave === null ? 'retirar_vinculo_kpi_organizacion' : 'vincular_kpi_organizacion',
        entidad: 'kpis_organizacion',
        entidadId: req.params.id,
        detalle: { indicadorClave, metaOperador: metaOperador || null, metaValor: metaValor ?? null },
        req,
        client,
      });
      return actualizado.rows[0];
    });
    if (!resultado) return res.status(404).json({ error: 'KPI no encontrado.' });
    return res.json({ kpi: resultado });
  } catch (err) {
    console.error('Error en vincular (kpis de la organizacion):', err);
    return res.status(500).json({ error: 'Error interno al vincular el KPI.' });
  }
}

// ------------------------------------------------------------
// GET /api/kpis-organizacion/comparativo
// ------------------------------------------------------------
async function comparativo(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const [kpisRes, indicadores] = await Promise.all([
      query(
        `SELECT id, nombre, meta, indicador_clave, meta_operador, meta_valor
         FROM kpis_organizacion WHERE organizacion_id = $1 AND activo = true ORDER BY nombre`,
        [orgId]
      ),
      indicadoresParaEsteUsuario(req),
    ]);

    const resultados = [];
    for (const kpi of kpisRes.rows) {
      const base = { id: kpi.id, nombre: kpi.nombre, metaTexto: kpi.meta };
      if (!kpi.indicador_clave) {
        resultados.push({ ...base, estado: 'sin_vinculo', vinculo: null });
        continue;
      }
      const meta = Number(kpi.meta_valor);
      const vinculo = {
        indicadorClave: kpi.indicador_clave,
        indicador: INDICADORES_ENLAZABLES[kpi.indicador_clave].descripcion,
        operador: kpi.meta_operador,
        valorMeta: meta,
      };
      const v = valorDeKpi(indicadores, kpi);
      if (v.estado !== 'ok') {
        resultados.push({ ...base, estado: v.estado, vinculo });
        continue;
      }

      // Historial: solo se entrega si el rol puede ver el valor actual.
      const hist = await query(
        `SELECT to_char(fecha_medicion, 'YYYY-MM-DD') AS fecha, valor, cumple,
                (fecha_medicion < CURRENT_DATE) AS es_anterior_a_hoy
           FROM kpis_organizacion_mediciones
          WHERE kpi_id = $1 AND organizacion_id = $2
          ORDER BY fecha_medicion DESC LIMIT 6`,
        [kpi.id, orgId]
      );
      const previa = hist.rows.find((h) => h.es_anterior_a_hoy); // filas en orden DESC: la mas reciente anterior a hoy
      const cumple = cumpleMeta(v.valor, kpi.meta_operador, meta);
      resultados.push({
        ...base,
        estado: cumple ? 'cumple' : 'no_cumple',
        vinculo,
        valorActual: v.valor,
        desviacion: Math.round((v.valor - meta) * 10) / 10,
        tendencia: tendenciaEntre(previa ? Number(previa.valor) : undefined, v.valor, kpi.meta_operador, meta),
        historial: hist.rows.map((h) => ({ fecha: h.fecha, valor: Number(h.valor), cumple: h.cumple })).reverse(),
      });
    }
    return res.json({ kpis: resultados });
  } catch (err) {
    console.error('Error en comparativo (kpis de la organizacion):', err);
    return res.status(500).json({ error: 'Error interno al comparar los KPIs con sus valores reales.' });
  }
}

// ------------------------------------------------------------
// POST /api/kpis-organizacion/mediciones   (admin / sso / medico)
// Guarda la foto de HOY de cada KPI vinculado cuyo valor este
// disponible para el rol de quien la registra. Una por KPI y por dia
// (repetirla el mismo dia actualiza esa foto).
// ------------------------------------------------------------
async function registrarMediciones(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const [kpisRes, indicadores] = await Promise.all([
      query(
        `SELECT id, nombre, indicador_clave, meta_operador, meta_valor
         FROM kpis_organizacion WHERE organizacion_id = $1 AND activo = true AND indicador_clave IS NOT NULL`,
        [orgId]
      ),
      indicadoresParaEsteUsuario(req),
    ]);

    const guardadas = [];
    const omitidas = [];
    await withTransaction(async (client) => {
      for (const kpi of kpisRes.rows) {
        const v = valorDeKpi(indicadores, kpi);
        if (v.estado !== 'ok') { omitidas.push({ id: kpi.id, nombre: kpi.nombre, motivo: v.estado }); continue; }
        const meta = Number(kpi.meta_valor);
        const cumple = cumpleMeta(v.valor, kpi.meta_operador, meta);
        await client.query(
          `INSERT INTO kpis_organizacion_mediciones
             (organizacion_id, kpi_id, fecha_medicion, valor, meta_operador, meta_valor, cumple, registrado_por)
           VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7)
           ON CONFLICT (kpi_id, fecha_medicion)
           DO UPDATE SET valor = EXCLUDED.valor, meta_operador = EXCLUDED.meta_operador,
                         meta_valor = EXCLUDED.meta_valor, cumple = EXCLUDED.cumple,
                         registrado_por = EXCLUDED.registrado_por, registrado_en = now()`,
          [orgId, kpi.id, v.valor, kpi.meta_operador, meta, cumple, req.usuario.id]
        );
        guardadas.push({ id: kpi.id, nombre: kpi.nombre, valor: v.valor, cumple });
      }
      await registrarAuditoria({
        organizacionId: orgId,
        usuarioId: req.usuario.id,
        accion: 'registrar_mediciones_kpi_organizacion',
        entidad: 'kpis_organizacion_mediciones',
        detalle: { guardadas: guardadas.length, omitidas: omitidas.length },
        req,
        client,
      });
    });
    return res.status(201).json({ guardadas, omitidas });
  } catch (err) {
    console.error('Error en registrarMediciones (kpis de la organizacion):', err);
    return res.status(500).json({ error: 'Error interno al registrar las mediciones de KPI.' });
  }
}

module.exports = { listar, vincular, comparativo, registrarMediciones, INDICADORES_ENLAZABLES };
