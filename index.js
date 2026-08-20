// ============================================================
// SISSO Backend - punto de entrada del servidor.
// ============================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
// CORREGIDO tras auditoria de seguridad (hallazgo G4): necesario para
// leer la cookie HttpOnly donde ahora viaja el refresh token (ver
// authController.js: completarLogin/refrescar/logout).
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/authRoutes');
const ejemploRoutes = require('./routes/ejemploRoutes');
const trabajadoresRoutes = require('./routes/trabajadoresRoutes');
const superadminRoutes = require('./routes/superadminRoutes');
const ergonomiaRoutes = require('./routes/ergonomiaRoutes');
const rulaRoutes = require('./routes/rulaRoutes');
const aptitudRoutes = require('./routes/aptitudRoutes');
const consentimientosRoutes = require('./routes/consentimientosRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const audiometriaRoutes = require('./routes/audiometriaRoutes');
const espirometriaRoutes = require('./routes/espirometriaRoutes');
const historiaClinicaRoutes = require('./routes/historiaClinicaRoutes');
const visiometriaRoutes = require('./routes/visiometriaRoutes');
const nordicoRoutes = require('./routes/nordicoRoutes');
const nioshRoutes = require('./routes/nioshRoutes');
const puestosTrabajoRoutes = require('./routes/puestosTrabajoRoutes');
const organizacionRoutes = require('./routes/organizacionRoutes');
const alertasRoutes = require('./routes/alertasRoutes');
const matrizRiesgosRoutes = require('./routes/matrizRiesgosRoutes');
const indicadoresRoutes = require('./routes/indicadoresRoutes');
const ausentismoRoutes = require('./routes/ausentismoRoutes');
const reportesRoutes = require('./routes/reportesRoutes');
const capacitacionesRoutes = require('./routes/capacitacionesRoutes');
const certificadosRoutes = require('./routes/certificadosRoutes');
// CORREGIDO tras Auditoria SISSO N.06 (puntos 17 y 25 / hallazgos
// G2 y G8): modulos medicos nuevos, enfermedad profesional como
// proceso clinico exclusivo del medico, y restricciones medicas
// como entidad longitudinal separada de aptitud.
const enfermedadProfesionalRoutes = require('./routes/enfermedadProfesionalRoutes');
const restriccionesMedicasRoutes = require('./routes/restriccionesMedicasRoutes');
// CORREGIDO tras Auditoria SISSO N.06 (puntos 15 y 16 / CRITICO 2 y
// CRITICO 4): matriz medico-ocupacional por puesto (que examenes
// requiere cada puesto y su cobertura real) y vigilancia de la
// salud (programas longitudinales con cifras agregadas para SSO).
const matrizMedicoPuestoRoutes = require('./routes/matrizMedicoPuestoRoutes');
const vigilanciaSaludRoutes = require('./routes/vigilanciaSaludRoutes');
// CORREGIDO tras Auditoria SISSO N.06 (punto 18 / CRITICO 1): ciclo
// integral de investigacion preventiva de accidentes/incidentes/casi
// accidentes, con causas, acciones verificables y evidencia privada.
const accidentesRoutes = require('./routes/accidentesRoutes');
// CORREGIDO: no existia ningun endpoint para listar usuarios de la
// organizacion (necesario para asignar "responsable" de una accion
// en Accidentes/Incidentes). Solo lectura, minimo, sin datos sensibles.
const usuariosRoutes = require('./routes/usuariosRoutes');
// CORREGIDO tras Auditoria SISSO N.06 (punto 19 / G1): CAPA
// transversal, con verificacion de eficacia real antes de cerrar
// (no solo "marcar como completado").
const capaRoutes = require('./routes/capaRoutes');

const app = express();

// --- Seguridad basica de cabeceras HTTP ---
app.use(helmet());

// --- CORS: solo permitimos peticiones desde los dominios autorizados ---
const origenesPermitidos = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const esProduccion = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: function (origin, callback) {
    // CORREGIDO tras auditoria de seguridad: la version anterior era
    // "fail-open" (si CORS_ORIGINS estaba vacia, aceptaba CUALQUIER
    // origen). Eso es comodo en desarrollo pero peligroso si alguien
    // olvida configurar CORS_ORIGINS en Render al desplegar: la API
    // quedaria abierta a cualquier sitio web.
    //
    // Ahora es "fail-closed" en produccion:
    //   - En desarrollo (NODE_ENV != production): se mantiene el
    //     comportamiento permisivo de siempre, incluyendo origin
    //     "null" (necesario para abrir los HTML con file:// sin
    //     servidor, que es como el equipo prueba localmente).
    //   - En produccion: si CORS_ORIGINS no esta definida, se
    //     RECHAZAN todos los origenes (en vez de aceptarlos todos), y
    //     el origen "null" tampoco se acepta.
    if (!esProduccion) {
      if (!origin || origin === 'null' || origenesPermitidos.length === 0 || origenesPermitidos.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origen no permitido por la politica de CORS.'));
    }

    // Produccion: solo origenes explicitamente listados en CORS_ORIGINS.
    // Las peticiones sin header Origin (Postman, apps moviles via HTTPS
    // directo, health checks) se siguen permitiendo porque no son
    // peticiones de navegador y CORS no aplica a ellas.
    if (!origin || (origenesPermitidos.length > 0 && origenesPermitidos.includes(origin))) {
      return callback(null, true);
    }
    return callback(new Error('Origen no permitido por la politica de CORS.'));
  },
  credentials: true,
}));

