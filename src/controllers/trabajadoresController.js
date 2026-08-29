// ============================================================
// Controlador de trabajadores.
//
// Regla de oro multi-tenant: TODA consulta filtra por
// organizacion_id = req.usuario.organizacionId. Nunca se
// confia en un id de organizacion que venga del body o query
// del cliente, siempre se usa el que viene del JWT verificado.
//
// IMPORTANTE (corrige el punto CRITICO #4 de la auditoria, "el
// rol admin tiene acceso completo a historia clinica"):
//   - Este controlador YA NO permite asignar "aptitud" al crear
//     o importar trabajadores. La aptitud SOLO puede registrarse
//     a traves del modulo medico (src/controllers/aptitudController.js),
//     que exige justificacion clinica obligatoria y corre el
//     motor de reglas de contraindicacion. Permitir asignarla
//     aqui era una puerta vieja que dejaba sin proteccion todo
//     lo construido en el punto critico #3.
//   - El campo "aptitud" SOLO se incluye en las respuestas de
//     listar()/obtener() cuando el usuario autenticado tiene rol
//     'medico'. Para cualquier otro rol (admin, sso, th), el
//     campo simplemente no viaja en el JSON de respuesta.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { verificarLimitePlan } = require('../utils/planes');

// ------------------------------------------------------------
// CORREGIDO en Auditoria N.08 (hallazgo GRAVE G-N08-02): antes,
// listar()/obtener() solo ocultaban "aptitud" para no-medico, pero
// devolvian sexo/fecha_nacimiento/talla_cm/peso_kg a CUALQUIER rol
// autenticado -- incluido sso, que no tiene ningun permiso de
// escritura sobre trabajadores ni sobre datos antropometricos (ver
// trabajadoresRoutes.js: solo admin/medico/th estan autorizados en
// POST /:id/datos-antropometricos).
//
// La correccion NO le quita estos campos a admin/th: la propia
// arquitectura ya los trata como datos administrativos (no
// clinicos) que admin/th cargan legitimamente al registrar un
// trabajador -- quitarselos en la lectura seria inconsistente con
// que puedan escribirlos, y no resuelve ningun riesgo real (ya son
// dueños de ese dato). Sí se le quitan a sso: no puede escribirlos,
// no hay ninguna necesidad operativa documentada para que un rol de
// seguridad industrial conozca la talla/peso/fecha de nacimiento de
// cada trabajador nombrado, y dejarselos visibles sin una razon de
// negocio es exactamente la clase de "via lateral" que señala esta
// auditoria.
// ------------------------------------------------------------
function columnasSegunRol(rol) {
  if (rol === 'medico') {
    return 'id, nombre_completo, documento, area, puesto, fecha_emo, fecha_vencimiento, aptitud, activo, sexo, fecha_nacimiento, talla_cm, peso_kg';
  }
  if (rol === 'admin' || rol === 'th') {
    return 'id, nombre_completo, documento, area, puesto, fecha_emo, fecha_vencimiento, activo, sexo, fecha_nacimiento, talla_cm, peso_kg';
  }
  // sso (y cualquier rol futuro sin necesidad documentada): solo lo
  // estrictamente operativo/preventivo, sin datos antropometricos.
  return 'id, nombre_completo, documento, area, puesto, fecha_emo, fecha_vencimiento, activo';
}

// ------------------------------------------------------------
// GET /api/trabajadores
// Lista los trabajadores de la organizacion del usuario logueado.
// ------------------------------------------------------------
async function listar(req, res) {
  try {
    const columnas = columnasSegunRol(req.usuario.rol);

    const resultado = await query(
      `SELECT ${columnas}
       FROM trabajadores
       WHERE organizacion_id = $1 AND activo = true
       ORDER BY nombre_completo ASC`,
      [req.usuario.organizacionId]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'listar_trabajadores',
      entidad: 'trabajador',
      req,
    });

    return res.json({ trabajadores: resultado.rows });
  } catch (err) {
    console.error('Error en listar trabajadores:', err);
    return res.status(500).json({ error: 'Error interno al listar trabajadores.' });
  }
}

