// ============================================================
// Controlador de superadmin: gestion de TODAS las empresas
// clientes y sus administradores. Solo accesible por el rol
// 'superadmin' (el dueno de la plataforma SISSO).
// ============================================================
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { rotarSecretosMfaLegados } = require('../utils/mfaLegado');

const SALT_ROUNDS = 12;

function generarCodigoOrganizacion() {
  const sufijo = uuidv4().split('-')[0].toUpperCase();
  return `SISSO-${sufijo}`;
}

function generarPasswordTemporal() {
  // Genera una contrasena temporal legible, ej: "Tigre-Rio-4821".
  // CORREGIDO tras auditoria de seguridad: la version anterior
  // ("Palabra-NNNN", 8 palabras x 9000 numeros = ~72 mil
  // combinaciones) era mas debil de lo deseable para una contrasena
  // temporal de un sistema con datos clinicos, aunque el bloqueo de
  // cuenta tras 5 intentos fallidos ya mitigaba el riesgo de fuerza
  // bruta online. Se agrega una segunda palabra (usando
  // crypto.randomInt para ambos indices, no Math.random) para subir
  // el espacio de busqueda a mas de 500 mil combinaciones. Sigue
  // siendo de un solo uso y de vida corta: requiere_cambio_password
  // obliga a reemplazarla en el primer login.
  const palabras = ['Tigre', 'Andes', 'Quito', 'Cobre', 'Rio', 'Sol', 'Monte', 'Luna'];
  const palabra1 = palabras[crypto.randomInt(0, palabras.length)];
  let palabra2 = palabras[crypto.randomInt(0, palabras.length)];
  while (palabra2 === palabra1) {
    palabra2 = palabras[crypto.randomInt(0, palabras.length)];
  }
  const numero = crypto.randomInt(1000, 9999);
  return `${palabra1}-${palabra2}-${numero}`;
}

// ------------------------------------------------------------
// GET /api/superadmin/empresas
// Lista todas las organizaciones con su(s) administrador(es).
// CORREGIDO: ahora incluye tambien el estado de suscripcion/plan,
// para que el superadmin vea de un vistazo quien esta en trial,
// activo, vencido o suspendido.
// ------------------------------------------------------------
async function listarEmpresas(req, res) {
  try {
    const resultado = await query(
      `SELECT
        o.id, o.nombre, o.codigo, o.ruc_nit, o.plan, o.activa, o.creado_en,
        o.estado_suscripcion, o.fecha_fin_trial, o.fecha_proxima_renovacion,
        o.suspendida_manualmente, o.motivo_suspension,
        p.codigo AS plan_codigo, p.nombre AS plan_nombre, p.precio_mensual_usd,
        COALESCE(
          json_agg(
            json_build_object('id', u.id, 'nombre_completo', u.nombre_completo, 'email', u.email, 'activo', u.activo, 'ultimo_login', u.ultimo_login)
          ) FILTER (WHERE u.id IS NOT NULL AND u.rol = 'admin'),
          '[]'
        ) AS administradores
       FROM organizaciones o
       LEFT JOIN planes p ON p.id = o.plan_id
       LEFT JOIN usuarios u ON u.organizacion_id = o.id AND u.rol = 'admin'
       GROUP BY o.id, p.codigo, p.nombre, p.precio_mensual_usd
       ORDER BY o.creado_en DESC`
    );
    return res.json({ empresas: resultado.rows });
  } catch (err) {
    console.error('Error en listarEmpresas:', err);
    return res.status(500).json({ error: 'Error interno al listar empresas.' });
  }
}

