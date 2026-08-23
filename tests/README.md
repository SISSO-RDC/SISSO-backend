# Suite de pruebas automatizadas de SISSO

Corrige el hallazgo GRAVE de la Auditoria Integral 2026-08-22 ("Ausencia
de pruebas automatizadas") para los puntos de **mayor riesgo real**:
aislamiento multi-tenant (C1), autorizacion entre roles / IDOR clinico
(G4), y el rate limiting de MFA (G1). No es un suite exhaustivo de toda
la aplicacion — es la base minima que demuestra, con evidencia real, que
las garantias de seguridad mas criticas del sistema funcionan.

## Como se prueba

Las pruebas **arrancan el servidor real** (`src/index.js`) como proceso
hijo y lo atacan por HTTP, exactamente como lo haria un cliente o un
atacante. No se importan ni mockean controladores: si el ruteo, un
middleware, o la serializacion JSON estuvieran rotos, las pruebas lo
detectarian igual.

Se necesita una base de datos PostgreSQL real (no en memoria) porque las
pruebas de aislamiento multi-tenant dependen del comportamiento real de
las consultas SQL con `organizacion_id`.

## Como correrlas

1. Tener PostgreSQL corriendo (local, o cualquier instancia de prueba —
   **nunca contra la base de datos de produccion**, las pruebas crean y
   borran organizaciones con el codigo `TEST-ORG-A` / `TEST-ORG-B`).
2. Correr las migraciones contra esa base con `npm run migrate`.
3. Definir en `.env` (ademas de las variables normales):
   - `MFA_ENCRYPTION_KEY` (una clave AES-256 en base64; puede generarse
     con `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)
   - `CORS_ORIGINS` (cualquier valor, ej: `http://localhost:3000`)
4. `npm test`

## Que cubre cada archivo

- **`tests/helpers/seed.js`** — crea dos organizaciones de prueba (A y
  B), un usuario de cada rol en A (admin, medico, sso, th) con MFA
  habilitado de verdad (secreto TOTP real, cifrado igual que en
  produccion), y trabajadores en cada organizacion.
- **`tests/helpers/servidor.js`** — arranca/detiene el servidor real en
  un puerto dedicado a pruebas.
- **`tests/helpers/cliente.js`** — hace login COMPLETO (password + MFA)
  contra el servidor, generando codigos TOTP validos en el momento.
- **`tests/seguridad.test.js`** — 10 casos de prueba contra el
  servidor HTTP real:
  - **C1 (multi-tenant)**: un usuario de la Organizacion A nunca puede
    leer, ni por ID directo ni por listado, un registro de la
    Organizacion B — y viceversa.
  - **G4 (autorizacion por rol)**: SSO, TH y admin no pueden acceder al
    detalle de Historia Clinica (exclusivo de `medico`), ni siquiera con
    un token valido de su propia organizacion. Una ruta protegida sin
    token responde 401.
  - **G1 (rate limiting MFA)**: tras 5 codigos TOTP incorrectos, el
    sexto intento se rechaza con 429 **aunque el codigo sea correcto**.
- **`tests/rls.test.js`** — 3 casos que prueban el hallazgo G3
  (Row-Level Security) de una forma que `seguridad.test.js` NO puede:
  se saltan el controlador por completo y ejecutan una consulta SQL
  **deliberadamente sin `WHERE organizacion_id`** — el bug humano
  exacto que la auditoria advierte que un desarrollador futuro podria
  cometer. Si RLS funciona de verdad, esa consulta "con el bug" sigue
  aislada por la politica de base de datos; si no funcionara (o el rol
  de conexion tuviera BYPASSRLS, o fuera dueño de las tablas sin FORCE
  ROW LEVEL SECURITY), devolveria filas de todas las organizaciones.

## Nota sobre RLS y el dueño de las tablas

Por defecto, PostgreSQL deja que el **dueño** de una tabla salte sus
propias politicas RLS, aunque esten "activadas" — a menos que se use
tambien `FORCE ROW LEVEL SECURITY` (que la migracion 045 ya aplica en
todas las tablas). Si reproduces este suite localmente conectando con
un rol **superusuario** de Postgres (como el `postgres` por defecto),
las pruebas de `rls.test.js` pueden pasar por una razon equivocada: los
superusuarios de Postgres bypassan RLS SIEMPRE, sin importar FORCE.
Para una verificacion realista (igual que en Neon, donde el rol de
conexion de la app no es superusuario), crea un rol dedicado sin
`SUPERUSER` que sea dueño de las tablas de prueba, por ejemplo:

```sql
CREATE ROLE sisso_app LOGIN PASSWORD 'algo';
ALTER DATABASE sisso_test OWNER TO sisso_app;
-- reconectar como sisso_app y correr `npm run migrate` desde ahi,
-- para que las tablas se creen con sisso_app como dueño.
```

## Que falta (para las proximas sesiones)

La Auditoria Integral señala estos huecos adicionales que este suite
inicial NO cubre todavia, y que valdria la pena agregar despues:
- IDOR en el resto de modulos clinicos (aptitud, enfermedad profesional,
  restricciones medicas, accidentes, CAPA, alertas, audiometria,
  espirometria, visiometria, certificados) — el patron de
  `seguridad.test.js` es directamente reutilizable, solo hace falta
  repetirlo por modulo.
- Pruebas unitarias de calculos clinicos/ergonomicos (RULA, REBA, NIOSH,
  espirometria, audiometria) contra valores de referencia conocidos.
- Pruebas de reutilizacion de refresh token (deteccion de robo).
- Pruebas de escalada de privilegios (un usuario intentando llamar
  endpoints de un rol superior).
- Pruebas de suspension de usuarios/organizaciones (que efectivamente
  corten el acceso de inmediato).
