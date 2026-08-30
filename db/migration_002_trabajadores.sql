-- ============================================================
-- SISSO - Migracion 002: tabla de trabajadores
-- PostgreSQL - sigue el mismo patron multi-tenant que schema.sql:
-- toda fila pertenece a una organizacion_id especifica.
-- ============================================================

CREATE TABLE trabajadores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    nombre_completo VARCHAR(200) NOT NULL,
    documento       VARCHAR(30) NOT NULL,   -- cedula / identificacion
    area            VARCHAR(100),
    puesto          VARCHAR(150),
    fecha_emo       DATE,                   -- fecha del ultimo examen medico ocupacional
    fecha_vencimiento DATE,                 -- fecha en que vence ese examen
    aptitud         VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                        CHECK (aptitud IN ('apto', 'con_restricciones', 'no_apto', 'pendiente')),
    activo          BOOLEAN NOT NULL DEFAULT true,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organizacion_id, documento)
);

CREATE INDEX idx_trabajadores_organizacion ON trabajadores(organizacion_id);
CREATE INDEX idx_trabajadores_documento ON trabajadores(documento);

CREATE TRIGGER set_actualizado_en_trabajadores
  BEFORE UPDATE ON trabajadores
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

-- ------------------------------------------------------------
-- NOTA: trigger_set_actualizado_en() ya existe (definida en
-- schema.sql, migracion 001). No se vuelve a crear aqui.
-- ------------------------------------------------------------
