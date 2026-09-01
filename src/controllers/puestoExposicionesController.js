// ============================================================
// Controlador de puesto_exposiciones (fuente de verdad de
// exposiciones por puesto para el motor de aptitud).
// CREADO en Auditoria N.13 (hallazgo CRITICO C-03, P0). Ver
// migration_065 para el detalle de diseno y por que NO se deriva
// automaticamente de puestos_trabajo.factores_riesgo.
//
// Autorizacion: 'sso' (quien tipicamente hace la medicion/
// clasificacion de higiene industrial del puesto) y 'medico' (quien
// consume esta informacion clinicamente y puede necesitar
// corregirla). 'admin' queda excluido a proposito, mismo criterio ya
// aplicado al motor de aptitud: esto alimenta directamente una
// decision clinica, no es configuracion administrativa general.
// ============================================================
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

// ------------------------------------------------------------
// GET /api/puesto-exposiciones/:puestoTrabajoId
// ------------------------------------------------------------
async function listar(req, res) {
  try {
    const puestoRes = await query(
      `SELECT id FROM puestos_trabajo WHERE id = $1 AND organizacion_id = $2`,
      [req.params.puestoTrabajoId, req.usuario.organizacionId]
    );
    if (puestoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Puesto de trabajo no encontrado.' });
    }

    const resultado = await query(
      `SELECT pe.id, pe.exposicion_codigo, ce.nombre, ce.categoria, pe.creado_en
       FROM puesto_exposiciones pe
       LEFT JOIN catalogo_exposiciones ce
         ON ce.codigo = pe.exposicion_codigo AND (ce.organizacion_id IS NULL OR ce.organizacion_id = pe.organizacion_id)
       WHERE pe.puesto_trabajo_id = $1 AND pe.organizacion_id = $2
       ORDER BY pe.creado_en ASC`,
      [req.params.puestoTrabajoId, req.usuario.organizacionId]
    );
    return res.json({ exposiciones: resultado.rows });
  } catch (err) {
    console.error('Error en listar (puesto_exposiciones):', err);
    return res.status(500).json({ error: 'Error interno al listar las exposiciones del puesto.' });
  }
}

// ------------------------------------------------------------
// PUT /api/puesto-exposiciones/:puestoTrabajoId
// Reemplaza el conjunto completo de exposiciones declaradas para un
// puesto (mas simple y menos propenso a error que POST/DELETE
// individuales para un catalogo tipicamente pequeño por puesto).
// ------------------------------------------------------------
async function reemplazar(req, res) {
  const { exposicionCodigos } = req.body;
  if (!Array.isArray(exposicionCodigos)) {
    return res.status(400).json({ error: 'exposicionCodigos debe ser un arreglo de codigos.' });
  }

  try {
    const puestoRes = await query(
      `SELECT id FROM puestos_trabajo WHERE id = $1 AND organizacion_id = $2`,
      [req.params.puestoTrabajoId, req.usuario.organizacionId]
    );
    if (puestoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Puesto de trabajo no encontrado.' });
    }

    // Valida que cada codigo exista en el catalogo (global o de la
    // organizacion) y este activo -- no se acepta un codigo
    // arbitrario que el motor de aptitud despues no reconoceria.
    if (exposicionCodigos.length > 0) {
      const validos = await query(
        `SELECT DISTINCT codigo FROM catalogo_exposiciones
         WHERE activo = true AND (organizacion_id IS NULL OR organizacion_id = $1) AND codigo = ANY($2::text[])`,
        [req.usuario.organizacionId, exposicionCodigos]
      );
      const codigosValidos = new Set(validos.rows.map((r) => r.codigo));
      const invalidos = exposicionCodigos.filter((c) => !codigosValidos.has(c));
      if (invalidos.length > 0) {
        return res.status(400).json({ error: `Codigos de exposicion no reconocidos o inactivos: ${invalidos.join(', ')}.` });
      }
    }

    const resultado = await withTransaction(async (client) => {
      await client.query(
        `DELETE FROM puesto_exposiciones WHERE puesto_trabajo_id = $1 AND organizacion_id = $2`,
        [req.params.puestoTrabajoId, req.usuario.organizacionId]
      );
      for (const codigo of exposicionCodigos) {
        await client.query(
          `INSERT INTO puesto_exposiciones (organizacion_id, puesto_trabajo_id, exposicion_codigo, creado_por)
           VALUES ($1,$2,$3,$4)`,
          [req.usuario.organizacionId, req.params.puestoTrabajoId, codigo, req.usuario.id]
        );
      }

      await registrarAuditoria({
        organizacionId: req.usuario.organizacionId,
        usuarioId: req.usuario.id,
        accion: 'puesto_exposiciones_actualizadas',
        entidad: 'puesto_exposiciones',
        entidadId: req.params.puestoTrabajoId,
        detalle: { exposicionCodigos },
        req,
        client,
      });

      return client.query(
        `SELECT exposicion_codigo FROM puesto_exposiciones WHERE puesto_trabajo_id = $1 AND organizacion_id = $2`,
        [req.params.puestoTrabajoId, req.usuario.organizacionId]
      );
    });

    return res.json({ exposiciones: resultado.rows.map((r) => r.exposicion_codigo) });
  } catch (err) {
    console.error('Error en reemplazar (puesto_exposiciones):', err);
    return res.status(500).json({ error: 'Error interno al actualizar las exposiciones del puesto.' });
  }
}

module.exports = { listar, reemplazar };
