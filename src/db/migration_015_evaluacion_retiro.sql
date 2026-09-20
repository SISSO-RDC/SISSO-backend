-- ============================================================
-- SISSO - Migracion 015: evaluacion de retiro (HCU 080).
--
-- Segunda pieza de la Historia Clinica Ocupacional (la primera
-- fue preocupacional-inicio, migration_014). Confirmado contra el
-- instructivo oficial del MSP: el formulario de retiro es
-- notablemente MAS SIMPLE que el preocupacional -no tiene motivo
-- de consulta, antecedentes laborales/familiares, matriz de
-- riesgo detallada, revision de organos y sistemas, ni bloque de
-- aptitud medica (en su lugar, un bloque especifico "evaluacion
-- medica de retiro": si se realizo + observaciones)-. Comparte
-- con preocupacional: antecedentes clinico-quirurgicos, accidentes/
-- enfermedades previas, vitales, examen fisico regional,
-- resultados de examenes, diagnostico, recomendaciones, datos del
-- profesional y firma (por eso se reutilizan las columnas ya
-- existentes de esos bloques, no se duplican).
-- ============================================================

-- Se busca y elimina la restriccion CHECK de tipo_evaluacion de
-- forma dinamica (no se asume el nombre exacto que Postgres le
-- puso automaticamente, para no arriesgar que la migracion falle
-- si el nombre real es distinto al esperado).
DO $$
DECLARE
  nombre_restriccion TEXT;
BEGIN
  SELECT con.conname INTO nombre_restriccion
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'evaluaciones_ocupacionales'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%tipo_evaluacion%';

  IF nombre_restriccion IS NOT NULL THEN
    EXECUTE format('ALTER TABLE evaluaciones_ocupacionales DROP CONSTRAINT %I', nombre_restriccion);
  END IF;
END $$;

ALTER TABLE evaluaciones_ocupacionales
  ADD CONSTRAINT evaluaciones_ocupacionales_tipo_evaluacion_check
    CHECK (tipo_evaluacion IN ('preocupacional_inicio', 'retiro'));

-- ---- Campos exclusivos del formulario de retiro (Bloque A) ----
ALTER TABLE evaluaciones_ocupacionales
  ADD COLUMN fecha_inicio_labores      DATE,
  ADD COLUMN fecha_salida              DATE,
  ADD COLUMN tiempo_permanencia_meses  INTEGER,
  ADD COLUMN factores_riesgo_texto_libre TEXT;
  -- Nota: puesto_trabajo_ciuo y actividades_relevantes ya existen
  -- (de migration_014) y se reutilizan tal cual para retiro (el
  -- formulario oficial les da el mismo significado, solo que en
  -- tiempo pasado: "actividades que desempeño").

-- ---- Bloque G del formulario de retiro: evaluacion medica de retiro ----
ALTER TABLE evaluaciones_ocupacionales
  ADD COLUMN retiro_se_realizo_evaluacion BOOLEAN,
  ADD COLUMN retiro_observaciones         TEXT;
