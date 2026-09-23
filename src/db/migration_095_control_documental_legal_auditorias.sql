-- ============================================================
-- Migracion 095 (Lote 2 del plan de cierre de brechas frente a
-- plataformas EHS globales -- Cority/VelocityEHS/Benchmark
-- Gensuite, ver analisis Sep 2026): control documental,
-- matriz de obligaciones legales y auditorias internas/externas.
--
-- Estas tres capacidades comparten un mismo requisito de fondo
-- (necesario para ISO 45001/14001/9001): trazabilidad de version,
-- responsable, vencimiento y evidencia -- por eso van en una sola
-- migracion tematica, igual que higiene_industrial (040) agrupo
-- varias tablas relacionadas.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CONTROL DOCUMENTAL
-- Cada version de un documento es una FILA independiente
-- (numero_documento agrupa versiones de un mismo documento;
-- reemplaza_a apunta a la version anterior). Al publicar una
-- version nueva, el controlador marca la anterior 'obsoleto' --
-- esto preserva el historial completo, que una auditoria ISO
-- puede pedir ver.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documentos_control (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    numero_documento        VARCHAR(60) NOT NULL, -- ej: 'POL-SST-001', libre pero constante entre versiones
    titulo                  VARCHAR(200) NOT NULL,
    categoria               VARCHAR(20) NOT NULL
                                CHECK (categoria IN ('politica', 'procedimiento', 'instructivo', 'formato', 'otro')),
    version                 INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    reemplaza_a             UUID REFERENCES documentos_control(id) ON DELETE SET NULL,

    estado                  VARCHAR(20) NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'obsoleto')),
    propietario_id          UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    aprobador_id            UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha_aprobacion        DATE,
    fecha_proxima_revision  DATE,
    requiere_acuse          BOOLEAN NOT NULL DEFAULT true,

    public_id               VARCHAR(300) NOT NULL, -- PDF en Cloudinary (recurso privado, ver cloudinaryService)

    creado_por              UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documentos_control_organizacion ON documentos_control(organizacion_id);
CREATE INDEX idx_documentos_control_numero ON documentos_control(organizacion_id, numero_documento);

ALTER TABLE documentos_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_control FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON documentos_control
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

-- Acuse de lectura: un trabajador (usuario del sistema) por documento
-- (version). Si sale una version nueva, requiere un acuse nuevo --
-- el acuse de la version anterior NO se traslada.
CREATE TABLE IF NOT EXISTS documentos_control_acuses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    documento_id    UUID NOT NULL REFERENCES documentos_control(id) ON DELETE CASCADE,
    organizacion_id UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    usuario_id      UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    leido_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (documento_id, usuario_id)
);

CREATE INDEX idx_documentos_acuses_documento ON documentos_control_acuses(documento_id);

ALTER TABLE documentos_control_acuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_control_acuses FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON documentos_control_acuses
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

-- ------------------------------------------------------------
-- 2. MATRIZ DE OBLIGACIONES LEGALES
-- Gobierno de la referencia normativa IDENTICO al ya probado en
-- migration_091 (examenes_organizacion): una obligacion solo
-- cuenta como 'verificada' si tiene fuente, jurisdiccion,
-- articulo y fecha de validacion. Todas nacen 'no_verificada' --
-- este lote no inventa ningun contenido normativo real.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS obligaciones_legales (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    titulo                  VARCHAR(200) NOT NULL,
    descripcion             TEXT,
    jurisdiccion            VARCHAR(80), -- ej: 'Ecuador - nacional', 'Quito - municipal'
    frecuencia              VARCHAR(20) NOT NULL
                                CHECK (frecuencia IN ('unica', 'mensual', 'trimestral', 'semestral', 'anual')),
    responsable_id          UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    proxima_fecha_vencimiento DATE NOT NULL,

    estado_cumplimiento     VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado_cumplimiento IN ('pendiente', 'cumplida')),
    ultimo_cumplimiento_en  TIMESTAMPTZ,
    ultimo_cumplimiento_nota VARCHAR(300),
    documento_evidencia_id  UUID REFERENCES documentos_control(id) ON DELETE SET NULL,

    -- Mismo gobierno normativo que examenes_organizacion (migration_091).
    estado_verificacion     VARCHAR(20) NOT NULL DEFAULT 'no_verificada',
    fuente_norma            VARCHAR(250),
    articulo_referencia     VARCHAR(150),
    fecha_validacion        DATE,
    verificado_por          UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    verificado_en           TIMESTAMPTZ,

    capa_id                 UUID REFERENCES capa_acciones(id) ON DELETE SET NULL,

    creado_por              UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE obligaciones_legales
  ADD CONSTRAINT obligaciones_legales_verificacion_chk
  CHECK (
    estado_verificacion IN ('no_verificada', 'verificada')
    AND (
      estado_verificacion = 'no_verificada'
      OR (fuente_norma IS NOT NULL AND jurisdiccion IS NOT NULL
          AND articulo_referencia IS NOT NULL AND fecha_validacion IS NOT NULL
          AND verificado_en IS NOT NULL)
    )
  );

