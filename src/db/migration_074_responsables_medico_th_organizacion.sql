-- ============================================================
-- Migracion 074: responsable del departamento medico y responsable
-- de Talento Humano en el perfil de "Mi Empresa".
--
-- CREADO a pedido de la persona usuaria (02/09/2026): junto al ya
-- existente "Responsable de SST", el perfil de la organizacion
-- tambien debe registrar quien es el responsable medico y quien es
-- el responsable de Talento Humano (para membretes, certificados y
-- reportes que los mencionen).
-- ============================================================

ALTER TABLE organizaciones
  ADD COLUMN IF NOT EXISTS responsable_medico_nombre VARCHAR(200),
  ADD COLUMN IF NOT EXISTS responsable_medico_cargo  VARCHAR(150),
  ADD COLUMN IF NOT EXISTS responsable_th_nombre     VARCHAR(200),
  ADD COLUMN IF NOT EXISTS responsable_th_cargo      VARCHAR(150);

INSERT INTO schema_migrations (version) VALUES ('074_responsables_medico_th_organizacion')
ON CONFLICT (version) DO NOTHING;
