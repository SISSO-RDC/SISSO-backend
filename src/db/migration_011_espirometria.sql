-- ============================================================
-- SISSO - Migracion 011: espirometria ocupacional (ATS/ERS 2005)
-- con ecuaciones de referencia ECSC/ERS 1993 (Quanjer 1993).
--
-- PARTE 1: CORRIGE UN BUG PREEXISTENTE.
--   src/controllers/audiometriaController.js consulta la columna
--   "fecha_nacimiento" de trabajadores para calcular la edad (usada
--   en la clasificacion de presbiacusia), pero esa columna nunca
--   se creo en migration_002_trabajadores.sql. Esto hace que el
--   registro de examenes de audiometria falle con un error de SQL
--   ("column fecha_nacimiento does not exist"), o que la edad se
--   use incorrectamente segun como maneje el error el pool.
--
--   La espirometria TAMBIEN necesita sexo, edad y talla para
--   calcular los valores predichos (ECSC/ERS 1993 depende de
--   sexo/edad/talla). Por eso esta migracion agrega de una vez
--   los 4 campos antropometricos que le faltan a trabajadores,
--   beneficiando a ambos modulos.
--
--   Los campos se agregan NULLABLE para no romper trabajadores ya
--   existentes; el frontend debe pedirlos al registrar un nuevo
--   examen (audiometria o espirometria) si aun no estan cargados.
--
-- PARTE 2: examenes_espirometria
--   -> un examen completo por trabajador y fecha, con valores
--      PRE-broncodilatador (obligatorios) y POST-broncodilatador
--      (opcionales, si se hizo prueba de reversibilidad).
--   -> el calculo de predichos, LLN, %predicho, patron y
--      reversibilidad lo hace el backend
--      (src/espirometria/espirometria.js), nunca SQL.
--   -> se guarda una "foto" (snapshot) del sexo/edad/talla/peso
--      usados en el calculo de ESTE examen especifico, para que si
--      el trabajador actualiza su talla despues, los examenes
--      antiguos seguan mostrando con que datos se calcularon.
-- ============================================================

-- ---- PARTE 1: datos antropometricos en trabajadores ----
ALTER TABLE trabajadores
  ADD COLUMN sexo             VARCHAR(1) CHECK (sexo IN ('M', 'F')),
  ADD COLUMN fecha_nacimiento DATE,
  ADD COLUMN talla_cm         SMALLINT CHECK (talla_cm BETWEEN 100 AND 250),
  ADD COLUMN peso_kg          NUMERIC(5,2) CHECK (peso_kg BETWEEN 20 AND 300);

-- ---- PARTE 2: examenes de espirometria ----
CREATE TABLE examenes_espirometria (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    trabajador_id           UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    medico_id               UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,

    fecha_examen            DATE NOT NULL DEFAULT CURRENT_DATE,

    -- ---- Snapshot antropometrico usado en ESTE calculo ----
    -- (no se recalculan retroactivamente si el trabajador cambia
    -- de talla/peso mas adelante; asi el historial es trazable)
    sexo_usado              VARCHAR(1) NOT NULL CHECK (sexo_usado IN ('M', 'F')),
    edad_anios_usada        SMALLINT NOT NULL CHECK (edad_anios_usada BETWEEN 5 AND 120),
    talla_cm_usada          SMALLINT NOT NULL CHECK (talla_cm_usada BETWEEN 100 AND 250),
    peso_kg_usado           NUMERIC(5,2),

    -- ---- Valores medidos PRE-broncodilatador (obligatorios) ----
    fvc_pre                 NUMERIC(4,2) NOT NULL CHECK (fvc_pre > 0),   -- litros
    fev1_pre                NUMERIC(4,2) NOT NULL CHECK (fev1_pre > 0),  -- litros
    pef_pre                 NUMERIC(5,2) CHECK (pef_pre IS NULL OR pef_pre > 0),      -- L/s
    fef2575_pre             NUMERIC(5,2) CHECK (fef2575_pre IS NULL OR fef2575_pre > 0), -- L/s

    -- ---- Valores medidos POST-broncodilatador (opcionales) ----
    -- Se llenan solo si se realizo prueba de reversibilidad.
    fvc_post                NUMERIC(4,2) CHECK (fvc_post IS NULL OR fvc_post > 0),
    fev1_post               NUMERIC(4,2) CHECK (fev1_post IS NULL OR fev1_post > 0),
    pef_post                NUMERIC(5,2) CHECK (pef_post IS NULL OR pef_post > 0),
    fef2575_post            NUMERIC(5,2) CHECK (fef2575_post IS NULL OR fef2575_post > 0),
    minutos_post_broncodilatador SMALLINT, -- tiempo transcurrido desde la administracion del broncodilatador

    -- ---- Resultados calculados automaticamente por el backend ----
    -- (nunca se editan a mano; los genera espirometria.js al guardar)

    fvc_predicho             NUMERIC(4,2),
    fev1_predicho            NUMERIC(4,2),
    pef_predicho             NUMERIC(5,2),
    fef2575_predicho         NUMERIC(5,2),
    fev1_fvc_predicho        NUMERIC(5,2), -- cociente predicho (%), informativo

    fvc_lln                  NUMERIC(4,2),
    fev1_lln                 NUMERIC(4,2),

    fvc_pct_predicho         NUMERIC(5,1),
    fev1_pct_predicho        NUMERIC(5,1),
    pef_pct_predicho         NUMERIC(5,1),
    fef2575_pct_predicho     NUMERIC(5,1),
    fev1_fvc_medido          NUMERIC(5,2), -- cociente medido (%), (fev1_pre/fvc_pre)*100

    -- Patron ventilatorio (algoritmo ATS/ERS 2005). Los patrones
    -- "restrictivo" y "mixto" llevan sufijo "_sugerido" porque la
    -- espirometria NO puede confirmarlos por si sola (se requiere
    -- volumen pulmonar total / pletismografia para confirmar
    -- restriccion verdadera).
    patron                   VARCHAR(30) CHECK (patron IN (
                                'normal',
                                'obstructivo_leve', 'obstructivo_moderado',
                                'obstructivo_moderado_severo', 'obstructivo_severo',
                                'obstructivo_muy_severo',
                                'restrictivo_sugerido', 'mixto_sugerido',
                                'no_clasificable'
                            )),

    -- Reversibilidad post-broncodilatador (NULL si no hay post-BD)
    reversibilidad_positiva  BOOLEAN,
    cambio_fev1_pct          NUMERIC(5,1),
    cambio_fev1_ml           INTEGER,
    cambio_fvc_pct           NUMERIC(5,1),
    cambio_fvc_ml            INTEGER,

    observaciones            TEXT,

    creado_en                TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_espirometria_organizacion ON examenes_espirometria(organizacion_id);
CREATE INDEX idx_espirometria_trabajador ON examenes_espirometria(trabajador_id);

CREATE TRIGGER set_actualizado_en_espirometria
  BEFORE UPDATE ON examenes_espirometria
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();
