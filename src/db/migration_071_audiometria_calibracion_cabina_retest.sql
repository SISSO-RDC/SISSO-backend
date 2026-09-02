-- ============================================================
-- Migracion 071: workflow de calibracion de equipo, ambiente
-- (cabina/ruido de fondo) y retest confirmatorio de STS en
-- audiometria ocupacional.
--
-- CORRIGE el hallazgo GRAVE G14-09 (Auditoria N.14, P1): N13
-- corrigio el manejo de 0 dB, exigio 3 frecuencias para declarar
-- STS y creo el modelo de baseline vigente (migration_060), pero
-- seguian pendientes de N12: control de equipo/calibracion, ruido
-- de fondo de cabina, y un workflow de retest confirmatorio.
-- ============================================================

ALTER TABLE examenes_audiometria
  ADD COLUMN IF NOT EXISTS equipo_marca VARCHAR(120),
  ADD COLUMN IF NOT EXISTS equipo_modelo VARCHAR(120),
  ADD COLUMN IF NOT EXISTS equipo_numero_serie VARCHAR(120),
  ADD COLUMN IF NOT EXISTS equipo_fecha_calibracion DATE,
  ADD COLUMN IF NOT EXISTS equipo_resultado_verificacion_biologica VARCHAR(20)
    CHECK (equipo_resultado_verificacion_biologica IS NULL OR equipo_resultado_verificacion_biologica IN ('conforme', 'no_conforme', 'no_realizada')),
  ADD COLUMN IF NOT EXISTS ambiente_cabina_sonoamortiguada BOOLEAN,
  ADD COLUMN IF NOT EXISTS ambiente_nivel_ruido_fondo_dba NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS ambiente_cumple_ansi_s3_1 BOOLEAN,
  ADD COLUMN IF NOT EXISTS operador_id UUID REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS es_retest_confirmatorio BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS examen_original_retest_id UUID REFERENCES examenes_audiometria(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sts_confirmado_en_retest BOOLEAN,
  ADD COLUMN IF NOT EXISTS decision_medica_documentada TEXT;

COMMENT ON COLUMN examenes_audiometria.equipo_resultado_verificacion_biologica IS
  'G14-09: verificacion biologica diaria del audiometro (ANSI S3.6) antes del examen. "no_realizada" es un valor explicito, distinto de NULL (dato no registrado por examenes previos a esta correccion).';
COMMENT ON COLUMN examenes_audiometria.ambiente_nivel_ruido_fondo_dba IS
  'G14-09: nivel de ruido de fondo medido en la cabina/ambiente de prueba en dBA, para poder verificar cumplimiento de limites ANSI S3.1 por frecuencia (el limite exacto depende de la frecuencia -- este campo registra el nivel medido, no una conclusion automatica de cumplimiento).';
COMMENT ON COLUMN examenes_audiometria.es_retest_confirmatorio IS
  'G14-09: true cuando este examen es un retest realizado especificamente para confirmar un STS detectado en examen_original_retest_id. Practica estandar OSHA: un STS puede requerir retest antes de notificarse como perdida persistente.';
COMMENT ON COLUMN examenes_audiometria.sts_confirmado_en_retest IS
  'G14-09: NULL mientras no aplique/no se haya hecho retest; true/false segun el retest confirme o no el STS original. Un STS con sts_confirmado_en_retest=true SIEMPRE debe tener decision_medica_documentada.';

-- Un retest confirmatorio siempre debe declarar sobre que examen retesta.
ALTER TABLE examenes_audiometria
  ADD CONSTRAINT chk_retest_requiere_examen_original
  CHECK (NOT es_retest_confirmatorio OR examen_original_retest_id IS NOT NULL);

INSERT INTO schema_migrations (version) VALUES ('071_audiometria_calibracion_cabina_retest')
ON CONFLICT (version) DO NOTHING;
