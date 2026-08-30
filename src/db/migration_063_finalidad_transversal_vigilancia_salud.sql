-- ============================================================
-- Migracion 063: cierra el ultimo grupo de tablas clinicas que
-- quedaron sin finalidad_tratamiento_codigo tras migration_056.
--
-- CORRIGE (continuacion) el hallazgo CRITICO C11-01/C12-04: al
-- revisar exhaustivamente las tablas con datos personales/sensibles
-- de trabajadores, examenes_audiometria, examenes_espirometria,
-- examenes_visiometria y registro_inmunizaciones seguian sin
-- columna de finalidad -- estas SI son datos de salud (categoria
-- especial), asi que su ausencia es tan relevante como la de las
-- 13 tablas que si cerro migration_056.
--
-- Se usa el mismo codigo 'gestion_vigilancia_salud' creado en
-- migration_056 para audiometria/espirometria/visiometria (son,
-- literalmente, los examenes de los programas de vigilancia
-- epidemiologica de conservacion auditiva/respiratoria/visual). Las
-- inmunizaciones usan 'vigilancia_salud_ocupacional' (mismo codigo
-- que enfermedad_profesional/restricciones_medicas: seguimiento
-- clinico ocupacional general, no un programa de vigilancia
-- especifico por agente de riesgo).
-- ============================================================

ALTER TABLE examenes_audiometria ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'gestion_vigilancia_salud';
UPDATE examenes_audiometria SET finalidad_tratamiento_codigo = 'gestion_vigilancia_salud' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE examenes_espirometria ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'gestion_vigilancia_salud';
UPDATE examenes_espirometria SET finalidad_tratamiento_codigo = 'gestion_vigilancia_salud' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE examenes_visiometria ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'gestion_vigilancia_salud';
UPDATE examenes_visiometria SET finalidad_tratamiento_codigo = 'gestion_vigilancia_salud' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE registro_inmunizaciones ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'vigilancia_salud_ocupacional';
UPDATE registro_inmunizaciones SET finalidad_tratamiento_codigo = 'vigilancia_salud_ocupacional' WHERE finalidad_tratamiento_codigo IS NULL;

INSERT INTO schema_migrations (version) VALUES ('063_finalidad_transversal_vigilancia_salud')
ON CONFLICT (version) DO NOTHING;
