// ============================================================
// Controlador de "Mi Empresa": perfil de la organizacion del
// usuario autenticado. Solo admin puede ver/editar (ver
// layout.js: roles: ['admin']).
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { subirEvidencia, borrarEvidencia } = require('../servicios/cloudinaryService');

const CARPETA_LOGOS = 'sisso/logos-empresa';

// ------------------------------------------------------------
// GET /api/organizacion
// Perfil completo + un resumen rapido (trabajadores/usuarios
// activos) util para la pantalla de "Mi Empresa".
// ------------------------------------------------------------
async function obtenerPerfil(req, res) {
  try {
    const orgRes = await query(
      `SELECT id, nombre, codigo, ruc_nit, plan, activa,
              direccion, telefono, email_contacto,
              actividad_economica_ciiu, actividad_economica_desc,
              representante_legal, responsable_sst_nombre, responsable_sst_cargo,
              responsable_medico_nombre, responsable_medico_cargo,
              responsable_th_nombre, responsable_th_cargo,
              logo_url, creado_en
       FROM organizaciones WHERE id = $1`,
      [req.usuario.organizacionId]
    );
    if (orgRes.rows.length === 0) {
      return res.status(404).json({ error: 'Organizacion no encontrada.' });
    }

    const resumenRes = await query(
      `SELECT
        (SELECT count(*) FROM trabajadores WHERE organizacion_id = $1 AND activo = true) AS trabajadores_activos,
        (SELECT count(*) FROM usuarios WHERE organizacion_id = $1 AND activo = true) AS usuarios_activos,
        (SELECT count(*) FROM puestos_trabajo WHERE organizacion_id = $1 AND activo = true) AS puestos_trabajo`,
      [req.usuario.organizacionId]
    );

    return res.json({ organizacion: orgRes.rows[0], resumen: resumenRes.rows[0] });
  } catch (err) {
    console.error('Error en obtenerPerfil (mi empresa):', err);
    return res.status(500).json({ error: 'Error interno al obtener el perfil de la organizacion.' });
  }
}

// ------------------------------------------------------------
// PUT /api/organizacion
// No permite cambiar nombre/codigo/ruc_nit/plan/activa aqui
// deliberadamente: esos campos son de gestion del superadmin
// (crearEmpresa/cambiarEstadoUsuario en superadminController.js),
// no de auto-servicio del admin de la empresa. Este endpoint solo
// toca los campos de perfil/contacto agregados en esta migracion.
// ------------------------------------------------------------
async function actualizarPerfil(req, res) {
  const b = req.body;

  try {
    const resultado = await query(
      `UPDATE organizaciones
       SET direccion = $1, telefono = $2, email_contacto = $3,
           actividad_economica_ciiu = $4, actividad_economica_desc = $5,
           representante_legal = $6, responsable_sst_nombre = $7, responsable_sst_cargo = $8,
           responsable_medico_nombre = $9, responsable_medico_cargo = $10,
           responsable_th_nombre = $11, responsable_th_cargo = $12
       WHERE id = $13
       RETURNING id, nombre, direccion, telefono, email_contacto,
                 actividad_economica_ciiu, actividad_economica_desc,
                 representante_legal, responsable_sst_nombre, responsable_sst_cargo,
                 responsable_medico_nombre, responsable_medico_cargo,
                 responsable_th_nombre, responsable_th_cargo`,
      [
        b.direccion || null, b.telefono || null, b.emailContacto || null,
        b.actividadEconomicaCiiu || null, b.actividadEconomicaDesc || null,
        b.representanteLegal || null, b.responsableSstNombre || null, b.responsableSstCargo || null,
        b.responsableMedicoNombre || null, b.responsableMedicoCargo || null,
        b.responsableThNombre || null, b.responsableThCargo || null,
        req.usuario.organizacionId,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'actualizar_perfil_organizacion',
      entidad: 'organizacion',
      entidadId: req.usuario.organizacionId,
      req,
    });

    return res.json({ organizacion: resultado.rows[0] });
  } catch (err) {
    console.error('Error en actualizarPerfil (mi empresa):', err);
    return res.status(500).json({ error: 'Error interno al actualizar el perfil de la organizacion.' });
  }
}

// ------------------------------------------------------------
// PUT /api/organizacion/logo
// Sube (o reemplaza) el logo institucional, usado en los PDFs
// generados por el sistema (consentimientos, certificados,
// historia clinica).
// ------------------------------------------------------------
async function actualizarLogo(req, res) {
  const { logoBase64 } = req.body;

  if (!logoBase64 || typeof logoBase64 !== 'string' || !logoBase64.startsWith('data:image')) {
    return res.status(400).json({ error: 'logoBase64 es obligatorio, en formato data URI de imagen.' });
  }

  try {
    const actualRes = await query(`SELECT logo_public_id FROM organizaciones WHERE id = $1`, [req.usuario.organizacionId]);
    const publicIdAnterior = actualRes.rows[0]?.logo_public_id;

    // CORREGIDO (hallazgo G12): el logo se sube como recurso PUBLICO
    // a proposito (privado: false) — es la unica excepcion, ver nota
    // completa en cloudinaryService.js. No es informacion sensible y
    // necesita mostrarse en <img> sin pasar por el backend.
    const logo = await subirEvidencia(logoBase64, req.usuario.organizacionId, CARPETA_LOGOS, { privado: false });

    const resultado = await query(
      `UPDATE organizaciones SET logo_url = $1, logo_public_id = $2 WHERE id = $3
       RETURNING id, logo_url`,
      [logo.url, logo.publicId, req.usuario.organizacionId]
    );

    // Se borra el logo anterior DESPUES de confirmar que el nuevo
    // se guardo bien, para no quedarnos sin logo si algo falla.
    if (publicIdAnterior) {
      try { await borrarEvidencia(publicIdAnterior, 'image', { privado: false }); }
      catch (err) { console.error('No se pudo borrar el logo anterior de Cloudinary (no critico):', err.message); }
    }

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'actualizar_logo_organizacion',
      entidad: 'organizacion',
      entidadId: req.usuario.organizacionId,
      req,
    });

    return res.json({ organizacion: resultado.rows[0] });
  } catch (err) {
    console.error('Error en actualizarLogo (mi empresa):', err);
    return res.status(500).json({ error: 'Error interno al actualizar el logo.' });
  }
}

module.exports = { obtenerPerfil, actualizarPerfil, actualizarLogo };
