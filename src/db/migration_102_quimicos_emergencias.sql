-- ============================================================
-- Migracion 102 (Lote 4 del plan de cierre de brechas frente a
-- plataformas EHS globales -- Cority/VelocityEHS/Benchmark
-- Gensuite, ver analisis Sep 2026): quimicos/SDS y gestion de
-- emergencias (planes, simulacros, equipos criticos).
--
-- Alcance deliberadamente acotado (MVP): el inventario quimico
-- guarda la SDS VIGENTE embebida (version, fecha, archivo), sin
-- historial de versiones separado -- a diferencia de
-- documentos_control (095), que si versiona por fila. Si mas
-- adelante se necesita historial de SDS reemplazadas, se puede
-- extraer a una tabla propia sin romper esta.
-- ============================================================

-- ------------------------------------------------------------
-- 1. INVENTARIO QUIMICO
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quimicos_inventario (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    nombre_comercial        VARCHAR(150) NOT NULL,
    nombre_quimico          VARCHAR(200), -- nombre IUPAC/tecnico, si se conoce
    numero_cas              VARCHAR(20),  -- CAS Registry Number, ej: '67-64-1'
    fabricante              VARCHAR(150),
    area                    VARCHAR(150) NOT NULL, -- bodega/area donde se almacena
    cantidad_almacenada     NUMERIC(12,2),
    unidad_medida           VARCHAR(20), -- ej: 'litros', 'kg', 'galones'

    clasificacion_ghs       TEXT[], -- pictogramas GHS aplicables, texto libre (ej: 'inflamable', 'corrosivo')
    frases_h                TEXT,   -- frases de peligro (H-statements), texto libre

    sds_version             VARCHAR(30),
    sds_fecha_emision       DATE,
    sds_idioma              VARCHAR(10) DEFAULT 'es',
    sds_public_id           VARCHAR(300), -- PDF de la SDS/FDS vigente en Cloudinary

    estado                  VARCHAR(20) NOT NULL DEFAULT 'activo'
                                CHECK (estado IN ('activo', 'agotado', 'dado_de_baja')),

    creado_por              UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quimicos_inventario_organizacion ON quimicos_inventario(organizacion_id);
CREATE INDEX idx_quimicos_inventario_cas ON quimicos_inventario(organizacion_id, numero_cas);

ALTER TABLE quimicos_inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE quimicos_inventario FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON quimicos_inventario
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

-- ------------------------------------------------------------
-- 2. PLANES DE EMERGENCIA
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emergencias_planes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    nombre              VARCHAR(150) NOT NULL,
    escenario           VARCHAR(25) NOT NULL
                            CHECK (escenario IN ('incendio', 'sismo', 'derrame_quimico', 'evacuacion',
                                                   'atencion_medica', 'otro')),
    area_cobertura      VARCHAR(150),
    version             INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    vigente             BOOLEAN NOT NULL DEFAULT true,
    public_id           VARCHAR(300), -- PDF del plan en Cloudinary

    creado_por          UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_emergencias_planes_organizacion ON emergencias_planes(organizacion_id);

ALTER TABLE emergencias_planes ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergencias_planes FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON emergencias_planes
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

-- ------------------------------------------------------------
-- 3. SIMULACROS (ejecucion de un plan de emergencia)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emergencias_simulacros (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id             UUID NOT NULL REFERENCES emergencias_planes(id) ON DELETE CASCADE,
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    fecha_realizado     DATE NOT NULL,
    asistentes          INTEGER CHECK (asistentes IS NULL OR asistentes >= 0),
    duracion_minutos    INTEGER CHECK (duracion_minutos IS NULL OR duracion_minutos > 0),
    hallazgos           TEXT,
    capa_id             UUID REFERENCES capa_acciones(id) ON DELETE SET NULL,

    creado_por          UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_emergencias_simulacros_plan ON emergencias_simulacros(plan_id);
CREATE INDEX idx_emergencias_simulacros_organizacion ON emergencias_simulacros(organizacion_id);

ALTER TABLE emergencias_simulacros ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergencias_simulacros FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON emergencias_simulacros
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

-- ------------------------------------------------------------
-- 4. EQUIPOS DE EMERGENCIA (activos criticos: extintores,
-- gabinetes, alarmas, DEA, duchas/lavaojos, botiquines, kits de
-- derrame -- con su ciclo de inspeccion)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emergencias_equipos (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id             UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    tipo                        VARCHAR(25) NOT NULL
                                    CHECK (tipo IN ('extintor', 'gabinete_contraincendios', 'alarma',
                                                     'dea', 'ducha_lavaojos', 'botiquin', 'kit_derrame', 'otro')),
    codigo_identificacion       VARCHAR(60), -- ej: numero de placa/etiqueta fisica
    ubicacion                   VARCHAR(150) NOT NULL,
    estado                      VARCHAR(25) NOT NULL DEFAULT 'operativo'
                                    CHECK (estado IN ('operativo', 'requiere_mantenimiento', 'fuera_de_servicio')),
    fecha_ultima_inspeccion     DATE,
    fecha_proxima_inspeccion    DATE,

    creado_por                  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_emergencias_equipos_organizacion ON emergencias_equipos(organizacion_id);
CREATE INDEX idx_emergencias_equipos_proxima_inspeccion ON emergencias_equipos(organizacion_id, fecha_proxima_inspeccion);

ALTER TABLE emergencias_equipos ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergencias_equipos FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON emergencias_equipos
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

-- Nuevo origen de CAPA: hallazgos de un simulacro de emergencia.
ALTER TABLE capa_acciones DROP CONSTRAINT capa_acciones_origen_tipo_check;
ALTER TABLE capa_acciones ADD CONSTRAINT capa_acciones_origen_tipo_check
  CHECK (origen_tipo IN ('accidente', 'casi_accidente', 'matriz_riesgo', 'inspeccion', 'enfermedad_profesional',
                          'auditoria', 'manual', 'riesgo_psicosocial', 'higiene_industrial', 'reporte_peligro',
                          'obligacion_legal', 'permiso_trabajo', 'simulacro_emergencia'));

INSERT INTO schema_migrations (version) VALUES ('102_quimicos_emergencias')
ON CONFLICT (version) DO NOTHING;
