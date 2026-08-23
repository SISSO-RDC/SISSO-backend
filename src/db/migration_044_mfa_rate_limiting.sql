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

ALTER TABLE usuarios ADD COLUMN intentos_mfa_fallidos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN bloqueado_mfa_hasta TIMESTAMPTZ;