// ------------------------------------------------------------
// POST /api/superadmin/empresas
// Crea una empresa nueva + su primer usuario administrador.
// Reemplaza el registro publico (que se elimino por seguridad).
// CORREGIDO: ahora asigna un plan real del catalogo y arranca un
// trial de 14 dias (en vez del campo de texto libre 'gratis' sin
// fecha de vencimiento que existia antes).
// ------------------------------------------------------------
async function crearEmpresa(req, res) {
  const { nombreEmpresa, rucNit, nombreAdmin, email, planCodigo } = req.body;

  if (!nombreEmpresa || !nombreAdmin || !email) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: nombreEmpresa, nombreAdmin, email.' });
  }

  const passwordTemporal = generarPasswordTemporal();

  try {
    const resultado = await withTransaction(async (client) => {
      const codigo = generarCodigoOrganizacion();

      const planRes = await client.query(
        `SELECT id FROM planes WHERE codigo = $1 AND activo = true`,
        [planCodigo || 'inicial']
      );
      const planId = planRes.rows[0] ? planRes.rows[0].id : null;

      const hoy = new Date().toISOString().slice(0, 10);
      const finTrial = new Date();
      finTrial.setDate(finTrial.getDate() + 14);

      const orgRes = await client.query(
        `INSERT INTO organizaciones (nombre, codigo, ruc_nit, plan, plan_id, estado_suscripcion, fecha_inicio_trial, fecha_fin_trial)
         VALUES ($1, $2, $3, $4, $5, 'trial', $6, $7)
         RETURNING id, nombre, codigo, plan, estado_suscripcion, fecha_fin_trial`,
        [nombreEmpresa, codigo, rucNit || null, planCodigo || 'inicial', planId, hoy, finTrial.toISOString().slice(0, 10)]
      );
      const organizacion = orgRes.rows[0];

      const passwordHash = await bcrypt.hash(passwordTemporal, SALT_ROUNDS);

      const userRes = await client.query(
        `INSERT INTO usuarios (organizacion_id, email, password_hash, nombre_completo, rol)
         VALUES ($1, $2, $3, $4, 'admin')
         RETURNING id, email, nombre_completo, rol`,
        [organizacion.id, email.toLowerCase().trim(), passwordHash, nombreAdmin]
      );

      return { organizacion, usuario: userRes.rows[0] };
    });

    await registrarAuditoria({
      organizacionId: resultado.organizacion.id,
      usuarioId: req.usuario.id,
      accion: 'empresa_creada_por_superadmin',
      entidad: 'organizacion',
      entidadId: resultado.organizacion.id,
      detalle: { nombreEmpresa, creadoPorSuperadmin: req.usuario.id },
      req,
    });

    return res.status(201).json({
      mensaje: 'Empresa creada con exito. Trial de 14 dias iniciado.',
      organizacion: resultado.organizacion,
      usuarioAdmin: resultado.usuario,
      passwordTemporal, // Se muestra UNA SOLA VEZ; el superadmin debe comunicarla al cliente.
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe una organizacion o usuario con esos datos.' });
    }
    console.error('Error en crearEmpresa:', err);
    return res.status(500).json({ error: 'Error interno al crear la empresa.' });
  }
}

