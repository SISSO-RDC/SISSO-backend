-- ============================================================
-- Migracion 086: cuarto tipo materializado del motor sectorial
-- (Auditoria N.17, C-17-03) -- 'riesgo'.
--
-- POR QUE UNA TABLA NUEVA (patron identico al de 'area' en
-- migration_084) Y NO matriz_riesgos (migration_024):
-- matriz_riesgos exige juicio humano real por cada fila
-- (tipo_peligro clasificado en 6 categorias fijas,
-- peligro_especifico en texto libre, probabilidad Y consecuencia
-- 1-5 NOT NULL para calcular nivel_riesgo/clasificacion). El
-- catalogo sectorial (catalogo_sectores.riesgos) NO trae nada de
-- eso -- solo {nombre, nivel: alto|medio|bajo, descripcion, icono}
-- (ver comentario de MATERIALIZADORES.riesgo). Insertar en
-- matriz_riesgos habria significado INVENTAR probabilidad y
-- consecuencia para completar los NOT NULL -- son datos de
-- evaluacion de seguridad, no algo que este motor deba fabricar.
--
-- riesgos_organizacion es entonces un catalogo de "que riesgos
-- reconoce la organizacion como aplicables por su sector" (el
-- PRIMER paso, informativo) -- completar la evaluacion IPER real
-- de cada uno (probabilidad x consecuencia, controles) sigue
-- siendo trabajo humano en el modulo de Matriz de Riesgos, igual
-- que antes de este lote.
-- ============================================================

CREATE TABLE IF NOT EXISTS riesgos_organizacion (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id   UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    nombre            VARCHAR(150) NOT NULL,
    -- Nivel INFORMATIVO tal como lo sugiere el catalogo sectorial
    -- (alto/medio/bajo) -- NO es probabilidad x consecuencia de
    -- matriz_riesgos, es solo la severidad tipica que el sector le
    -- asigna a este riesgo en general.
    nivel             VARCHAR(10) CHECK (nivel IS NULL OR nivel IN ('alto', 'medio', 'bajo')),
    descripcion       TEXT,

    origen            VARCHAR(20) NOT NULL DEFAULT 'sectorial'
      CHECK (origen IN ('sectorial', 'manual')),

    activo            BOOLEAN NOT NULL DEFAULT true,
    creado_por        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (organizacion_id, nombre)
);

CREATE INDEX idx_riesgos_organizacion_organizacion ON riesgos_organizacion(organizacion_id);

ALTER TABLE riesgos_organizacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE riesgos_organizacion FORCE ROW LEVEL SECURITY;

CREATE POLICY aislamiento_tenant ON riesgos_organizacion
  USING (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  ) WITH CHECK (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

COMMENT ON TABLE riesgos_organizacion IS
  'Catalogo REAL de riesgos que la organizacion reconoce como aplicables (Auditoria N.17, C-17-03, cuarto '
  'tipo materializado). Es el paso informativo -- "sabemos que este riesgo nos aplica" -- NO reemplaza ni '
  'completa automaticamente la evaluacion IPER real de matriz_riesgos (probabilidad x consecuencia), que '
  'sigue siendo trabajo humano en el modulo de Matriz de Riesgos (migration_024).';

INSERT INTO schema_migrations (version) VALUES ('086_materializacion_riesgos')
ON CONFLICT (version) DO NOTHING;
