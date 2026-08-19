-- ============================================================
-- SISSO - Migracion 019: examenes de visiometria ocupacional.
--
-- Prueba tamiz de agudeza visual, vision de colores (Ishihara) y
-- percepcion de profundidad. Mismo patron que
-- examenes_audiometria/examenes_espirometria: serie historica por
-- trabajador (un registro por examen realizado en el tiempo), no
-- un formulario que se llena una sola vez.
--
-- La agudeza visual se guarda en notacion decimal (0.1 a 1.2,
-- equivalente a Snellen: 1.0 = 20/20). Ver src/visiometria/
-- visiometria.js para el detalle completo de los umbrales de
-- clasificacion usados y su justificacion.
-- ============================================================

CREATE TABLE examenes_visiometria (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id             UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    trabajador_id               UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    medico_id                   UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,

    fecha_examen                DATE NOT NULL DEFAULT CURRENT_DATE,

    -- ---- Agudeza visual lejana (notacion decimal 0.1-1.2) ----
    od_lejana_sin_correccion    NUMERIC(3,2) CHECK (od_lejana_sin_correccion IS NULL OR od_lejana_sin_correccion BETWEEN 0.01 AND 2.0),
    od_lejana_con_correccion    NUMERIC(3,2) CHECK (od_lejana_con_correccion IS NULL OR od_lejana_con_correccion BETWEEN 0.01 AND 2.0),
    oi_lejana_sin_correccion    NUMERIC(3,2) CHECK (oi_lejana_sin_correccion IS NULL OR oi_lejana_sin_correccion BETWEEN 0.01 AND 2.0),
    oi_lejana_con_correccion    NUMERIC(3,2) CHECK (oi_lejana_con_correccion IS NULL OR oi_lejana_con_correccion BETWEEN 0.01 AND 2.0),
    ao_lejana_sin_correccion    NUMERIC(3,2) CHECK (ao_lejana_sin_correccion IS NULL OR ao_lejana_sin_correccion BETWEEN 0.01 AND 2.0),
    ao_lejana_con_correccion    NUMERIC(3,2) CHECK (ao_lejana_con_correccion IS NULL OR ao_lejana_con_correccion BETWEEN 0.01 AND 2.0),

    -- ---- Agudeza visual cercana (notacion decimal 0.1-1.2) ----
    od_cercana_sin_correccion   NUMERIC(3,2) CHECK (od_cercana_sin_correccion IS NULL OR od_cercana_sin_correccion BETWEEN 0.01 AND 2.0),
    od_cercana_con_correccion   NUMERIC(3,2) CHECK (od_cercana_con_correccion IS NULL OR od_cercana_con_correccion BETWEEN 0.01 AND 2.0),
    oi_cercana_sin_correccion   NUMERIC(3,2) CHECK (oi_cercana_sin_correccion IS NULL OR oi_cercana_sin_correccion BETWEEN 0.01 AND 2.0),
    oi_cercana_con_correccion   NUMERIC(3,2) CHECK (oi_cercana_con_correccion IS NULL OR oi_cercana_con_correccion BETWEEN 0.01 AND 2.0),
    ao_cercana_sin_correccion   NUMERIC(3,2) CHECK (ao_cercana_sin_correccion IS NULL OR ao_cercana_sin_correccion BETWEEN 0.01 AND 2.0),
    ao_cercana_con_correccion   NUMERIC(3,2) CHECK (ao_cercana_con_correccion IS NULL OR ao_cercana_con_correccion BETWEEN 0.01 AND 2.0),

    usa_correccion_optica       BOOLEAN NOT NULL DEFAULT false,
    tipo_correccion             VARCHAR(30), -- 'lentes' | 'lentes_de_contacto' | 'ambos'

    -- ---- Vision de colores (Ishihara) ----
    ishihara_laminas_correctas  SMALLINT,
    ishihara_laminas_totales    SMALLINT,

    -- ---- Percepcion de profundidad y balance muscular (opcionales) ----
    percepcion_profundidad      VARCHAR(20), -- 'normal' | 'alterada' | 'no_evaluado'
    balance_muscular            VARCHAR(20), -- 'ortoforia' | 'exoforia' | 'esoforia' | 'no_evaluado'

    -- ---- Resultados calculados por el backend (src/visiometria/visiometria.js) ----
    clasificacion_od            VARCHAR(30),
    clasificacion_oi            VARCHAR(30),
    clasificacion_ao            VARCHAR(30),
    clasificacion_colores       VARCHAR(30),
    vision_monocular_severa     BOOLEAN,
    aptitud_sugerida            VARCHAR(40),

    -- El medico siempre puede anular la sugerencia automatica; esta
    -- es la aptitud REGISTRADA (puede coincidir o no con la sugerida).
    aptitud_definida            VARCHAR(40) CHECK (aptitud_definida IN (
                                    'apto', 'apto_con_correccion_obligatoria', 'apto_con_restricciones',
                                    'requiere_evaluacion_oftalmologica', 'no_apto'
                                 )),

    observaciones                TEXT,

    creado_en                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_visiometria_organizacion ON examenes_visiometria(organizacion_id);
CREATE INDEX idx_visiometria_trabajador ON examenes_visiometria(trabajador_id);
