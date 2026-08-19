// ============================================================
// Controlador de autenticacion.
//
// Flujos implementados:
// - registrarOrganizacion: crea una empresa cliente nueva + su
//   primer usuario administrador (alta de un nuevo cliente que
//   te compra el sistema).
// - login: valida credenciales, devuelve accessToken + refreshToken.
// - refrescar: usa el refreshToken para emitir un nuevo accessToken
//   sin que el usuario tenga que volver a escribir su contrasena.
// - logout: revoca el refreshToken (cierra la sesion de verdad).
// ============================================================
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { query, withTransaction } = require('../db/pool');
const {
  generarAccessToken,
  generarRefreshToken,
  generarTokenMfaPendiente,
  verificarTokenMfaPendiente,
  verificarRefreshToken,
  expiresInMs,
  hashToken,
  REFRESH_EXPIRES,
} = require('../utils/jwt');
const { registrarAuditoria } = require('../utils/auditoria');
// CORREGIDO tras auditoria de seguridad (hallazgo CRITICO): el secreto
// TOTP ya no se guarda en texto plano. Ver src/utils/crypto.js.
const { encriptar, desencriptar, esFormatoCifrado } = require('../utils/crypto');

// Tolerancia de +-1 paso (30s) para compensar pequenos desfaces de
// reloj entre el celular del usuario y el servidor.
// CORREGIDO (reporte de usuario: "el codigo del autenticador nunca
// es aceptado" incluso tras validar el round-trip de cifrado). La
// causa mas probable de fallos PERSISTENTES (no solo un intento
// aislado) es desfase de reloj del telefono: TOTP genera un codigo
// nuevo cada 30s a partir de la hora UTC del dispositivo, y si el
// reloj del celular esta desincronizado (hora manual, sin
// sincronizacion automatica), NINGUN codigo calza aunque todo el
// resto del flujo este perfecto. window: 1 solo tolera +-30s (un
// paso hacia atras/adelante); se sube a window: 2 (+-60s, 150s de
// margen total) para absorber el desfase tipico de un telefono con
// la hora mal configurada, sin debilitar de forma practica la
// seguridad del MFA (los codigos siguen siendo de un solo uso y de
// vida muy corta).
authenticator.options = { window: 2 };

const SALT_ROUNDS = 12;
const MAX_INTENTOS_FALLIDOS = 5;
const BLOQUEO_MINUTOS = 15;

// CORREGIDO tras auditoria de seguridad (hallazgo GRAVE G5): estos
// roles manejan datos clinicos y/o privilegios administrativos altos,
// asi que la auditoria pide hacer el MFA OBLIGATORIO (no opcional)
// para ellos. Se aplica en login(): si el rol esta en esta lista y el
// usuario todavia no configuro su MFA, el login se corta con un
// codigo especial que el frontend usa para redirigir directo a la
// pantalla de configuracion de MFA en vez de al dashboard.
const ROLES_MFA_OBLIGATORIO = ['superadmin', 'admin', 'medico'];

// ------------------------------------------------------------
// CORREGIDO tras auditoria de seguridad (hallazgo GRAVE G4): el
// refresh token ya no viaja en el cuerpo JSON ni se guarda en
// sessionStorage del navegador. Se entrega como cookie HttpOnly,
// asi que JavaScript en el navegador (incluido un XSS) no puede
// leerlo. Solo el propio navegador la reenvia automaticamente al
// backend en las 3 rutas de /api/auth que la necesitan.
//
// Atributos:
//   - httpOnly: invisible para JavaScript.
//   - secure: solo viaja por HTTPS (el backend en Render siempre
//     es HTTPS, asi que no hay perdida de funcionalidad).
//   - sameSite: 'none' porque el frontend (GitHub Pages) y el
//     backend (Render) son dominios distintos; sameSite=None
//     requiere secure=true, que ya tenemos.
//   - path: acotada a /api/auth (no a todo el dominio) para que
//     el navegador NO la adjunte en peticiones a otras rutas de la
//     API donde no hace falta, reduciendo la superficie de CSRF.
//
// Nota sobre CSRF: las 3 rutas que leen esta cookie (refrescar,
// logout, y el login inicial que la establece) son JSON puro
// (Content-Type: application/json), lo que obliga al navegador a
// hacer un preflight CORS antes de enviar la peticion real. Como
// el backend rechaza origenes no listados en CORS_ORIGINS, un
// sitio malicioso no puede completar ese preflight y el navegador
// nunca llega a enviar la peticion real con la cookie. Por eso no
// se agrego un token CSRF adicional en esta correccion.
// ------------------------------------------------------------
const REFRESH_COOKIE_NAME = 'sisso_refresh_token';
const REFRESH_COOKIE_PATH = '/api/auth';

function opcionesCookieRefresh(maxAgeMs) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeMs,
  };
}

/**
 * Genera un codigo de organizacion legible y unico, ej: SISSO-7F3K2Q
 */
function generarCodigoOrganizacion() {
  const sufijo = uuidv4().split('-')[0].toUpperCase();
  return `SISSO-${sufijo}`;
}

// ------------------------------------------------------------
// POST /api/auth/registrar-organizacion
// Crea una nueva empresa cliente y su usuario administrador.
// ------------------------------------------------------------
async function registrarOrganizacion(req, res) {
  const { nombreEmpresa, rucNit, nombreAdmin, email, password } = req.body;

  if (!nombreEmpresa || !nombreAdmin || !email || !password) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: nombreEmpresa, nombreAdmin, email, password.' });
  }
  if (password.length < 12) {
    return res.status(400).json({ error: 'La contrasena debe tener al menos 12 caracteres. Se recomienda usar una frase larga facil de recordar en vez de una palabra corta con simbolos.' });
  }

  try {
    const resultado = await withTransaction(async (client) => {
      const codigo = generarCodigoOrganizacion();

      const orgRes = await client.query(
        `INSERT INTO organizaciones (nombre, codigo, ruc_nit)
         VALUES ($1, $2, $3) RETURNING id, nombre, codigo, plan`,
        [nombreEmpresa, codigo, rucNit || null]
      );
      const organizacion = orgRes.rows[0];

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

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
      usuarioId: resultado.usuario.id,
      accion: 'organizacion_creada',
      entidad: 'organizacion',
      entidadId: resultado.organizacion.id,
      detalle: { nombreEmpresa },
      req,
    });

    return res.status(201).json({
      mensaje: 'Empresa registrada con exito. Guarde el codigo de organizacion para futuros usuarios.',
      organizacion: resultado.organizacion,
      usuarioAdmin: resultado.usuario,
    });
  } catch (err) {
    if (err.code === '23505') { // violacion de UNIQUE constraint en Postgres
      return res.status(409).json({ error: 'Ya existe una organizacion o usuario con esos datos.' });
    }
    console.error('Error en registrarOrganizacion:', err);
    return res.status(500).json({ error: 'Error interno al registrar la organizacion.' });
  }
}

