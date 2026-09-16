// ============================================================
// Controlador del motor base de propuestas/confirmaciones del
// configurador sectorial.
//
// CREADO en Auditoria N.16 -> N.17 (P1, lote "motor base" elegido
// por el usuario). Ver migration_083 para el diseño de las 2 tablas
// que este controlador opera, y la Seccion 4/16 del informe N.16
// para el hallazgo que motiva este motor: "Aplicar configuracion"
// guardaba el perfil sectorial pero no generaba nada revisable.
//
// FLUJO:
//   1. POST /generar   -- a partir del sector ya elegido en
//      "Mi Empresa" (organizacionController.aplicarConfiguracionSectorial),
//      crea una propuesta "pendiente" por cada elemento sugerido del
//      catalogo_sectores que la organizacion todavia no tiene
//      propuesto (idempotente: nunca duplica ni revive una propuesta
//      ya rechazada -- ver UNIQUE en migration_083).
//   2. GET /            -- lista las propuestas de la organizacion,
//      opcionalmente filtradas por tipo/estado.
//   3. PUT /:id/confirmar -- acepta, rechaza o modifica una
//      propuesta puntual. El rol exigido depende del TIPO de la
//      propuesta (ver ROLES_POR_TIPO), no solo de la ruta, porque la
//      Seccion 16 del informe N.16 exige exactamente esa separacion:
//      "El administrador debe confirmar lo administrativo. SSO debe
//      revisar lo preventivo/tecnico. El medico ocupacional debe
//      decidir lo clinico."
//
// IMPORTANTE -- lo que este controlador NO hace todavia: aceptar una
// propuesta NO crea todavia el area/puesto/EPP/herramienta/KPI real
// en su modulo correspondiente (columnas "aplicado"/"aplicado_en"
// quedan sin usar). Esa materializacion es G-16-02 a G-16-06,
// deliberadamente diferida al siguiente lote de N.17.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

// Columna de catalogo_sectores de la que sale cada tipo de
// propuesta, y como extraer una clave estable (para el UNIQUE de
// idempotencia) de cada elemento de esa columna. Los arreglos de
// catalogo_sectores mezclan strings simples (areas, herramientas
// ergonomicas, EPP) con objetos {nombre, ...} (riesgos, examenes,
// kpis) -- ver seed de migration_077.
const MAPA_TIPOS = {
  area: { columna: 'areas', clave: (item) => (typeof item === 'string' ? item : item?.nombre) },
  riesgo: { columna: 'riesgos', clave: (item) => item?.nombre },
  examen: { columna: 'examenes_sugeridos', clave: (item) => item?.nombre },
  herramienta_ergonomica: { columna: 'herramientas_ergonomicas', clave: (item) => (typeof item === 'string' ? item : item?.nombre) },
  epp: { columna: 'epp_sugerido', clave: (item) => (typeof item === 'string' ? item : item?.nombre) },
  kpi: { columna: 'kpis_sugeridos', clave: (item) => item?.nombre },
  puesto: { columna: 'puestos_frecuentes', clave: (item) => (typeof item === 'string' ? item : item?.nombre) },
};

// Seccion 16 del informe N.16: quien decide cada tipo de propuesta.
// 'examen' queda exclusivo de 'medico' (juicio clinico); 'riesgo' y
// 'herramienta_ergonomica' de 'sso' (preventivo/tecnico); el resto
// (administrativo) de 'admin'. Deliberadamente sin solapamiento:
// permitir que admin decida un tipo clinico es precisamente el
// riesgo que la auditoria senala (G-16-09, "sector = obligacion
// medica").
const ROLES_POR_TIPO = {
  area: ['admin'],
  puesto: ['admin'],
  epp: ['admin'],
  kpi: ['admin'],
  riesgo: ['sso'],
  herramienta_ergonomica: ['sso'],
  examen: ['medico'],
};

