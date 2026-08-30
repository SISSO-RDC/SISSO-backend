-- ============================================================
-- Migracion 056: extension transversal de la gobernanza de
-- finalidad/base juridica (C11-01, continuacion de migration_051).
--
-- CORRIGE PARCIALMENTE el hallazgo CRITICO C11-01 de la Auditoria
-- Integral SISSO N.11: la migracion 051 creo el catalogo
-- finalidades_tratamiento pero solo lo enlazo a
-- evaluaciones_ocupacionales y tipos_consentimiento. La auditoria
-- N.11 senala correctamente que el resto de modulos (accidentes,
-- CAPA, EPP, capacitaciones, ausentismo, ergonomia, Nordico, NIOSH,
-- riesgo psicosocial, higiene industrial, inspecciones, vigilancia
-- de la salud, enfermedad profesional, restricciones medicas)
-- seguian sin una finalidad declarada tecnicamente.
--
-- Esta migracion:
--   1. Agrega las finalidades faltantes al catalogo
--      (gestion_higiene_industrial, gestion_inspecciones,
--      gestion_vigilancia_salud).
--   2. Agrega finalidad_tratamiento_codigo a las 13 tablas listadas
--      explicitamente por la auditoria, con backfill al codigo
--      correspondiente.
--
-- ALCANCE TODAVIA NO CUBIERTO (ver RESUMEN de esta entrega): esto
-- NO implementa por si solo los puntos 2-7 de la correccion
-- obligatoria de C11-01 (categoria de dato explicita por columna,
-- responsable/encargado formal, plazos de retencion aplicados,
-- bloqueo/eliminacion automatizados, registro de transferencias).
-- Esos requieren definiciones de negocio/legales que van mas alla
-- de anadir una columna, y quedan como trabajo pendiente.
-- ============================================================

INSERT INTO finalidades_tratamiento (codigo, nombre, descripcion, base_juridica, categoria_datos, plazo_conservacion_meses) VALUES
  ('gestion_higiene_industrial',
   'Mediciones de higiene industrial',
   'Mediciones de agentes fisicos/quimicos/biologicos por puesto de trabajo y su cumplimiento normativo.',
   'Obligacion legal de identificacion y medicion de riesgos de higiene industrial.',
   'agregado_anonimizado', NULL),
  ('gestion_inspecciones',
   'Inspecciones de seguridad',
   'Inspecciones planificadas/no planificadas, hallazgos y su seguimiento via CAPA.',
   'Obligacion legal de inspeccion periodica de condiciones de trabajo.',
   'personal', 84),
  ('gestion_vigilancia_salud',
   'Programas de vigilancia de la salud',
   'Programas de vigilancia epidemiologica ocupacional (ej. conservacion auditiva, respiratoria) y sus observaciones de seguimiento.',
   'Obligacion legal de vigilancia de la salud de los trabajadores expuestos a riesgos especificos.',
   'sensible', NULL)
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE accidentes_incidentes ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'gestion_accidentes_incidentes';
UPDATE accidentes_incidentes SET finalidad_tratamiento_codigo = 'gestion_accidentes_incidentes' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE capa_acciones ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'gestion_capa';
UPDATE capa_acciones SET finalidad_tratamiento_codigo = 'gestion_capa' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE entregas_epp ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'gestion_epp';
UPDATE entregas_epp SET finalidad_tratamiento_codigo = 'gestion_epp' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE capacitaciones ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'gestion_capacitaciones';
UPDATE capacitaciones SET finalidad_tratamiento_codigo = 'gestion_capacitaciones' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE ausencias ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'gestion_ausentismo';
UPDATE ausencias SET finalidad_tratamiento_codigo = 'gestion_ausentismo' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE sesiones_evaluacion_ergonomica ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'evaluaciones_ergonomicas';
UPDATE sesiones_evaluacion_ergonomica SET finalidad_tratamiento_codigo = 'evaluaciones_ergonomicas' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE sesiones_evaluacion_rula ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'evaluaciones_ergonomicas';
UPDATE sesiones_evaluacion_rula SET finalidad_tratamiento_codigo = 'evaluaciones_ergonomicas' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE cuestionarios_nordicos ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'evaluaciones_ergonomicas';
UPDATE cuestionarios_nordicos SET finalidad_tratamiento_codigo = 'evaluaciones_ergonomicas' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE evaluaciones_niosh ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'evaluaciones_ergonomicas';
UPDATE evaluaciones_niosh SET finalidad_tratamiento_codigo = 'evaluaciones_ergonomicas' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE evaluaciones_psicosociales ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'gestion_riesgo_psicosocial';
UPDATE evaluaciones_psicosociales SET finalidad_tratamiento_codigo = 'gestion_riesgo_psicosocial' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE mediciones_higiene_industrial ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'gestion_higiene_industrial';
UPDATE mediciones_higiene_industrial SET finalidad_tratamiento_codigo = 'gestion_higiene_industrial' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE inspecciones ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'gestion_inspecciones';
UPDATE inspecciones SET finalidad_tratamiento_codigo = 'gestion_inspecciones' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE programas_vigilancia_salud ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'gestion_vigilancia_salud';
UPDATE programas_vigilancia_salud SET finalidad_tratamiento_codigo = 'gestion_vigilancia_salud' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE enfermedad_profesional ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'vigilancia_salud_ocupacional';
UPDATE enfermedad_profesional SET finalidad_tratamiento_codigo = 'vigilancia_salud_ocupacional' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE restricciones_medicas ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'vigilancia_salud_ocupacional';
UPDATE restricciones_medicas SET finalidad_tratamiento_codigo = 'vigilancia_salud_ocupacional' WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE matriz_riesgos ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo) DEFAULT 'matriz_riesgos_puesto';
UPDATE matriz_riesgos SET finalidad_tratamiento_codigo = 'matriz_riesgos_puesto' WHERE finalidad_tratamiento_codigo IS NULL;

-- Las dos tablas ya enlazadas por migration_051 no tenian DEFAULT,
-- asi que nuevas filas insertadas por codigo que no seteara el
-- campo explicitamente quedarian en NULL. Se agrega DEFAULT aqui
-- (fix-forward, sin reescribir migration_051 ya aplicada).
ALTER TABLE evaluaciones_ocupacionales ALTER COLUMN finalidad_tratamiento_codigo SET DEFAULT 'vigilancia_salud_ocupacional';

INSERT INTO schema_migrations (version) VALUES ('056_gobernanza_finalidades_extendida')
ON CONFLICT (version) DO NOTHING;