// Limite del body JSON: 1mb era razonable antes de soportar evidencia
// visual (fotos/video en base64 para REBA/RULA), que puede pesar varios
// MB una vez codificado. Se sube a 15mb para cubrir fotos de camara de
// celular tipicas; videos mas pesados deberian comprimirse en el cliente
// antes de enviarse, o subirse directo a Cloudinary desde el frontend
// (upload firmado) en una iteracion futura si el limite resulta corto.
app.use(express.json({ limit: '15mb' }));

// Parseo de cookies (ver nota junto al require de arriba).
app.use(cookieParser());

// --- Logging de peticiones HTTP (util para depurar y monitorear) ---
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// --- Ruta de salud, para verificar que el servidor esta vivo (Render la usa) ---
// CORREGIDO: se agrega "version" para poder confirmar en segundos,
// desde el navegador (GET https://sissso-backend.onrender.com/api/salud),
// si Render ya esta sirviendo el ultimo codigo desplegado o si se
// quedo en una version anterior -- sin esto, la unica forma de
// saberlo era revisar manualmente los logs/eventos de deploy en el
// dashboard de Render.
app.get('/api/salud', (req, res) => {
  res.json({
    estado: 'ok',
    timestamp: new Date().toISOString(),
    version: '2026-08-19-capa-transversal',
  });
});

// --- Rutas de la aplicacion ---
app.use('/api/auth', authRoutes);
app.use('/api/ejemplo', ejemploRoutes);
app.use('/api/trabajadores', trabajadoresRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/ergonomia/rula', rulaRoutes);
app.use('/api/ergonomia', ergonomiaRoutes);
app.use('/api/aptitud', aptitudRoutes);
app.use('/api/consentimientos', consentimientosRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/audiometria', audiometriaRoutes);
app.use('/api/espirometria', espirometriaRoutes);
app.use('/api/historia-clinica', historiaClinicaRoutes);
app.use('/api/visiometria', visiometriaRoutes);
app.use('/api/nordico', nordicoRoutes);
app.use('/api/niosh', nioshRoutes);
app.use('/api/puestos-trabajo', puestosTrabajoRoutes);
app.use('/api/organizacion', organizacionRoutes);
app.use('/api/alertas', alertasRoutes);
app.use('/api/matriz-riesgos', matrizRiesgosRoutes);
app.use('/api/indicadores', indicadoresRoutes);
app.use('/api/ausentismo', ausentismoRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/capacitaciones', capacitacionesRoutes);
app.use('/api/certificados', certificadosRoutes);
app.use('/api/enfermedad-profesional', enfermedadProfesionalRoutes);
app.use('/api/restricciones-medicas', restriccionesMedicasRoutes);
app.use('/api/matriz-medico-puesto', matrizMedicoPuestoRoutes);
app.use('/api/vigilancia-salud', vigilanciaSaludRoutes);
app.use('/api/accidentes', accidentesRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/capa', capaRoutes);

// --- Manejo de rutas no encontradas ---
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

// --- Manejo centralizado de errores no capturados ---
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SISSO backend escuchando en el puerto ${PORT} (${process.env.NODE_ENV || 'development'})`);
});
