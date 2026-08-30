-- ============================================================
-- Migracion 054: clasificacion de tipos de consentimiento
-- (clinico vs operativo).
--
-- CORRIGE PARCIALMENTE el hallazgo GRAVE G10-05 de la Auditoria
-- Integral SISSO N.10: SSO y TH podian obtener la URL firmada de la
-- imagen de firma y descargar el PDF firmado de CUALQUIER tipo de
-- consentimiento, incluidos los que son inherentemente clinicos
-- (audiometria, espirometria, pruebas biologicas/toxicologicas/
-- psicologicas): el solo hecho de que exista un consentimiento
-- firmado de "pruebas_psicologicas" para un trabajador ya revela
-- indirectamente informacion de salud.
--
-- Esta columna permite separar, tipo por tipo:
--   - 'clinico': el CONTENIDO firmado (imagen de firma + texto legal
--     + PDF) queda reservado a 'medico'. SSO/TH pueden seguir
--     gestionando el ESTADO (listar cuales existen, vigencia,
--     revocarlos) sin acceder al contenido.
--   - 'operativo': sin ese contenido clinico implicito (ej. un
--     futuro consentimiento de uso de imagen para fotografias de
--     capacitacion); SSO/TH pueden acceder al contenido tambien.
--
-- Todos los tipos ya existentes en el catalogo son, por su propia
-- naturaleza, clinicos -- se clasifican como tales por defecto.
-- ============================================================

ALTER TABLE tipos_consentimiento
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(20) NOT NULL DEFAULT 'clinico'
    CHECK (categoria IN ('clinico', 'operativo'));

INSERT INTO schema_migrations (version) VALUES ('054_categoria_tipos_consentimiento')
ON CONFLICT (version) DO NOTHING;
