-- ============================================================
-- Migracion 037: CAPA (Acciones Correctivas y Preventivas)
-- transversal. Corrige el punto 19 / hallazgo G1 de la Auditoria
-- SISSO N.06: "Debe existir seguimiento hasta verificacion de
-- eficacia y cierre."
--
-- Diferencia clave frente a accidentes_acciones (migration_036):
-- aquella es especifica del ciclo de un accidente. Esta es la
-- version CENTRAL/TRANSVERSAL que puede originarse desde CUALQUIER
-- modulo (accidente, matriz de riesgos, inspeccion, enfermedad
-- profesional, auditoria, o manual), y agrega el paso que
-- accidentes_acciones no tenia: verificar que la accion se
-- IMPLEMENTO es solo el paso 1; despues hay que revisar, tiempo
-- despues, si esa accion realmente fue EFICAZ (el problema no
-- volvio a ocurrir) antes de poder cerrar el hallazgo.
--
-- Referencia POLIMORFICA deliberada: origen_tipo + origen_id (sin
-- FK) porque el origen puede ser cualquiera de varias tablas
-- distintas (accidentes_incidentes, matriz_riesgos, futuras
-- inspecciones, enfermedad_profesional, o ninguna si es manual). Un
-- FK real requeriria una tabla por cada origen o un esquema mucho
-- mas complejo; la integridad referencial de este campo la valida
-- el controlador, no la base de datos.
-- ============================================================

CREATE TABLE capa_acciones (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    origen_tipo             VARCHAR(30) NOT NULL DEFAULT 'manual'
                                CHECK (origen_tipo IN ('accidente', 'casi_accidente', 'matriz_riesgo', 'inspeccion', 'enfermedad_profesional', 'auditoria', 'manual')),
    origen_id               UUID, -- referencia polimorfica, sin FK (ver nota arriba)
    origen_descripcion      TEXT, -- contexto legible, ej: "Accidente #.. - corte en mano"

    tipo                    VARCHAR(12) NOT NULL DEFAULT 'correctiva' CHECK (tipo IN ('correctiva', 'preventiva')),
    hallazgo                TEXT NOT NULL,          -- el problema/no conformidad detectada
    descripcion_accion      TEXT NOT NULL,          -- que se va a hacer al respecto

    responsable_id          UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha_limite            DATE NOT NULL,

    -- CORRIGE el punto central del hallazgo G1: el ciclo tiene 3
    -- pasos verificables, no uno solo:
    --   1. implementada       -- el responsable dice que ya lo hizo
    --   2. verificada         -- OTRA persona confirma que se hizo
    --   3. eficaz / no_eficaz -- tiempo despues, se revisa si el
    --                            problema realmente dejo de ocurrir
    -- Solo con eficaz=true se puede pasar a 'cerrada'.
    estado                  VARCHAR(15) NOT NULL DEFAULT 'pendiente'
                                CHECK (estado IN ('pendiente', 'en_progreso', 'implementada', 'verificada', 'eficaz', 'no_eficaz', 'cerrada')),

    fecha_implementacion    DATE,

    verificado_por          UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha_verificacion      DATE,
    nota_verificacion       TEXT,

    fecha_revision_eficacia DATE,    -- cuando esta programado revisar si funciono
    evaluado_por            UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha_evaluacion_eficacia DATE,
    nota_eficacia           TEXT,

    creado_por              UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_capa_organizacion ON capa_acciones(organizacion_id);
CREATE INDEX idx_capa_estado ON capa_acciones(organizacion_id, estado);
CREATE INDEX idx_capa_origen ON capa_acciones(origen_tipo, origen_id);
CREATE INDEX idx_capa_responsable ON capa_acciones(responsable_id);
CREATE INDEX idx_capa_vencimiento ON capa_acciones(fecha_limite) WHERE estado NOT IN ('cerrada', 'eficaz');

CREATE TRIGGER set_actualizado_en_capa_acciones
  BEFORE UPDATE ON capa_acciones
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();


-- CORREGIDO en Auditoria N.07 (hallazgo GRAVE G-N07-02): se agrega
-- el auto-registro en schema_migrations, siguiendo la convencion ya
-- usada desde migration_030/031, para que esta migracion tambien sea
-- segura de pegar a mano en el SQL Editor de Neon (el flujo manual
-- que usa el equipo) sin quedar en un estado inconsistente frente a
-- migrate.js. ON CONFLICT DO NOTHING la hace ademas re-ejecutable.
INSERT INTO schema_migrations (version) VALUES ('037_capa_acciones')
ON CONFLICT (version) DO NOTHING;
