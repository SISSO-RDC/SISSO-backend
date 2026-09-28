-- ============================================================
-- Migracion 101 (Lote 3 del plan de cierre de brechas frente a
-- plataformas EHS globales -- Cority/VelocityEHS/Benchmark
-- Gensuite, ver analisis Sep 2026): contratistas, competencias
-- y permisos de trabajo (control de tareas criticas).
--
-- Estas tres capacidades comparten el mismo objetivo: controlar
-- el trabajo ANTES de que el riesgo ocurra (a diferencia de
-- incidentes/inspecciones, que registran despues). Van en una
-- sola migracion tematica, igual que el Lote 2 (095) agrupo
-- documentos/legal/auditorias.
--
-- Semaforo de cumplimiento: se calcula en el controlador (no en
-- SQL) a partir de contratistas_documentos.fecha_vencimiento y
-- competencias_asignadas.fecha_vencimiento -- mismo criterio ya
-- usado para EMO/vencimientos en el resto de la plataforma
-- (comparar fecha contra CURRENT_DATE en el momento de la
-- consulta, nunca un campo booleano que se desactualice).
-- ============================================================

-- ------------------------------------------------------------
-- 1. CONTRATISTAS (empresa contratista, no un trabajador SISSO)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contratistas (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    razon_social        VARCHAR(200) NOT NULL,
    ruc                 VARCHAR(20) NOT NULL,
    representante_legal VARCHAR(150),
    telefono_contacto   VARCHAR(30),
    correo_contacto     VARCHAR(150),
    actividad           VARCHAR(200), -- ej: 'mantenimiento electrico', 'construccion civil'

    estado              VARCHAR(20) NOT NULL DEFAULT 'activo'
                            CHECK (estado IN ('activo', 'suspendido', 'inactivo')),

    creado_por          UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (organizacion_id, ruc)
);

CREATE INDEX idx_contratistas_organizacion ON contratistas(organizacion_id);

ALTER TABLE contratistas ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratistas FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON contratistas
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

