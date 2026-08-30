-- ============================================================
-- SISSO - Migracion 016: evaluacion periodica (HCU 078).
--
-- Tercera pieza de la Historia Clinica Ocupacional. Confirmado
-- contra el instructivo oficial: periodica comparte MAS bloques
-- con preocupacional que retiro (habitos toxicos, antecedentes
-- familiares, matriz de riesgo, revision de organos y sistemas,
-- aptitud medica de 4 categorias -a diferencia de retiro, que NO
-- tiene aptitud-), pero NO tiene antecedentes laborales anteriores
-- (tabla de empleos previos), datos demograficos extendidos
-- (religion/discapacidad/etc, esos son solo del ingreso) ni
-- actividades extra laborales. Agrega 2 campos propios:
-- "incidentes" y "tiempo en el puesto actual".
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
    CHECK (tipo_evaluacion IN ('preocupacional_inicio', 'retiro', 'periodica'));

-- ---- Campos exclusivos de la evaluacion periodica ----
ALTER TABLE evaluaciones_ocupacionales
  ADD COLUMN incidentes                  TEXT,
  ADD COLUMN tiempo_puesto_actual_meses  INTEGER;
