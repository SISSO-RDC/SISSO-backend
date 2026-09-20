-- ============================================================
-- SISSO - Migracion 017: evaluacion de reintegro (HCU 079).
--
-- Cuarta pieza de la Historia Clinica Ocupacional. Se aplica
-- obligatoriamente cuando el trabajador se reincorpora tras una
-- ausencia >= 15 dias por salud, maternidad o incapacidad laboral.
--
-- Confirmado contra el instructivo oficial: reintegro es el mas
-- simple de los 4 -no tiene habitos toxicos, antecedentes
-- familiares, matriz de riesgo ni revision de sistemas-. Solo
-- tiene: datos de la ausencia (Bloque A), enfermedad actual,
-- vitales, examen fisico regional, examenes, diagnostico, aptitud
-- (SI tiene aptitud, a diferencia de retiro) con un campo extra de
-- "reubicacion", recomendaciones, profesional y firma.
-- ============================================================

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
    CHECK (tipo_evaluacion IN ('preocupacional_inicio', 'retiro', 'periodica', 'reintegro'));

-- ---- Campos exclusivos de la evaluacion de reintegro ----
ALTER TABLE evaluaciones_ocupacionales
  ADD COLUMN fecha_ultimo_dia_laboral  DATE,
  ADD COLUMN fecha_reingreso           DATE,
  ADD COLUMN total_dias_ausencia       INTEGER,
  ADD COLUMN causa_salida              TEXT,
  ADD COLUMN aptitud_reubicacion       TEXT;
  -- Nota: aptitud_msp/aptitud_observacion/aptitud_limitacion (de
  -- migration_014) se reutilizan tal cual; reintegro solo agrega
  -- este campo extra de "reubicacion" al bloque de aptitud.
