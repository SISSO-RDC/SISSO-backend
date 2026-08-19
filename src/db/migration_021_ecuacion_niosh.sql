-- ============================================================
-- SISSO - Migracion 021: Ecuacion NIOSH revisada (1994) para
-- levantamiento manual de cargas. Analisis de tarea simple
-- (single-task), el mas usado en la practica. Ver
-- src/niosh/niosh.js para el detalle completo de formulas y
-- tablas (con las fuentes verificadas contra ejemplos oficiales
-- de CCOHS/NIOSH).
-- ============================================================

CREATE TABLE evaluaciones_niosh (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    trabajador_id           UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    evaluado_por            UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,

    fecha_evaluacion        DATE NOT NULL DEFAULT CURRENT_DATE,
    nombre_tarea            VARCHAR(200) NOT NULL, -- identifica que tarea/puesto se evaluo

    -- ---- Variables de entrada ----
    horizontal_cm           NUMERIC(5,1) NOT NULL CHECK (horizontal_cm > 0),
    vertical_cm             NUMERIC(5,1) NOT NULL CHECK (vertical_cm >= 0),
    distancia_vertical_cm   NUMERIC(5,1) NOT NULL CHECK (distancia_vertical_cm >= 0),
    angulo_asimetria        NUMERIC(5,1) NOT NULL CHECK (angulo_asimetria >= 0),
    frecuencia_por_min      NUMERIC(4,1) NOT NULL CHECK (frecuencia_por_min > 0),
    duracion                VARCHAR(10) NOT NULL CHECK (duracion IN ('corta', 'media', 'larga')), -- <=1h, >1-2h, >2-8h
    calidad_agarre          VARCHAR(10) NOT NULL CHECK (calidad_agarre IN ('bueno', 'regular', 'malo')),
    peso_carga_kg           NUMERIC(5,1) NOT NULL CHECK (peso_carga_kg > 0),

    -- ---- Resultados calculados por el backend ----
    hm                      NUMERIC(5,3),
    vm                      NUMERIC(5,3),
    dm                      NUMERIC(5,3),
    am                      NUMERIC(5,3),
    fm                      NUMERIC(5,3),
    cm                      NUMERIC(5,3),
    rwl_kg                  NUMERIC(6,2), -- Recommended Weight Limit
    li                      NUMERIC(6,2), -- Lifting Index
    clasificacion           VARCHAR(20) CHECK (clasificacion IN ('aceptable', 'riesgo_moderado', 'riesgo_alto', 'riesgo_muy_alto', 'no_calculable')),

    observaciones           TEXT,

    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_niosh_organizacion ON evaluaciones_niosh(organizacion_id);
CREATE INDEX idx_niosh_trabajador ON evaluaciones_niosh(trabajador_id);