CREATE INDEX idx_obligaciones_legales_organizacion ON obligaciones_legales(organizacion_id);
CREATE INDEX idx_obligaciones_legales_vencimiento ON obligaciones_legales(organizacion_id, proxima_fecha_vencimiento);

ALTER TABLE obligaciones_legales ENABLE ROW LEVEL SECURITY;
ALTER TABLE obligaciones_legales FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON obligaciones_legales
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

COMMENT ON TABLE obligaciones_legales IS
  'Matriz de obligaciones legales/regulatorias. estado_verificacion sigue el mismo gobierno normativo '
  'que examenes_organizacion (migration_091): "verificada" exige fuente, jurisdiccion, articulo y fecha '
  'de validacion humana. Ninguna fila nace verificada.';

-- ------------------------------------------------------------
-- 3. AUDITORIAS INTERNAS/EXTERNAS Y HALLAZGOS
-- 'auditoria' YA existe como origen valido de capa_acciones desde
-- migration_037 -- estaba reservado pero nunca tuvo una tabla que
-- lo alimentara. Este lote la construye.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditorias (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    tipo                VARCHAR(20) NOT NULL CHECK (tipo IN ('interna', 'externa')),
    norma_referencia    VARCHAR(150), -- texto libre, ej: 'ISO 45001', 'Reglamento SART'
    alcance             TEXT,
    auditor_nombre      VARCHAR(150),

    fecha_programada    DATE NOT NULL,
    fecha_ejecucion     DATE,
    estado              VARCHAR(20) NOT NULL DEFAULT 'programada'
                            CHECK (estado IN ('programada', 'en_progreso', 'completada')),

    creado_por          UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auditorias_organizacion ON auditorias(organizacion_id);

ALTER TABLE auditorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditorias FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON auditorias
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

CREATE TABLE IF NOT EXISTS auditoria_hallazgos (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auditoria_id        UUID NOT NULL REFERENCES auditorias(id) ON DELETE CASCADE,
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    tipo                VARCHAR(25) NOT NULL
                            CHECK (tipo IN ('no_conformidad', 'observacion', 'oportunidad_mejora')),
    descripcion         TEXT NOT NULL,
    capa_id             UUID REFERENCES capa_acciones(id) ON DELETE SET NULL,

    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auditoria_hallazgos_auditoria ON auditoria_hallazgos(auditoria_id);

ALTER TABLE auditoria_hallazgos ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_hallazgos FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON auditoria_hallazgos
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

-- Nuevo origen de CAPA: una obligacion legal vencida/incumplida
-- puede escalar a una accion correctiva real. 'auditoria' ya
-- estaba permitido desde migration_037.
ALTER TABLE capa_acciones DROP CONSTRAINT capa_acciones_origen_tipo_check;
ALTER TABLE capa_acciones ADD CONSTRAINT capa_acciones_origen_tipo_check
  CHECK (origen_tipo IN ('accidente', 'casi_accidente', 'matriz_riesgo', 'inspeccion', 'enfermedad_profesional',
                          'auditoria', 'manual', 'riesgo_psicosocial', 'higiene_industrial', 'reporte_peligro',
                          'obligacion_legal'));

INSERT INTO schema_migrations (version) VALUES ('095_control_documental_legal_auditorias')
ON CONFLICT (version) DO NOTHING;
