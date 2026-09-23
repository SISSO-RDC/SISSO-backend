// ============================================================
// Controlador de "Mi Empresa": perfil de la organizacion del
// usuario autenticado. Solo admin puede ver/editar (ver
// layout.js: roles: ['admin']).
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { analizarDataUri } = require('../utils/validarArchivo');
const { subirEvidencia, borrarEvidencia } = require('../servicios/cloudinaryService');
const QRCode = require('qrcode');

const CARPETA_LOGOS = 'sisso/logos-empresa';

// Base publica del frontend, para armar el enlace del canal de
// reporte de peligro (Lote 1, Sep 2026). FRONTEND_URL es opcional:
// si no se define, se usa el primer origen de CORS_ORIGINS -- esa
// variable YA es obligatoria en produccion (ver src/index.js) y
// representa exactamente el mismo dominio (el frontend de GitHub
// Pages). Se documenta como opcional en .env.example para cubrir el
// caso, hoy hipotetico, de que el frontend viva en un dominio propio
// distinto de los origenes CORS permitidos.
function baseFrontend() {
  const explicita = (process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
  if (explicita) return explicita;
  const primerOrigenCors = (process.env.CORS_ORIGINS || '').split(',')[0].trim().replace(/\/+$/, '');
  return primerOrigenCors || null;
}

// ------------------------------------------------------------
// GET /api/organizacion
// Perfil completo + un resumen rapido (trabajadores/usuarios
// activos) util para la pantalla de "Mi Empresa".
// ------------------------------------------------------------
async function obtenerPerfil(req, res) {
  try {
    const orgRes = await query(
      `SELECT o.id, o.nombre, o.codigo, o.ruc_nit, o.plan, o.activa,
              o.direccion, o.telefono, o.email_contacto,
              o.actividad_economica_ciiu, o.actividad_economica_desc,
              o.representante_legal, o.responsable_sst_nombre, o.responsable_sst_cargo,
              o.responsable_medico_nombre, o.responsable_medico_cargo,
              o.responsable_th_nombre, o.responsable_th_cargo,
              o.logo_url, o.creado_en,
              o.sector_empresarial_clave, o.numero_trabajadores_declarado,
              o.riesgos_presentes, o.configuracion_sectorial_aplicada_en,
              o.pais_normativo_clave,
              s.etiqueta AS sector_etiqueta, s.icono AS sector_icono,
              s.color_acento AS sector_color_acento,
              p.nombre AS pais_nombre, p.bandera_emoji AS pais_bandera,
              p.estado AS pais_estado, p.descripcion_estado AS pais_descripcion_estado,
              p.cobertura_detalle AS pais_cobertura_detalle
       FROM organizaciones o
       LEFT JOIN catalogo_sectores s ON s.clave = o.sector_empresarial_clave
       LEFT JOIN catalogo_paises_normativos p ON p.clave = o.pais_normativo_clave
       WHERE o.id = $1`,
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

  if (!logoBase64 || typeof logoBase64 !== 'string') {
    return res.status(400).json({ error: 'logoBase64 es obligatorio, en formato data URI de imagen.' });
  }
  // G19-11 (Auditoria N.19): el logo es PUBLICO; solo PNG/JPEG/WebP, con tope de tamano.
  const chkLogo = analizarDataUri(logoBase64, 'logo');
  if (!chkLogo.ok) return res.status(400).json({ error: `logoBase64 invalido: ${chkLogo.motivo}` });

  try {
    const actualRes = await query(`SELECT logo_public_id FROM organizaciones WHERE id = $1`, [req.usuario.organizacionId]);
    const publicIdAnterior = actualRes.rows[0]?.logo_public_id;

    // CORREGIDO (hallazgo G12): el logo se sube como recurso PUBLICO
    // a proposito (privado: false) — es la unica excepcion, ver nota
    // completa en cloudinaryService.js. No es informacion sensible y
    // necesita mostrarse en <img> sin pasar por el backend.
    const logo = await subirEvidencia(logoBase64, req.usuario.organizacionId, CARPETA_LOGOS, { privado: false, politica: 'logo' });

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

// ------------------------------------------------------------
// PUT /api/organizacion/perfil-sectorial
// Paso final (Fase 3, "Confirmacion de configuracion") del
// configurador inteligente de "Mi Empresa". Guarda el sector
// elegido, el numero de trabajadores declarado en el asistente y
// los riesgos sugeridos por el sector que el usuario confirmo como
// presentes -- solo se ejecuta cuando el usuario aprieta
// "Aplicar configuracion" en el paso 6, nunca automaticamente.
//
// No sobrescribe actividad_economica_ciiu/desc si el asistente no
// los trae (COALESCE): esos campos ya existen desde antes (perfil
// basico, migration_023) y este endpoint solo los toca si el
// usuario los edito en el paso 2 del asistente.
// ------------------------------------------------------------
async function aplicarConfiguracionSectorial(req, res) {
  const b = req.body;

  try {
    const sectorRes = await query(
      `SELECT clave, etiqueta FROM catalogo_sectores WHERE clave = $1 AND activo = true`,
      [b.sectorClave]
    );
    if (sectorRes.rows.length === 0) {
      return res.status(400).json({ error: 'El sector seleccionado no existe o no esta disponible.' });
    }

    // Lote C (Fase 4): el pais normativo es opcional en este endpoint
    // -- si no se envia, se conserva el que ya tenia la organizacion
    // (por defecto 'ecuador' desde migration_080). Igual que con el
    // sector, solo se valida que exista y este activo en el
    // catalogo; un pais en estado 'en_desarrollo' es perfectamente
    // seleccionable (esa es justamente la Fase 4: registrar la
    // preferencia SIN declarar que ya hay reglas especificas
    // implementadas para ese pais).
    let paisNormativoClave = null;
    if (b.paisNormativoClave) {
      const paisRes = await query(
        `SELECT clave FROM catalogo_paises_normativos WHERE clave = $1 AND activo = true`,
        [b.paisNormativoClave]
      );
      if (paisRes.rows.length === 0) {
        return res.status(400).json({ error: 'El país seleccionado no existe o no está disponible en el catálogo.' });
      }
      paisNormativoClave = b.paisNormativoClave;
    }

    const resultado = await query(
      `UPDATE organizaciones
       SET sector_empresarial_clave = $1,
           numero_trabajadores_declarado = $2,
           riesgos_presentes = $3::jsonb,
           actividad_economica_ciiu = COALESCE($4, actividad_economica_ciiu),
           actividad_economica_desc = COALESCE($5, actividad_economica_desc),
           pais_normativo_clave = COALESCE($6, pais_normativo_clave),
           configuracion_sectorial_aplicada_en = now()
       WHERE id = $7
       RETURNING id, sector_empresarial_clave, numero_trabajadores_declarado,
                 riesgos_presentes, pais_normativo_clave, configuracion_sectorial_aplicada_en`,
      [
        b.sectorClave,
        b.numeroTrabajadoresDeclarado ?? null,
        JSON.stringify(Array.isArray(b.riesgosPresentes) ? b.riesgosPresentes : []),
        b.actividadEconomicaCiiu || null,
        b.actividadEconomicaDesc || null,
        paisNormativoClave,
        req.usuario.organizacionId,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'aplicar_configuracion_sectorial',
      entidad: 'organizacion',
      entidadId: req.usuario.organizacionId,
      detalle: {
        sectorClave: b.sectorClave,
        numeroTrabajadoresDeclarado: b.numeroTrabajadoresDeclarado ?? null,
        riesgosPresentes: Array.isArray(b.riesgosPresentes) ? b.riesgosPresentes : [],
        paisNormativoClave: paisNormativoClave || '(sin cambio)',
      },
      req,
    });

    return res.json({ organizacion: resultado.rows[0] });
  } catch (err) {
    console.error('Error en aplicarConfiguracionSectorial (mi empresa):', err);
    return res.status(500).json({ error: 'Error interno al aplicar la configuracion sectorial.' });
  }
}

// ------------------------------------------------------------
// GET /api/organizacion/qr-reporte-peligro
// CREADO Lote 1 (plan de cierre de brechas frente a plataformas EHS
// globales, Sep 2026): genera el enlace publico del canal de reporte
// de peligros (ver reportesPeligroController.js:crearPublico) y su
// codigo QR, para que la organizacion pueda imprimirlo y pegarlo en
// planta.
//
// Reutiliza EXACTAMENTE el mismo patron ya probado en produccion
// para el QR de MFA (authController.js: QRCode.toDataURL) -- no se
// escribe ningun encoder de QR propio. No hay riesgo de SSRF: la
// libreria solo codifica el texto de la URL como imagen, nunca la
// visita.
// ------------------------------------------------------------
async function generarQrReportePeligro(req, res) {
  try {
    const orgRes = await query(`SELECT codigo FROM organizaciones WHERE id = $1`, [req.usuario.organizacionId]);
    if (orgRes.rows.length === 0) {
      return res.status(404).json({ error: 'Organizacion no encontrada.' });
    }

    const base = baseFrontend();
    if (!base) {
      return res.status(503).json({ error: 'El enlace publico no esta configurado (falta FRONTEND_URL o CORS_ORIGINS). Contacte al administrador de la plataforma.' });
    }

    const codigo = orgRes.rows[0].codigo;
    const url = `${base}/reporte-peligro/?org=${encodeURIComponent(codigo)}`;
    const qrDataUrl = await QRCode.toDataURL(url);

    return res.json({ url, qrDataUrl });
  } catch (err) {
    console.error('Error en generarQrReportePeligro (mi empresa):', err);
    return res.status(500).json({ error: 'Error interno al generar el codigo QR.' });
  }
}

module.exports = { obtenerPerfil, actualizarPerfil, actualizarLogo, aplicarConfiguracionSectorial, generarQrReportePeligro };
