-- ============================================================
-- Migracion 084: primer paso de materializacion del motor
-- sectorial (Auditoria N.17, hallazgo CRITICO C-17-03).
--
-- C-17-03 senala que el motor creado en migration_083 solo
-- PROPONE y CONFIRMA, pero nunca crea el objeto real
-- correspondiente -- "el usuario puede interpretar que 'aceptar'
-- equivale a 'aplicar' cuando en realidad todavia es una
-- confirmacion almacenada". El usuario eligio 'area' como primer
-- tipo a materializar (de los 7 que existen: area, puesto, riesgo,
-- examen, herramienta_ergonomica, epp, kpi).
--
-- POR QUE HACIA FALTA UNA TABLA NUEVA: 'area' HOY NO ES UNA
-- ENTIDAD PROPIA en todo el sistema. Es unicamente una columna de
-- texto libre en trabajadores (migration_002) y en
-- puestos_trabajo.area (migration_022) -- no existia ningun
-- catalogo real al que "materializar" una propuesta de area.
-- areas_organizacion es ese catalogo: sigue el mismo patron ya
-- usado para puestos_trabajo (catalogo COMPLEMENTARIO y opcional,
-- no reemplaza ni migra los campos de texto libre existentes).
--
-- COMO SE VINCULA LA PROPUESTA CON EL OBJETO CREADO (pedido
-- explicito de C-17-03: "registrar que objeto real fue creado o
-- actualizado"): se agregan 2 columnas polimorficas a
-- propuestas_configuracion_sectorial en vez de 7 FKs nullable (una
-- por tipo) -- entidad_materializada_tabla identifica la tabla
-- destino y entidad_materializada_id el id de la fila. Sin FK de
-- base de datos a proposito (el destino cambia segun el tipo), la
-- integridad se garantiza desde el controlador, igual que el
-- patron ya usado para tabla/columna en gobierno_datos_inventario
-- (migration_069).
--
-- IMPORTANTE -- lo que esta migracion SIGUE sin resolver a
-- proposito: los otros 6 tipos (puesto, riesgo, examen,
-- herramienta_ergonomica, epp, kpi) continuan sin materializador,
-- exactamente como los dejo migration_083. Cada uno requiere su
-- propio analisis (p.ej. 'epp' ya tiene un catalogo real en
-- src/controllers/eppController.js; 'puesto' depende de que
-- 'area' ya exista). Quedan para los siguientes lotes de C-17-03.
-- ============================================================

CREATE TABLE IF NOT EXISTS areas_organizacion (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id   UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    nombre            VARCHAR(150) NOT NULL,
    descripcion       TEXT,
    activo            BOOLEAN NOT NULL DEFAULT true,

    -- Origen: 'sectorial' cuando la creo el motor de propuestas al
    -- materializar una propuesta aceptada/modificada; 'manual'
    -- reservado para una futura creacion directa (fuera de este
    -- lote -- ver comentario de tabla).
    origen            VARCHAR(20) NOT NULL DEFAULT 'sectorial'
      CHECK (origen IN ('sectorial', 'manual')),

    creado_por        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Idempotencia de materializacion (C-17-03: "no duplicar
    -- elementos existentes"): si dos propuestas distintas (o una
    -- misma organizacion creando el area por otra via en el
    -- futuro) apuntan al mismo nombre, es la MISMA area.
    UNIQUE (organizacion_id, nombre)
);

CREATE INDEX idx_areas_organizacion_organizacion ON areas_organizacion(organizacion_id);

ALTER TABLE areas_organizacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE areas_organizacion FORCE ROW LEVEL SECURITY;

CREATE POLICY aislamiento_tenant ON areas_organizacion
  USING (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  ) WITH CHECK (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

COMMENT ON TABLE areas_organizacion IS
  'Catalogo REAL de areas de la organizacion (Auditoria N.17, C-17-03, primer tipo materializado del '
  'motor sectorial). Complementario y opcional -- NO reemplaza los campos de texto libre '
  'trabajadores.area / puestos_trabajo.area (migrations 002/022), que siguen funcionando igual.';

-- ------------------------------------------------------------
-- Vinculo polimorfico propuesta -> objeto real creado/reutilizado.
-- ------------------------------------------------------------
ALTER TABLE propuestas_configuracion_sectorial
  ADD COLUMN IF NOT EXISTS entidad_materializada_tabla VARCHAR(50),
  ADD COLUMN IF NOT EXISTS entidad_materializada_id UUID;

COMMENT ON COLUMN propuestas_configuracion_sectorial.entidad_materializada_tabla IS
  'C-17-03: nombre de la tabla real donde quedo materializada esta propuesta (p.ej. areas_organizacion). '
  'NULL mientras el tipo de la propuesta no tenga materializador todavia, o si sigue pendiente/rechazada.';
COMMENT ON COLUMN propuestas_configuracion_sectorial.entidad_materializada_id IS
  'C-17-03: id de la fila real (en entidad_materializada_tabla) creada o reutilizada al aceptar/modificar '
  'esta propuesta. Sin FK de base de datos porque la tabla destino varia segun "tipo" -- la integridad '
  'la garantiza el controlador (configuracionSectorialController.js), no una constraint.';

INSERT INTO schema_migrations (version) VALUES ('084_materializacion_areas')
ON CONFLICT (version) DO NOTHING;
