// ============================================================
// Controlador de Examenes de la Organizacion (catalogo real, ver
// migration_087_materializacion_examenes.sql).
//
// CREADO en Auditoria N.17 (C-17-03, quinto tipo materializado).
// Es el catalogo del PROTOCOLO de examenes periodicos que la
// organizacion reconoce como aplicables -- NO son registros
// clinicos de examenes ya realizados (eso sigue siendo
// audiometria/espirometria/visiometria/historia_clinica).
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

// ------------------------------------------------------------
// GET /api/examenes-organizacion
// ------------------------------------------------------------
async function listar(req, res) {
  try {
    const resultado = await query(
      // N.18 (G18-05 / M18-10): la referencia normativa se entrega SIEMPRE con su
      // estado de verificacion y su vigencia calculada, para que ninguna
      // pantalla presente una sugerencia sectorial como si fuera norma.
      `SELECT e.id, e.nombre, e.tipo, e.frecuencia, e.norma_referencia, e.activo, e.origen, e.creado_en,
              e.estado_verificacion, e.fuente_norma, e.jurisdiccion, e.articulo_referencia,
              e.fecha_validacion, e.vigente_hasta, e.verificado_en,
              CASE
                WHEN e.estado_verificacion <> 'verificada' THEN 'no_verificada'
                WHEN e.vigente_hasta IS NOT NULL AND e.vigente_hasta < CURRENT_DATE THEN 'verificada_vencida'
                ELSE 'verificada_vigente'
              END AS vigencia_norma,
              u.nombre_completo AS creado_por_nombre,
              uv.nombre_completo AS verificado_por_nombre
       FROM examenes_organizacion e
       LEFT JOIN usuarios u ON u.id = e.creado_por
       LEFT JOIN usuarios uv ON uv.id = e.verificado_por
       WHERE e.organizacion_id = $1
       ORDER BY e.nombre`,
      [req.usuario.organizacionId]
    );
    return res.json({ examenes: resultado.rows });
  } catch (err) {
    console.error('Error en listar (examenes de la organizacion):', err);
    return res.status(500).json({ error: 'Error interno al listar los exámenes de la organización.' });
  }
}

// ------------------------------------------------------------
// PUT /api/examenes-organizacion/:id/verificacion   (solo medico)
// Auditoria N.18, G18-05. Establece o retira la verificacion formal
// de la norma/frecuencia de un examen del protocolo. Verificar exige
// fuente, jurisdiccion, articulo y fecha de validacion (validador +
// CHECK de base de datos). Solo el medico: relacionar un examen con
// una norma es un criterio medico-ocupacional, no administrativo.
// ------------------------------------------------------------
async function verificarNorma(req, res) {
  const orgId = req.usuario.organizacionId;
  const { id } = req.params;
  const { verificada, fuenteNorma, jurisdiccion, articuloReferencia, fechaValidacion, vigenteHasta, frecuencia } = req.body;

  try {
    const resultado = await withTransaction(async (client) => {
      const actual = await client.query(
        `SELECT id, estado_verificacion FROM examenes_organizacion WHERE id = $1 AND organizacion_id = $2 FOR UPDATE`,
        [id, orgId]
      );
      if (actual.rows.length === 0) return null;

      const actualizado = verificada
        ? await client.query(
          `UPDATE examenes_organizacion
              SET estado_verificacion = 'verificada', fuente_norma = $3, jurisdiccion = $4,
                  articulo_referencia = $5, fecha_validacion = $6, vigente_hasta = $7,
                  frecuencia = COALESCE($8, frecuencia),
                  norma_referencia = $9, verificado_por = $10, verificado_en = now()
            WHERE id = $1 AND organizacion_id = $2
            RETURNING id, nombre, estado_verificacion, fuente_norma, jurisdiccion, articulo_referencia,
                      fecha_validacion, vigente_hasta, frecuencia, norma_referencia, verificado_en`,
          [id, orgId, fuenteNorma, jurisdiccion, articuloReferencia, fechaValidacion, vigenteHasta || null,
            frecuencia || null, `${fuenteNorma}, ${articuloReferencia}`.slice(0, 150), req.usuario.id]
        )
        : await client.query(
          `UPDATE examenes_organizacion
              SET estado_verificacion = 'no_verificada', fuente_norma = NULL, jurisdiccion = NULL,
                  articulo_referencia = NULL, fecha_validacion = NULL, vigente_hasta = NULL,
                  norma_referencia = NULL, verificado_por = NULL, verificado_en = NULL
            WHERE id = $1 AND organizacion_id = $2
            RETURNING id, nombre, estado_verificacion, frecuencia`,
          [id, orgId]
        );

      await registrarAuditoria({
        organizacionId: orgId,
        usuarioId: req.usuario.id,
        accion: verificada ? 'verificar_norma_examen' : 'retirar_verificacion_norma_examen',
        entidad: 'examenes_organizacion',
        entidadId: id,
        detalle: verificada
          ? { fuenteNorma, jurisdiccion, articuloReferencia, fechaValidacion, vigenteHasta: vigenteHasta || null }
          : { estadoAnterior: actual.rows[0].estado_verificacion },
        req,
        client,
      });
      return actualizado.rows[0];
    });

    if (!resultado) return res.status(404).json({ error: 'Examen no encontrado.' });
    return res.json({ examen: resultado });
  } catch (err) {
    console.error('Error en verificarNorma (examenes de la organizacion):', err);
    return res.status(500).json({ error: 'Error interno al registrar la verificación de la norma.' });
  }
}

module.exports = { listar, verificarNorma };