// ------------------------------------------------------------
// GET /api/trabajadores/:id
// ------------------------------------------------------------
async function obtener(req, res) {
  try {
    const columnas = columnasSegunRol(req.usuario.rol);

    const resultado = await query(
      `SELECT ${columnas}
       FROM trabajadores
       WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, req.usuario.organizacionId]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'ver_trabajador',
      entidad: 'trabajador',
      entidadId: req.params.id,
      req,
    });

    return res.json({ trabajador: resultado.rows[0] });
  } catch (err) {
    console.error('Error en obtener trabajador:', err);
    return res.status(500).json({ error: 'Error interno al obtener el trabajador.' });
  }
}

// ------------------------------------------------------------
// POST /api/trabajadores
// Crea un trabajador nuevo dentro de la organizacion del usuario.
// ------------------------------------------------------------
async function crear(req, res) {
  const { nombreCompleto, documento, area, puesto, fechaEmo, fechaVencimiento, sexo, fechaNacimiento, tallaCm, pesoKg } = req.body;

  if (!nombreCompleto || !documento) {
    return res.status(400).json({ error: 'nombreCompleto y documento son obligatorios.' });
  }

  try {
    // CORREGIDO en Auditoria N.09 (G-N09-08): verificacion del
    // limite de trabajadores del plan, DENTRO de la misma
    // transaccion que el INSERT (con FOR UPDATE sobre la fila de la
    // organizacion) para que dos altas concurrentes no puedan
    // saltarse el limite. Ver utils/planes.js.
    const resultado = await withTransaction(async (client) => {
      await verificarLimitePlan(client, req.usuario.organizacionId, 'trabajadores', 1);

      const insertRes = await client.query(
      // La aptitud se crea siempre como 'pendiente' y NUNCA se recibe
      // del body: solo puede cambiar a traves de POST
      // /api/aptitud/trabajadores/:id/registrar (modulo medico), que
      // exige justificacion clinica obligatoria y corre el motor de
      // reglas de contraindicacion.
      //
      // sexo/fechaNacimiento/tallaCm/pesoKg son opcionales aqui: si
      // no se conocen todavia, pueden completarse luego con
      // PUT /api/trabajadores/:id/datos-antropometricos (necesario
      // antes de poder registrar audiometrias o espirometrias).
      `INSERT INTO trabajadores
        (organizacion_id, nombre_completo, documento, area, puesto, fecha_emo, fecha_vencimiento, aptitud,
         sexo, fecha_nacimiento, talla_cm, peso_kg)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente', $8, $9, $10, $11)
       RETURNING id, nombre_completo, documento, area, puesto, fecha_emo, fecha_vencimiento, activo,
                 sexo, fecha_nacimiento, talla_cm, peso_kg`,
      [
        req.usuario.organizacionId,
        nombreCompleto,
        documento,
        area || null,
        puesto || null,
        fechaEmo || null,
        fechaVencimiento || null,
        sexo || null,
        fechaNacimiento || null,
        tallaCm || null,
        pesoKg || null,
      ]
      );

      await registrarAuditoria({
        organizacionId: req.usuario.organizacionId,
        usuarioId: req.usuario.id,
        accion: 'crear_trabajador',
        entidad: 'trabajador',
        entidadId: insertRes.rows[0].id,
        req,
        client,
      });

      return insertRes;
    });

    return res.status(201).json({ trabajador: resultado.rows[0] });
  } catch (err) {
    if (err.codigo === 'LIMITE_PLAN_EXCEDIDO') {
      return res.status(403).json({ error: err.message, codigo: err.codigo });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un trabajador con ese documento en esta organizacion.' });
    }
    console.error('Error en crear trabajador:', err);
    return res.status(500).json({ error: 'Error interno al crear el trabajador.' });
  }
}

// ------------------------------------------------------------
// POST /api/trabajadores/importar
// Crea o actualiza muchos trabajadores de una sola vez, a partir
// de las filas que el frontend ya extrajo de un Excel/CSV.
//
// Si el documento ya existe en la organizacion, ACTUALIZA esos
// datos en vez de fallar (asi se puede re-importar la nomina
// completa varias veces sin duplicar a nadie).
//
// La columna "aptitud" del Excel, si viene, se IGNORA
// deliberadamente: no se permite asignar aptitud por importacion
// masiva (ver nota al inicio del archivo). Si la fila trae esa
// columna, simplemente no se usa; no se reporta como error para
// no bloquear la importacion del resto de los datos del
// trabajador, que si son validos.
//
// Responde con un detalle fila por fila: cuales se crearon,
// cuales se actualizaron, y cuales fallaron (y por que), para
// que el frontend pueda mostrar un resumen claro.
// ------------------------------------------------------------
async function importarMasivo(req, res) {
  const filas = req.body.trabajadores;

  if (!Array.isArray(filas) || filas.length === 0) {
    return res.status(400).json({ error: 'Debe enviar un arreglo "trabajadores" con al menos una fila.' });
  }
  if (filas.length > 1000) {
    return res.status(400).json({ error: 'Maximo 1000 filas por importacion. Divida el archivo en partes mas pequenas.' });
  }

  const resultados = [];
  let creados = 0;
  let actualizados = 0;
  let fallidos = 0;

  // CORREGIDO en Auditoria N.11 (hallazgo GRAVE G11-08, P1): la
  // verificacion anterior corria en su propia consulta, ANTES del
  // bucle, sin ningun bloqueo -- dos importaciones concurrentes
  // sobre la MISMA organizacion podian leer ambas "estamos por
  // debajo del limite" y terminar, sumadas, por encima de el (exacto
  // el mismo patron de carrera que ya se habia cerrado para altas
  // individuales en verificarLimitePlan()). Ahora TODO el lote
  // -verificacion + cada upsert- corre dentro de UNA sola
  // transaccion que mantiene bloqueada (FOR UPDATE) la fila de la
  // organizacion durante toda la importacion, serializando cualquier
  // otra alta/importacion concurrente contra el mismo limite.
  //
  // Con hasta 1000 filas, esto mantiene el candado mas tiempo que un
  // alta individual -- se acepta el trade-off (una importacion
  // concurrente simplemente espera a que termine la anterior) porque
  // es preferible a permitir superar el limite comercial del plan.
  try {
    const resultadoTransaccion = await withTransaction(async (client) => {
      const orgRes = await client.query(
        `SELECT o.id, p.limite_trabajadores AS limite
         FROM organizaciones o LEFT JOIN planes p ON p.id = o.plan_id
         WHERE o.id = $1
         FOR UPDATE`,
        [req.usuario.organizacionId]
      );
      const limite = orgRes.rows[0] ? orgRes.rows[0].limite : null;

      if (limite !== null && limite !== undefined) {
        const documentos = filas.map((f) => (f.documento || '').toString().trim()).filter(Boolean);
        const existentesRes = await client.query(
          `SELECT COUNT(*)::int AS total FROM trabajadores WHERE organizacion_id = $1 AND activo = true`,
          [req.usuario.organizacionId]
        );
        const yaExistentesRes = await client.query(
          `SELECT COUNT(*)::int AS total FROM trabajadores WHERE organizacion_id = $1 AND documento = ANY($2::text[])`,
          [req.usuario.organizacionId, documentos]
        );
        const actualesActivos = existentesRes.rows[0].total;
        const filasNuevasEstimadas = documentos.length - yaExistentesRes.rows[0].total;
        if (actualesActivos + filasNuevasEstimadas > limite) {
          const errLimite = new Error(
            `Limite del plan alcanzado: ya tiene ${actualesActivos} trabajadores activos de un maximo de ${limite}. `
            + `Esta importacion agregaria aproximadamente ${filasNuevasEstimadas} trabajadores nuevos. `
            + `Reduzca el tamano del archivo o actualice de plan.`
          );
          errLimite.codigo = 'LIMITE_PLAN_EXCEDIDO';
          throw errLimite;
        }
      }

      for (let i = 0; i < filas.length; i++) {
        const fila = filas[i];
        const numeroFila = i + 2; // +2 porque la fila 1 del Excel suele ser el encabezado

        const nombreCompleto = (fila.nombreCompleto || '').toString().trim();
        const documento = (fila.documento || '').toString().trim();
        const area = (fila.area || '').toString().trim() || null;
        const puesto = (fila.puesto || '').toString().trim() || null;

        if (!nombreCompleto || !documento) {
          resultados.push({ fila: numeroFila, documento: documento || '(vacio)', estado: 'error', mensaje: 'Falta nombreCompleto o documento.' });
          fallidos++;
          continue;
        }

        try {
          const upsert = await client.query(
            `INSERT INTO trabajadores
              (organizacion_id, nombre_completo, documento, area, puesto, aptitud)
             VALUES ($1, $2, $3, $4, $5, 'pendiente')
             ON CONFLICT (organizacion_id, documento)
             DO UPDATE SET
               nombre_completo = EXCLUDED.nombre_completo,
               area = EXCLUDED.area,
               puesto = EXCLUDED.puesto,
               activo = true
             RETURNING id, (xmax = 0) AS es_nuevo`,
            [req.usuario.organizacionId, nombreCompleto, documento, area, puesto]
          );

          const esNuevo = upsert.rows[0].es_nuevo;
          if (esNuevo) { creados++; } else { actualizados++; }
          resultados.push({
            fila: numeroFila,
            documento,
            estado: esNuevo ? 'creado' : 'actualizado',
            id: upsert.rows[0].id,
          });
        } catch (err) {
          console.error(`Error importando fila ${numeroFila} (documento ${documento}):`, err.message);
          resultados.push({ fila: numeroFila, documento, estado: 'error', mensaje: 'Error interno al guardar esta fila.' });
          fallidos++;
        }
      }

      await registrarAuditoria({
        organizacionId: req.usuario.organizacionId,
        usuarioId: req.usuario.id,
        accion: 'importar_trabajadores_masivo',
        entidad: 'trabajador',
        detalle: { total: filas.length, creados, actualizados, fallidos },
        req,
        client,
      });
    });

    return res.status(200).json({
      resumen: { total: filas.length, creados, actualizados, fallidos },
      detalle: resultados,
    });
  } catch (errTransaccion) {
    if (errTransaccion.codigo === 'LIMITE_PLAN_EXCEDIDO') {
      return res.status(403).json({ error: errTransaccion.message, codigo: errTransaccion.codigo });
    }
    console.error('Error en importarMasivo (trabajadores):', errTransaccion);
    return res.status(500).json({ error: 'Error interno al importar los trabajadores.' });
  }
}

// ------------------------------------------------------------
// PUT /api/trabajadores/:id/datos-antropometricos
// Registra o corrige sexo, fecha de nacimiento, talla y peso de
// un trabajador. Estos datos NO son un diagnostico clinico (por
// eso no siguen la restriccion de "aptitud" del punto critico #4
// de la auditoria), pero SI son indispensables para que
// audiometria (edad, para presbiacusia) y espirometria (sexo,
// edad, talla, para los valores predichos ECSC/ERS 1993) puedan
// calcular resultados correctos. Sin este endpoint, un trabajador
// creado antes de esta version quedaria sin poder tener examenes
// de espirometria registrados.
// ------------------------------------------------------------
async function actualizarDatosAntropometricos(req, res) {
  const { sexo, fechaNacimiento, tallaCm, pesoKg } = req.body;

  try {
    const resultado = await query(
      `UPDATE trabajadores
       SET sexo = $1, fecha_nacimiento = $2, talla_cm = $3, peso_kg = $4
       WHERE id = $5 AND organizacion_id = $6
       RETURNING id, nombre_completo, documento, sexo, fecha_nacimiento, talla_cm, peso_kg`,
      [sexo, fechaNacimiento, tallaCm, pesoKg || null, req.params.id, req.usuario.organizacionId]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'actualizar_datos_antropometricos',
      entidad: 'trabajador',
      entidadId: req.params.id,
      req,
    });

    return res.json({ trabajador: resultado.rows[0] });
  } catch (err) {
    console.error('Error en actualizarDatosAntropometricos:', err);
    return res.status(500).json({ error: 'Error interno al actualizar los datos antropometricos.' });
  }
}

// ------------------------------------------------------------
// GET /api/trabajadores/proximos-examenes
// Panel de vencimientos de EMO (Examen Medico Ocupacional). No
// requiere tabla nueva: se calcula sobre trabajadores.fecha_emo/
// fecha_vencimiento (migration_002). Sirve tanto para "Calendario
// EMOs" como para "Proximos examenes" en el menu -son la misma
// necesidad vista de dos maneras, asi que comparten este endpoint-.
//
// Urgencia:
//   vencido      -> fecha_vencimiento ya paso
//   critico      -> vence en 15 dias o menos
//   proximo      -> vence en 16 a 30 dias
//   proximo_60   -> vence en 31 a 60 dias
//   normal       -> vence en mas de 60 dias
//   sin_fecha    -> el trabajador no tiene fecha_vencimiento registrada
// ------------------------------------------------------------
async function proximosExamenes(req, res) {
  try {
    const resultado = await query(
      `SELECT id, nombre_completo, documento, area, puesto, fecha_emo, fecha_vencimiento,
              (fecha_vencimiento - CURRENT_DATE) AS dias_restantes
       FROM trabajadores
       WHERE organizacion_id = $1 AND activo = true
       ORDER BY (fecha_vencimiento IS NULL) ASC, fecha_vencimiento ASC NULLS LAST`,
      [req.usuario.organizacionId]
    );

    const conUrgencia = resultado.rows.map(t => {
      let urgencia;
      if (t.fecha_vencimiento === null) urgencia = 'sin_fecha';
      else if (t.dias_restantes < 0) urgencia = 'vencido';
      else if (t.dias_restantes <= 15) urgencia = 'critico';
      else if (t.dias_restantes <= 30) urgencia = 'proximo';
      else if (t.dias_restantes <= 60) urgencia = 'proximo_60';
      else urgencia = 'normal';
      return { ...t, urgencia };
    });

    const resumen = conUrgencia.reduce((acc, t) => {
      acc[t.urgencia] = (acc[t.urgencia] || 0) + 1;
      return acc;
    }, {});

    return res.json({ trabajadores: conUrgencia, resumen });
  } catch (err) {
    console.error('Error en proximosExamenes:', err);
    return res.status(500).json({ error: 'Error interno al obtener los proximos examenes.' });
  }
}

module.exports = { listar, obtener, crear, importarMasivo, actualizarDatosAntropometricos, proximosExamenes };