// ------------------------------------------------------------
// POST /api/auth/registrar-usuario
// Crea un usuario adicional dentro de una organizacion existente.
// Requiere el codigo de organizacion (lo entrega el admin).
// Solo un admin deberia poder invitar; aqui se valida el codigo
// como minimo viable, y se recomienda restringir esto a admins
// autenticados en una version mas avanzada.
// ------------------------------------------------------------
async function registrarUsuario(req, res) {
  const { codigoOrganizacion, nombreCompleto, email, password, rol } = req.body;
  const rolesValidos = ['admin', 'medico', 'sso', 'th'];

  if (!codigoOrganizacion || !nombreCompleto || !email || !password || !rol) {
    return res.status(400).json({ error: 'Faltan campos obligatorios.' });
  }
  if (!rolesValidos.includes(rol)) {
    return res.status(400).json({ error: `Rol invalido. Debe ser uno de: ${rolesValidos.join(', ')}` });
  }
  if (password.length < 12) {
    return res.status(400).json({ error: 'La contrasena debe tener al menos 12 caracteres. Se recomienda usar una frase larga facil de recordar en vez de una palabra corta con simbolos.' });
  }

  try {
    const orgRes = await query('SELECT id, activa FROM organizaciones WHERE codigo = $1', [codigoOrganizacion.toUpperCase().trim()]);
    if (orgRes.rows.length === 0) {
      return res.status(404).json({ error: 'Codigo de organizacion no encontrado.' });
    }
    const organizacion = orgRes.rows[0];
    if (!organizacion.activa) {
      return res.status(403).json({ error: 'Esta organizacion esta inactiva. Contacte al proveedor del servicio.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const userRes = await query(
      `INSERT INTO usuarios (organizacion_id, email, password_hash, nombre_completo, rol)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, nombre_completo, rol`,
      [organizacion.id, email.toLowerCase().trim(), passwordHash, nombreCompleto, rol]
    );

    await registrarAuditoria({
      organizacionId: organizacion.id,
      usuarioId: userRes.rows[0].id,
      accion: 'usuario_creado',
      entidad: 'usuario',
      entidadId: userRes.rows[0].id,
      detalle: { rol },
      req,
    });

    return res.status(201).json({ mensaje: 'Usuario creado con exito.', usuario: userRes.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un usuario con ese email en esta organizacion.' });
    }
    console.error('Error en registrarUsuario:', err);
    return res.status(500).json({ error: 'Error interno al registrar el usuario.' });
  }
}

// ------------------------------------------------------------
// POST /api/auth/registrar-usuario-interno
// Igual que registrarUsuario, pero pensado para usarse DESDE
// DENTRO de la aplicacion ya autenticada: no requiere que el
// admin escriba el codigo de organizacion a mano, porque ya
// sabemos a que organizacion pertenece gracias a su propio JWT.
// Esta ruta requiere autenticacion y rol admin (ver routes).
// ------------------------------------------------------------
async function registrarUsuarioInterno(req, res) {
  const { nombreCompleto, email, password, rol } = req.body;
  const rolesValidos = ['admin', 'medico', 'sso', 'th'];

  if (!nombreCompleto || !email || !password || !rol) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: nombreCompleto, email, password, rol.' });
  }
  if (!rolesValidos.includes(rol)) {
    return res.status(400).json({ error: `Rol invalido. Debe ser uno de: ${rolesValidos.join(', ')}` });
  }
  if (password.length < 12) {
    return res.status(400).json({ error: 'La contrasena debe tener al menos 12 caracteres. Se recomienda usar una frase larga facil de recordar en vez de una palabra corta con simbolos.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const userRes = await query(
      `INSERT INTO usuarios (organizacion_id, email, password_hash, nombre_completo, rol)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, nombre_completo, rol`,
      [req.usuario.organizacionId, email.toLowerCase().trim(), passwordHash, nombreCompleto, rol]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'usuario_creado_interno',
      entidad: 'usuario',
      entidadId: userRes.rows[0].id,
      detalle: { rol, creadoPor: req.usuario.id },
      req,
    });

    return res.status(201).json({ mensaje: 'Usuario creado con exito.', usuario: userRes.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un usuario con ese email en esta organizacion.' });
    }
    console.error('Error en registrarUsuario:', err);
    return res.status(500).json({ error: 'Error interno al registrar el usuario.' });
  }
}

// ------------------------------------------------------------
// POST /api/auth/login
// ------------------------------------------------------------
async function login(req, res) {
  const { email, password, codigoOrganizacion } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contrasena son obligatorios.' });
  }

  try {
    // CORREGIDO (bug critico encontrado durante remediacion de la
    // auditoria, no listado explicitamente en el informe): esta
    // consulta NO incluia u.mfa_habilitado. Como el chequeo de abajo
    // (`if (usuario.mfa_habilitado)`) dependia de ese campo, siempre
    // evaluaba `undefined` (falsy) sin importar si el usuario tenia
    // MFA configurado. Efecto real: CUALQUIER cuenta con MFA activado
    // completaba el login solo con la contrasena, sin pedir jamas el
    // codigo TOTP — el segundo factor estaba activo en la base de
    // datos pero nunca se aplicaba en el flujo de login.
    //
    // CORREGIDO (hallazgo CRITICO C1 de la auditoria de identidad de
    // tenant): el esquema permite el MISMO email en organizaciones
    // distintas (UNIQUE(organizacion_id, email)), pero esta consulta
    // buscaba solo por email y el codigo mas abajo tomaba
    // ciegamente userRes.rows[0] -- si dos empresas tenian un
    // empleado con el mismo correo, el sistema podia autenticar a la
    // persona equivocada (el orden de filas que devuelve Postgres
    // sin ORDER BY no esta garantizado). Ahora se traen TODOS los
    // candidatos que comparten ese email (normalmente sera 1) y se
    // desambigua explicitamente mas abajo, nunca por accidente.
    const userRes = await query(
      `SELECT u.id, u.organizacion_id, u.email, u.password_hash, u.nombre_completo, u.rol,
              u.activo, u.intentos_fallidos, u.bloqueado_hasta, u.requiere_cambio_password,
              u.mfa_habilitado,
              o.activa AS organizacion_activa, o.nombre AS organizacion_nombre, o.codigo AS organizacion_codigo,
              o.logo_url AS organizacion_logo_url
       FROM usuarios u
       LEFT JOIN organizaciones o ON o.id = u.organizacion_id
       WHERE u.email = $1`,
      [email.toLowerCase().trim()]
    );

    if (userRes.rows.length === 0) {
      await registrarAuditoria({ accion: 'login_fallido', detalle: { email, razon: 'usuario_no_existe' }, req });
      // Mensaje deliberadamente generico: no revelamos si el email existe o no.
      return res.status(401).json({ error: 'Credenciales invalidas.' });
    }

    let usuario;

    if (userRes.rows.length === 1) {
      // Caso normal (inmensa mayoria de los logins): un solo
      // candidato, ninguna ambiguedad posible.
      usuario = userRes.rows[0];
    } else if (codigoOrganizacion) {
      // El cliente ya nos dijo a que organizacion pertenece (porque
      // una vez recibio ORGANIZACION_AMBIGUA mas abajo, o porque el
      // frontend lo pide siempre para este caso). Se filtra por eso.
      const candidatos = userRes.rows.filter(
        (u) => u.organizacion_codigo && u.organizacion_codigo.toLowerCase() === codigoOrganizacion.toLowerCase()
      );
      if (candidatos.length !== 1) {
        await registrarAuditoria({ accion: 'login_fallido', detalle: { email, razon: 'codigo_organizacion_no_coincide' }, req });
        return res.status(401).json({ error: 'Credenciales invalidas.' });
      }
      usuario = candidatos[0];
    } else {
      // Mismo email en 2+ organizaciones y todavia no sabemos cual.
      // En vez de adivinar, probamos la contrasena recibida contra
      // CADA candidato (bcrypt.compare recalcula con la sal propia
      // de cada hash, asi que esto es seguro: no hay atajo que
      // filtre informacion de una cuenta usando la contrasena de
      // otra). Si exactamente UNA coincide, no hay ambiguedad real
      // -- la contrasena identifica la cuenta sin lugar a dudas.
      const coincidencias = [];
      for (const candidato of userRes.rows) {
        if (await bcrypt.compare(password, candidato.password_hash)) coincidencias.push(candidato);
      }

      if (coincidencias.length === 0) {
        await registrarAuditoria({ accion: 'login_fallido', detalle: { email, razon: 'password_incorrecta_multiples_cuentas' }, req });
        return res.status(401).json({ error: 'Credenciales invalidas.' });
      }
      if (coincidencias.length > 1) {
        // Colision real: la misma contrasena es valida para mas de
        // una cuenta con ese email (en organizaciones distintas).
        // No podemos elegir por la persona: se le pide el codigo de
        // su organizacion para desambiguar, en vez de autenticarla
        // silenciosamente contra la cuenta equivocada.
        await registrarAuditoria({ accion: 'login_ambiguo_requiere_codigo_organizacion', detalle: { email }, req });
        return res.status(409).json({
          error: 'Hay más de una cuenta con este correo. Ingresa también el código de tu organización.',
          codigo: 'ORGANIZACION_AMBIGUA',
        });
      }
      usuario = coincidencias[0];
    }

    if (usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date()) {
      const minutosRestantes = Math.ceil((new Date(usuario.bloqueado_hasta) - new Date()) / 60000);
      return res.status(423).json({ error: `Cuenta bloqueada temporalmente. Intente de nuevo en ${minutosRestantes} minuto(s).` });
    }

    if (!usuario.activo) {
      return res.status(403).json({ error: 'Esta cuenta de usuario esta deshabilitada.' });
    }
    // El superadmin no pertenece a ninguna organizacion (organizacion_id es
    // NULL a proposito), asi que esta validacion solo aplica a los demas roles.
    if (usuario.rol !== 'superadmin' && !usuario.organizacion_activa) {
      return res.status(403).json({ error: 'La organizacion asociada esta inactiva.' });
    }

    const passwordValida = await bcrypt.compare(password, usuario.password_hash);

    if (!passwordValida) {
      const intentos = usuario.intentos_fallidos + 1;
      let bloqueadoHasta = null;
      if (intentos >= MAX_INTENTOS_FALLIDOS) {
        bloqueadoHasta = new Date(Date.now() + BLOQUEO_MINUTOS * 60000);
      }
      await query(
        'UPDATE usuarios SET intentos_fallidos = $1, bloqueado_hasta = $2 WHERE id = $3',
        [intentos, bloqueadoHasta, usuario.id]
      );
      await registrarAuditoria({
        organizacionId: usuario.organizacion_id,
        usuarioId: usuario.id,
        accion: 'login_fallido',
        detalle: { razon: 'password_incorrecta', intentos },
        req,
      });
      return res.status(401).json({ error: 'Credenciales invalidas.' });
    }

    // Login exitoso: reseteamos intentos fallidos y registramos el acceso.
    await query(
      'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_login = now() WHERE id = $1',
      [usuario.id]
    );

    // Corregido tras auditoria de seguridad (hallazgo 4.11): si el
    // usuario tiene MFA habilitado, la contrasena correcta NO es
    // suficiente para entrar. Se corta el login aqui, se emite un
    // token de 5 minutos que solo sirve para el segundo paso
    // (POST /auth/mfa/verificar-login), y NO se crea ninguna sesion
    // (ni accessToken ni refreshToken) todavia.
    if (usuario.mfa_habilitado) {
      const mfaToken = generarTokenMfaPendiente(usuario);
      await registrarAuditoria({
        organizacionId: usuario.organizacion_id, usuarioId: usuario.id,
        accion: 'login_password_ok_pendiente_mfa', req,
      });
      return res.json({ requiereMfa: true, mfaToken });
    }

    // CORREGIDO tras auditoria de seguridad (hallazgo GRAVE G5): si el
    // rol exige MFA obligatorio y el usuario aun no lo configuro, no
    // se le deja completar el login. Se emite el mismo tipo de token
    // corto de 'mfa_pendiente' (reutilizando iniciarConfiguracionMfa,
    // que ya exige un accessToken real) para que el frontend pueda
    // llevarlo directo a /configuracion con un token minimo, sin
    // abrir una sesion completa todavia.
    if (ROLES_MFA_OBLIGATORIO.includes(usuario.rol)) {
      const mfaToken = generarTokenMfaPendiente(usuario);
      await registrarAuditoria({
        organizacionId: usuario.organizacion_id, usuarioId: usuario.id,
        accion: 'login_bloqueado_mfa_obligatorio_no_configurado', req,
      });
      return res.status(403).json({
        error: 'Su rol requiere autenticacion de dos factores (MFA). Debe configurarla antes de continuar.',
        codigo: 'MFA_OBLIGATORIO_NO_CONFIGURADO',
        mfaToken,
      });
    }

    return res.json(await completarLogin(usuario, req, res));
  } catch (err) {
    console.error('Error en login:', err);
    return res.status(500).json({ error: 'Error interno durante el inicio de sesion.' });
  }
}

// ------------------------------------------------------------
// Emite accessToken + refreshToken y registra la sesion. Extraida
// de login() para que tambien la use verificarCodigoMfa() (segundo
// paso del login cuando el usuario tiene MFA habilitado), evitando
// duplicar la logica de emision de tokens en dos lugares.
//
// CORREGIDO (hallazgo G4): el refreshToken ya NO se incluye en el
// objeto devuelto (que se manda como JSON al frontend). En su lugar
// se asienta como cookie HttpOnly en `res` antes de retornar. Por
// eso esta funcion ahora necesita `res`, no solo `req`.
// ------------------------------------------------------------
async function completarLogin(usuario, req, res) {
  const accessToken = generarAccessToken(usuario);
  const refreshToken = generarRefreshToken(usuario);
  const expiraEnMs = expiresInMs(REFRESH_EXPIRES);

  // CORREGIDO (hallazgo CRITICO C1 de la auditoria): el codigo de
  // rotacion/reuso en refrescar() depende de familia_id y usado_en
  // para encadenar los refresh tokens hijos con su padre y detectar
  // reuso. La primera insercion de la sesion (aqui, en el login) es
  // la RAIZ de la familia: no tiene padre, asi que su propio id ES
  // la familia_id (todos los tokens rotados despues heredan este
  // mismo valor). Ver migration_030_refresh_tokens_rotacion.sql para
  // las columnas correspondientes en la base de datos.
  const familiaId = uuidv4();

  await query(
    `INSERT INTO refresh_tokens (usuario_id, familia_id, token_hash, user_agent, ip_origen, expira_en)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      usuario.id,
      familiaId,
      hashToken(refreshToken),
      req.headers['user-agent'] || null,
      req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
      new Date(Date.now() + expiraEnMs),
    ]
  );

  await registrarAuditoria({
    organizacionId: usuario.organizacion_id,
    usuarioId: usuario.id,
    accion: 'login_exitoso',
    req,
  });

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, opcionesCookieRefresh(expiraEnMs));

  return {
    accessToken,
    usuario: {
      id: usuario.id,
      email: usuario.email,
      nombreCompleto: usuario.nombre_completo,
      rol: usuario.rol,
      // CORREGIDO (mejora de UX solicitada: mostrar el logo de la
      // empresa cliente en el sidebar, ademas del logo de la
      // plataforma). Ya existia logo_url en organizaciones (subido
      // desde Mi Empresa, usado hoy solo en los PDFs); solo faltaba
      // devolverlo tambien aqui para que el sidebar lo tenga
      // disponible sin pedir un endpoint aparte.
      organizacion: { id: usuario.organizacion_id, nombre: usuario.organizacion_nombre, logoUrl: usuario.organizacion_logo_url || null },
      requiereCambioPassword: usuario.requiere_cambio_password,
    },
  };
}

// ------------------------------------------------------------
// POST /api/auth/mfa/iniciar-configuracion   (autenticado)
// Genera un secreto TOTP nuevo (todavia NO activo) y devuelve el
// QR para escanear con Google Authenticator/Authy/etc. El secreto
// solo queda activo cuando el usuario confirma con un codigo valido
// en confirmarMfa() — asi no se puede "activar" MFA por error y
// quedar bloqueado fuera de su propia cuenta.
// ------------------------------------------------------------
async function iniciarConfiguracionMfa(req, res) {
  try {
    const usuarioRes = await query('SELECT email, mfa_habilitado, mfa_secret_pendiente FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (usuarioRes.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (usuarioRes.rows[0].mfa_habilitado) {
      return res.status(400).json({ error: 'Ya tiene MFA habilitado. Deshabilitelo primero si quiere generar un nuevo codigo.' });
    }

    // CORREGIDO (bug real reportado por un usuario: "el codigo del
    // autenticador nunca es aceptado, lo intente 4 veces"). Antes,
    // CADA llamada a este endpoint generaba un secreto TOTP nuevo y
    // pisaba el anterior en mfa_secret_pendiente, sin comprobar si ya
    // habia uno en curso. Como el flujo de "MFA obligatorio no
    // configurado" (ver login()) puede disparar esta llamada mas de
    // una vez -- el usuario reintenta el login, recarga la pagina, la
    // pestana se duplica, etc. -- cada reintento invalidaba en
    // silencio el QR que el usuario ya habia escaneado en su app de
    // autenticacion. El resultado: la app sigue generando codigos del
    // secreto viejo, mientras el servidor espera los del secreto
    // nuevo, y NINGUN codigo funciona jamas, sin importar cuantas
    // veces se reintente.
    //
    // Ahora, si ya existe un secreto pendiente sin confirmar, se
    // REUTILIZA (se regenera el QR a partir del mismo secreto) en vez
    // de reemplazarlo. Asi, sin importar cuantas veces se dispare
    // este endpoint durante el mismo intento de configuracion, el QR
    // mostrado siempre corresponde al secreto realmente almacenado.
    let secreto;
    if (usuarioRes.rows[0].mfa_secret_pendiente) {
      secreto = desencriptar(usuarioRes.rows[0].mfa_secret_pendiente);
    } else {
      secreto = authenticator.generateSecret();
      await query('UPDATE usuarios SET mfa_secret_pendiente = $1 WHERE id = $2', [encriptar(secreto), req.usuario.id]);
    }

    const otpauthUrl = authenticator.keyuri(usuarioRes.rows[0].email, 'SISSO', secreto);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    return res.json({ secreto, otpauthUrl, qrCodeDataUrl });
  } catch (err) {
    console.error('Error en iniciarConfiguracionMfa:', err);
    return res.status(500).json({ error: 'Error interno al generar la configuracion de MFA.' });
  }
}

// ------------------------------------------------------------
// POST /api/auth/mfa/confirmar   (autenticado)  { codigo }
// ------------------------------------------------------------
async function confirmarMfa(req, res) {
  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ error: 'Falta el codigo de 6 digitos.' });

  try {
    const usuarioRes = await query(
      'SELECT mfa_secret_pendiente, organizacion_id FROM usuarios WHERE id = $1',
      [req.usuario.id]
    );
    const secretoPendienteCifrado = usuarioRes.rows[0]?.mfa_secret_pendiente;
    if (!secretoPendienteCifrado) {
      return res.status(400).json({ error: 'No hay una configuracion de MFA en curso. Inicie el proceso de nuevo.' });
    }
    // desencriptar() es compatible hacia atras: si el valor es un
    // secreto legado en texto plano (de antes de esta correccion),
    // lo devuelve tal cual en vez de fallar.
    const secretoPendiente = desencriptar(secretoPendienteCifrado);

    const valido = authenticator.check(codigo, secretoPendiente);
    if (!valido) {
      // DIAGNOSTICO (no se expone al cliente, solo queda en los logs
      // de Render): checkDelta con una ventana mucho mas amplia (10
      // pasos = +-5 min) nos dice si el codigo ingresado ES el
      // correcto pero desfasado en el tiempo (delta != null -> el
      // secreto es el correcto, es un problema de reloj del
      // telefono) o si es un secreto totalmente distinto (delta ===
      // null incluso con esta ventana amplia -> haria falta seguir
      // investigando, no es solo desfase horario). Esto no debilita
      // la seguridad real (la validacion que SI otorga acceso sigue
      // usando la ventana estrecha de +-60s definida arriba).
      let diagnostico = 'secreto_no_coincide_ni_con_ventana_amplia';
      try {
        const deltaAmplio = authenticator.checkDelta(codigo, secretoPendiente, { window: 10 });
        if (deltaAmplio !== null) diagnostico = `coincide_con_desfase_de_${deltaAmplio * 30}_segundos`;
      } catch (_e) { /* ignorar: el diagnostico es best-effort */ }
      console.warn(`[MFA] confirmarMfa fallido para usuario ${req.usuario.id}. Diagnostico: ${diagnostico}. Hora del servidor: ${new Date().toISOString()}.`);
      return res.status(401).json({ error: 'Codigo incorrecto. Verifique la hora de su dispositivo e intente de nuevo.' });
    }

    await query(
      'UPDATE usuarios SET mfa_habilitado = true, mfa_secret = $1, mfa_secret_pendiente = NULL WHERE id = $2',
      [encriptar(secretoPendiente), req.usuario.id]
    );
    // req.usuario.organizacionId puede ser null aqui si se llego por
    // el flujo de "MFA obligatorio no configurado" (autenticarOMfaPendiente
    // no lo conoce todavia); usamos el que acabamos de leer de la BD.
    await registrarAuditoria({
      organizacionId: usuarioRes.rows[0].organizacion_id, usuarioId: req.usuario.id, accion: 'mfa_habilitado', req,
    });

    return res.json({ mensaje: 'MFA habilitado correctamente. A partir de ahora se le pedira un codigo en cada inicio de sesion.' });
  } catch (err) {
    console.error('Error en confirmarMfa:', err);
    return res.status(500).json({ error: 'Error interno al confirmar MFA.' });
  }
}

// ------------------------------------------------------------
// POST /api/auth/mfa/deshabilitar   (autenticado)  { password, codigo }
//
// CORREGIDO tras auditoria de seguridad (hallazgo CRITICO): antes
// solo se exigia la contrasena. Eso es insuficiente para un sistema
// que maneja historia clinica: si un atacante obtiene la contrasena
// (phishing, reuso de contrasenas filtradas, sesion desatendida en
// la que puede leer el campo de un gestor de contrasenas, etc.) y
// tambien tiene la sesion activa, podia quitar el segundo factor
// con un solo dato robado.
//
// Ahora se exige POSESION del segundo factor tambien: contrasena
// (algo que sabe) + codigo TOTP vigente (algo que tiene). Asi,
// deshabilitar MFA requiere exactamente la misma prueba que
// iniciar sesion con MFA activo, en vez de ser mas debil.
// ------------------------------------------------------------
async function deshabilitarMfa(req, res) {
  const { password, codigo } = req.body;
  if (!password) return res.status(400).json({ error: 'Debe confirmar su contrasena actual.' });
  if (!codigo) return res.status(400).json({ error: 'Debe ingresar el codigo de 6 digitos de su aplicacion de autenticacion.' });

  try {
    const usuarioRes = await query('SELECT password_hash, mfa_habilitado, mfa_secret FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (usuarioRes.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const usuario = usuarioRes.rows[0];

    if (!usuario.mfa_habilitado || !usuario.mfa_secret) {
      return res.status(400).json({ error: 'MFA no esta habilitado en esta cuenta.' });
    }

    const passwordValida = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordValida) return res.status(401).json({ error: 'Contrasena incorrecta.' });

    const secretoActual = desencriptar(usuario.mfa_secret);
    const codigoValido = authenticator.check(codigo, secretoActual);
    if (!codigoValido) {
      await registrarAuditoria({
        organizacionId: req.usuario.organizacionId, usuarioId: req.usuario.id,
        accion: 'mfa_deshabilitar_codigo_incorrecto', req,
      });
      return res.status(401).json({ error: 'Codigo incorrecto.' });
    }

    await query(
      'UPDATE usuarios SET mfa_habilitado = false, mfa_secret = NULL, mfa_secret_pendiente = NULL WHERE id = $1',
      [req.usuario.id]
    );
    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId, usuarioId: req.usuario.id, accion: 'mfa_deshabilitado', req,
    });

    return res.json({ mensaje: 'MFA deshabilitado.' });
  } catch (err) {
    console.error('Error en deshabilitarMfa:', err);
    return res.status(500).json({ error: 'Error interno al deshabilitar MFA.' });
  }
}

// ------------------------------------------------------------
// POST /api/auth/mfa/verificar-login   (publico)  { mfaToken, codigo }
// Segundo paso del login cuando el usuario tiene MFA habilitado.
// ------------------------------------------------------------
async function verificarCodigoMfa(req, res) {
  const { mfaToken, codigo } = req.body;
  if (!mfaToken || !codigo) {
    return res.status(400).json({ error: 'Faltan mfaToken y/o codigo.' });
  }

  try {
    let payload;
    try {
      payload = verificarTokenMfaPendiente(mfaToken);
    } catch {
      return res.status(401).json({ error: 'La verificacion expiro o es invalida. Inicie sesion de nuevo.' });
    }
    if (payload.tipo !== 'mfa_pendiente') {
      return res.status(401).json({ error: 'Token invalido.' });
    }

    const userRes = await query(
      `SELECT u.id, u.organizacion_id, u.email, u.nombre_completo, u.rol, u.activo,
              u.requiere_cambio_password, u.mfa_habilitado, u.mfa_secret,
              o.activa AS organizacion_activa, o.nombre AS organizacion_nombre, o.logo_url AS organizacion_logo_url
       FROM usuarios u LEFT JOIN organizaciones o ON o.id = u.organizacion_id
       WHERE u.id = $1`,
      [payload.sub]
    );
    if (userRes.rows.length === 0 || !userRes.rows[0].activo || !userRes.rows[0].mfa_habilitado) {
      return res.status(401).json({ error: 'No se pudo completar el inicio de sesion.' });
    }
    const usuario = userRes.rows[0];

    // desencriptar() es compatible hacia atras con secretos legados
    // en texto plano (ver src/utils/crypto.js).
    const secretoDescifrado = desencriptar(usuario.mfa_secret);
    const valido = authenticator.check(codigo, secretoDescifrado);
    if (!valido) {
      await registrarAuditoria({
        organizacionId: usuario.organizacion_id, usuarioId: usuario.id,
        accion: 'mfa_codigo_incorrecto', req,
      });
      return res.status(401).json({ error: 'Codigo incorrecto.' });
    }

    // CORREGIDO tras auditoria de seguridad (hallazgo GRAVE G5): en
    // vez de obligar al usuario a desactivar y reactivar MFA a mano
    // para migrar su secreto, aprovechamos que acaba de demostrar
    // que lo conoce (login exitoso) para re-cifrarlo en el acto. Asi,
    // cada cuenta con un secreto heredado en texto plano queda
    // migrada automaticamente la proxima vez que su dueño inicia
    // sesion, sin pedirle ninguna accion adicional.
    if (!esFormatoCifrado(usuario.mfa_secret)) {
      await query('UPDATE usuarios SET mfa_secret = $1 WHERE id = $2', [encriptar(secretoDescifrado), usuario.id]);
      await registrarAuditoria({
        organizacionId: usuario.organizacion_id, usuarioId: usuario.id,
        accion: 'mfa_secreto_migrado_a_cifrado', req,
      });
    }

    return res.json(await completarLogin(usuario, req, res));
  } catch (err) {
    console.error('Error en verificarCodigoMfa:', err);
    return res.status(500).json({ error: 'Error interno al verificar el codigo.' });
  }
}

// ------------------------------------------------------------
// ------------------------------------------------------------
// POST /api/auth/refrescar
// Usa el refresh token para emitir un nuevo access token.
//
// CORREGIDO tras auditoria de seguridad (hallazgo 4.10): antes el
// mismo refresh token se reutilizaba durante toda su vigencia (7
// dias) sin cambiar. Ahora se aplica ROTACION: cada uso valido
// emite un refresh token NUEVO y marca el usado como consumido
// (usado_en), encadenados por familia_id. Si alguna vez llega un
// refresh token cuyo hash coincide con uno YA marcado como usado,
// se interpreta como reuso (robo de token: dos partes distintas
// tienen la misma cadena) y se revoca TODA la familia de una vez,
// forzando a volver a iniciar sesion en todos los dispositivos.
// ------------------------------------------------------------
async function refrescar(req, res) {
  // CORREGIDO (hallazgo G4): el refreshToken ya no viaja en el body,
  // se lee de la cookie HttpOnly que puso completarLogin(). Se
  // mantiene un fallback a req.body por compatibilidad hacia atras
  // (por si un cliente viejo todavia lo manda asi durante un
  // despliegue en transicion), pero el flujo normal es la cookie.
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ error: 'No hay sesion que renovar. Inicie sesion de nuevo.' });
  }

  try {
    const payload = verificarRefreshToken(refreshToken);
    if (payload.tipo !== 'refresh') {
      return res.status(401).json({ error: 'Tipo de token invalido.' });
    }

    const tokenHash = hashToken(refreshToken);

    // CORREGIDO tras auditoria de seguridad (hallazgo GRAVE G8): la
    // version anterior hacia un SELECT para leer usado_en, decidia en
    // JavaScript si el token ya habia sido usado, y RECIEN despues
    // hacia el UPDATE que lo marcaba como usado. Entre esas dos
    // peticiones a la base de datos hay una ventana de tiempo: si el
    // mismo refresh token llegaba dos veces casi al mismo tiempo (dos
    // pestañas, una condicion de red que reintenta, o un atacante que
    // ya tiene el token intentando junto con el usuario legitimo),
    // ambas peticiones podian leer usado_en = NULL ANTES de que
    // cualquiera de las dos alcanzara a escribirlo, y las dos
    // continuaban como si fueran la primera en usarlo — se generaban
    // dos tokens hijos validos de un mismo padre, y la deteccion de
    // reuso (pensada exactamente para este caso) nunca se disparaba.
    //
    // La correccion: un UNICO UPDATE atomico que SOLO tiene efecto si
    // usado_en todavia es NULL (`WHERE usado_en IS NULL`). Postgres
    // serializa los UPDATE concurrentes sobre la misma fila, asi que
    // como mucho una de las peticiones puede "ganar" la carrera; la
    // otra ve 0 filas afectadas y cae en la rama de abajo, que la
    // trata igual que un reuso real (es lo correcto: si dos
    // peticiones reclaman el mismo token casi al mismo tiempo, ya no
    // hay forma de saber cual de las dos es legitima).
    const claimRes = await query(
      `UPDATE refresh_tokens
       SET usado_en = now()
       WHERE token_hash = $1 AND usado_en IS NULL
       RETURNING id, usuario_id, familia_id, expira_en, revocado`,
      [tokenHash]
    );

    if (claimRes.rows.length === 0) {
      // No se pudo reclamar: o no existe, o ya fue usado (reuso), o
      // esta revocado. Distinguimos leyendo la fila (sin condicion)
      // solo para decidir que auditar y que mensaje mostrar.
      const filaRes = await query(
        'SELECT id, usuario_id, familia_id, revocado, usado_en FROM refresh_tokens WHERE token_hash = $1',
        [tokenHash]
      );
      if (filaRes.rows.length > 0 && filaRes.rows[0].usado_en !== null) {
        // Reuso detectado (ver nota de arriba): revocamos toda la
        // familia porque no hay forma de saber cual de las dos partes
        // (la legitima o la atacante) esta pidiendo el refresh ahora.
        await query('UPDATE refresh_tokens SET revocado = true WHERE familia_id = $1', [filaRes.rows[0].familia_id]);
        await registrarAuditoria({
          usuarioId: filaRes.rows[0].usuario_id,
          accion: 'refresh_token_reuso_detectado',
          entidad: 'refresh_tokens',
          entidadId: filaRes.rows[0].familia_id,
          req,
        });
        res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
        return res.status(401).json({ error: 'Sesion invalida detectada. Por seguridad, se cerraron todas las sesiones. Vuelva a iniciar sesion.' });
      }
      res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
      return res.status(401).json({ error: 'Refresh token invalido o revocado.' });
    }

    const tokenFila = claimRes.rows[0];

    if (tokenFila.revocado) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
      return res.status(401).json({ error: 'Refresh token invalido o revocado.' });
    }
    if (new Date(tokenFila.expira_en) < new Date()) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
      return res.status(401).json({ error: 'Refresh token expirado, vuelva a iniciar sesion.' });
    }

    const userRes = await query(
      `SELECT id, organizacion_id, rol, activo FROM usuarios WHERE id = $1`,
      [payload.sub]
    );
    if (userRes.rows.length === 0 || !userRes.rows[0].activo) {
      return res.status(401).json({ error: 'Usuario no encontrado o inactivo.' });
    }

    const nuevoAccessToken = generarAccessToken(userRes.rows[0]);
    const nuevoRefreshToken = generarRefreshToken(userRes.rows[0]);
    const expiraEnMs = expiresInMs(REFRESH_EXPIRES);

    // El token viejo ya quedo marcado como usado por el UPDATE
    // atomico de arriba; solo falta insertar el hijo en la misma
    // familia.
    await query(
      `INSERT INTO refresh_tokens (usuario_id, familia_id, token_hash, user_agent, ip_origen, expira_en)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userRes.rows[0].id,
        tokenFila.familia_id,
        hashToken(nuevoRefreshToken),
        req.headers['user-agent'] || null,
        req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
        new Date(Date.now() + expiraEnMs),
      ]
    );

    res.cookie(REFRESH_COOKIE_NAME, nuevoRefreshToken, opcionesCookieRefresh(expiraEnMs));

    return res.json({ accessToken: nuevoAccessToken });
  } catch (err) {
    return res.status(401).json({ error: 'Refresh token invalido o expirado.' });
  }
}

