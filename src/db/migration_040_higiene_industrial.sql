-- ============================================================
-- Migracion 040: Higiene Industrial (hallazgo G4 de la Auditoria
-- SISSO N.06): "Falta registro estructurado de mediciones y
-- cumplimiento."
--
-- Una sola tabla flexible para cualquier tipo de medicion
-- (ruido, iluminacion, vibracion, agentes quimicos, estres
-- termico, etc.) contra un limite permisible, con calculo
-- automatico de cumplimiento. Si no cumple, se puede generar una
-- accion CAPA (mismo patron ya usado en inspecciones y riesgo
-- psicosocial), asi que este script tambien registra
-- 'higiene_industrial' como origen_tipo valido en capa_acciones.
-- ============================================================

ALTER TABLE capa_acciones DROP CONSTRAINT capa_acciones_origen_tipo_check;
ALTER TABLE capa_acciones ADD CONSTRAINT capa_acciones_origen_tipo_check
  CHECK (origen_tipo IN ('accidente', 'casi_accidente', 'matriz_riesgo', 'inspeccion', 'enfermedad_profesional', 'auditoria', 'manual', 'riesgo_psicosocial', 'higiene_industrial'));

CREATE TABLE mediciones_higiene_industrial (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    tipo_medicion           VARCHAR(20) NOT NULL
                                CHECK (tipo_medicion IN ('ruido', 'iluminacion', 'vibracion', 'quimico', 'estres_termico', 'polvo', 'radiacion', 'otro')),
    puesto_trabajo_id       UUID REFERENCES puestos_trabajo(id) ON DELETE SET NULL,
    area                    VARCHAR(150) NOT NULL,

    parametro               VARCHAR(120) NOT NULL, -- ej: "Nivel de presion sonora continuo equivalente", "Benceno"
    valor_medido            NUMERIC(10,3) NOT NULL,
    unidad                  VARCHAR(20) NOT NULL,  -- ej: dB(A), lux, ppm, °C, mg/m3
    limite_permisible       NUMERIC(10,3) NOT NULL,
    cumple                  BOOLEAN NOT NULL,       -- calculado en el controlador al momento de guardar

    equipo_utilizado        VARCHAR(150),
    metodo_referencia       VARCHAR(150), -- ej: "NTE INEN-ISO 9612", norma tecnica usada

    fecha_medicion          DATE NOT NULL,
    responsable_id          UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,

    capa_id                 UUID, -- referencia polimorfica a capa_acciones.id (sin FK, ver migration_037)
    observaciones           TEXT,

    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_medhig_organizacion ON mediciones_higiene_industrial(organizacion_id);
CREATE INDEX idx_medhig_tipo ON mediciones_higiene_industrial(organizacion_id, tipo_medicion);
CREATE INDEX idx_medhig_cumple ON mediciones_higiene_industrial(organizacion_id, cumple);
CREATE INDEX idx_medhig_puesto ON mediciones_higiene_industrial(puesto_trabajo_id);


-- CORREGIDO en Auditoria N.07 (hallazgo GRAVE G-N07-02): se agrega
-- el auto-registro en schema_migrations, siguiendo la convencion ya
-- usada desde migration_030/031, para que esta migracion tambien sea
-- segura de pegar a mano en el SQL Editor de Neon (el flujo manual
-- que usa el equipo) sin quedar en un estado inconsistente frente a
-- migrate.js. ON CONFLICT DO NOTHING la hace ademas re-ejecutable.
INSERT INTO schema_migrations (version) VALUES ('040_higiene_industrial')
ON CONFLICT (version) DO NOTHING;
