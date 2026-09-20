-- ============================================================
-- SISSO - Migracion 031: columnas de rotacion de refresh tokens.
--
-- Corrige el hallazgo CRITICO C1 de la auditoria de seguridad:
-- el codigo de authController.js (refrescar(), completarLogin(),
-- logout()) usa las columnas familia_id y usado_en de la tabla
-- refresh_tokens para implementar rotacion con deteccion de reuso,
-- pero esas columnas nunca se crearon en schema.sql ni en ninguna
-- migracion anterior. Sin esta migracion, CUALQUIER login o
-- refresh falla con un error SQL ("column familia_id does not
-- exist").
--
-- familia_id: agrupa todos los refresh tokens que descienden de un
--   mismo login original (el primero, emitido en completarLogin(),
--   usa su propio id como familia_id; cada rotacion posterior hereda
--   el mismo valor). Revocar una familia entera cierra la sesion en
--   TODOS los dispositivos que compartian ese login.
-- usado_en: marca el momento exacto en que un refresh token fue
--   canjeado por uno nuevo. NULL = todavia no se uso (vigente).
--   Si alguna vez llega una peticion con un token cuyo usado_en YA
--   esta poblado, es reuso (posible robo) y se revoca la familia.
-- ============================================================

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS familia_id UUID,
  ADD COLUMN IF NOT EXISTS usado_en   TIMESTAMPTZ;

-- Backfill: cualquier fila preexistente (creada antes de esta
-- migracion, con el INSERT viejo que no mandaba familia_id) no
-- tiene forma de saber a que familia pertenecia. La tratamos como
-- su propia familia de un solo elemento (su propio id), que es el
-- comportamiento mas seguro: en el peor caso, esas sesiones viejas
-- dejan de poder rotar (el usuario simplemente tiene que volver a
-- iniciar sesion), pero nunca se mezclan por error con otra familia.
UPDATE refresh_tokens SET familia_id = id WHERE familia_id IS NULL;

ALTER TABLE refresh_tokens
  ALTER COLUMN familia_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_familia ON refresh_tokens(familia_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);

INSERT INTO schema_migrations (version) VALUES ('031_refresh_tokens_rotacion')
ON CONFLICT (version) DO NOTHING;
