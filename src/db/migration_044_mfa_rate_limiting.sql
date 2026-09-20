-- ============================================================
-- Migracion 044: Rate limiting especifico para verificacion de
-- codigo TOTP en login (hallazgo GRAVE G1 de la Auditoria Integral
-- 2026-08-22): "El endpoint POST /api/auth/mfa/verificar-login
-- comprueba el codigo TOTP, pero no existe un limite especifico de
-- intentos TOTP. Un atacante que conozca email y contraseña podria
-- intentar codigos TOTP repetidamente durante la vida util del
-- mfaToken."
--
-- Se agregan columnas DEDICADAS (no se reutiliza
-- intentos_fallidos/bloqueado_hasta, que son del PASSWORD): un
-- usuario que acierta la contraseña pero falla el codigo TOTP no
-- deberia quedar bloqueado por el mecanismo de password, serian dos
-- conceptos distintos mezclados en el mismo contador.
-- ============================================================

-- CORREGIDO en Auditoria N.07 (hallazgo GRAVE G-N07-02): agrega
-- IF NOT EXISTS a cada ADD COLUMN para que el script sea repetible
-- si alguna vez se ejecuta manualmente (Neon SQL Editor) sin pasar
-- por migrate.js -- por ejemplo, si migrate.js ya la aplico y
-- registro en schema_migrations, pero alguien la vuelve a correr a
-- mano por error. Sin esto, una segunda ejecucion fallaria con
-- "column already exists" en vez de no hacer nada.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS intentos_mfa_fallidos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bloqueado_mfa_hasta TIMESTAMPTZ;

INSERT INTO schema_migrations (version) VALUES ('044_mfa_rate_limiting')
ON CONFLICT (version) DO NOTHING;
