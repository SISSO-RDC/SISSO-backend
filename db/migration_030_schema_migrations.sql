-- ============================================================
-- SISSO - Migracion 030: sistema de versionado de migraciones.
--
-- Corrige el hallazgo CRITICO C2 de la auditoria de seguridad:
-- "npm run migrate" (src/db/migrate.js) solo ejecuta schema.sql (el
-- esquema BASE). Las migraciones 002 en adelante se venian
-- aplicando a mano, una por una, en el SQL Editor de Neon, sin
-- ningun registro de cuales ya corrieron en esta base de datos en
-- particular. Eso puede producir instalaciones inconsistentes (una
-- migracion aplicada dos veces, o una que se salta por error).
--
-- Esta migracion crea la tabla de control schema_migrations y la
-- deja poblada con el historial de migraciones que YA se aplicaron
-- manualmente en la base de datos de produccion de SISSO hasta hoy
-- (002-029). A partir de esta migracion (030 en adelante), CADA
-- archivo migration_XXX_*.sql termina con un INSERT que se registra
-- a si mismo aqui, sin importar si se ejecuta a mano en Neon o con
-- "npm run migrate" (ver el migrate.js actualizado, que ahora
-- consulta esta tabla para saber que migraciones faltan).
--
-- IMPORTANTE: los numeros de la lista de abajo (002-029) asumen que
-- esta base de datos es la de produccion de SISSO, donde todas esas
-- migraciones ya corrieron. Si esta migracion se aplica sobre una
-- base de datos NUEVA (instalacion desde cero), no ejecute este
-- archivo tal cual: use "npm run migrate", que en una base vacia
-- corre schema.sql (que YA incluye todo lo de 002-030 al dia de
-- hoy) y registra el historial completo automaticamente.
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(100) PRIMARY KEY,
    aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES
    ('001_schema_base'),
    ('002_trabajadores'),
    ('003_superadmin'),
    ('004_ergonomia_reba'),
    ('005_ergonomia_rula'),
    ('006_aptitud_medica'),
    ('007_fix_cie10_columnas'),
    ('008_consentimientos'),
    ('009_fix_rula_varchar'),
    ('010_audiometria'),
    ('011_espirometria'),
    ('012_reset_password'),
    ('013_firma_fisica'),
    ('014_historia_clinica_ocupacional'),
    ('015_evaluacion_retiro'),
    ('016_evaluacion_periodica'),
    ('017_evaluacion_reintegro'),
    ('018_inmunizaciones'),
    ('019_visiometria'),
    ('020_cuestionario_nordico'),
    ('021_ecuacion_niosh'),
    ('022_puestos_trabajo'),
    ('023_mi_empresa'),
    ('024_matriz_riesgos'),
    ('025_ausentismo'),
    ('026_capacitaciones'),
    ('028_mfa'),
    ('029_mfa_cifrado')
ON CONFLICT (version) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('030_schema_migrations')
ON CONFLICT (version) DO NOTHING;
