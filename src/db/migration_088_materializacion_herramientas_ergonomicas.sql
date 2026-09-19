-- ============================================================
-- Migracion 088: sexto tipo materializado del motor sectorial
-- (Auditoria N.17, C-17-03) -- 'herramienta_ergonomica'.
--
-- POR QUE UNA TABLA NUEVA (mismo criterio que 'riesgo'/'examen' en
-- migration_086/087, NO las tablas de resultados de ergonomia que
-- ya existen): 'herramienta_ergonomica' en el catalogo sectorial
-- es el NOMBRE DE UN METODO de evaluacion recomendado para el
-- sector (ej. "REBA (movilizacion pacientes)", "RULA (trabajo en
-- quirofano)", "Cuestionario Nordico") -- NO es una evaluacion ya
-- realizada. Las tablas evaluaciones_reba (migration_004),
-- evaluaciones_rula (migration_005) y evaluaciones_niosh
-- (migration_021) guardan resultados REALES calculados a partir de
-- posturas/cargas observadas de un trabajador/tarea especifica --
-- requieren datos de entrada (angulos, pesos, frecuencias) que el
-- catalogo sectorial simplemente no provee. Insertar ahi habria
-- significado FABRICAR una evaluacion ergonomica cuantitativa que
-- nadie realizo -- mas grave incluso que el caso de 'examen'.
--
-- herramientas_ergonomicas_organizacion es entonces el catalogo de
-- "que metodos de evaluacion ergonomica incluye el programa
-- preventivo de esta organizacion" -- realizar cada evaluacion en
-- si (con datos reales de postura/carga) sigue siendo trabajo de
-- sso en los modulos de REBA/RULA/NIOSH, igual que antes de este
-- lote.
-- ============================================================

CREATE TABLE IF NOT EXISTS herramientas_ergonomicas_organizacion (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id   UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    nombre            VARCHAR(150) NOT NULL,
    descripcion       TEXT,

    origen            VARCHAR(20) NOT NULL DEFAULT 'sectorial'
      CHECK (origen IN ('sectorial', 'manual')),

    activo            BOOLEAN NOT NULL DEFAULT true,
    creado_por        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (organizacion_id, nombre)
);

CREATE INDEX idx_herramientas_ergonomicas_organizacion_organizacion
  ON herramientas_ergonomicas_organizacion(organizacion_id);

ALTER TABLE herramientas_ergonomicas_organizacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE herramientas_ergonomicas_organizacion FORCE ROW LEVEL SECURITY;

CREATE POLICY aislamiento_tenant ON herramientas_ergonomicas_organizacion
  USING (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  ) WITH CHECK (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

COMMENT ON TABLE herramientas_ergonomicas_organizacion IS
  'Catalogo REAL de metodos de evaluacion ergonomica que el programa preventivo de la organizacion '
  'incluye (Auditoria N.17, C-17-03, sexto tipo materializado). NO son evaluaciones ya realizadas -- '
  'eso sigue siendo evaluaciones_reba/evaluaciones_rula/evaluaciones_niosh, con datos reales de postura '
  'y carga que este catalogo sectorial no provee.';

INSERT INTO schema_migrations (version) VALUES ('088_materializacion_herramientas_ergonomicas')
ON CONFLICT (version) DO NOTHING;
