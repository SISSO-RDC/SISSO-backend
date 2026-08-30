-- ============================================================
-- Migracion 061: soporte de columnas para la actualizacion clinica
-- de espirometria a criterios ERS/ATS 2022 y control de calidad de
-- maniobra (ATS/ERS 2019).
--
-- CORRIGE el hallazgo CRITICO C12-02 de la Auditoria Integral SISSO
-- N.12: el modulo interpretaba con ATS/ERS 2005 (cociente fijo
-- FEV1/FVC < 0.70, 80% del predicho como referencia de normalidad,
-- reversibilidad >=12%+200mL) y no registraba calidad de maniobra.
-- Ver src/espirometria/espirometria.js para el detalle del nuevo
-- algoritmo.
--
-- LIMITACION DOCUMENTADA (transparencia obligatoria hacia el equipo
-- clinico, no solo hacia el codigo): la implementacion correcta de
-- ERS/ATS 2022 en su forma mas completa usa las ecuaciones GLI-2012
-- (splines LMS con tablas de lookup por edad/sexo/etnia/talla). Esa
-- tabla de coeficientes NO se reproduce en esta migracion/codigo
-- porque requiere una fuente oficial verificada por un profesional
-- biomedico/bioestadistico antes de usarse en decisiones clinicas
-- reales -- reproducirla de memoria arriesgaria introducir un error
-- silencioso peor que el que se esta corrigiendo. En su lugar, esta
-- version:
--   1. Elimina el cociente fijo 0.70 y el 80% del predicho como
--      criterios PRINCIPALES (tal como exige la correccion
--      obligatoria de C12-02).
--   2. Calcula un LLN estadistico (percentil 5, predicho - 1.645*RSD)
--      tambien para el cociente FEV1/FVC, no solo para FVC/FEV1
--      individuales -- generalizando el mismo metodo LLN que el
--      modulo ya aplicaba a FVC y FEV1 desde la version anterior.
--   3. Dejar explicito en el codigo y en este comentario que migrar
--      a las tablas GLI-2012 oficiales (M/S/L por edad) sigue siendo
--      trabajo pendiente de cierre P0 -> requiere validacion medica
--      formal antes de reemplazar el metodo LLN generico aqui usado.
-- ============================================================

ALTER TABLE examenes_espirometria
  ADD COLUMN IF NOT EXISTS fev1_fvc_lln NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS cambio_fev1_pct_predicho NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS cambio_fvc_pct_predicho NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS calidad_numero_maniobras SMALLINT,
  ADD COLUMN IF NOT EXISTS calidad_repetibilidad_fvc_ml INTEGER,
  ADD COLUMN IF NOT EXISTS calidad_repetibilidad_fev1_ml INTEGER,
  ADD COLUMN IF NOT EXISTS calidad_grado VARCHAR(1),
  ADD COLUMN IF NOT EXISTS interpretable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS criterio_interpretativo VARCHAR(30) NOT NULL DEFAULT 'ers_ats_2022_lln';

ALTER TABLE examenes_espirometria
  ADD CONSTRAINT chk_espirometria_calidad_grado
  CHECK (calidad_grado IS NULL OR calidad_grado IN ('A','B','C','D','E','F','U'));

COMMENT ON COLUMN examenes_espirometria.interpretable IS
  'false si la prueba no cumple criterios minimos de calidad (ATS/ERS 2019): el backend no debe presentar patron como apoyo diagnostico. C12-02.';
COMMENT ON COLUMN examenes_espirometria.criterio_interpretativo IS
  'Identifica el estandar usado para clasificar el patron. "ers_ats_2022_lln" = LLN estadistico generalizado (ver limitacion documentada en esta migracion sobre tablas GLI-2012 oficiales pendientes).';

INSERT INTO schema_migrations (version) VALUES ('061_espirometria_ers_ats_2022')
ON CONFLICT (version) DO NOTHING;
