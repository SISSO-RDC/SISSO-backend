-- ============================================================
-- Migracion 050: capa normativa para Historia Clinica Ocupacional
-- y bloqueo de campos retirados del flujo de captura.
--
-- CORRIGE el hallazgo CRITICO C10-01 de la Auditoria Integral SISSO
-- N.10: el modulo de historia clinica ocupacional estaba construido
-- y documentado como si el Acuerdo Ministerial MSP 0341-2019 (y sus
-- formularios HCU 077-083) fuera el marco normativo vigente
-- obligatorio. La Corte Constitucional del Ecuador, mediante
-- Sentencia 59-19-IN/24 (11 de julio de 2024), declaro la
-- inconstitucionalidad del Acuerdo con efectos diferidos (un ano
-- desde su notificacion para que el MSP emita normativa
-- sustitutiva) y ordeno expresamente que, mientras tanto, no se
-- solicite a los trabajadores informacion sobre orientacion sexual
-- ni identidad de genero.
--
-- Esta migracion:
--   1. Agrega una capa de versionado normativo (norma_aplicada,
--      version_formulario, fecha_vigencia, base_juridica) a
--      evaluaciones_ocupacionales, para que cada evaluacion quede
--      registrada con la base juridica bajo la que se realizo (en
--      vez de asumir implicitamente el Acuerdo 0341-2019).
--   2. NO borra las columnas orientacion_sexual / identidad_genero
--      ni los datos ya existentes en ellas -- la propia auditoria
--      instruye explicitamente que datos historicos de este tipo
--      "deben someterse a bloqueo, minimizacion, restriccion de
--      acceso y politica de conservacion", no a borrado unilateral
--      sin una politica legal definida. En su lugar, se documenta
--      la fecha de bloqueo y se restringe el acceso a nivel de
--      aplicacion (ver historiaClinicaController.js: estos dos
--      campos ya no se leen en NINGUNA proyeccion de respuesta,
--      para ningun rol, a partir de esta version).
-- ============================================================

ALTER TABLE evaluaciones_ocupacionales
  ADD COLUMN IF NOT EXISTS norma_aplicada TEXT,
  ADD COLUMN IF NOT EXISTS version_formulario TEXT,
  ADD COLUMN IF NOT EXISTS fecha_vigencia DATE,
  ADD COLUMN IF NOT EXISTS base_juridica TEXT;

COMMENT ON COLUMN evaluaciones_ocupacionales.norma_aplicada IS
  'Identificador corto del marco normativo bajo el cual se realizo esta evaluacion. '
  'Ver src/historiaClinica/catalogosRiesgo.js: NORMA_APLICADA_ACTUAL.';
COMMENT ON COLUMN evaluaciones_ocupacionales.version_formulario IS
  'Version del formulario/flujo de captura usado (ej. si en el futuro se retiran o agregan campos).';
COMMENT ON COLUMN evaluaciones_ocupacionales.fecha_vigencia IS
  'Fecha en la que estaba vigente la base normativa aplicada al momento de crear esta evaluacion.';
COMMENT ON COLUMN evaluaciones_ocupacionales.base_juridica IS
  'Texto explicativo de la base juridica/finalidad bajo la que se trato este conjunto de datos clinicos.';

-- Backfill de filas historicas: se documenta que fueron creadas
-- bajo el marco anterior a esta correccion, sin asumir que el
-- Acuerdo 0341-2019 siga vigente hoy.
UPDATE evaluaciones_ocupacionales
SET norma_aplicada = 'previo_a_correccion_n10_no_reclasificado',
    base_juridica = 'Evaluacion creada antes de la migracion 050. No reclasificada retroactivamente; '
                     || 'requiere revision legal/DPD antes de asumir una base juridica especifica.'
WHERE norma_aplicada IS NULL;

-- ------------------------------------------------------------
-- Bloqueo documental (no fisico) de orientacion_sexual /
-- identidad_genero: se agrega una columna que registra CUANDO se
-- bloqueo el acceso de aplicacion a estos campos, para trazabilidad
-- de cumplimiento. El bloqueo real de LECTURA se aplica en
-- historiaClinicaController.js (las proyecciones de respuesta ya no
-- incluyen estas columnas para ningun rol).
-- ------------------------------------------------------------
ALTER TABLE evaluaciones_ocupacionales
  ADD COLUMN IF NOT EXISTS campos_sensibles_bloqueados_desde TIMESTAMPTZ;

UPDATE evaluaciones_ocupacionales
SET campos_sensibles_bloqueados_desde = now()
WHERE (orientacion_sexual IS NOT NULL OR identidad_genero IS NOT NULL)
  AND campos_sensibles_bloqueados_desde IS NULL;

COMMENT ON COLUMN evaluaciones_ocupacionales.campos_sensibles_bloqueados_desde IS
  'Fecha desde la que orientacion_sexual/identidad_genero quedaron bloqueados de lectura a nivel de '
  'aplicacion (Auditoria N.10, C10-01, tras Sentencia 59-19-IN/24). NULL si la fila nunca tuvo estos datos.';

INSERT INTO schema_migrations (version) VALUES ('050_capa_normativa_historia_clinica')
ON CONFLICT (version) DO NOTHING;
