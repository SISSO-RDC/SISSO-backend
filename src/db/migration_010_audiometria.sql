-- ============================================================
-- SISSO - Migracion 010: audiometria ocupacional con deteccion
-- automatica de STS y clasificacion de patron audiometrico.
--
-- Corrige los errores GRAVES #6 y #7 de la auditoria:
--
--   "#6: Falta comparacion con audiometria basal, cambio >=10 dB
--    promedio 2k-3k-4k, alerta OSHA/NIOSH."
--
--   "#7: Falta identificar: notch ocupacional 3-4-6k, presbiacusia,
--    conductiva, mixta, neurosensorial."
--
-- MODELO DE DATOS:
--   examenes_audiometria
--     -> un examen completo por trabajador y fecha, con los umbrales
--        de conduccion aerea (obligatorio) y osea (opcional) para
--        7 frecuencias estandar (500-8000 Hz), por oido.
--     -> el calculo de STS y clasificacion de patron lo hace el
--        backend (src/audiometria/audiometria.js), no SQL.
--     -> se guarda si es la audiometria BASAL del trabajador, ya
--        que el STS se calcula siempre comparando contra la basal.
--
-- CONDUCCION OSEA: se captura para permitir la clasificacion
-- correcta del tipo de perdida (conductiva = gap aereo-oseo >10dB;
-- neurosensorial = perdida osea igual a aerea; mixta = ambas).
-- ============================================================