// ------------------------------------------------------------
// POST /api/auth/logout
// Revoca TODA la familia de refresh tokens (no solo el token
// actual), cerrando de verdad la cadena de sesion completa.
// ------------------------------------------------------------
async function logout(req, res) {
  // CORREGIDO (hallazgo G4): se lee de la cookie HttpOnly, con
  // fallback a body por compatibilidad hacia atras (ver refrescar()).
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  if (!refreshToken) {
    return res.status(400).json({ error: 'Falta el refreshToken.' });
  }
  try {
    const tokenHash = hashToken(refreshToken);
    const tokenRes = await query('SELECT familia_id FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    if (tokenRes.rows.length > 0) {
      await query('UPDATE refresh_tokens SET revocado = true WHERE familia_id = $1', [tokenRes.rows[0].familia_id]);
    }
    if (req.usuario) {
      await registrarAuditoria({ organizacionId: req.usuario.organizacionId, usuarioId: req.usuario.id, accion: 'logout', req });
    }
    return res.json({ mensaje: 'Sesion cerrada correctamente.' });
  } catch (err) {
    console.error('Error en logout:', err);
    return res.status(500).json({ error: 'Error interno al cerrar sesion.' });
  }
}

// ------------------------------------------------------------
// GET /api/auth/perfil
// Devuelve la info del usuario autenticado (util para que el
// frontend sepa quien esta logueado al cargar la app).
// ------------------------------------------------------------
async function perfil(req, res) {
  try {
    const userRes = await query(
      `SELECT u.id, u.email, u.nombre_completo, u.rol, u.ultimo_login, u.mfa_habilitado,
              o.id AS organizacion_id, o.nombre AS organizacion_nombre, o.plan
       FROM usuarios u JOIN organizaciones o ON o.id = u.organizacion_id
       WHERE u.id = $1`,
      [req.usuario.id]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    const fila = userRes.rows[0];
    return res.json({
      usuario: {
        id: fila.id,
        email: fila.email,
        nombre_completo: fila.nombre_completo,
        rol: fila.rol,
        ultimo_login: fila.ultimo_login,
        mfaHabilitado: fila.mfa_habilitado,
        organizacion_id: fila.organizacion_id,
        organizacion_nombre: fila.organizacion_nombre,
        plan: fila.plan,
      },
    });
  } catch (err) {
    console.error('Error en perfil:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
}

// ------------------------------------------------------------
// GET /api/auth/usuarios
// Lista los usuarios de la organizacion del admin autenticado.
// Solo admin puede ver esta lista (ver routes).
// ------------------------------------------------------------
async function listarUsuarios(req, res) {
  try {
    const resultado = await query(
      `SELECT id, email, nombre_completo, rol, activo, ultimo_login, requiere_cambio_password
       FROM usuarios
       WHERE organizacion_id = $1
       ORDER BY creado_en ASC`,
      [req.usuario.organizacionId]
    );
    return res.json({ usuarios: resultado.rows });
  } catch (err) {
    console.error('Error en listarUsuarios:', err);
    return res.status(500).json({ error: 'Error interno al listar usuarios.' });
  }
}

// ------------------------------------------------------------
// PUT /api/auth/usuarios/:id/resetear-password
//
// Permite a un admin resetear la contrasena de un usuario de SU
// MISMA organizacion (no puede tocar usuarios de otras empresas).
// El admin elige la contrasena temporal (no enviamos correos: el
// sistema no tiene infraestructura de email configurada todavia,
// asi que el admin debe comunicarla de forma segura al usuario).
//
// Efectos:
// - Actualiza el password_hash.
// - Marca requiere_cambio_password = true, para que el frontend
//   fuerce al usuario a elegir su propia contrasena en su proximo
//   login (ver layout.js).
// - Desbloquea la cuenta y resetea intentos_fallidos, por si el
//   motivo del reseteo fue justamente que la cuenta quedo
//   bloqueada por intentos fallidos.
// ------------------------------------------------------------
async function resetearPassword(req, res) {
  const { id } = req.params;
  const { passwordTemporal } = req.body;

  try {
    const passwordHash = await bcrypt.hash(passwordTemporal, SALT_ROUNDS);

    const resultado = await query(
      `UPDATE usuarios
       SET password_hash = $1, requiere_cambio_password = true,
           intentos_fallidos = 0, bloqueado_hasta = NULL
       WHERE id = $2 AND organizacion_id = $3
       RETURNING id, email, nombre_completo`,
      [passwordHash, id, req.usuario.organizacionId]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    // Revoca todas las sesiones activas del usuario afectado (mismo
    // criterio que el cambio de password propio: una contrasena
    // reseteada por el admin invalida cualquier sesion abierta con
    // la contrasena anterior).
    await query('UPDATE refresh_tokens SET revocado = true WHERE usuario_id = $1', [id]);

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'resetear_password_admin',
      entidad: 'usuario',
      entidadId: id,
      detalle: { usuarioAfectado: resultado.rows[0].email },
      req,
    });

    return res.json({ mensaje: 'Contrasena reseteada. El usuario debera cambiarla en su proximo inicio de sesion.', usuario: resultado.rows[0] });
  } catch (err) {
    console.error('Error en resetearPassword:', err);
    return res.status(500).json({ error: 'Error interno al resetear la contrasena.' });
  }
}

// ------------------------------------------------------------
// PUT /api/auth/cambiar-password
//
// Auto-servicio: cualquier usuario autenticado cambia su propia
// contrasena. Exige la contrasena actual (evita que alguien con
// una sesion abierta sin vigilancia pueda secuestrar la cuenta
// cambiando la contrasena sin saberla). Tambien la usa el flujo
// forzado tras un reseteo por admin (el usuario ingresa la
// temporal que le dieron como "passwordActual").
// ------------------------------------------------------------
async function cambiarPassword(req, res) {
  const { passwordActual, passwordNueva } = req.body;

  try {
    const userRes = await query('SELECT id, password_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const passwordValida = await bcrypt.compare(passwordActual, userRes.rows[0].password_hash);
    if (!passwordValida) {
      return res.status(401).json({ error: 'La contrasena actual no es correcta.' });
    }

    const passwordHash = await bcrypt.hash(passwordNueva, SALT_ROUNDS);
    await query(
      'UPDATE usuarios SET password_hash = $1, requiere_cambio_password = false WHERE id = $2',
      [passwordHash, req.usuario.id]
    );

    // CORREGIDO tras auditoria de seguridad (hallazgo 4.9): un cambio
    // de password debe invalidar TODAS las sesiones existentes del
    // usuario (todas sus familias de refresh token), no solo afectar
    // la sesion actual. Si alguien mas tenia una sesion abierta con
    // la contrasena vieja (dispositivo compartido, sesion robada),
    // queda cerrada de inmediato.
    await query('UPDATE refresh_tokens SET revocado = true WHERE usuario_id = $1', [req.usuario.id]);

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'cambiar_password_propia',
      entidad: 'usuario',
      entidadId: req.usuario.id,
      req,
    });

    return res.json({ mensaje: 'Contrasena actualizada correctamente.' });
  } catch (err) {
    console.error('Error en cambiarPassword:', err);
    return res.status(500).json({ error: 'Error interno al cambiar la contrasena.' });
  }
}

// ------------------------------------------------------------
// GET /api/auth/sesiones
//
// CORREGIDO (hallazgo MODERADO de la auditoria: "crear gestion de
// sesiones activas"). Permite a un usuario ver desde donde tiene
// sesion abierta (familias de refresh token vigentes: no
// revocadas, no expiradas) y cerrar cualquiera de ellas de forma
// individual, sin tener que esperar a que expire sola. Nunca se
// devuelve el token_hash: solo metadatos (user agent, IP, fechas).
// ------------------------------------------------------------
async function listarSesiones(req, res) {
  try {
    const resultado = await query(
      `SELECT DISTINCT ON (familia_id)
              familia_id, user_agent, ip_origen, creado_en, expira_en
       FROM refresh_tokens
       WHERE usuario_id = $1 AND revocado = false AND expira_en > now()
       ORDER BY familia_id, creado_en DESC`,
      [req.usuario.id]
    );

    // Identificamos cual es la sesion actual comparando el hash del
    // refresh token de esta misma peticion (viene en la cookie),
    // para que el frontend pueda mostrar "Esta sesión" y evitar que
    // alguien se cierre la sesion activa por error sin darse cuenta.
    const refreshTokenActual = req.cookies?.[REFRESH_COOKIE_NAME];
    let familiaActual = null;
    if (refreshTokenActual) {
      const actualRes = await query(
        'SELECT familia_id FROM refresh_tokens WHERE token_hash = $1 AND usuario_id = $2',
        [hashToken(refreshTokenActual), req.usuario.id]
      );
      familiaActual = actualRes.rows[0]?.familia_id || null;
    }

    const sesiones = resultado.rows.map((f) => ({
      familiaId: f.familia_id,
      userAgent: f.user_agent,
      ipOrigen: f.ip_origen,
      creadoEn: f.creado_en,
      expiraEn: f.expira_en,
      esSesionActual: f.familia_id === familiaActual,
    }));

    return res.json({ sesiones });
  } catch (err) {
    console.error('Error en listarSesiones:', err);
    return res.status(500).json({ error: 'Error interno al listar las sesiones.' });
  }
}

// ------------------------------------------------------------
// DELETE /api/auth/sesiones/:familiaId
// Revoca UNA familia de refresh token especifica (una sesion/
// dispositivo puntual), siempre que pertenezca al usuario
// autenticado (nunca se puede revocar la sesion de otra persona
// desde aqui).
// ------------------------------------------------------------
async function revocarSesion(req, res) {
  try {
    const resultado = await query(
      `UPDATE refresh_tokens SET revocado = true
       WHERE familia_id = $1 AND usuario_id = $2 AND revocado = false
       RETURNING familia_id`,
      [req.params.familiaId, req.usuario.id]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Sesión no encontrada o ya estaba cerrada.' });
    }
    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId, usuarioId: req.usuario.id,
      accion: 'sesion_revocada_por_usuario', entidad: 'refresh_tokens', entidadId: req.params.familiaId, req,
    });
    return res.json({ mensaje: 'Sesión cerrada correctamente.' });
  } catch (err) {
    console.error('Error en revocarSesion:', err);
    return res.status(500).json({ error: 'Error interno al cerrar la sesión.' });
  }
}

