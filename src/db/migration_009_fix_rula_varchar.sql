-- ============================================================
-- SISSO - Migracion 009: correccion de longitud de columna en
-- evaluaciones_rula.
--
-- Bug encontrado en pruebas reales: la columna nivel_riesgo se
-- definio como VARCHAR(20) en migration_005, pero los valores
-- reales que genera el calculo RULA (src/ergonomia/rula.js)
-- incluyen 'puede_requerir_cambios' (22 caracteres) y
-- 'requiere_cambios_pronto' (23 caracteres), ambos mas largos
-- que el limite de la columna. Esto causaba el error de Postgres
-- "value too long for type character varying(20)" (codigo 22001)
-- al intentar guardar una evaluacion con esos niveles de riesgo.
--
-- Se amplia a VARCHAR(30), con margen suficiente para los 4
-- valores actuales y cualquier ajuste menor futuro.
-- ============================================================

ALTER TABLE evaluaciones_rula
  ALTER COLUMN nivel_riesgo TYPE VARCHAR(30);
