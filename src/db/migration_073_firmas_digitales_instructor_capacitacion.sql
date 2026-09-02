-- ============================================================
-- Migracion 073: firma digital por usuario (alternativa a la firma
-- electronica ya existente en consentimientos) + instructor interno
-- vinculado a un usuario del sistema en capacitaciones.
--
-- CREADO a pedido de la persona usuaria (02/09/2026):
--   - "en un panel administrativo deben estar todas las firmas en
--     digital tanto la del medico como la del sso y de th para que
--     estas firmas sean agregadas en los certificados"
--   - "en la pestaña de configuracion deberan constar la firma
--     digital de cada usuario"
--   - "el acceso a las capacitaciones debera tambien darse por la
--     persona que hace la capacitacion"
-- ============================================================

CREATE TABLE IF NOT EXISTS firmas_digitales_usuario (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id          UUID NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    imagen_url          TEXT NOT NULL,
    imagen_public_id    TEXT NOT NULL,
    actualizado_por      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE firmas_digitales_usuario IS
  'Firma digital (imagen dibujada en canvas) de un usuario del sistema, para incrustarse en certificados PDF (aptitud, capacitacion, y otros documentos que requieran firma) como alternativa a la firma electronica de consentimientos. Una fila por usuario (UNIQUE usuario_id) -- subir una nueva firma REEMPLAZA la anterior.';

CREATE INDEX IF NOT EXISTS idx_firmas_digitales_organizacion ON firmas_digitales_usuario(organizacion_id);

CREATE TRIGGER set_actualizado_en_firmas_digitales
  BEFORE UPDATE ON firmas_digitales_usuario
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

ALTER TABLE firmas_digitales_usuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE firmas_digitales_usuario FORCE ROW LEVEL SECURITY;
CREATE POLICY firmas_digitales_aislamiento_tenant ON firmas_digitales_usuario
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
              OR current_setting('app.es_superadmin', true) = 'true');

-- ------------------------------------------------------------
-- Instructor interno de una capacitacion, vinculado a un usuario
-- real del sistema (ademas del campo de texto libre `instructor`,
-- que se conserva para instructores EXTERNOS/contratados que no
-- tienen usuario en SISSO).
-- ------------------------------------------------------------
ALTER TABLE capacitaciones
  ADD COLUMN IF NOT EXISTS instructor_usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL;

COMMENT ON COLUMN capacitaciones.instructor_usuario_id IS
  'Si la capacitacion la dicto un usuario interno de SISSO (no un instructor externo), se referencia aqui. Un usuario que NO es admin/sso/th puede registrar una capacitacion UNICAMENTE si se asigna a si mismo como instructor_usuario_id (ver capacitacionesController.crear) -- "el acceso a las capacitaciones tambien se da por la persona que hace la capacitacion".';

INSERT INTO schema_migrations (version) VALUES ('073_firmas_digitales_instructor_capacitacion')
ON CONFLICT (version) DO NOTHING;
