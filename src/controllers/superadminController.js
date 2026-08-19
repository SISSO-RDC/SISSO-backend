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
// ------------------------------------------------------------
async function listarEmpresas(req, res) {
  try {
    const resultado = await query(
      `SELECT
        o.id, o.nombre, o.codigo, o.ruc_nit, o.plan, o.activa, o.creado_en,
        COALESCE(
          json_agg(
            json_build_object('id', u.id, 'nombre_completo', u.nombre_completo, 'email', u.email, 'activo', u.activo, 'ultimo_login', u.ultimo_login)
          ) FILTER (WHERE u.id IS NOT NULL AND u.rol = 'admin'),
          '[]'
        ) AS administradores
       FROM organizaciones o
       LEFT JOIN usuarios u ON u.organizacion_id = o.id AND u.rol = 'admin'
       GROUP BY o.id
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
// ------------------------------------------------------------
async function crearEmpresa(req, res) {
  const { nombreEmpresa, rucNit, nombreAdmin, email, plan } = req.body;

  if (!nombreEmpresa || !nombreAdmin || !email) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: nombreEmpresa, nombreAdmin, email.' });
  }

  const passwordTemporal = generarPasswordTemporal();

  try {
    const resultado = await withTransaction(async (client) => {
      const codigo = generarCodigoOrganizacion();

      const orgRes = await client.query(
        `INSERT INTO organizaciones (nombre, codigo, ruc_nit, plan)
         VALUES ($1, $2, $3, $4) RETURNING id, nombre, codigo, plan`,
        [nombreEmpresa, codigo, rucNit || null, plan || 'gratis']
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
      mensaje: 'Empresa creada con exito.',
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

module.exports = { listarEmpresas, crearEmpresa, cambiarEstadoUsuario, resetearPassword };
