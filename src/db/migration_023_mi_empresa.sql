-- ============================================================
-- SISSO - Migracion 023: perfil extendido de la organizacion
-- ("Mi Empresa"). organizaciones ya existe desde schema.sql con
-- los campos minimos para operar el sistema (nombre, codigo,
-- ruc_nit, plan, activa); esta migracion agrega los campos que
-- tipicamente exige la documentacion de SST en Ecuador (direccion,
-- actividad economica, representante legal, responsable de SST) y
-- un logo institucional para los PDFs generados por el sistema
-- (consentimientos, certificados, historia clinica), que hasta
-- ahora solo muestran el nombre de la organizacion en texto.
-- ============================================================

ALTER TABLE organizaciones
  ADD COLUMN direccion               VARCHAR(300),
  ADD COLUMN telefono                VARCHAR(30),
  ADD COLUMN email_contacto          VARCHAR(150),
  ADD COLUMN actividad_economica_ciiu VARCHAR(20),
  ADD COLUMN actividad_economica_desc VARCHAR(200),
  ADD COLUMN representante_legal     VARCHAR(200),
  ADD COLUMN responsable_sst_nombre  VARCHAR(200),
  ADD COLUMN responsable_sst_cargo   VARCHAR(150),
  ADD COLUMN logo_url                TEXT,
  ADD COLUMN logo_public_id          VARCHAR(300);
