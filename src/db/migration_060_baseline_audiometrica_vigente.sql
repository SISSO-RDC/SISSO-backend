-- ============================================================
-- Migracion 060: modelo de baseline audiometrica VIGENTE y
-- revisable por oido, con historial de revision/retest.
--
-- CORRIGE el hallazgo GRAVE G12-03 de la Auditoria Integral SISSO
-- N.12: el controlador buscaba la basal con
-- "ORDER BY fecha_examen ASC LIMIT 1" (la MAS ANTIGUA marcada
-- es_basal=true). El esquema permite varios registros con
-- es_basal=true por trabajador, pero no existia un concepto de
-- "cual de ellas es la vigente ahora" ni un flujo para sustituir la
-- basal cuando un STS persiste en un retest (practica estandar de
-- OSHA/NIOSH: un STS confirmado en retest puede ameritar revisar la
-- basal para reflejar una perdida real, no una fluctuacion).
--
-- CORRECCION:
--   1. baseline_vigente: SOLO puede haber una fila con
--      baseline_vigente = true por trabajador (indice unico parcial).
--      El controlador consulta la vigente, no la mas antigua.
--   2. baseline_revisada_en / baseline_revision_motivo /
--      baseline_revisada_por: trazabilidad de CUANDO, POR QUE y
--      QUIEN reviso la baseline (obligatorios juntos).
-- ============================================================

ALTER TABLE examenes_audiometria
  ADD COLUMN IF NOT EXISTS baseline_vigente BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS baseline_revisada_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS baseline_revision_motivo TEXT,
  ADD COLUMN IF NOT EXISTS baseline_revisada_por UUID REFERENCES usuarios(id);

ALTER TABLE examenes_audiometria
  ADD CONSTRAINT chk_baseline_revision_motivo_si_revisada
  CHECK (baseline_revisada_en IS NULL OR (baseline_revision_motivo IS NOT NULL AND baseline_revisada_por IS NOT NULL));

-- Solo puede existir UNA baseline vigente por trabajador a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_una_baseline_vigente_por_trabajador
  ON examenes_audiometria(trabajador_id)
  WHERE baseline_vigente = true;

-- Migracion de datos existentes: para cada trabajador con al menos
-- un examen es_basal=true, marca como vigente la MAS RECIENTE (antes
-- el controlador tomaba la mas antigua; al pasar a "vigente" se
-- prefiere la mas reciente porque es la que con mayor probabilidad
-- ya incorpora cualquier revision informal que se haya hecho fuera
-- del sistema). Un administrador/medico puede reasignar la vigente
-- explicitamente despues via el nuevo endpoint de revision si esto
-- no refleja la realidad clinica de un caso puntual.
WITH mas_reciente AS (
  SELECT DISTINCT ON (trabajador_id) id
  FROM examenes_audiometria
  WHERE es_basal = true
  ORDER BY trabajador_id, fecha_examen DESC, creado_en DESC
)
UPDATE examenes_audiometria e
SET baseline_vigente = true
FROM mas_reciente m
WHERE e.id = m.id;

COMMENT ON COLUMN examenes_audiometria.baseline_vigente IS
  'Marca la audiometria basal ACTUALMENTE vigente para calcular STS. Unica por trabajador (ver indice). G12-03.';
COMMENT ON COLUMN examenes_audiometria.baseline_revisada_en IS
  'Fecha en que esta baseline reemplazo a una anterior (ej. por STS confirmado en retest). NULL si es la basal original. G12-03.';

INSERT INTO schema_migrations (version) VALUES ('060_baseline_audiometrica_vigente')
ON CONFLICT (version) DO NOTHING;