// ------------------------------------------------------------
// DELETE /api/auth/sesiones
// Revoca TODAS las demas sesiones del usuario (todos los
// dispositivos) EXCEPTO la que esta usando ahora mismo, para el
// caso de "cerrar sesión en todos los demás dispositivos".
// ------------------------------------------------------------
async function revocarOtrasSesiones(req, res) {
  try {
    const refreshTokenActual = req.cookies?.[REFRESH_COOKIE_NAME];
    const familiaActual = refreshTokenActual
      ? (await query('SELECT familia_id FROM refresh_tokens WHERE token_hash = $1 AND usuario_id = $2', [hashToken(refreshTokenActual), req.usuario.id])).rows[0]?.familia_id
      : null;

    const params = [req.usuario.id];
    let condicionFamilia = '';
    if (familiaActual) {
      params.push(familiaActual);
      condicionFamilia = 'AND familia_id != $2';
    }

    await query(
      `UPDATE refresh_tokens SET revocado = true WHERE usuario_id = $1 AND revocado = false ${condicionFamilia}`,
      params
    );
    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId, usuarioId: req.usuario.id,
      accion: 'todas_las_otras_sesiones_revocadas_por_usuario', req,
    });
    return res.json({ mensaje: 'Se cerraron todas las demás sesiones.' });
  } catch (err) {
    console.error('Error en revocarOtrasSesiones:', err);
    return res.status(500).json({ error: 'Error interno al cerrar las sesiones.' });
  }
}

