-- ============================================================
-- Migracion 100: originalmente arreglaba el error "value too long
-- for type character varying(500)" que dejo migration_099 a medias
-- en produccion (filas 1-8 de 10 aplicadas, SISAT y AM 1404 no).
--
-- CORREGIDO: el ALTER TABLE que ampliaba la columna ahora vive
-- DENTRO de migration_099_normativas_urls.sql (ver su encabezado),
-- porque una instalacion nueva (CI, un despliegue desde cero)
-- siempre corre las migraciones en orden 001->ultima, y necesitaba
-- el ancho correcto ANTES de llegar a la 099, no despues.
--
-- Esta migracion queda solo como un ALTER TABLE idempotente (no
-- reintenta los UPDATE de SISAT/AM 1404: con la 099 ya corregida,
-- repetirlos aqui duplicaria el texto concatenado en fuente_cita en
-- cualquier instalacion nueva). En produccion no cambia nada -- la
-- columna ya quedo en VARCHAR(1000) cuando esta migracion se corrio
-- la primera vez.
-- ============================================================

ALTER TABLE normativas_sisso ALTER COLUMN fuente_cita TYPE VARCHAR(1000);

INSERT INTO schema_migrations (version) VALUES ('100_fuente_cita_widen_fix')
ON CONFLICT (version) DO NOTHING;
