-- ============================================================
-- SISSO - Migracion 028: autenticacion de 2 factores (MFA/TOTP).
-- Corrige el hallazgo 4.11 de la auditoria de seguridad (ausencia
-- total de segundo factor de autenticacion).
--
-- Diseño: TOTP estandar (Google Authenticator, Authy, etc.),
-- opcional por usuario (cada quien lo activa desde su perfil, no
-- es obligatorio de entrada para no bloquear a nadie de golpe).
--
-- mfa_secret_pendiente guarda el secreto generado mientras el
-- usuario esta a mitad del proceso de activacion (escaneo el QR
-- pero todavia no confirmo con un codigo valido); si nunca
-- confirma, ese secreto queda ahi sin efecto (MFA sigue
-- deshabilitado) hasta que se sobreescriba con un nuevo intento.
--
-- Nota de seguridad reconocida: mfa_secret se guarda en texto
-- plano en esta version (igual que otros secretos del sistema
-- como CLOUDINARY_API_SECRET viven en variables de entorno sin
-- cifrar en la BD). Es superior a no tener MFA, pero si se
-- requiere cifrado en reposo del secreto TOTP en el futuro, se
-- puede migrar a cifrado con una clave de aplicacion (KMS/env)
-- sin cambiar la logica de verificacion.
-- ============================================================

ALTER TABLE usuarios
  ADD COLUMN mfa_habilitado       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN mfa_secret           TEXT,
  ADD COLUMN mfa_secret_pendiente TEXT;
