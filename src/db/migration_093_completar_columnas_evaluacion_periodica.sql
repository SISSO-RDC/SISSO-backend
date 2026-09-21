-- Migracion 093 (Auditoria N.18): completa las columnas de la evaluacion PERIODICA.
-- La 016 las agrega, pero en la copia de produccion en Neon faltaban y registrar una
-- evaluacion periodica respondia 500. Idempotente y aditiva.
ALTER TABLE evaluaciones_ocupacionales
  ADD COLUMN IF NOT EXISTS incidentes                 TEXT,
  ADD COLUMN IF NOT EXISTS tiempo_puesto_actual_meses INTEGER;

INSERT INTO schema_migrations (version) VALUES ('093_completar_columnas_evaluacion_periodica')
ON CONFLICT (version) DO NOTHING;
