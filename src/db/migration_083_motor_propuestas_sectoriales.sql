-- ============================================================
-- Migracion 083: motor base de propuestas/confirmaciones del
-- configurador sectorial.
--
-- CORRIGE el hallazgo principal de la Auditoria N.16 (Seccion 4,
-- "EL CONFIGURADOR SECTORIAL EXISTE, PERO TODAVIA NO ES UN MOTOR
-- DE CONFIGURACION GLOBAL") y sienta la arquitectura recomendada en
-- la Seccion 16 del informe:
--   catalogo_sectores (ya existe, migration_077)
--   perfil_sectorial_organizacion (ya existe: columnas en
--     organizaciones, migration_078)
--   propuestas_configuracion_sectorial   <- esta migracion
--   confirmaciones_configuracion_sectorial <- esta migracion
--   reglas_exposicion_sectorial / reglas_normativas / motor_aplicacion
--     -> quedan para P1 posterior, no forman parte de este lote.
--
-- ALCANCE DELIBERADAMENTE LIMITADO (lote "motor base", elegido por
-- el usuario como primer lote de N.17): esta migracion crea el
-- motor de PROPUESTA + REVISION + AUDITORIA. NO materializa
-- todavia las propuestas aceptadas dentro de areas/puestos_trabajo/
-- catalogo_epp/herramientas ergonomicas/indicadores reales -- eso
-- es exactamente lo que la auditoria separa en G-16-02 a G-16-06
-- ("boton Agregar/Generar borrador con confirmacion") y queda para
-- el siguiente lote. Por eso "aplicado"/"aplicado_en" quedan como
-- columnas reservadas (slot), sin logica que las use aun, mismo
-- criterio ya usado para "normaReferencia" en migration_081.
--
-- DISENO -- por que 2 tablas y no 1:
--   propuestas_configuracion_sectorial es el ESTADO ACTUAL de cada
--   propuesta (una fila por elemento sugerido, se actualiza in-place
--   cuando se acepta/rechaza/modifica).
--   confirmaciones_configuracion_sectorial es el HISTORIAL
--   INMUTABLE de cada accion tomada sobre una propuesta (generada/
--   aceptada/rechazada/modificada), append-only igual que la tabla
--   `auditoria` (migration_047) -- necesario porque G-16-07 exige
--   explicitamente una prueba de "auditoria de cambios" para el
--   configurador, y una sola tabla mutable no deja rastro de
--   revisiones previas si una propuesta se modifica mas de una vez.
--
-- clave_item: identidad ESTABLE del elemento sugerido dentro de su
-- tipo (el nombre del area/EPP/herramienta tal cual viene del
-- catalogo, o el campo "nombre" para riesgos/examenes/kpis). Se usa
-- para el UNIQUE de idempotencia: volver a generar propuestas para
-- la misma organizacion NUNCA duplica una propuesta ya existente
-- (sea cual sea su estado) -- si fue rechazada, se respeta esa
-- decision y no se vuelve a proponer sola sin que un humano la
-- revoque explicitamente primero (fuera del alcance de este lote).
-- ============================================================

CREATE TABLE IF NOT EXISTS propuestas_configuracion_sectorial (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id       UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    -- 7 tipos: los 7 arreglos de sugerencias que catalogo_sectores
    -- realmente tiene (riesgos, areas, examenes_sugeridos,
    -- herramientas_ergonomicas, epp_sugerido, kpis_sugeridos,
    -- puestos_frecuentes). "plan_vigilancia" y "elemento de matriz
    -- de riesgos" (mencionados en la Seccion 4 del informe) NO se
    -- incluyen como tipos propios aqui porque no existe todavia una
    -- columna de origen para ellos en catalogo_sectores -- derivarlos
    -- de "riesgo" + "examen" es logica de negocio del siguiente lote
    -- (G-16-02), no infraestructura del motor base.
    tipo                  VARCHAR(30) NOT NULL
      CHECK (tipo IN ('area', 'puesto', 'riesgo', 'examen', 'herramienta_ergonomica', 'epp', 'kpi')),

    clave_item            VARCHAR(200) NOT NULL,
    clave_sector          VARCHAR(50) REFERENCES catalogo_sectores(clave) ON DELETE SET NULL,

    -- Snapshot del elemento tal como estaba en catalogo_sectores al
    -- momento de generar la propuesta -- si el catalogo global
    -- cambia despues, esta propuesta ya generada no cambia con el
    -- (misma razon que examenes_sugeridos.metadatosReferencia se
    -- persiste por examen en vez de recalcularse, ver migration_067).
    datos_propuestos      JSONB NOT NULL,

    -- Solo se llena cuando estado = 'modificada': el dato que el
    -- revisor edito antes de aceptar, distinto del original propuesto.
    datos_confirmados      JSONB,

    estado                VARCHAR(20) NOT NULL DEFAULT 'pendiente'
      CHECK (estado IN ('pendiente', 'aceptada', 'rechazada', 'modificada')),

    generado_por          UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    generado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),

    revisado_por          UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    revisado_en           TIMESTAMPTZ,
    comentario_revision   TEXT,

    -- Reservado para el lote de aplicacion confirmable (G-16-02 a
    -- G-16-06). El motor base (esta migracion) los deja siempre en
    -- false/NULL -- ningun controlador de este lote los escribe.
    aplicado              BOOLEAN NOT NULL DEFAULT false,
    aplicado_en           TIMESTAMPTZ,

    UNIQUE (organizacion_id, tipo, clave_item)
);

