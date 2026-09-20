-- ============================================================
-- SISSO - Migracion 022: catalogo de Puestos de Trabajo.
--
-- Trabajadores.puesto/area son campos de texto libre (migration_002)
-- y esta migracion NO los cambia -no se toca nada existente-. Este
-- es un catalogo COMPLEMENTARIO y opcional: permite a la
-- organizacion definir formalmente sus puestos de trabajo, con un
-- perfil de riesgo reutilizable (misma taxonomia de 6 categorias
-- ya usada en Historia Clinica Ocupacional Bloque F -ver
-- src/historiaClinica/catalogosRiesgo.js-, para no duplicar listas
-- de riesgos en dos lugares del sistema).
--
-- Se agrega tambien una relacion opcional (nullable) desde
-- trabajadores hacia este catalogo, para que en el futuro otros
-- modulos (NIOSH, historia clinica, matriz de riesgos) puedan
-- pre-llenar el perfil de riesgo del puesto del trabajador
-- automaticamente. No es obligatorio usarla: un trabajador puede
-- seguir teniendo solo su campo de texto libre "puesto" sin estar
-- vinculado a un registro de este catalogo.
-- ============================================================

CREATE TABLE puestos_trabajo (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    nombre_puesto           VARCHAR(150) NOT NULL,
    area                    VARCHAR(100),
    codigo_ciuo             VARCHAR(20), -- codigo CIUO opcional (mismo formato usado en Historia Clinica)
    descripcion_actividades TEXT,
    numero_trabajadores_estimado SMALLINT,

    -- Perfil de riesgo del puesto (misma forma que
    -- factores_riesgo_actual de evaluaciones_ocupacionales):
    -- { riesgosFisicos: [...], riesgosMecanicos: [...], riesgosQuimicos: [...],
    --   riesgosBiologicos: [...], riesgosErgonomicos: [...], riesgosPsicosociales: [...] }
    -- Los valores validos de cada categoria estan en
    -- src/historiaClinica/catalogosRiesgo.js (mismo catalogo fijo).
    factores_riesgo         JSONB,

    epp_requerido           TEXT, -- equipo de proteccion personal requerido (texto libre)
    medidas_preventivas     TEXT,

    activo                  BOOLEAN NOT NULL DEFAULT true,

    creado_por              UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_puestos_trabajo_organizacion ON puestos_trabajo(organizacion_id);

CREATE TRIGGER set_actualizado_en_puestos_trabajo
  BEFORE UPDATE ON puestos_trabajo
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

-- ---- Relacion opcional desde trabajadores (no rompe nada existente) ----
ALTER TABLE trabajadores
  ADD COLUMN puesto_trabajo_id UUID REFERENCES puestos_trabajo(id) ON DELETE SET NULL;
