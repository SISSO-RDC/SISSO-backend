# Entorno de pruebas reproducible — SISSO backend

**CREADO en Auditoría N.18 (C18-01, P0).** La auditoría no pudo ejecutar la
suite completa porque su entorno no tenía PostgreSQL ni variables. Esta guía
deja el procedimiento por escrito y `npm test` lo verifica antes de correr.

## Qué necesita la suite

1. **PostgreSQL 16 real** (no en memoria): las pruebas de RLS, RBAC y
   aislamiento entre organizaciones dependen del comportamiento real de SQL.
2. **Un rol de aplicación SIN `SUPERUSER` y SIN `BYPASSRLS`.** PostgreSQL omite
   Row Level Security para esos roles: con ellos las pruebas de aislamiento
   darían resultados falsos. `npm test` ejecuta primero
   `scripts/verificar_entorno_pruebas.js` (script `pretest`) y aborta si el rol
   de `DATABASE_URL` tiene alguno de los dos atributos.
3. Las variables obligatorias (ver `.env.example`): `DATABASE_URL`,
   `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `MFA_ENCRYPTION_KEY`,
   `BOOTSTRAP_SECRET`, `RECOVERY_SECRET`, `CLOUDINARY_CLOUD_NAME`,
   `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
4. Migraciones aplicadas (`npm run migrate`).

`tests/atomicidad_auditoria.test.js` además usa `DATABASE_URL_ADMIN` (un rol
propietario de las tablas) para crear/borrar un trigger; ver
`.env.example`.

## Opción A — PostgreSQL efímero local (Docker)

```bash
docker run -d --name sisso-pg-test -e POSTGRES_USER=sisso_ci \
  -e POSTGRES_PASSWORD=sisso_ci_password -e POSTGRES_DB=sisso_ci -p 5432:5432 postgres:16

# El rol bootstrap de la imagen es superusuario y NO se le puede quitar:
# se crea un rol de aplicación aparte y se le da la base (igual que ci.yml).
until docker exec sisso-pg-test pg_isready -U sisso_ci; do sleep 1; done
docker exec sisso-pg-test psql -U sisso_ci -d sisso_ci \
  -c "CREATE ROLE sisso_app WITH LOGIN PASSWORD 'sisso_app_password';" \
  -c "ALTER DATABASE sisso_ci OWNER TO sisso_app;"
```

## Opción B — PostgreSQL instalado (Ubuntu/Debian/Codespaces)

```bash
sudo apt-get install -y postgresql postgresql-client
sudo pg_ctlcluster 16 main start
sudo -u postgres psql -c "CREATE ROLE sisso_app WITH LOGIN PASSWORD 'sisso_app_password';"
sudo -u postgres psql -c "CREATE DATABASE sisso_ci OWNER sisso_app;"
```

## Variables y ejecución

```bash
export DATABASE_URL=postgresql://sisso_app:sisso_app_password@localhost:5432/sisso_ci
export DB_SSL_DISABLED=true          # SOLO para un Postgres local sin TLS. NUNCA en producción.
export JWT_ACCESS_SECRET=ci_test_secret_access_do_not_use_in_prod_0000000000000000
export JWT_REFRESH_SECRET=ci_test_secret_refresh_do_not_use_in_prod_0000000000000000
export MFA_ENCRYPTION_KEY='MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI='
export BOOTSTRAP_SECRET=ci_test_bootstrap_secret_0000000000000000
export RECOVERY_SECRET=ci_test_recovery_secret_0000000000000000
export CLOUDINARY_CLOUD_NAME=ci-dummy-cloud CLOUDINARY_API_KEY=123456789012345
export CLOUDINARY_API_SECRET=ci_dummy_secret_do_not_use_0000000000
export CORS_ORIGINS=http://localhost:3000 NODE_ENV=test

npm ci
npm run migrate        # aplica schema.sql + todas las migraciones desde cero
npm run test:entorno   # (opcional) solo el verificador de entorno
npm test               # verificador + suite completa, en serie
```

Son los mismos valores que usa `.github/workflows/ci.yml` (secretos de CI
descartables, nunca los de Render).

## Neon: advertencia

Un rol creado con el botón **"Add role"** de la consola de Neon hereda
`neon_superuser` y por tanto `BYPASSRLS`; no se puede quitar. Para pruebas cree
el rol con SQL plano (`CREATE ROLE ... LOGIN PASSWORD ...`) en una **rama
separada** de Neon, nunca sobre la rama de producción.

## Mensajes del verificador

| Mensaje | Qué hacer |
|---|---|
| faltan variables de entorno | Definirlas (ver arriba / `.env.example`). |
| no se pudo conectar a PostgreSQL | Levantar Postgres; revisar `DATABASE_URL`; `DB_SSL_DISABLED=true` solo si no hay TLS. |
| el rol es SUPERUSUARIO / BYPASSRLS | Usar un rol de aplicación sin esos atributos. |
| migraciones sin aplicar | `npm run migrate`. |

## Qué NO hace este entorno

Los pasos de CI de análisis de dependencias (`npm audit`) y SBOM están en
`.github/workflows/ci.yml`. El pentest y las pruebas visuales/E2E de navegador
no forman parte de esta suite (ver `CORRECCIONES_N18.md`).