CREATE INDEX idx_propuestas_config_sectorial_organizacion
  ON propuestas_configuracion_sectorial(organizacion_id);
CREATE INDEX idx_propuestas_config_sectorial_estado
  ON propuestas_configuracion_sectorial(organizacion_id, estado);

ALTER TABLE propuestas_configuracion_sectorial ENABLE ROW LEVEL SECURITY;
ALTER TABLE propuestas_configuracion_sectorial FORCE ROW LEVEL SECURITY;

CREATE POLICY aislamiento_tenant ON propuestas_configuracion_sectorial
  USING (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  ) WITH CHECK (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

COMMENT ON TABLE propuestas_configuracion_sectorial IS
  'Motor base del configurador sectorial (Auditoria N.16 Seccion 4/16, corregido en N.17). '
  'Estado actual de cada elemento sugerido por catalogo_sectores para una organizacion: '
  'pendiente de revision, aceptado, rechazado o modificado. No aplica todavia el contenido '
  'a los modulos reales (areas/puestos/EPP/ergonomia/indicadores) -- ver columna "aplicado".';

-- ------------------------------------------------------------
-- Historial inmutable de acciones sobre cada propuesta.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS confirmaciones_configuracion_sectorial (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- SET NULL (no CASCADE): igual que en `auditoria`
    -- (migration_047), para que un DELETE en cascada desde
    -- organizaciones/usuarios/propuestas jamas dispare un DELETE
    -- sobre esta tabla -- el trigger append-only de mas abajo
    -- bloquearia esa cascada. El registro historico sobrevive
    -- aunque pierda el vinculo a una entidad ya eliminada.
    propuesta_id      UUID REFERENCES propuestas_configuracion_sectorial(id) ON DELETE SET NULL,
    organizacion_id   UUID REFERENCES organizaciones(id) ON DELETE SET NULL,

    accion            VARCHAR(20) NOT NULL
      CHECK (accion IN ('generada', 'aceptada', 'rechazada', 'modificada')),
    datos             JSONB,
    comentario        TEXT,
    usuario_id        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_confirmaciones_config_sectorial_propuesta
  ON confirmaciones_configuracion_sectorial(propuesta_id);
CREATE INDEX idx_confirmaciones_config_sectorial_organizacion
  ON confirmaciones_configuracion_sectorial(organizacion_id);

ALTER TABLE confirmaciones_configuracion_sectorial ENABLE ROW LEVEL SECURITY;
ALTER TABLE confirmaciones_configuracion_sectorial FORCE ROW LEVEL SECURITY;

CREATE POLICY aislamiento_tenant ON confirmaciones_configuracion_sectorial
  USING (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  ) WITH CHECK (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

-- Append-only: mismo patron y misma justificacion que
-- auditoria_bloquear_modificacion() en migration_047 (REVOKE no
-- basta porque el rol de conexion es dueño de la tabla). Se permite
-- UNICAMENTE que propuesta_id/organizacion_id/usuario_id pasen a
-- NULL por una integridad referencial ON DELETE SET NULL; cualquier
-- otro cambio, o cualquier DELETE, se bloquea siempre.
CREATE OR REPLACE FUNCTION confirmaciones_config_sectorial_bloquear_modificacion()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.accion IS NOT DISTINCT FROM OLD.accion
       AND NEW.datos IS NOT DISTINCT FROM OLD.datos
       AND NEW.comentario IS NOT DISTINCT FROM OLD.comentario
       AND NEW.creado_en IS NOT DISTINCT FROM OLD.creado_en
       AND (NEW.propuesta_id IS NOT DISTINCT FROM OLD.propuesta_id OR NEW.propuesta_id IS NULL)
       AND (NEW.organizacion_id IS NOT DISTINCT FROM OLD.organizacion_id OR NEW.organizacion_id IS NULL)
       AND (NEW.usuario_id IS NOT DISTINCT FROM OLD.usuario_id OR NEW.usuario_id IS NULL)
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'confirmaciones_configuracion_sectorial es append-only: no se permite modificar un registro existente. (Auditoria N.16, G-16-07)';
  END IF;

  RAISE EXCEPTION 'confirmaciones_configuracion_sectorial es append-only: no se permite eliminar registros existentes. (Auditoria N.16, G-16-07)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS confirmaciones_config_sectorial_inmutable ON confirmaciones_configuracion_sectorial;
CREATE TRIGGER confirmaciones_config_sectorial_inmutable
  BEFORE UPDATE OR DELETE ON confirmaciones_configuracion_sectorial
  FOR EACH ROW EXECUTE FUNCTION confirmaciones_config_sectorial_bloquear_modificacion();

COMMENT ON TABLE confirmaciones_configuracion_sectorial IS
  'Historial append-only de cada accion (generada/aceptada/rechazada/modificada) sobre una '
  'propuesta de configuracion sectorial. Requerido por G-16-07 (Auditoria N.16): "auditoria de cambios" '
  'dedicada del configurador, ademas de (no en reemplazo de) la tabla auditoria general.';

INSERT INTO schema_migrations (version) VALUES ('083_motor_propuestas_sectoriales')
ON CONFLICT (version) DO NOTHING;
