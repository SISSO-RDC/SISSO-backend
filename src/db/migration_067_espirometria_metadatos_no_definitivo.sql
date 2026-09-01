-- ============================================================
-- Migracion 067: metadatos de trazabilidad de la ecuacion de
-- referencia usada en espirometria, y deja de llamar al criterio
-- "ers_ats_2022_lln" (sugeria cumplimiento definitivo con esa norma).
--
-- CORRIGE el hallazgo CRITICO C-01 de la Auditoria N.13: se pide
-- registrar ecuacion, version, poblacion de referencia, variables
-- utilizadas y metodo de LLN por cada examen, y dejar de presentar
-- el modulo como "ERS/ATS 2022 definitivo" hasta incorporar
-- GLI-2012 oficial validado. Ver src/espirometria/espirometria.js
-- para el detalle del algoritmo interino.
-- ============================================================

ALTER TABLE examenes_espirometria
  ADD COLUMN IF NOT EXISTS metadatos_referencia JSONB;

COMMENT ON COLUMN examenes_espirometria.metadatos_referencia IS
  'C-01: { ecuacionPredichos, versionAlgoritmo, poblacionReferencia, variablesUtilizadas, metodoLln, esDefinitivo, pendienteValidacion }. '
  'esDefinitivo siempre debe ser false hasta que se incorpore una tabla GLI-2012 oficial validada.';

-- Renombra el valor existente del criterio interpretativo: ya no se
-- llama "ers_ats_2022_lln" (sugiere cumplimiento pleno de esa norma).
UPDATE examenes_espirometria
SET criterio_interpretativo = 'lln_interino_no_gli'
WHERE criterio_interpretativo = 'ers_ats_2022_lln';

ALTER TABLE examenes_espirometria
  ALTER COLUMN criterio_interpretativo SET DEFAULT 'lln_interino_no_gli';

-- Backfill de metadatos minimos para examenes ya guardados (no se
-- puede reconstruir el JSONB completo con precision retroactiva sin
-- reprocesar cada examen, pero se deja constancia explicita de que
-- son examenes anteriores a esta correccion, para que un reporte no
-- los confunda con datos sin ninguna procedencia registrada).
UPDATE examenes_espirometria
SET metadatos_referencia = jsonb_build_object(
  'ecuacionPredichos', 'ECSC/ERS 1993 (Quanjer et al.), lineal por sexo/edad/talla',
  'versionAlgoritmo', 'interino_v1_no_gli_2012',
  'poblacionReferencia', 'Europea/caucasica (ECSC/ERS 1993) -- NO validada especificamente para poblacion ecuatoriana/latinoamericana',
  'variablesUtilizadas', jsonb_build_array('sexo (M/F)', 'edad', 'talla'),
  'metodoLln', 'Backfill retroactivo tras C-01 (N.13): metodo exacto no reconstruido para examenes previos a esta migracion.',
  'esDefinitivo', false,
  'pendienteValidacion', 'Sustituir por tabla GLI-2012 oficial con validacion bioestadistica/medica formal.'
)
WHERE metadatos_referencia IS NULL;

INSERT INTO schema_migrations (version) VALUES ('067_espirometria_metadatos_no_definitivo')
ON CONFLICT (version) DO NOTHING;