CREATE TABLE examenes_audiometria (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    trabajador_id           UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    medico_id               UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,

    fecha_examen            DATE NOT NULL DEFAULT CURRENT_DATE,
    es_basal                BOOLEAN NOT NULL DEFAULT false, -- true = este examen es la audiometria de referencia para calcular STS futuros

    -- ---- Conduccion aerea: oido derecho (dB HL) ----
    -- Frecuencias estandar OSHA/NIOSH para audiometria ocupacional.
    -- Valores tipicos: 0-25 normal, 26-40 leve, 41-55 moderada,
    -- 56-70 moderada-severa, 71-90 severa, >90 profunda.
    -- NULL = frecuencia no evaluada en este examen.
    ca_od_500               SMALLINT CHECK (ca_od_500 BETWEEN -10 AND 120),
    ca_od_1000              SMALLINT CHECK (ca_od_1000 BETWEEN -10 AND 120),
    ca_od_2000              SMALLINT CHECK (ca_od_2000 BETWEEN -10 AND 120),
    ca_od_3000              SMALLINT CHECK (ca_od_3000 BETWEEN -10 AND 120),
    ca_od_4000              SMALLINT CHECK (ca_od_4000 BETWEEN -10 AND 120),
    ca_od_6000              SMALLINT CHECK (ca_od_6000 BETWEEN -10 AND 120),
    ca_od_8000              SMALLINT CHECK (ca_od_8000 BETWEEN -10 AND 120),

    -- ---- Conduccion aerea: oido izquierdo (dB HL) ----
    ca_oi_500               SMALLINT CHECK (ca_oi_500 BETWEEN -10 AND 120),
    ca_oi_1000              SMALLINT CHECK (ca_oi_1000 BETWEEN -10 AND 120),
    ca_oi_2000              SMALLINT CHECK (ca_oi_2000 BETWEEN -10 AND 120),
    ca_oi_3000              SMALLINT CHECK (ca_oi_3000 BETWEEN -10 AND 120),
    ca_oi_4000              SMALLINT CHECK (ca_oi_4000 BETWEEN -10 AND 120),
    ca_oi_6000              SMALLINT CHECK (ca_oi_6000 BETWEEN -10 AND 120),
    ca_oi_8000              SMALLINT CHECK (ca_oi_8000 BETWEEN -10 AND 120),

    -- ---- Conduccion osea: oido derecho (dB HL, opcional) ----
    -- Se usa para distinguir perdida conductiva (gap aereo-oseo >10dB)
    -- de neurosensorial (perdida osea igual o similar a aerea).
    co_od_500               SMALLINT CHECK (co_od_500 BETWEEN -10 AND 80),
    co_od_1000              SMALLINT CHECK (co_od_1000 BETWEEN -10 AND 80),
    co_od_2000              SMALLINT CHECK (co_od_2000 BETWEEN -10 AND 80),
    co_od_3000              SMALLINT CHECK (co_od_3000 BETWEEN -10 AND 80),
    co_od_4000              SMALLINT CHECK (co_od_4000 BETWEEN -10 AND 80),

    -- ---- Conduccion osea: oido izquierdo (dB HL, opcional) ----
    co_oi_500               SMALLINT CHECK (co_oi_500 BETWEEN -10 AND 80),
    co_oi_1000              SMALLINT CHECK (co_oi_1000 BETWEEN -10 AND 80),
    co_oi_2000              SMALLINT CHECK (co_oi_2000 BETWEEN -10 AND 80),
    co_oi_3000              SMALLINT CHECK (co_oi_3000 BETWEEN -10 AND 80),
    co_oi_4000              SMALLINT CHECK (co_oi_4000 BETWEEN -10 AND 80),

    -- ---- Resultados calculados automaticamente por el backend ----
    -- (nunca se editan a mano; los genera audiometria.js al guardar)

    -- Promedios conversacionales (500-1k-2k Hz) y agudos (2k-3k-4k Hz)
    -- por oido, para comparacion y clasificacion de severidad.
    pta_od                  NUMERIC(5,1), -- Pure Tone Average od (500-1k-2k)
    pta_oi                  NUMERIC(5,1), -- Pure Tone Average oi (500-1k-2k)

    -- STS: Standard Threshold Shift OSHA (cambio >=10 dB en promedio
    -- 2k-3k-4k Hz comparado con la audiometria basal del mismo trabajador).
    -- NULL si no hay basal disponible para comparar.
    sts_od                  NUMERIC(5,1), -- cambio en dB (positivo = empeoro)
    sts_oi                  NUMERIC(5,1),
    sts_od_positivo         BOOLEAN,      -- true si sts_od >= 10 dB (alerta OSHA)
    sts_oi_positivo         BOOLEAN,      -- true si sts_oi >= 10 dB (alerta OSHA)
    id_audiometria_basal    UUID REFERENCES examenes_audiometria(id) ON DELETE SET NULL, -- la basal usada para calcular el STS

    -- Clasificacion del patron audiometrico por oido.
    -- 'normal': PTA <= 25 dB en todas las frecuencias evaluadas.
    -- 'notch_ocupacional': caida tipica en 3k-4k-6k Hz (patron en V),
    --   hallazgo caracteristico de hipoacusia inducida por ruido (NIHL).
    -- 'neurosensorial': perdida en conduccion aerea y osea similar,
    --   sin gap significativo (> 10 dB) entre ambas.
    -- 'conductiva': perdida en conduccion aerea con osea normal o
    --   cercana a normal (gap > 10 dB), sugiere patologia de oido medio.
    -- 'mixta': perdida tanto en via aerea como osea, con gap adicional.
    -- 'presbiacusia': perdida progresiva bilateral en frecuencias agudas
    --   (>2k Hz), sin notch, en contexto de edad avanzada.
    -- 'no_clasificable': datos insuficientes para clasificar.
    patron_od               VARCHAR(25) CHECK (patron_od IN (
                                'normal','notch_ocupacional','neurosensorial',
                                'conductiva','mixta','presbiacusia','no_clasificable'
                            )),
    patron_oi               VARCHAR(25) CHECK (patron_oi IN (
                                'normal','notch_ocupacional','neurosensorial',
                                'conductiva','mixta','presbiacusia','no_clasificable'
                            )),

    observaciones           TEXT,

    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audiometria_organizacion ON examenes_audiometria(organizacion_id);
CREATE INDEX idx_audiometria_trabajador ON examenes_audiometria(trabajador_id);
CREATE INDEX idx_audiometria_basal ON examenes_audiometria(trabajador_id) WHERE es_basal = true;

CREATE TRIGGER set_actualizado_en_audiometria
  BEFORE UPDATE ON examenes_audiometria
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();