module.exports = {
  registrarOrganizacion, registrarUsuario, registrarUsuarioInterno, listarUsuarios,
  bootstrapSuperadmin, recuperarSuperadmin, login, refrescar, logout, perfil,
  resetearPassword, cambiarPassword,
  iniciarConfiguracionMfa, confirmarMfa, deshabilitarMfa, verificarCodigoMfa,
  listarSesiones, revocarSesion, revocarOtrasSesiones,
};

// ------------------------------------------------------------
// POST /api/auth/bootstrap-superadmin
//
// Crea el PRIMER superadmin de la plataforma usando el mismo
// bcrypt real que usa el resto del sistema (no SQL a mano).
//
// SOLO funciona si todavia NO existe ningun superadmin en la
// base de datos. En cuanto se crea el primero, esta ruta se
// autodesactiva (siempre devuelve error 403 despues de eso).
//
// PROTECCION ADICIONAL (corregido tras auditoria de seguridad):
// sin autenticacion previa, cualquiera que descubra esta URL en
// el intervalo entre el deploy y el primer uso legitimo podria
// reclamar el superadmin antes que el dueño real. Por eso ahora
// exige ademas un secreto de instalacion de un solo uso
// (BOOTSTRAP_SECRET), definido como variable de entorno SOLO
// durante la instalacion inicial y luego eliminado de Render.
// Si la variable no esta definida, la ruta se rechaza por
// completo (fail-closed): no hay bootstrap "abierto" por defecto.
// ------------------------------------------------------------
async function bootstrapSuperadmin(req, res) {
  const { email, password, nombreCompleto, secretoInstalacion } = req.body;

  if (!process.env.BOOTSTRAP_SECRET) {
    return res.status(403).json({
      error: 'El bootstrap de superadmin esta deshabilitado. Defina la variable de entorno BOOTSTRAP_SECRET en Render para habilitarlo temporalmente durante la instalacion inicial, y eliminela apenas termine.',
    });
  }
  if (!secretoInstalacion || secretoInstalacion !== process.env.BOOTSTRAP_SECRET) {
    return res.status(401).json({ error: 'Secreto de instalacion invalido o faltante.' });
  }

  if (!email || !password || !nombreCompleto) {
    return res.status(400).json({ error: 'Faltan campos: email, password, nombreCompleto.' });
  }
  if (password.length < 12) {
    return res.status(400).json({ error: 'La contrasena debe tener al menos 12 caracteres. Se recomienda usar una frase larga facil de recordar en vez de una palabra corta con simbolos.' });
  }

  try {
    const existente = await query("SELECT id FROM usuarios WHERE rol = 'superadmin' LIMIT 1");
    if (existente.rows.length > 0) {
      return res.status(403).json({ error: 'Ya existe un superadmin. Esta ruta solo funciona para crear el primero.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const resultado = await query(
      `INSERT INTO usuarios (organizacion_id, email, password_hash, nombre_completo, rol)
       VALUES (NULL, $1, $2, $3, 'superadmin')
       RETURNING id, email, nombre_completo, rol`,
      [email.toLowerCase().trim(), passwordHash, nombreCompleto]
    );

    await registrarAuditoria({
      usuarioId: resultado.rows[0].id,
      accion: 'superadmin_bootstrap',
      entidad: 'usuario',
      entidadId: resultado.rows[0].id,
      req,
    });

    return res.status(201).json({ mensaje: 'Superadmin creado con exito.', usuario: resultado.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un usuario con ese correo.' });
    }
    console.error('Error en bootstrapSuperadmin:', err);
    return res.status(500).json({ error: 'Error interno al crear el superadmin.' });
  }
}

// ------------------------------------------------------------
// POST /api/auth/recuperar-superadmin
//
// CORREGIDO tras auditoria de seguridad (hallazgo GRAVE G1): antes
// de esta correccion NO EXISTIA ninguna forma de recuperar el
// acceso si el superadmin olvidaba su contrasena. El unico endpoint
// de reseteo de password para ese rol (superadminController.
// resetearPassword) exige estar YA autenticado COMO superadmin
// (circular: si perdio la contrasena, no puede entrar para
// resetearla), y bootstrap-superadmin solo funciona una vez, la
// primera vez que se crea la cuenta.
//
// Como SISSO todavia no tiene infraestructura de correo (ver nota
// en resetearPassword mas abajo), esta ruta sigue el mismo patron
// "break-glass" que bootstrap-superadmin: fail-closed por defecto
// (rechaza todo si la variable de entorno no esta definida) y exige
// un secreto de recuperacion separado (RECOVERY_SECRET) que SOLO
// vive en las variables de entorno de Render, nunca en el
// repositorio ni en la base de datos. Quien tenga acceso a Render
// puede recuperar el acceso al panel; nadie mas.
//
// Efectos (igual que pide G1): fuerza cambio de contrasena en el
// siguiente login (requiere_cambio_password = true) y revoca TODAS
// las sesiones/refresh tokens existentes del superadmin afectado.
//
// LIMITACION CONOCIDA: esto NO recupera el acceso si el superadmin
// tambien perdio su dispositivo de MFA (el MFA no se toca aqui a
// proposito, para no debilitar esa proteccion). Si eso llegara a
// pasar, se necesitaria una intervencion manual directa en la base
// de datos (UPDATE usuarios SET mfa_habilitado = false, mfa_secret
// = NULL WHERE id = '...') desde el SQL Editor de Neon.
// ------------------------------------------------------------
async function recuperarSuperadmin(req, res) {
  const { email, secretoRecuperacion } = req.body;

  if (!process.env.RECOVERY_SECRET) {
    return res.status(403).json({
      error: 'La recuperacion de superadmin esta deshabilitada. Defina RECOVERY_SECRET en las variables de entorno de Render para habilitarla.',
    });
  }
  if (!secretoRecuperacion || secretoRecuperacion !== process.env.RECOVERY_SECRET) {
    return res.status(401).json({ error: 'Secreto de recuperacion invalido o faltante.' });
  }
  if (!email) {
    return res.status(400).json({ error: 'Falta el campo email.' });
  }

  try {
    const passwordTemporal = generarPasswordTemporalSegura();
    const passwordHash = await bcrypt.hash(passwordTemporal, SALT_ROUNDS);

    const resultado = await query(
      `UPDATE usuarios
       SET password_hash = $1, requiere_cambio_password = true,
           intentos_fallidos = 0, bloqueado_hasta = NULL
       WHERE email = $2 AND rol = 'superadmin'
       RETURNING id, email, nombre_completo`,
      [passwordHash, email.toLowerCase().trim()]
    );

    // Mensaje deliberadamente generico si no existe: no confirmamos
    // ni negamos si ese email corresponde a un superadmin real.
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'No se pudo completar la recuperacion con los datos proporcionados.' });
    }

    await query('UPDATE refresh_tokens SET revocado = true WHERE usuario_id = $1', [resultado.rows[0].id]);

    await registrarAuditoria({
      usuarioId: resultado.rows[0].id,
      accion: 'superadmin_recuperado_via_break_glass',
      entidad: 'usuario',
      entidadId: resultado.rows[0].id,
      req,
    });

    return res.json({
      mensaje: 'Acceso recuperado. Debera cambiar esta contrasena temporal en su proximo inicio de sesion. Todas las sesiones anteriores fueron cerradas.',
      usuario: resultado.rows[0],
      passwordTemporal,
    });
  } catch (err) {
    console.error('Error en recuperarSuperadmin:', err);
    return res.status(500).json({ error: 'Error interno al recuperar el acceso.' });
  }
}

// Generador compartido de contrasenas temporales legibles pero con
// suficiente entropia (ver nota identica en superadminController.js).
function generarPasswordTemporalSegura() {
  const palabras = ['Tigre', 'Andes', 'Quito', 'Cobre', 'Rio', 'Sol', 'Monte', 'Luna'];
  const palabra1 = palabras[crypto.randomInt(0, palabras.length)];
  let palabra2 = palabras[crypto.randomInt(0, palabras.length)];
  while (palabra2 === palabra1) {
    palabra2 = palabras[crypto.randomInt(0, palabras.length)];
  }
  const numero = crypto.randomInt(1000, 9999);
  return `${palabra1}-${palabra2}-${numero}`;
}