// ------------------------------------------------------------
// POST /api/configuracion-sectorial/propuestas/generar
// ------------------------------------------------------------
async function generarPropuestas(req, res) {
  const organizacionId = req.usuario.organizacionId;

  try {
    const orgRes = await query(
      `SELECT sector_empresarial_clave FROM organizaciones WHERE id = $1`,
      [organizacionId]
    );
    const sectorClave = orgRes.rows[0]?.sector_empresarial_clave;
    if (!sectorClave) {
      return res.status(400).json({
        error: 'La organización debe tener un sector configurado en "Mi Empresa" antes de generar propuestas.',
      });
    }

    const sectorRes = await query(
      `SELECT clave, activo, areas, riesgos, examenes_sugeridos,
              herramientas_ergonomicas, epp_sugerido, kpis_sugeridos, puestos_frecuentes
       FROM catalogo_sectores WHERE clave = $1`,
      [sectorClave]
    );
    const sector = sectorRes.rows[0];
    if (!sector || !sector.activo) {
      return res.status(400).json({ error: 'El sector configurado ya no existe o no está activo en el catálogo.' });
    }

    const nuevas = [];
    let consideradas = 0;

    await withTransaction(async (client) => {
      for (const [tipo, { columna, clave }] of Object.entries(MAPA_TIPOS)) {
        const items = Array.isArray(sector[columna]) ? sector[columna] : [];
        for (const item of items) {
          const claveItem = clave(item);
          if (!claveItem) continue; // elemento sin nombre reconocible: se ignora, no se inventa una clave.
          consideradas += 1;

          const insertRes = await client.query(
            `INSERT INTO propuestas_configuracion_sectorial
               (organizacion_id, tipo, clave_item, clave_sector, datos_propuestos, generado_por)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6)
             ON CONFLICT (organizacion_id, tipo, clave_item) DO NOTHING
             RETURNING id, tipo, clave_item, datos_propuestos, estado, generado_en`,
            [organizacionId, tipo, claveItem, sectorClave, JSON.stringify(item), req.usuario.id]
          );

          if (insertRes.rows.length > 0) {
            const propuesta = insertRes.rows[0];
            nuevas.push(propuesta);
            await client.query(
              `INSERT INTO confirmaciones_configuracion_sectorial
                 (propuesta_id, organizacion_id, accion, datos, usuario_id)
               VALUES ($1, $2, 'generada', $3::jsonb, $4)`,
              [propuesta.id, organizacionId, JSON.stringify(item), req.usuario.id]
            );
          }
        }
      }

      await registrarAuditoria({
        organizacionId,
        usuarioId: req.usuario.id,
        accion: 'generar_propuestas_configuracion_sectorial',
        entidad: 'propuestas_configuracion_sectorial',
        detalle: { sectorClave, consideradas, generadas: nuevas.length },
        req,
        client,
      });
    });

    return res.status(201).json({
      sectorClave,
      consideradas,
      generadas: nuevas.length,
      omitidas: consideradas - nuevas.length,
      propuestas: nuevas,
    });
  } catch (err) {
    console.error('Error en generarPropuestas (configuracion sectorial):', err);
    return res.status(500).json({ error: 'Error interno al generar las propuestas de configuración sectorial.' });
  }
}

// ------------------------------------------------------------
// GET /api/configuracion-sectorial/propuestas?tipo=&estado=
// ------------------------------------------------------------
async function listarPropuestas(req, res) {
  const organizacionId = req.usuario.organizacionId;
  const { tipo, estado } = req.query;

  if (tipo && !MAPA_TIPOS[tipo]) {
    return res.status(400).json({ error: `tipo inválido. Valores permitidos: ${Object.keys(MAPA_TIPOS).join(', ')}.` });
  }
  if (estado && !['pendiente', 'aceptada', 'rechazada', 'modificada'].includes(estado)) {
    return res.status(400).json({ error: 'estado inválido. Valores permitidos: pendiente, aceptada, rechazada, modificada.' });
  }

  try {
    const condiciones = ['p.organizacion_id = $1'];
    const valores = [organizacionId];
    if (tipo) {
      valores.push(tipo);
      condiciones.push(`p.tipo = $${valores.length}`);
    }
    if (estado) {
      valores.push(estado);
      condiciones.push(`p.estado = $${valores.length}`);
    }

    const resultado = await query(
      `SELECT p.id, p.tipo, p.clave_item, p.clave_sector, p.datos_propuestos, p.datos_confirmados,
              p.estado, p.generado_en, p.revisado_en, p.comentario_revision,
              ug.nombre_completo AS generado_por_nombre,
              ur.nombre_completo AS revisado_por_nombre
       FROM propuestas_configuracion_sectorial p
       LEFT JOIN usuarios ug ON ug.id = p.generado_por
       LEFT JOIN usuarios ur ON ur.id = p.revisado_por
       WHERE ${condiciones.join(' AND ')}
       ORDER BY p.tipo, p.generado_en`,
      valores
    );

    return res.json({ propuestas: resultado.rows });
  } catch (err) {
    console.error('Error en listarPropuestas (configuracion sectorial):', err);
    return res.status(500).json({ error: 'Error interno al listar las propuestas de configuración sectorial.' });
  }
}

