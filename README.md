# SISSO Backend

Backend con autenticacion real y arquitectura multi-tenant para el Sistema
de Salud Ocupacional (SISSO). Reemplaza el sistema de roles simulados en el
navegador por autenticacion con JWT, contrasenas hasheadas, y aislamiento
real de datos entre empresas clientes.

## Que incluye esta primera fase

- Registro de organizaciones (empresas clientes = "tenants")
- Registro de usuarios dentro de cada organizacion, con 4 roles: `admin`,
  `medico`, `sso`, `th`
- Login con JWT (access token de 15 min + refresh token de 7 dias)
- Bloqueo temporal de cuenta tras 5 intentos fallidos
- Limite de peticiones (rate limiting) sobre el endpoint de login
- Tabla de auditoria: registra logins, accesos a datos clinicos, creacion
  de usuarios, etc.
- Middleware reutilizable de autenticacion y autorizacion por rol, listo
  para proteger los modulos que migremos despues (trabajadores, examenes,
  certificados...)

## Estructura del proyecto

```
sisso-backend/
├── src/
│   ├── controllers/      # Logica de negocio (authController.js)
│   ├── db/                # Conexion (pool.js), esquema (schema.sql), migracion
│   ├── middleware/        # auth.js (JWT), validacion.js (inputs)
│   ├── routes/            # Definicion de endpoints
│   ├── utils/             # jwt.js, auditoria.js
│   └── index.js           # Arranque del servidor Express
├── .env.example            # Plantilla de variables de entorno
├── package.json
└── README.md
```

---

## Paso 1: Crear la base de datos gratis (Neon)

1. Ve a https://neon.tech y crea una cuenta gratuita (puedes usar tu cuenta
   de GitHub para registrarte mas rapido).
2. Crea un nuevo proyecto. Nombralo, por ejemplo, `sisso-db`.
3. Neon te mostrara una cadena de conexion parecida a:
   ```
   postgresql://usuario:password@ep-algo-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   Copiala, la necesitaras en el paso 3.

## Paso 2: Subir el codigo a GitHub

1. Crea un repositorio nuevo en GitHub (puede ser privado), por ejemplo
   `sisso-backend`.
2. Desde tu computadora, dentro de la carpeta del proyecto:
   ```bash
   git init
   git add .
   git commit -m "Backend inicial con autenticacion real y multi-tenant"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/sisso-backend.git
   git push -u origin main
   ```
   El archivo `.gitignore` ya esta configurado para que **nunca** subas tu
   archivo `.env` con secretos reales.

## Paso 3: Desplegar en Render (gratis)

1. Ve a https://render.com y crea una cuenta (puedes entrar con GitHub).
2. Click en "New +" → "Web Service".
3. Conecta tu repositorio de GitHub `sisso-backend`.
4. Configura:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. En la seccion "Environment Variables" agrega TODAS las variables que
   estan en `.env.example`, con sus valores reales:
   - `DATABASE_URL` → la cadena de conexion de Neon (paso 1)
   - `JWT_ACCESS_SECRET` → genera una con `openssl rand -base64 48`
     (o usa cualquier generador de cadenas aleatorias largas)
   - `JWT_REFRESH_SECRET` → otra cadena distinta, igual de larga
   - `JWT_ACCESS_EXPIRES` → `15m`
   - `JWT_REFRESH_EXPIRES` → `7d`
   - `CORS_ORIGINS` → el dominio donde vivira tu frontend (puedes dejarlo
     vacio por ahora y completarlo cuando despliegues el frontend)
   - `NODE_ENV` → `production`
6. Click en "Create Web Service". Render instalara las dependencias y
   arrancara el servidor automaticamente. Cada vez que hagas `git push`,
   Render vuelve a desplegar solo.

## Paso 4: Crear las tablas en la base de datos

Una vez desplegado (o tambien puedes hacerlo en local antes de desplegar),
necesitas correr la migracion una sola vez para crear las tablas:

**Opcion A: desde tu computadora, apuntando a la base de Neon:**
```bash
npm install
cp .env.example .env
# Edita .env y pon tu DATABASE_URL real de Neon
npm run migrate
```

**Opcion B: usando la consola SQL de Neon directamente:**
Abre el "SQL Editor" en el panel de Neon y pega el contenido completo de
`src/db/schema.sql`, luego ejecutalo.

## Paso 5: Probar que todo funciona

Con el backend desplegado (o corriendo local con `npm run dev`), prueba
estos pasos con `curl` o con Postman:

### 1. Registrar tu primera empresa (esto crea el admin de esa empresa)
```bash
curl -X POST https://TU-BACKEND.onrender.com/api/auth/registrar-organizacion \
  -H "Content-Type: application/json" \
  -d '{
    "nombreEmpresa": "Fabrica Textil XYZ",
    "rucNit": "1234567890001",
    "nombreAdmin": "Maria Lopez",
    "email": "admin@fabricaxyz.com",
    "password": "ContrasenaSegura123"
  }'
```
Guarda el `codigo` de organizacion que te devuelve (ej: `SISSO-7F3K2Q`).

### 2. Iniciar sesion
```bash
curl -X POST https://TU-BACKEND.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "admin@fabricaxyz.com", "password": "ContrasenaSegura123" }'
```
Esto te devuelve un `accessToken` y un `refreshToken`. Guarda el `accessToken`.

### 3. Acceder a una ruta protegida
```bash
curl https://TU-BACKEND.onrender.com/api/ejemplo/saludo \
  -H "Authorization: Bearer TU_ACCESS_TOKEN"
```

### 4. Registrar un segundo usuario (ej: el medico ocupacional) en la misma empresa
```bash
curl -X POST https://TU-BACKEND.onrender.com/api/auth/registrar-usuario \
  -H "Content-Type: application/json" \
  -d '{
    "codigoOrganizacion": "SISSO-7F3K2Q",
    "nombreCompleto": "Dr. Juan Perez",
    "email": "medico@fabricaxyz.com",
    "password": "OtraContrasena456",
    "rol": "medico"
  }'
```

---

## Importante sobre el "tier gratuito"

- **Neon free tier:** suficiente para desarrollo y para tus primeros
  clientes pequenos. Tiene limites de almacenamiento y de computo que se
  "duermen" tras inactividad (la primera consulta tras inactividad puede
  tardar 1-2 segundos en "despertar" la base, es normal).
- **Render free tier:** el servicio "se duerme" tras ~15 minutos sin
  trafico, y la primera peticion despues de dormir tarda unos segundos en
  responder. Cuando tengas clientes pagando, el plan pago ($7/mes
  aproximadamente) elimina ese problema.

## Siguientes pasos (no incluidos en esta fase)

- Migrar los modulos del frontend original (trabajadores, examenes
  medicos, certificados) para que consuman este backend en vez de tener
  los datos hardcodeados en el HTML.
- Cifrado de campos sensibles especificos en la base de datos.
- Politicas de Row Level Security (RLS) en PostgreSQL como capa adicional
  de aislamiento entre organizaciones.
- Recuperacion de contrasena por email.
- Panel de auditoria visual para que el admin de cada empresa vea quien
  accedio a que.