-- ------------------------------------------------------------
-- 2. DOCUMENTOS DEL CONTRATISTA (polizas, permisos, certificados
-- con vigencia -- lo que alimenta el semaforo de cumplimiento
-- antes de habilitar ingreso o emitir un permiso de trabajo)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contratistas_documentos (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contratista_id      UUID NOT NULL REFERENCES contratistas(id) ON DELETE CASCADE,
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    tipo                VARCHAR(30) NOT NULL
                            CHECK (tipo IN ('poliza_responsabilidad_civil', 'poliza_riesgos_trabajo',
                                             'permiso_municipal', 'certificado_seguridad_industrial',
                                             'rup', 'ruc', 'otro')),
    numero_documento    VARCHAR(100),
    fecha_emision       DATE,
    fecha_vencimiento   DATE, -- NULL = no vence (ej. RUC)
    public_id           VARCHAR(300), -- PDF/imagen en Cloudinary

    creado_por          UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contratistas_documentos_contratista ON contratistas_documentos(contratista_id);
CREATE INDEX idx_contratistas_documentos_organizacion ON contratistas_documentos(organizacion_id);

ALTER TABLE contratistas_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratistas_documentos FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON contratistas_documentos
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

-- ------------------------------------------------------------
-- 3. TRABAJADORES DEL CONTRATISTA (personal externo -- NO son
-- filas de `trabajadores`, que es exclusivamente personal propio
-- con historia clinica ocupacional; mezclar ambos violaria la
-- separacion clinica/operativa que ya es un diferencial de SISSO)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contratistas_trabajadores (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contratista_id      UUID NOT NULL REFERENCES contratistas(id) ON DELETE CASCADE,
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    nombre_completo     VARCHAR(150) NOT NULL,
    cedula              VARCHAR(20) NOT NULL,
    cargo               VARCHAR(150),
    estado              VARCHAR(20) NOT NULL DEFAULT 'activo'
                            CHECK (estado IN ('activo', 'inactivo')),

    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (organizacion_id, cedula)
);

CREATE INDEX idx_contratistas_trabajadores_contratista ON contratistas_trabajadores(contratista_id);
CREATE INDEX idx_contratistas_trabajadores_organizacion ON contratistas_trabajadores(organizacion_id);

ALTER TABLE contratistas_trabajadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratistas_trabajadores FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON contratistas_trabajadores
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

-- ------------------------------------------------------------
-- 4. CATALOGO DE COMPETENCIAS (por organizacion -- cada empresa
-- define que certificaciones/licencias exige para que rango de
-- cargos, propios o de contratistas)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competencias_catalogo (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    nombre              VARCHAR(150) NOT NULL,
    descripcion         TEXT,
    vigencia_meses      INTEGER CHECK (vigencia_meses IS NULL OR vigencia_meses > 0), -- NULL = no vence

    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (organizacion_id, nombre)
);

ALTER TABLE competencias_catalogo ENABLE ROW LEVEL SECURITY;
ALTER TABLE competencias_catalogo FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON competencias_catalogo
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

-- ------------------------------------------------------------
-- 5. COMPETENCIAS ASIGNADAS (a un trabajador propio O a un
-- trabajador de contratista -- exactamente uno de los dos, nunca
-- ambos ni ninguno)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competencias_asignadas (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    competencia_id          UUID NOT NULL REFERENCES competencias_catalogo(id) ON DELETE CASCADE,

    trabajador_id           UUID REFERENCES trabajadores(id) ON DELETE CASCADE,
    contratista_trabajador_id UUID REFERENCES contratistas_trabajadores(id) ON DELETE CASCADE,

    fecha_obtencion         DATE NOT NULL,
    fecha_vencimiento       DATE, -- calculada por el controlador desde vigencia_meses; NULL si no vence
    public_id               VARCHAR(300), -- certificado en Cloudinary

    creado_por              UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (num_nonnulls(trabajador_id, contratista_trabajador_id) = 1)
);

CREATE INDEX idx_competencias_asignadas_trabajador ON competencias_asignadas(trabajador_id);
CREATE INDEX idx_competencias_asignadas_contratista_trabajador ON competencias_asignadas(contratista_trabajador_id);
CREATE INDEX idx_competencias_asignadas_organizacion ON competencias_asignadas(organizacion_id);

ALTER TABLE competencias_asignadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE competencias_asignadas FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON competencias_asignadas
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

-- ------------------------------------------------------------
-- 6. PERMISOS DE TRABAJO (control de tareas criticas: caliente,
-- altura, espacio confinado, electrico/LOTO, excavacion, izaje).
-- contratista_id es opcional -- una tarea critica puede ser
-- ejecutada por personal propio.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permisos_trabajo (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    tipo                VARCHAR(25) NOT NULL
                            CHECK (tipo IN ('trabajo_caliente', 'trabajo_altura', 'espacio_confinado',
                                             'electrico_loto', 'excavacion', 'izaje_cargas', 'otro')),
    area                VARCHAR(150) NOT NULL,
    descripcion_tarea   TEXT NOT NULL,

    contratista_id      UUID REFERENCES contratistas(id) ON DELETE SET NULL,
    solicitante_id      UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    autorizado_por      UUID REFERENCES usuarios(id) ON DELETE SET NULL,

    fecha_inicio_prevista TIMESTAMPTZ NOT NULL,
    fecha_fin_prevista    TIMESTAMPTZ NOT NULL,

    estado              VARCHAR(20) NOT NULL DEFAULT 'borrador'
                            CHECK (estado IN ('borrador', 'aprobado', 'en_ejecucion', 'cerrado', 'cancelado')),
    condiciones_verificadas BOOLEAN NOT NULL DEFAULT false, -- checklist de inicio (aislamiento de energia, EPP, atmosfera medida, etc.)
    notas_cierre        TEXT,

    cerrado_por         UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    cerrado_en          TIMESTAMPTZ,

    creado_por          UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (fecha_fin_prevista > fecha_inicio_prevista)
);

CREATE INDEX idx_permisos_trabajo_organizacion ON permisos_trabajo(organizacion_id);
CREATE INDEX idx_permisos_trabajo_contratista ON permisos_trabajo(contratista_id);
CREATE INDEX idx_permisos_trabajo_estado ON permisos_trabajo(organizacion_id, estado);

ALTER TABLE permisos_trabajo ENABLE ROW LEVEL SECURITY;
ALTER TABLE permisos_trabajo FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON permisos_trabajo
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

-- ------------------------------------------------------------
-- 7. PASOS DEL ANALISIS SEGURO DE TRABAJO (JSA/AST) -- cada
-- permiso lleva su propio JSA por pasos, no un documento aparte,
-- para que quede vinculado y auditable en una sola vista.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permisos_trabajo_pasos (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    permiso_id          UUID NOT NULL REFERENCES permisos_trabajo(id) ON DELETE CASCADE,
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    orden               INTEGER NOT NULL CHECK (orden > 0),
    paso_tarea          TEXT NOT NULL,
    peligro_identificado TEXT NOT NULL,
    medida_control      TEXT NOT NULL,
    epp_requerido       VARCHAR(300),

    UNIQUE (permiso_id, orden)
);

CREATE INDEX idx_permisos_trabajo_pasos_permiso ON permisos_trabajo_pasos(permiso_id);

ALTER TABLE permisos_trabajo_pasos ENABLE ROW LEVEL SECURITY;
ALTER TABLE permisos_trabajo_pasos FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON permisos_trabajo_pasos
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

-- ------------------------------------------------------------
-- 8. FIRMAS DE PARTICIPANTES DEL PERMISO (charla previa/AST leida
-- y aceptada -- firmante puede ser trabajador propio o de
-- contratista, igual regla de exclusividad que competencias_asignadas)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permisos_trabajo_firmas (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    permiso_id              UUID NOT NULL REFERENCES permisos_trabajo(id) ON DELETE CASCADE,
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    trabajador_id           UUID REFERENCES trabajadores(id) ON DELETE CASCADE,
    contratista_trabajador_id UUID REFERENCES contratistas_trabajadores(id) ON DELETE CASCADE,
    rol_firma               VARCHAR(20) NOT NULL DEFAULT 'ejecutante'
                                CHECK (rol_firma IN ('ejecutante', 'supervisor', 'vigia')),

    firma_public_id         VARCHAR(300), -- firma fisica/canvas en Cloudinary, mismo patron que EPP/capacitaciones
    firmado_en              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (num_nonnulls(trabajador_id, contratista_trabajador_id) = 1)
);

CREATE INDEX idx_permisos_trabajo_firmas_permiso ON permisos_trabajo_firmas(permiso_id);

ALTER TABLE permisos_trabajo_firmas ENABLE ROW LEVEL SECURITY;
ALTER TABLE permisos_trabajo_firmas FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON permisos_trabajo_firmas
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

-- Nuevo origen de CAPA: un permiso de trabajo cerrado con hallazgos
-- (ej. condicion insegura detectada durante la ejecucion) puede
-- escalar a una accion correctiva real, igual que reporte_peligro
-- y obligacion_legal en el Lote 1/2.
ALTER TABLE capa_acciones DROP CONSTRAINT capa_acciones_origen_tipo_check;
ALTER TABLE capa_acciones ADD CONSTRAINT capa_acciones_origen_tipo_check
  CHECK (origen_tipo IN ('accidente', 'casi_accidente', 'matriz_riesgo', 'inspeccion', 'enfermedad_profesional',
                          'auditoria', 'manual', 'riesgo_psicosocial', 'higiene_industrial', 'reporte_peligro',
                          'obligacion_legal', 'permiso_trabajo'));

INSERT INTO schema_migrations (version) VALUES ('101_contratistas_permisos_trabajo')
ON CONFLICT (version) DO NOTHING;
