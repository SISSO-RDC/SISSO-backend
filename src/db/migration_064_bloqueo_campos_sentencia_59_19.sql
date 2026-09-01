-- ============================================================
-- Migracion 064: extiende el bloqueo documental de C10-01/migration_050
-- a los 5 campos adicionales que la Auditoria N.13 (hallazgo CRITICO
-- C-02, P0) identifico como todavia capturables desde el body:
-- religion, antecedentes_ginecobstetricos,
-- antecedentes_ginecologicos_examenes,
-- antecedentes_reproductivos_masculinos y habitos_toxicos.
--
-- La Sentencia 59-19-IN/24 de la Corte Constitucional del Ecuador
-- (11/07/2024) identifica estos campos, junto con orientacion_sexual
-- e identidad_genero (ya bloqueados desde N.10), como parte de la
-- informacion que el Acuerdo Ministerial 0341-2019 exigia capturar
-- y que la Corte ordeno dejar de solicitar mientras el MSP no emita
-- normativa sustitutiva.
--
-- Mismo criterio que migration_050: NO se borran datos historicos
-- (eso requeriria una decision juridica formal sobre retencion/
-- eliminacion, ver docs/DPIA_SISSO.md), pero se bloquea tanto la
-- CAPTURA nueva (ya corregido en historiaClinicaController.js) como
-- la LECTURA de aplicacion (ya corregido en
-- src/utils/politicaMinimizacion.js) para CUALQUIER rol, incluido
-- medico.
-- ============================================================

UPDATE evaluaciones_ocupacionales
SET campos_sensibles_bloqueados_desde = now()
WHERE (
    religion IS NOT NULL
    OR antecedentes_ginecobstetricos IS NOT NULL
    OR antecedentes_ginecologicos_examenes IS NOT NULL
    OR antecedentes_reproductivos_masculinos IS NOT NULL
    OR habitos_toxicos IS NOT NULL
  )
  AND campos_sensibles_bloqueados_desde IS NULL;

COMMENT ON COLUMN evaluaciones_ocupacionales.campos_sensibles_bloqueados_desde IS
  'Fecha desde la que orientacion_sexual/identidad_genero (C10-01, N.10) y religion/'
  'antecedentes_ginecobstetricos/antecedentes_ginecologicos_examenes/'
  'antecedentes_reproductivos_masculinos/habitos_toxicos (C-02, N.13) quedaron bloqueados '
  'de captura y lectura a nivel de aplicacion, tras la Sentencia 59-19-IN/24. '
  'NULL si la fila nunca tuvo estos datos.';

COMMENT ON COLUMN evaluaciones_ocupacionales.religion IS
  'BLOQUEADO desde Auditoria N.13 (C-02): ver Sentencia 59-19-IN/24. No capturable ni legible desde N.13; dato historico preservado sin decision juridica de eliminacion.';
COMMENT ON COLUMN evaluaciones_ocupacionales.antecedentes_ginecobstetricos IS
  'BLOQUEADO desde Auditoria N.13 (C-02): ver comentario de religion (misma base normativa).';
COMMENT ON COLUMN evaluaciones_ocupacionales.antecedentes_ginecologicos_examenes IS
  'BLOQUEADO desde Auditoria N.13 (C-02): ver comentario de religion (misma base normativa).';
COMMENT ON COLUMN evaluaciones_ocupacionales.antecedentes_reproductivos_masculinos IS
  'BLOQUEADO desde Auditoria N.13 (C-02): ver comentario de religion (misma base normativa).';
COMMENT ON COLUMN evaluaciones_ocupacionales.habitos_toxicos IS
  'BLOQUEADO desde Auditoria N.13 (C-02): ver comentario de religion (misma base normativa).';

INSERT INTO schema_migrations (version) VALUES ('064_bloqueo_campos_sentencia_59_19')
ON CONFLICT (version) DO NOTHING;
