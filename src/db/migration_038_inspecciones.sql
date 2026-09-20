-- ============================================================
-- Migracion 038: Inspecciones de seguridad (Punto/hallazgo G3 de
-- la Auditoria SISSO N.06): "Debe existir ciclo completo de
-- hallazgo y accion."
--
-- 3 tablas: la inspeccion en si, su checklist (items sueltos,
-- flexible -- no una plantilla rigida, para que sirva tanto para
-- una inspeccion de EPP como de orden y limpieza sin rediseñar
-- nada), y los hallazgos. Cada hallazgo puede generar una accion
-- CAPA (capa_acciones, migration_037) con un solo clic -- asi se
-- cierra el ciclo completo que pide el hallazgo G3: encontrar algo
-- mal Y que quede una accion rastreable hasta el cierre.
-- ============================================================

CREATE TABLE inspecciones (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    tipo                    VARCHAR(20) NOT NULL DEFAULT 'planeada' CHECK (tipo IN ('planeada', 'no_planeada')),
    area                    VARCHAR(150) NOT NULL,
    puesto_trabajo_id       UUID REFERENCES puestos_trabajo(id) ON DELETE SET NULL,

    fecha_programada        DATE,
    fecha_ejecucion         DATE,
    inspector_id            UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,

    estado                  VARCHAR(15) NOT NULL DEFAULT 'programada'
                                CHECK (estado IN ('programada', 'en_progreso', 'completada')),
    observaciones_generales TEXT,

    creado_por              UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspec_organizacion ON inspecciones(organizacion_id);
CREATE INDEX idx_inspec_estado ON inspecciones(organizacion_id, estado);

CREATE TRIGGER set_actualizado_en_inspecciones
  BEFORE UPDATE ON inspecciones
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

-- ------------------------------------------------------------
-- Checklist flexible: items sueltos que el inspector va agregando
-- durante la inspeccion (no una plantilla fija por diseño, para
-- que sirva igual de bien para una inspeccion de EPP, de orden y
-- limpieza, o de extintores sin necesitar un catalogo de
-- plantillas por tipo).
-- ------------------------------------------------------------
CREATE TABLE inspecciones_items (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspeccion_id           UUID NOT NULL REFERENCES inspecciones(id) ON DELETE CASCADE,
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    item                    TEXT NOT NULL,
    cumple                  VARCHAR(10) NOT NULL CHECK (cumple IN ('si', 'no', 'no_aplica')),
    observacion             TEXT,

    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspecitems_inspeccion ON inspecciones_items(inspeccion_id);
CREATE INDEX idx_inspecitems_organizacion ON inspecciones_items(organizacion_id);

-- ------------------------------------------------------------
-- Hallazgos: lo que cierra el ciclo. capa_id referencia (sin FK,
-- igual que el resto de referencias polimorficas de CAPA) la
-- accion correctiva generada a partir de este hallazgo.
-- ------------------------------------------------------------
CREATE TABLE inspecciones_hallazgos (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspeccion_id           UUID NOT NULL REFERENCES inspecciones(id) ON DELETE CASCADE,
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    descripcion             TEXT NOT NULL,
    gravedad                VARCHAR(10) NOT NULL DEFAULT 'media' CHECK (gravedad IN ('baja', 'media', 'alta')),
    capa_id                 UUID, -- referencia a capa_acciones.id una vez generada la accion

    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspechall_inspeccion ON inspecciones_hallazgos(inspeccion_id);
CREATE INDEX idx_inspechall_organizacion ON inspecciones_hallazgos(organizacion_id);


-- CORREGIDO en Auditoria N.07 (hallazgo GRAVE G-N07-02): se agrega
-- el auto-registro en schema_migrations, siguiendo la convencion ya
-- usada desde migration_030/031, para que esta migracion tambien sea
-- segura de pegar a mano en el SQL Editor de Neon (el flujo manual
-- que usa el equipo) sin quedar en un estado inconsistente frente a
-- migrate.js. ON CONFLICT DO NOTHING la hace ademas re-ejecutable.
INSERT INTO schema_migrations (version) VALUES ('038_inspecciones')
ON CONFLICT (version) DO NOTHING;
