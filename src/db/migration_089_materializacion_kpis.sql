-- ============================================================
-- Migracion 089: septimo y ULTIMO tipo materializado del motor
-- sectorial (Auditoria N.17, C-17-03) -- 'kpi'. Con este lote
-- quedan los 7 tipos de C-17-03 materializados.
--
-- POR QUE UNA TABLA NUEVA: no existe ningun catalogo de "que metas
-- de KPI adopto esta organizacion" en todo el sistema.
-- indicadoresController.js (dashboard de indicadores SSO) NO tiene
-- tabla propia -- calcula todo en tiempo real agregando otras
-- tablas (trabajadores, examenes, matriz de riesgos, etc.), no
-- guarda metas objetivo. El catalogo sectorial (kpis_sugeridos)
-- trae {nombre, meta} -- ej. "Tasa de accidentes biologicos: < 2
-- por 100 trab/año" -- es una meta a adoptar, no un valor
-- calculado.
--
-- kpis_organizacion es entonces el catalogo de metas que la
-- organizacion adopto para monitorear -- NO calcula ni compara
-- automaticamente el valor real contra la meta (eso seria un
-- modulo aparte, mas alla de C-17-03: comparar esta meta con lo
-- que indicadoresController.js ya calcula en tiempo real).
-- ============================================================

CREATE TABLE IF NOT EXISTS kpis_organizacion (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id   UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    nombre            VARCHAR(150) NOT NULL,
    meta              VARCHAR(100), -- texto libre, ej: "< 2 por 100 trab/año" (igual que catalogo_sectores)
    descripcion       TEXT,

    origen            VARCHAR(20) NOT NULL DEFAULT 'sectorial'
      CHECK (origen IN ('sectorial', 'manual')),

    activo            BOOLEAN NOT NULL DEFAULT true,
    creado_por        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (organizacion_id, nombre)
);

CREATE INDEX idx_kpis_organizacion_organizacion ON kpis_organizacion(organizacion_id);

ALTER TABLE kpis_organizacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpis_organizacion FORCE ROW LEVEL SECURITY;

CREATE POLICY aislamiento_tenant ON kpis_organizacion
  USING (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  ) WITH CHECK (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

COMMENT ON TABLE kpis_organizacion IS
  'Catalogo REAL de metas de indicadores (KPI) que la organizacion adopto para monitorear (Auditoria '
  'N.17, C-17-03, septimo y ultimo tipo materializado). Solo guarda la META adoptada -- NO calcula ni '
  'compara el valor real, eso lo sigue calculando /api/indicadores (indicadoresController.js) en tiempo '
  'real; conectar ambos (comparar meta vs. valor real) queda fuera del alcance de C-17-03.';

INSERT INTO schema_migrations (version) VALUES ('089_materializacion_kpis')
ON CONFLICT (version) DO NOTHING;
