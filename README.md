# SISSO Backend

Backend con autenticacion real, MFA, aislamiento multi-tenant forzado a
nivel de base de datos (RLS) y RBAC clinico para el Sistema de Salud
Ocupacional (SISSO).

> **Nota (Auditoria N.08, hallazgo GRAVE G-N08-04):** este README describia
> RLS y el cifrado de MFA como pasos "futuros" de una "primera fase",
> aunque ambos ya estaban completamente implementados desde hace varias
> migraciones. Esa desactualizacion podia inducir a desplegar con
> supuestos equivocados. Esta seccion refleja el estado real del codigo.

## Estado real de seguridad (al dia de hoy)

- **Autenticacion**: JWT (access token corto + refresh token separado,
  almacenado como hash, con rotacion y `familia_id` para detectar reuso).
- **MFA**: TOTP obligatorio para los 4 roles (`admin`, `medico`, `sso`,
  `th`). Secretos cifrados en reposo con AES-256-GCM
  (`MFA_ENCRYPTION_KEY`), rate limiting de intentos fallidos, y rotacion
  forzada de cualquier secreto heredado en texto plano (ver
  `POST /api/superadmin/mfa/rotar-legado` y
  `scripts/mfa_forzar_rotacion_legado.js`).
- **Aislamiento multi-tenant**: Row Level Security de PostgreSQL,
  `ENABLE` + `FORCE`, con el contexto de organizacion fijado por
  peticion (`AsyncLocalStorage` + `set_config`) y politicas `USING` +
  `WITH CHECK` explicitas (`migration_045`, `migration_046`). Es defensa
  en profundidad: los controladores tambien filtran por
  `organizacion_id` de forma independiente.
- **RBAC clinico**: los datos clinicos individuales (diagnostico CIE-10,
  aptitud medica, historia clinica, restricciones medicas, enfermedad
  profesional, resultados de audiometria/espirometria/visiometria) estan
  reservados al rol `medico`. Otros roles reciben, cuando corresponde,
  vistas agregadas o proyecciones operativas sin datos nominales —
  incluidos endpoints transversales como `/api/dashboard/resumen`,
  `/api/trabajadores`, `/api/indicadores` y `/api/reportes`, que
  aplican el mismo criterio de minimizacion que los modulos clinicos
  dedicados.
- **Auditoria**: tabla `auditoria` con modo `critico` — las escrituras
  clinicas mas sensibles hacen que un fallo al registrar la auditoria
  tumbe la peticion en vez de perderse en silencio.
- **Migraciones**: 001 a 046+, todas repetibles (`IF NOT EXISTS`,
  `DROP POLICY IF EXISTS`, `ON CONFLICT DO NOTHING`) y con auto-registro
  en `schema_migrations`, sea que se ejecuten con `npm run migrate` o
  pegadas a mano en el SQL Editor de Neon.
- **Pruebas automatizadas**: suite contra servidor HTTP real y
  PostgreSQL real (nada mockeado) en `tests/`: aislamiento multi-tenant,
  autorizacion por rol, rate limiting de MFA, matriz RBAC clinica
  (aptitud, restricciones, enfermedad profesional, audiometria,
  espirometria, visiometria, certificados, ausentismo, alertas) y
  pruebas de contenido (no solo status HTTP) para dashboard y
  trabajadores. Ver `tests/README.md`.

## Roles

`admin`, `medico`, `sso`, `th` — mas `superadmin`, que gestiona la
plataforma (no pertenece a ninguna organizacion cliente). Los permisos
detallados de cada rol viven documentados junto a cada ruta en
`src/routes/*.js`; no hay todavia una matriz formal separada rol ×
endpoint × tipo de dato (recomendado por la Auditoria N.08, hallazgo
G-N08-03, como siguiente paso de madurez).

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

Necesitas correr las migraciones (46 y contando) una sola vez por
entorno nuevo. Todas son repetibles: si por error se ejecutan dos veces,
no fallan (usan `IF NOT EXISTS`/`DROP POLICY IF EXISTS`/
`ON CONFLICT DO NOTHING`).

**Opcion A: desde tu computadora, apuntando a la base de Neon:**
```bash
npm install
cp .env.example .env
# Edita .env con tus valores reales (ver la lista completa mas abajo)
npm run migrate
```

**Opcion B: usando la consola SQL de Neon directamente (el flujo real
que usa el equipo, sin terminal local):**
Abre el "SQL Editor" en el panel de Neon y pega el contenido de cada
`src/db/migration_XXX_*.sql` en orden, o el `src/db/schema.sql` completo
para una base nueva. Cada migracion se auto-registra en
`schema_migrations`, asi que `npm run migrate` sabra cuales ya se
aplicaron manualmente y no las repetira.

### Variables de entorno obligatorias/opcionales

Ver `.env.example` para la lista completa y comentada. Resumen:

| Variable | Obligatoria | Para que |
|---|---|---|
| `DATABASE_URL` | Si | Conexion a Neon/PostgreSQL |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Si | Firma de tokens |
| `MFA_ENCRYPTION_KEY` | Si (si hay MFA, y todos los roles lo exigen) | Cifrado AES-256-GCM de secretos TOTP |
| `CORS_ORIGINS` | Si en produccion | Sin esta variable, CORS falla-cerrado en `NODE_ENV=production` |
| `CLOUDINARY_*` | Solo si se suben archivos | Evidencias, certificados escaneados, firmas |
| `PAYPHONE_*` | Solo si se cobran suscripciones | Pagos |
| `BOOTSTRAP_SECRET`, `RECOVERY_SECRET` | No | Habilitan endpoints de un solo uso para crear/recuperar el superadmin |

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

## Siguientes pasos (roadmap, no cerrado)

- Matriz formal de clasificacion de datos (D0 publico/tecnico … D4
  clinico altamente sensible) y matriz rol × endpoint × accion, como
  documento central en vez de reglas repartidas por controlador
  (Auditoria N.08, G-N08-03).
- Ampliar la suite automatizada a `indicadores`, `reportes` y variantes
  de `alertas` con el mismo nivel de detalle que ya tiene
  `tests/rbac_clinico.test.js` (Auditoria N.08, G-N08-01).
- Observabilidad estructurada en produccion (request-id, latencia,
  metricas) sin loguear PII.
- Recuperacion de contrasena por email para roles no-superadmin.
- Automatizar que la version que reporta `/api/salud` se derive del
  codigo desplegado en vez de mantenerse a mano.
