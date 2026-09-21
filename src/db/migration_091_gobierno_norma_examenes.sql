-- ============================================================
-- Migracion 091 (Auditoria N.18, G18-05 y M18-10, P1): gobierno
-- formal de la norma y la frecuencia de los examenes del protocolo.
--
-- PROBLEMA: examenes_organizacion.frecuencia y norma_referencia son
-- texto libre; nada distingue una referencia normativa VERIFICADA
-- de una simple sugerencia sectorial.
--
-- SOLUCION: una referencia solo cuenta como verificada si tiene
-- fuente, jurisdiccion, articulo y fecha de validacion, y quien la
-- verifico (constraint). Todas las filas existentes quedan
-- 'no_verificada' -- N.16 ya establecio que ninguna norma cargada
-- estaba verificada, y este lote NO inventa ninguna. La vigencia
-- (verificada_vigente / verificada_vencida) se calcula en la API a
-- partir de vigente_hasta, no se guarda.
-- ============================================================

ALTER TABLE examenes_organizacion
  ADD COLUMN IF NOT EXISTS estado_verificacion VARCHAR(20) NOT NULL DEFAULT 'no_verificada',
  ADD COLUMN IF NOT EXISTS fuente_norma VARCHAR(250),
  ADD COLUMN IF NOT EXISTS jurisdiccion VARCHAR(80),
  ADD COLUMN IF NOT EXISTS articulo_referencia VARCHAR(150),
  ADD COLUMN IF NOT EXISTS fecha_validacion DATE,
  ADD COLUMN IF NOT EXISTS vigente_hasta DATE,
  ADD COLUMN IF NOT EXISTS verificado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verificado_en TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'examenes_organizacion_verificacion_chk'
  ) THEN
    ALTER TABLE examenes_organizacion
      ADD CONSTRAINT examenes_organizacion_verificacion_chk
      CHECK (
        estado_verificacion IN ('no_verificada', 'verificada')
        AND (
          estado_verificacion = 'no_verificada'
          OR (
            fuente_norma IS NOT NULL AND jurisdiccion IS NOT NULL
            AND articulo_referencia IS NOT NULL AND fecha_validacion IS NOT NULL
            AND verificado_en IS NOT NULL
          )
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN examenes_organizacion.estado_verificacion IS
  'no_verificada (default) | verificada. Verificada exige fuente_norma, jurisdiccion, articulo_referencia, '
  'fecha_validacion y verificado_en (Auditoria N.18, G18-05). Solo el medico la establece.';

INSERT INTO schema_migrations (version) VALUES ('091_gobierno_norma_examenes')
ON CONFLICT (version) DO NOTHING;
