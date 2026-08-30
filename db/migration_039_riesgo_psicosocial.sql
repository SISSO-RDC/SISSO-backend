-- ============================================================
-- Migracion 039: Riesgo Psicosocial (punto 7.6 / hallazgo G6 de la
-- Auditoria SISSO N.06): "requiere un modulo especifico con
-- evaluacion, factores, nivel de riesgo, intervencion, seguimiento
-- y reevaluacion. Los datos clinicos individuales derivados de
-- atencion medica deben permanecer bajo el Medico."
--
-- SEPARACION CLINICA DELIBERADA (mismo criterio que accidentes y
-- enfermedad profesional): esta tabla guarda RESULTADOS DE RIESGO
-- (nivel, puntaje, factor organizacional como "carga mental" o
-- "liderazgo") -- nunca notas clinicas individuales de salud
-- mental. Si una evaluacion revela que un trabajador necesita
-- atencion psicologica/psiquiatrica, eso se deriva como referencia
-- clinica que vive en Historia Clinica/Enfermedad Profesional
-- (exclusivos de 'medico'); aqui solo queda el booleano
-- `derivado_atencion_medica`, igual patron que
-- `requiere_atencion_medica` en accidentes_incidentes.
--
-- Reevaluacion longitudinal: `evaluacion_anterior_id` (auto-
-- referencia) encadena evaluaciones sucesivas del mismo
-- trabajador/area, para poder ver la evolucion del riesgo en el
-- tiempo sin necesitar una tabla de "historial" aparte.
--
-- Intervencion: se resuelve reutilizando CAPA (migration_037) via
-- capa_id, igual patron que inspecciones_hallazgos -- por eso este
-- script primero AMPLIA el CHECK de capa_acciones.origen_tipo para
-- aceptar 'riesgo_psicosocial'.
-- ============================================================

ALTER TABLE capa_acciones DROP CONSTRAINT capa_acciones_origen_tipo_check;
ALTER TABLE capa_acciones ADD CONSTRAINT capa_acciones_origen_tipo_check
  CHECK (origen_tipo IN ('accidente', 'casi_accidente', 'matriz_riesgo', 'inspeccion', 'enfermedad_profesional', 'auditoria', 'manual', 'riesgo_psicosocial'));

CREATE TABLE evaluaciones_psicosociales (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    tipo_evaluacion         VARCHAR(10) NOT NULL DEFAULT 'individual' CHECK (tipo_evaluacion IN ('individual', 'grupal')),
    trabajador_id           UUID REFERENCES trabajadores(id) ON DELETE SET NULL, -- NULL si es evaluacion grupal por area
    puesto_trabajo_id       UUID REFERENCES puestos_trabajo(id) ON DELETE SET NULL,
    area                    VARCHAR(150), -- para evaluaciones grupales sin puesto especifico

    metodo                  VARCHAR(80) NOT NULL, -- ej: "CoPsoQ-Istas21", "Bateria MinTrabajo"
    fecha_evaluacion        DATE NOT NULL,
    puntaje_global          NUMERIC(6,2),
    nivel_riesgo            VARCHAR(10) NOT NULL CHECK (nivel_riesgo IN ('bajo', 'medio', 'alto', 'muy_alto')),

    estado                  VARCHAR(15) NOT NULL DEFAULT 'evaluado'
                                CHECK (estado IN ('evaluado', 'en_intervencion', 'en_seguimiento', 'cerrado')),

    evaluador_id            UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    evaluacion_anterior_id  UUID REFERENCES evaluaciones_psicosociales(id) ON DELETE SET NULL, -- cadena de reevaluacion
    capa_id                 UUID, -- referencia polimorfica a capa_acciones.id (sin FK, ver migration_037)

    derivado_atencion_medica BOOLEAN NOT NULL DEFAULT false, -- bandera de seguimiento, sin dato clinico
    observaciones_generales TEXT, -- observaciones NO clinicas (contexto organizacional)

    creado_por              UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_evalpsico_organizacion ON evaluaciones_psicosociales(organizacion_id);
CREATE INDEX idx_evalpsico_trabajador ON evaluaciones_psicosociales(trabajador_id);
CREATE INDEX idx_evalpsico_estado ON evaluaciones_psicosociales(organizacion_id, estado);
CREATE INDEX idx_evalpsico_anterior ON evaluaciones_psicosociales(evaluacion_anterior_id);

CREATE TRIGGER set_actualizado_en_evaluaciones_psicosociales
  BEFORE UPDATE ON evaluaciones_psicosociales
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

-- ------------------------------------------------------------
-- Factores evaluados (dimensiones organizacionales del riesgo
-- psicosocial: carga mental, liderazgo, compensaciones, doble
-- presencia, etc. -- nunca sintomas o diagnosticos individuales).
-- ------------------------------------------------------------
CREATE TABLE factores_psicosociales (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evaluacion_id           UUID NOT NULL REFERENCES evaluaciones_psicosociales(id) ON DELETE CASCADE,
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    factor                  VARCHAR(100) NOT NULL, -- ej: "Carga mental", "Liderazgo y relaciones sociales"
    nivel_riesgo            VARCHAR(10) NOT NULL CHECK (nivel_riesgo IN ('bajo', 'medio', 'alto', 'muy_alto')),
    puntaje                 NUMERIC(6,2),
    observacion             TEXT,

    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_factpsico_evaluacion ON factores_psicosociales(evaluacion_id);
CREATE INDEX idx_factpsico_organizacion ON factores_psicosociales(organizacion_id);


-- CORREGIDO en Auditoria N.07 (hallazgo GRAVE G-N07-02): se agrega
-- el auto-registro en schema_migrations, siguiendo la convencion ya
-- usada desde migration_030/031, para que esta migracion tambien sea
-- segura de pegar a mano en el SQL Editor de Neon (el flujo manual
-- que usa el equipo) sin quedar en un estado inconsistente frente a
-- migrate.js. ON CONFLICT DO NOTHING la hace ademas re-ejecutable.
INSERT INTO schema_migrations (version) VALUES ('039_riesgo_psicosocial')
ON CONFLICT (version) DO NOTHING;
