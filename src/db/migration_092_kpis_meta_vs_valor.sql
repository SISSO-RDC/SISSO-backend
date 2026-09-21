-- ============================================================
-- Migracion 092 (Auditoria N.18, G18-06, P1): conectar la META de
-- un KPI sectorial con el valor REAL que calcula /api/indicadores.
--
-- kpis_organizacion (migration_089) solo guardaba la meta como texto
-- libre ("< 2 por 100 trab/anio"). El texto NO se interpreta (seria
-- adivinar una regla de cumplimiento a partir de prosa); en su lugar
-- la persona administradora VINCULA explicitamente cada KPI con UNO
-- de los indicadores que la plataforma ya calcula (lista cerrada) y
-- declara la meta numerica y su operador. Un KPI sin vinculo no se
-- evalua -- se muestra como "sin vinculo", nunca como cumplido.
--
-- kpis_organizacion_mediciones guarda una foto por KPI y por dia
-- (la registra una accion explicita, no una lectura) para poder
-- calcular la TENDENCIA.
-- ============================================================

ALTER TABLE kpis_organizacion
  ADD COLUMN IF NOT EXISTS indicador_clave VARCHAR(60),
  ADD COLUMN IF NOT EXISTS meta_operador   VARCHAR(2),
  ADD COLUMN IF NOT EXISTS meta_valor      NUMERIC(10,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kpis_organizacion_vinculo_chk') THEN
    ALTER TABLE kpis_organizacion
      ADD CONSTRAINT kpis_organizacion_vinculo_chk
      CHECK (
        (indicador_clave IS NULL AND meta_operador IS NULL AND meta_valor IS NULL)
        OR (
          indicador_clave IN (
            'cobertura_emo_vigente_pct', 'aptitud_apto_pct',
            'cobertura_audiometria_pct', 'cobertura_espirometria_pct', 'cobertura_visiometria_pct',
            'audiometria_anormal_pct', 'espirometria_anormal_pct', 'visiometria_anormal_pct'
          )
          AND meta_operador IN ('<', '<=', '>', '>=', '=')
          AND meta_valor IS NOT NULL
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kpis_organizacion_mediciones (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id   UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    kpi_id            UUID NOT NULL REFERENCES kpis_organizacion(id) ON DELETE CASCADE,
    fecha_medicion    DATE NOT NULL DEFAULT CURRENT_DATE,
    valor             NUMERIC(10,2) NOT NULL,
    meta_operador     VARCHAR(2) NOT NULL,
    meta_valor        NUMERIC(10,2) NOT NULL,
    cumple            BOOLEAN NOT NULL,
    registrado_por    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    registrado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (kpi_id, fecha_medicion)
);

CREATE INDEX IF NOT EXISTS idx_kpis_mediciones_org ON kpis_organizacion_mediciones(organizacion_id);

ALTER TABLE kpis_organizacion_mediciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpis_organizacion_mediciones FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS aislamiento_tenant ON kpis_organizacion_mediciones;
CREATE POLICY aislamiento_tenant ON kpis_organizacion_mediciones
  USING (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  ) WITH CHECK (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

COMMENT ON TABLE kpis_organizacion_mediciones IS
  'Foto diaria (una por KPI y por dia) del valor real de un KPI vinculado frente a su meta numerica '
  '(Auditoria N.18, G18-06). Base del calculo de tendencia. Se registra con una accion explicita.';

INSERT INTO schema_migrations (version) VALUES ('092_kpis_meta_vs_valor')
ON CONFLICT (version) DO NOTHING;
