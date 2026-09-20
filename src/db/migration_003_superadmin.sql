-- ============================================================
-- SISSO - Migracion 003: soporte para superadmin
--
-- El superadmin es el dueno de la plataforma SISSO (no de una
-- empresa cliente). No pertenece a ninguna organizacion, por
-- eso organizacion_id debe poder ser NULL solo para este rol.
-- ============================================================

-- 1. Permitir organizacion_id nulo (el superadmin no tiene empresa)
ALTER TABLE usuarios ALTER COLUMN organizacion_id DROP NOT NULL;

-- 2. Actualizar el CHECK de roles para incluir 'superadmin'
ALTER TABLE usuarios DROP CONSTRAINT usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('superadmin', 'admin', 'medico', 'sso', 'th'));

-- 3. La restriccion UNIQUE(organizacion_id, email) no funciona bien
--    con NULL en organizacion_id (Postgres permite varios NULL).
--    Para evitar dos superadmins con el mismo email, agregamos un
--    indice unico parcial solo para filas sin organizacion.
CREATE UNIQUE INDEX idx_usuarios_superadmin_email_unico
  ON usuarios (email) WHERE organizacion_id IS NULL;

-- 4. Asegurar que solo el rol superadmin puede tener organizacion_id nulo
--    (todos los demas roles SIEMPRE deben pertenecer a una empresa).
ALTER TABLE usuarios ADD CONSTRAINT usuarios_organizacion_segun_rol
  CHECK (
    (rol = 'superadmin' AND organizacion_id IS NULL)
    OR (rol != 'superadmin' AND organizacion_id IS NOT NULL)
  );