// ------------------------------------------------------------
// PATCH /api/superadmin/usuarios/:id/estado
// Activa o desactiva el acceso de un administrador (o cualquier
// usuario) de una empresa cliente. No elimina datos, solo
// bloquea el login.
// ------------------------------------------------------------
async function cambiarEstadoUsuario(req, res) {
  const { activo } = req.body;
  if (typeof activo !== 'boolean') {
    return res.status(400).json({ error: 'El campo "activo" debe ser true o false.' });
  }

  try {
    const resultado = await query(
      `UPDATE usuarios SET activo = $1 WHERE id = $2 AND rol != 'superadmin'
       RETURNING id, email, nombre_completo, rol, organizacion_id, activo`,
      [activo, req.params.id]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    // CORREGIDO tras auditoria de seguridad (hallazgo GRAVE G2): antes
    // desactivar un usuario solo le impedia iniciar sesion de nuevo
    // (el chequeo de `activo` en login()), pero cualquier sesion que
    // YA tuviera abierta (accessToken vigente hasta 15 min, y sobre
    // todo el refreshToken de 7 dias) seguia funcionando con total
    // normalidad. Un empleado despedido o una cuenta comprometida
    // podia seguir usando el sistema hasta que su refresh token
    // expirara por su cuenta. Ahora, desactivar revoca de inmediato
    // TODAS las familias de refresh token del usuario, forzando el
    // cierre de sesion en cualquier dispositivo la proxima vez que
    // intente renovar su access token (a mas tardar en 15 minutos).
    if (!activo) {
      await query('UPDATE refresh_tokens SET revocado = true WHERE usuario_id = $1', [resultado.rows[0].id]);
    }

    await registrarAuditoria({
      organizacionId: resultado.rows[0].organizacion_id,
      usuarioId: req.usuario.id,
      accion: activo ? 'usuario_reactivado_por_superadmin' : 'usuario_desactivado_por_superadmin',
      entidad: 'usuario',
      entidadId: resultado.rows[0].id,
      req,
    });

    return res.json({ usuario: resultado.rows[0] });
  } catch (err) {
    console.error('Error en cambiarEstadoUsuario:', err);
    return res.status(500).json({ error: 'Error interno al cambiar el estado del usuario.' });
  }
}

// ------------------------------------------------------------
// POST /api/superadmin/usuarios/:id/resetear-password
// Genera una nueva contrasena temporal para un admin que la
// perdio, y la devuelve UNA SOLA VEZ en la respuesta.
// ------------------------------------------------------------
async function resetearPassword(req, res) {
  const passwordTemporal = generarPasswordTemporal();

  try {
    const passwordHash = await bcrypt.hash(passwordTemporal, SALT_ROUNDS);
    const resultado = await query(
      `UPDATE usuarios SET password_hash = $1, intentos_fallidos = 0, bloqueado_hasta = NULL
       WHERE id = $2 AND rol != 'superadmin'
       RETURNING id, email, nombre_completo, organizacion_id`,
      [passwordHash, req.params.id]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    await registrarAuditoria({
      organizacionId: resultado.rows[0].organizacion_id,
      usuarioId: req.usuario.id,
      accion: 'password_reseteado_por_superadmin',
      entidad: 'usuario',
      entidadId: resultado.rows[0].id,
      req,
    });

    return res.json({ usuario: resultado.rows[0], passwordTemporal });
  } catch (err) {
    console.error('Error en resetearPassword:', err);
    return res.status(500).json({ error: 'Error interno al resetear la contrasena.' });
  }
}

// ------------------------------------------------------------
// PATCH /api/superadmin/empresas/:id/suspension
// CORRIGE el punto 1.b reportado: hasta ahora solo se podia
// desactivar un administrador a la vez (cambiarEstadoUsuario). Si
// una empresa terminaba su contrato, el resto de sus usuarios
// (medico, sso, th) seguian con acceso total al sistema. Este
// endpoint apaga la organizacion COMPLETA de un solo boton:
//   - organizaciones.activa = false (el login YA lo valida)
//   - suspendida_manualmente = true (distingue de un simple
//     vencimiento de pago -- una reactivacion automatica por pago
//     nunca debe pisar esto)
//   - revoca DE INMEDIATO todos los refresh tokens de TODOS los
//     usuarios de la organizacion (no solo bloquea logins futuros;
//     mismo criterio ya aplicado a nivel de usuario individual
//     tras el hallazgo GRAVE G2 de la auditoria de seguridad)
// ------------------------------------------------------------
async function cambiarSuspensionOrganizacion(req, res) {
  const { suspender, motivo } = req.body;
  if (typeof suspender !== 'boolean') {
    return res.status(400).json({ error: 'El campo "suspender" debe ser true o false.' });
  }

  try {
    const resultado = await withTransaction(async (client) => {
      const orgRes = await client.query(
        `UPDATE organizaciones SET
           activa = $1,
           suspendida_manualmente = $1,
           motivo_suspension = $2,
           estado_suscripcion = CASE WHEN $1 THEN 'suspendida' ELSE estado_suscripcion END
         WHERE id = $3
         RETURNING id, nombre, activa, suspendida_manualmente, estado_suscripcion`,
        [suspender, suspender ? (motivo || 'Suspendida por el superadmin.') : null, req.params.id]
      );
      if (orgRes.rows.length === 0) return null;

      if (suspender) {
        // Revoca TODAS las sesiones activas de TODA la organizacion,
        // no solo la del administrador.
        await client.query(
          `UPDATE refresh_tokens SET revocado = true
           WHERE usuario_id IN (SELECT id FROM usuarios WHERE organizacion_id = $1)`,
          [req.params.id]
        );
      }

      return orgRes.rows[0];
    });

    if (!resultado) {
      return res.status(404).json({ error: 'Organizacion no encontrada.' });
    }

    await registrarAuditoria({
      organizacionId: resultado.id,
      usuarioId: req.usuario.id,
      accion: suspender ? 'organizacion_suspendida_por_superadmin' : 'organizacion_reactivada_por_superadmin',
      entidad: 'organizacion',
      entidadId: resultado.id,
      detalle: { motivo: motivo || null },
      req,
    });

    return res.json({ organizacion: resultado });
  } catch (err) {
    console.error('Error en cambiarSuspensionOrganizacion:', err);
    return res.status(500).json({ error: 'Error interno al cambiar la suspension de la organizacion.' });
  }
}

// ------------------------------------------------------------
// PATCH /api/superadmin/empresas/:id/plan
// Asigna o cambia el plan de una organizacion. No modifica el
// estado de suscripcion (eso lo maneja el pago o la suspension
// manual) -- solo el plan al que esta o quedara sujeta.
// ------------------------------------------------------------
async function asignarPlan(req, res) {
  const { planCodigo } = req.body;
  if (!['inicial', 'crecimiento', 'corporativo'].includes(planCodigo)) {
    return res.status(400).json({ error: 'planCodigo invalido.' });
  }

  try {
    const planRes = await query(`SELECT id FROM planes WHERE codigo = $1 AND activo = true`, [planCodigo]);
    if (planRes.rows.length === 0) {
      return res.status(404).json({ error: 'Plan no encontrado.' });
    }

    const actualizadaRes = await query(
      `UPDATE organizaciones SET plan = $1, plan_id = $2 WHERE id = $3 RETURNING id, nombre, plan`,
      [planCodigo, planRes.rows[0].id, req.params.id]
    );
    if (actualizadaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Organizacion no encontrada.' });
    }

    await registrarAuditoria({
      organizacionId: req.params.id, usuarioId: req.usuario.id, accion: 'organizacion_plan_cambiado',
      entidad: 'organizacion', entidadId: req.params.id, detalle: { planCodigo }, req,
    });

    return res.json({ organizacion: actualizadaRes.rows[0] });
  } catch (err) {
    console.error('Error en asignarPlan:', err);
    return res.status(500).json({ error: 'Error interno al asignar el plan.' });
  }
}

// ------------------------------------------------------------
// POST /api/superadmin/mfa/rotar-legado
//
// CORRIGE el hallazgo CRITICO C-N07-01 de la Auditoria Integral
// SISSO N.07: fuerza la rotacion de cualquier secreto MFA que haya
// quedado en texto plano (cuentas que nunca volvieron a iniciar
// sesion desde la migracion 029/AES-256-GCM). Ver
// src/utils/mfaLegado.js para el detalle de por que un simple
// re-cifrado en el lugar no es suficiente.
//
// Idempotente: si se ejecuta de nuevo y ya no quedan secretos
// heredados, devuelve una lista vacia sin efecto.
// ------------------------------------------------------------
async function rotarMfaLegado(req, res) {
  try {
    const { totalRevisadas, afectadas } = await rotarSecretosMfaLegados({
      actorUsuarioId: req.usuario.id,
      req,
    });
    return res.json({
      totalRevisadas,
      cuentasRotadas: afectadas.length,
      afectadas,
      mensaje: afectadas.length > 0
        ? 'Notifique a cada cuenta listada que su MFA quedo invalidado y debe reconfigurarlo (escanear un QR nuevo) en su proximo inicio de sesion.'
        : 'No se encontraron secretos MFA heredados en texto plano.',
    });
  } catch (err) {
    console.error('Error en rotarMfaLegado:', err);
    return res.status(500).json({ error: 'Error interno al rotar los secretos MFA heredados.' });
  }
}

module.exports = {
  listarEmpresas, crearEmpresa, cambiarEstadoUsuario, resetearPassword,
  cambiarSuspensionOrganizacion, asignarPlan, rotarMfaLegado,
};
