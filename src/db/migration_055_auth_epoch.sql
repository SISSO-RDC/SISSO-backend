-- ============================================================
-- Migracion 055: auth_epoch por usuario, para invalidacion
-- practicamente inmediata de access tokens.
--
-- CORRIGE el hallazgo GRAVE G10-08 de la Auditoria Integral SISSO
-- N.10: al desactivar un usuario, cambiarle el rol, resetearle la
-- contrasena o alternar su MFA, los refresh tokens se revocaban
-- (bien), pero cualquier access token ya emitido seguia siendo
-- valido hasta su propia expiracion (hasta 15 minutos) porque el
-- JWT solo se validaba por firma/expiracion, sin ninguna referencia
-- a un estado que pudiera cambiar server-side.
--
-- auth_epoch es un contador por usuario que se incrementa cada vez
-- que ocurre un evento que deberia invalidar sesiones activas
-- (desactivacion, cambio de rol, reset de password, cambio de MFA).
-- El access token incluye el valor de auth_epoch vigente al
-- momento de emitirlo; el middleware autenticar() compara ese valor
-- contra el auth_epoch ACTUAL del usuario (con una cache corta en
-- memoria, mismo patron que organizacionEstaBloqueada() de
-- G-N09-11, para no agregar una consulta a BD en cada peticion) y
-- rechaza el token si no coincide.
-- ============================================================

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS auth_epoch INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN usuarios.auth_epoch IS
  'Contador incrementado en cada evento que debe invalidar sesiones activas '
  '(desactivacion, cambio de rol, reset de password, cambio de MFA). '
  'Ver hallazgo G10-08 y middleware/auth.js.';

INSERT INTO schema_migrations (version) VALUES ('055_auth_epoch_usuarios')
ON CONFLICT (version) DO NOTHING;
