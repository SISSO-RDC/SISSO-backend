-- ============================================================
-- Migracion 094: Reportes de peligro (Lote 1 del plan de cierre de
-- brechas frente a plataformas EHS globales -- Cority/VelocityEHS/
-- Benchmark Gensuite, ver analisis Sep 2026).
--
-- POR QUE UNA TABLA NUEVA: SISSO ya tiene accidentes_incidentes
-- (incluye 'casi_accidente') y capa_acciones con origen polimorfico,
-- pero ambos requieren una cuenta de usuario para escribir. La
-- brecha identificada frente a los referentes globales es
-- especificamente la falta de un canal de reporte MASIVO para
-- cualquier trabajador -- sin necesitar login -- de condiciones
-- inseguras, actos inseguros u observaciones positivas (no solo
-- accidentes/incidentes ya ocurridos). Se modela como tabla propia,
-- no como fila de accidentes_incidentes, porque la naturaleza del
-- dato es distinta: no hay trabajador identificado por FK (el
-- reportante puede ser anonimo o dar solo su nombre en texto libre),
-- no hay gravedad clinica, y el flujo de triage es mas simple
-- (clasificar -> [generar CAPA] -> cerrar).
--
-- Sigue el MISMO patron ya usado en solicitudes_titular
-- (migration_047+, ver solicitudesTitularController.js:crearPublico):
-- un endpoint publico protegido por rate limiting que resuelve la
-- organizacion por su `codigo` publico (organizaciones.codigo), NUNCA
-- por organizacion_id expuesto en la URL/QR.
-- ============================================================

CREATE TABLE IF NOT EXISTS reportes_peligro (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    -- Clasificacion tomada de la literatura EHS estandar (condicion
    -- insegura / acto inseguro / near miss / observacion positiva),
    -- igual que describen los referentes globales revisados.
    clasificacion       VARCHAR(30) NOT NULL
                            CHECK (clasificacion IN ('condicion_insegura', 'acto_inseguro', 'casi_accidente', 'observacion_positiva', 'sugerencia')),

    descripcion         TEXT NOT NULL,
    area                VARCHAR(150),
    ubicacion_texto     VARCHAR(250), -- lugar descrito en texto libre (no hay geolocalizacion en este lote)

    -- Identidad del reportante: SIEMPRE opcional y en texto libre --
    -- el canal es publico por diseno (igual que solicitudes_titular),
    -- el reportante no tiene cuenta SISSO. NUNCA se pide documento de
    -- identidad aqui (no es un canal de derechos ARCO).
    reportante_nombre   VARCHAR(150),
    anonimo             BOOLEAN NOT NULL DEFAULT true,

    estado              VARCHAR(20) NOT NULL DEFAULT 'nuevo'
                            CHECK (estado IN ('nuevo', 'en_revision', 'con_capa', 'descartado', 'cerrado')),
    nota_triage         TEXT, -- por que se descarto o como se atendio, si no ameritó CAPA
    revisado_por        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    revisado_en         TIMESTAMPTZ,

    -- Enlace opcional a la accion CAPA generada desde este reporte
    -- (mismo patron de inspecciones_hallazgos.capa_id).
    capa_id             UUID REFERENCES capa_acciones(id) ON DELETE SET NULL,

    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reportes_peligro_organizacion ON reportes_peligro(organizacion_id);
CREATE INDEX idx_reportes_peligro_estado ON reportes_peligro(organizacion_id, estado);

ALTER TABLE reportes_peligro ENABLE ROW LEVEL SECURITY;
ALTER TABLE reportes_peligro FORCE ROW LEVEL SECURITY;

CREATE POLICY aislamiento_tenant ON reportes_peligro
  USING (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  ) WITH CHECK (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

-- ------------------------------------------------------------
-- Evidencia fotografica del reporte. Tabla separada (mismo patron
-- que accidentes_evidencias) porque un reporte puede tener 0, 1 o
-- varias fotos, y porque el archivo en si vive en Cloudinary --
-- aqui solo se guarda la referencia (public_id), nunca el binario.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reportes_peligro_evidencias (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporte_id          UUID NOT NULL REFERENCES reportes_peligro(id) ON DELETE CASCADE,
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    tipo_archivo        VARCHAR(20) NOT NULL,
    public_id           VARCHAR(300) NOT NULL,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reportes_peligro_evidencias_reporte ON reportes_peligro_evidencias(reporte_id);

ALTER TABLE reportes_peligro_evidencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE reportes_peligro_evidencias FORCE ROW LEVEL SECURITY;

CREATE POLICY aislamiento_tenant ON reportes_peligro_evidencias
  USING (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  ) WITH CHECK (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

-- Nuevo origen de CAPA: un reporte de peligro puede escalar a una
-- accion correctiva/preventiva real, igual que accidentes,
-- inspecciones, matriz de riesgos, etc.
ALTER TABLE capa_acciones DROP CONSTRAINT capa_acciones_origen_tipo_check;
ALTER TABLE capa_acciones ADD CONSTRAINT capa_acciones_origen_tipo_check
  CHECK (origen_tipo IN ('accidente', 'casi_accidente', 'matriz_riesgo', 'inspeccion', 'enfermedad_profesional', 'auditoria', 'manual', 'riesgo_psicosocial', 'higiene_industrial', 'reporte_peligro'));

COMMENT ON TABLE reportes_peligro IS
  'Canal publico (sin cuenta SISSO) de reporte de condiciones inseguras, actos inseguros, casi '
  'accidentes y observaciones positivas -- Lote 1 del plan de cierre de brechas frente a Cority/'
  'VelocityEHS/Benchmark Gensuite (Sep 2026). Identifica la organizacion por su codigo publico, '
  'mismo patron que solicitudes_titular.crearPublico. El triage (clasificar, generar CAPA si '
  'corresponde, cerrar) lo hace siempre un humano autenticado (admin/sso) -- este endpoint publico '
  'NUNCA crea ni modifica una accion CAPA por si mismo.';

INSERT INTO schema_migrations (version) VALUES ('094_reportes_peligro')
ON CONFLICT (version) DO NOTHING;
