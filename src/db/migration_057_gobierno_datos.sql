-- ============================================================
-- Migracion 057: modulo de Gobierno de Datos / Derechos del
-- Titular.
--
-- CORRIGE el hallazgo CRITICO C11-04 de la Auditoria Integral SISSO
-- N.11: existian controles tecnicos de minimizacion y un catalogo
-- de finalidades (migration_051/056), pero ningun mecanismo
-- OPERATIVO para que un trabajador ejerza sus derechos (acceso,
-- rectificacion, actualizacion, bloqueo, eliminacion, oposicion,
-- portabilidad) ni para gestionar incidentes de seguridad de datos.
--
-- ALCANCE: esta migracion crea las dos tablas nucleo
-- (solicitudes_titular, incidentes_seguridad_datos) con estados,
-- responsables, plazos y evidencia -- lo suficiente para operar el
-- flujo manualmente con trazabilidad completa. NO incluye:
-- automatizacion de "eliminacion cuando corresponda" (ejecutar el
-- borrado real across ~25 tablas es una decision caso a caso que
-- requiere criterio humano, no un boton), ni notificacion
-- automatica a autoridad de control (proceso legal, no tecnico).
-- Esos dos puntos quedan como trabajo humano apoyado por este
-- modulo, no automatizados por el sistema.
-- ============================================================

CREATE TABLE IF NOT EXISTS solicitudes_titular (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id           UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    trabajador_id             UUID REFERENCES trabajadores(id) ON DELETE SET NULL, -- NULL si el solicitante ya no esta en la tabla trabajadores (ex-empleado)

    tipo_solicitud            VARCHAR(20) NOT NULL CHECK (tipo_solicitud IN (
                                'acceso', 'rectificacion', 'actualizacion', 'bloqueo',
                                'eliminacion', 'oposicion', 'portabilidad'
                              )),
    descripcion               TEXT NOT NULL, -- que pide exactamente el titular, en sus palabras o resumido por quien registra

    -- Identidad del solicitante (obligatorio verificar antes de procesar
    -- cualquier solicitud sobre datos sensibles).
    solicitante_nombre        VARCHAR(200) NOT NULL,
    solicitante_documento     VARCHAR(20) NOT NULL,
    identidad_verificada      BOOLEAN NOT NULL DEFAULT false,
    metodo_verificacion       VARCHAR(100), -- ej. "documento de identidad presentado en RRHH", "firma electronica"

    estado                    VARCHAR(20) NOT NULL DEFAULT 'recibida' CHECK (estado IN (
                                'recibida', 'en_verificacion', 'en_proceso', 'respondida', 'rechazada', 'cancelada'
                              )),
    responsable_id            UUID REFERENCES usuarios(id), -- quien esta a cargo de resolverla

    fecha_recibida            DATE NOT NULL DEFAULT CURRENT_DATE,
    -- Plazo por defecto: 30 dias calendario desde la recepcion (punto
    -- de partida operativo razonable; el plazo legal exacto aplicable
    -- debe confirmarse con asesoria juridica -- ver hallazgo C11-04,
    -- correccion, y C10-02).
    fecha_limite_respuesta    DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
    fecha_respuesta           DATE,

    respuesta_texto           TEXT, -- que se le respondio/hizo al titular
    evidencia_url             TEXT, -- documento de respuesta/evidencia (Cloudinary, ver cloudinaryService.js)
    evidencia_public_id       TEXT,

    creado_por                UUID NOT NULL REFERENCES usuarios(id),
    creado_en                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_solicitudes_titular_organizacion ON solicitudes_titular(organizacion_id);
CREATE INDEX idx_solicitudes_titular_estado ON solicitudes_titular(estado);
CREATE INDEX idx_solicitudes_titular_trabajador ON solicitudes_titular(trabajador_id);
CREATE INDEX idx_solicitudes_titular_vencidas ON solicitudes_titular(fecha_limite_respuesta) WHERE estado NOT IN ('respondida', 'rechazada', 'cancelada');

COMMENT ON TABLE solicitudes_titular IS
  'Modulo de gobierno de datos: solicitudes de acceso/rectificacion/actualizacion/bloqueo/eliminacion/'
  'oposicion/portabilidad ejercidas por el titular de los datos. Ver hallazgo C11-04.';

CREATE TABLE IF NOT EXISTS incidentes_seguridad_datos (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    descripcion             TEXT NOT NULL,
    gravedad                VARCHAR(20) NOT NULL CHECK (gravedad IN ('baja', 'media', 'alta', 'critica')),
    categorias_datos_afectados TEXT[], -- ej. {'sensible','personal'}
    cantidad_titulares_afectados_estimada INTEGER,

    estado                  VARCHAR(20) NOT NULL DEFAULT 'detectado' CHECK (estado IN (
                              'detectado', 'en_investigacion', 'contenido', 'resuelto'
                            )),
    responsable_id          UUID REFERENCES usuarios(id),

    fecha_deteccion         TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_contencion        TIMESTAMPTZ,
    fecha_resolucion        TIMESTAMPTZ,

    medidas_tomadas         TEXT,
    notificado_autoridad    BOOLEAN NOT NULL DEFAULT false,
    fecha_notificacion_autoridad TIMESTAMPTZ,
    notificado_titulares    BOOLEAN NOT NULL DEFAULT false,

    creado_por              UUID NOT NULL REFERENCES usuarios(id),
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_incidentes_seguridad_organizacion ON incidentes_seguridad_datos(organizacion_id);

COMMENT ON TABLE incidentes_seguridad_datos IS
  'Registro de incidentes de seguridad de datos personales/sensibles. Ver hallazgo C11-04. '
  'La notificacion a la autoridad de control es un paso LEGAL que debe decidir un humano '
  '(asesoria juridica/DPO); este registro documenta que se hizo, no lo automatiza.';

-- RLS: mismo patron que el resto de tablas multi-tenant (migration_045/046).
ALTER TABLE solicitudes_titular ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_titular FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON solicitudes_titular USING (
  organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
  OR current_setting('app.es_superadmin', true) = 'true'
);

ALTER TABLE incidentes_seguridad_datos ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidentes_seguridad_datos FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON incidentes_seguridad_datos USING (
  organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
  OR current_setting('app.es_superadmin', true) = 'true'
);

-- Integridad cross-tenant (mismo patron de migration_048).
DROP TRIGGER IF EXISTS trg_tenant_fk_solicitudes_titular ON solicitudes_titular;
CREATE TRIGGER trg_tenant_fk_solicitudes_titular
  BEFORE INSERT OR UPDATE ON solicitudes_titular
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk(
    'trabajador_id', 'trabajadores',
    'responsable_id', 'usuarios',
    'creado_por', 'usuarios'
  );

DROP TRIGGER IF EXISTS trg_tenant_fk_incidentes_seguridad ON incidentes_seguridad_datos;
CREATE TRIGGER trg_tenant_fk_incidentes_seguridad
  BEFORE INSERT OR UPDATE ON incidentes_seguridad_datos
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk(
    'responsable_id', 'usuarios',
    'creado_por', 'usuarios'
  );

INSERT INTO schema_migrations (version) VALUES ('057_gobierno_datos_derechos_titular')
ON CONFLICT (version) DO NOTHING;
