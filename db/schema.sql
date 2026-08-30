-- ============================================================
-- SISSO - Esquema de base de datos
-- PostgreSQL - Arquitectura multi-tenant
--
-- Principio de diseno: TODA tabla que contenga datos de una
-- empresa cliente incluye organizacion_id. Esto es lo que
-- garantiza el aislamiento de datos entre empresas (tenants).
-- ============================================================

-- Extension necesaria para generar UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- 1. ORGANIZACIONES (las empresas que te contratan = tenants)
-- ------------------------------------------------------------
CREATE TABLE organizaciones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre          VARCHAR(200) NOT NULL,
    codigo          VARCHAR(50) UNIQUE NOT NULL, -- ej: EMPRESA-XYZ123, usado al registrar usuarios
    ruc_nit         VARCHAR(50),                  -- identificador fiscal de la empresa
    plan            VARCHAR(30) NOT NULL DEFAULT 'gratis', -- gratis | profesional | empresarial
    activa          BOOLEAN NOT NULL DEFAULT true,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. USUARIOS (login real, con contrasena hasheada)
-- ------------------------------------------------------------
CREATE TABLE usuarios (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    email               VARCHAR(255) NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,
    nombre_completo     VARCHAR(200) NOT NULL,
    rol                 VARCHAR(30) NOT NULL CHECK (rol IN ('admin', 'medico', 'sso', 'th')),
    -- admin = administrador del sistema en esa empresa
    -- medico = medico ocupacional
    -- sso = seguridad y salud ocupacional / industrial
    -- th = talento humano
    activo              BOOLEAN NOT NULL DEFAULT true,
    ultimo_login        TIMESTAMPTZ,
    intentos_fallidos   INTEGER NOT NULL DEFAULT 0,
    bloqueado_hasta      TIMESTAMPTZ,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organizacion_id, email) -- el mismo email puede existir en 2 empresas distintas
);

CREATE INDEX idx_usuarios_organizacion ON usuarios(organizacion_id);
CREATE INDEX idx_usuarios_email ON usuarios(email);

-- ------------------------------------------------------------
-- 3. REFRESH TOKENS (sesiones activas, permiten revocar acceso)
-- ------------------------------------------------------------
-- CORREGIDO (hallazgo CRITICO C1 de la auditoria de seguridad):
-- familia_id y usado_en son necesarias para la rotacion de refresh
-- tokens con deteccion de reuso (ver authController.js: refrescar()).
-- Antes solo existian en el codigo, no en el esquema. Ver tambien
-- migration_031_refresh_tokens_rotacion.sql para bases de datos que
-- ya estaban en produccion antes de este cambio.
CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id      UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    familia_id      UUID NOT NULL,
    token_hash      VARCHAR(255) NOT NULL, -- guardamos el hash, nunca el token en claro
    user_agent      VARCHAR(500),
    ip_origen       VARCHAR(64),
    expira_en       TIMESTAMPTZ NOT NULL,
    revocado        BOOLEAN NOT NULL DEFAULT false,
    usado_en        TIMESTAMPTZ, -- NULL = vigente; poblado = ya fue canjeado por uno nuevo
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_usuario ON refresh_tokens(usuario_id);
CREATE INDEX idx_refresh_tokens_familia ON refresh_tokens(familia_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);

-- ------------------------------------------------------------
-- 4. AUDITORIA (quien hizo que, cuando - requisito legal para
--    sistemas con datos clinicos)
-- ------------------------------------------------------------
CREATE TABLE auditoria (
    id              BIGSERIAL PRIMARY KEY,
    organizacion_id UUID REFERENCES organizaciones(id) ON DELETE SET NULL,
    usuario_id      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    accion          VARCHAR(100) NOT NULL,   -- ej: 'login_exitoso', 'login_fallido', 'crear_trabajador', 'ver_historia_clinica'
    entidad         VARCHAR(100),            -- ej: 'trabajador', 'examen_medico'
    entidad_id      UUID,
    detalle         JSONB,                   -- contexto adicional en formato JSON
    ip_origen       VARCHAR(64),
    user_agent      VARCHAR(500),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auditoria_organizacion ON auditoria(organizacion_id);
CREATE INDEX idx_auditoria_usuario ON auditoria(usuario_id);
CREATE INDEX idx_auditoria_creado_en ON auditoria(creado_en);

-- ------------------------------------------------------------
-- Trigger generico para mantener actualizado "actualizado_en"
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_set_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_actualizado_en_organizaciones
  BEFORE UPDATE ON organizaciones
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

CREATE TRIGGER set_actualizado_en_usuarios
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

-- ------------------------------------------------------------
-- NOTA PARA EXTENDER MAS ADELANTE:
-- Las tablas de trabajadores, examenes_medicos, certificados, etc.
-- (Fase 2) seguiran este mismo patron: SIEMPRE con organizacion_id
-- y SIEMPRE registrando en "auditoria" cuando se lean o modifiquen
-- datos clinicos.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 5. SCHEMA_MIGRATIONS (hallazgo CRITICO C2 de la auditoria de
--    seguridad): registro de que migraciones ya se aplicaron en
--    esta base de datos concreta. migrate.js la consulta antes de
--    aplicar cada migration_XXX_*.sql, para no volver a aplicar una
--    que ya corrio (a mano en Neon o via este mismo script) ni
--    saltarse una por error.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(100) PRIMARY KEY,
    aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('001_schema_base')
ON CONFLICT (version) DO NOTHING;
