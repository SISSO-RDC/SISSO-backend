-- ============================================================
-- Migracion 070: soporte de datos para calidad de maniobra ATS/ERS
-- completa (G14-07) y protocolo de broncodilatador verificable
-- (G14-08). Ver src/espirometria/espirometria.js para la logica.
-- ============================================================

ALTER TABLE examenes_espirometria
  ADD COLUMN IF NOT EXISTS calidad_numero_maniobras_aceptables SMALLINT,
  ADD COLUMN IF NOT EXISTS calidad_evaluacion_simplificada BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS calidad_aceptabilidad_maniobras JSONB,
  ADD COLUMN IF NOT EXISTS calidad_equipo JSONB,
  ADD COLUMN IF NOT EXISTS reversibilidad_protocolo JSONB,
  ADD COLUMN IF NOT EXISTS reversibilidad_protocolo_valido BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reversibilidad_motivo_no_evaluable TEXT;

COMMENT ON COLUMN examenes_espirometria.calidad_evaluacion_simplificada IS
  'G14-07: true (default) mientras no se registre aceptabilidad por maniobra -- el grado A-F/U se calcula con el pre-filtro simplificado anterior (cuenta maniobras informadas, no verifica aceptabilidad real segun criterios ATS/ERS). false solo cuando calidad_aceptabilidad_maniobras trae una entrada evaluada por maniobra.';
COMMENT ON COLUMN examenes_espirometria.calidad_aceptabilidad_maniobras IS
  'G14-07: array, una entrada por maniobra: { aceptable, bev, eofe, tos, cierreGlotico, inicioAdecuado, finalizacionAdecuada, fuga, tiempoEspiratorioS }.';
COMMENT ON COLUMN examenes_espirometria.calidad_equipo IS
  'G14-07: { marca, modelo, numeroSerie, fechaCalibracion, resultadoVerificacion, operadorId } -- trazabilidad del equipo/operador, no se usa para inferir aceptabilidad automaticamente.';
COMMENT ON COLUMN examenes_espirometria.reversibilidad_protocolo IS
  'G14-08: { farmaco, dosisMcg, horaPreIso, horaPostIso } declarado por el operador antes de calcular la respuesta broncodilatadora.';
COMMENT ON COLUMN examenes_espirometria.reversibilidad_protocolo_valido IS
  'G14-08: false (default) hasta que reversibilidad_protocolo tenga farmaco/dosis/horas completos Y el tiempo transcurrido cumpla el minimo esperado (ver MINUTOS_MINIMOS_POST_BD). Mientras sea false, reversibilidad_positiva SIEMPRE debe ser false/no evaluable, aunque el numero de cambioPctPredicho supere el umbral.';

INSERT INTO schema_migrations (version) VALUES ('070_espirometria_calidad_completa_bd_protocolo')
ON CONFLICT (version) DO NOTHING;