// ------------------------------------------------------------
// PUT /api/configuracion-sectorial/propuestas/:id/confirmar
// body: { accion: 'aceptar'|'rechazar'|'modificar', comentario?, datosModificados? }
// ------------------------------------------------------------
async function confirmarPropuesta(req, res) {
  const organizacionId = req.usuario.organizacionId;
  const { id } = req.params;
  const { accion, comentario, datosModificados } = req.body;

  try {
    const propRes = await query(
      `SELECT id, tipo, estado FROM propuestas_configuracion_sectorial WHERE id = $1 AND organizacion_id = $2`,
      [id, organizacionId]
    );
    const propuesta = propRes.rows[0];
    if (!propuesta) {
      return res.status(404).json({ error: 'Propuesta no encontrada.' });
    }
    if (propuesta.estado !== 'pendiente') {
      return res.status(409).json({
        error: `Esta propuesta ya fue revisada (estado actual: ${propuesta.estado}). No se permite volver a revisarla desde este endpoint.`,
      });
    }

    const rolesPermitidos = ROLES_POR_TIPO[propuesta.tipo] || [];
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({
        error: `Las propuestas de tipo "${propuesta.tipo}" solo pueden ser revisadas por: ${rolesPermitidos.join(', ')}.`,
      });
    }

    const nuevoEstado = accion === 'aceptar' ? 'aceptada' : accion === 'rechazar' ? 'rechazada' : 'modificada';
    const datosConfirmados = nuevoEstado === 'modificada' ? JSON.stringify(datosModificados) : null;

    let actualizada;
    await withTransaction(async (client) => {
      const updRes = await client.query(
        `UPDATE propuestas_configuracion_sectorial
         SET estado = $1, datos_confirmados = $2::jsonb, revisado_por = $3,
             revisado_en = now(), comentario_revision = $4
         WHERE id = $5 AND organizacion_id = $6 AND estado = 'pendiente'
         RETURNING id, tipo, clave_item, datos_propuestos, datos_confirmados, estado, revisado_en, comentario_revision`,
        [nuevoEstado, datosConfirmados, req.usuario.id, comentario || null, id, organizacionId]
      );
      if (updRes.rows.length === 0) {
        // Carrera: otro revisor la resolvio entre el SELECT y el UPDATE.
        throw Object.assign(new Error('conflicto_estado'), { codigoHttp: 409 });
      }
      actualizada = updRes.rows[0];

      await client.query(
        `INSERT INTO confirmaciones_configuracion_sectorial
           (propuesta_id, organizacion_id, accion, datos, comentario, usuario_id)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
        [id, organizacionId, nuevoEstado, datosConfirmados || actualizada.datos_propuestos, comentario || null, req.usuario.id]
      );

      await registrarAuditoria({
        organizacionId,
        usuarioId: req.usuario.id,
        accion: 'confirmar_propuesta_configuracion_sectorial',
        entidad: 'propuestas_configuracion_sectorial',
        entidadId: id,
        detalle: { tipo: propuesta.tipo, resultado: nuevoEstado, comentario: comentario || null },
        req,
        client,
      });
    });

    return res.json({ propuesta: actualizada });
  } catch (err) {
    if (err.codigoHttp === 409) {
      return res.status(409).json({ error: 'Esta propuesta ya fue revisada por otro usuario mientras se procesaba esta solicitud.' });
    }
    console.error('Error en confirmarPropuesta (configuracion sectorial):', err);
    return res.status(500).json({ error: 'Error interno al confirmar la propuesta de configuración sectorial.' });
  }
}

module.exports = { generarPropuestas, listarPropuestas, confirmarPropuesta, MAPA_TIPOS, ROLES_POR_TIPO };
