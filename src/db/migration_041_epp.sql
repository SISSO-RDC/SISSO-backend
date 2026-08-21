-- ============================================================
-- Migracion 041: Equipo de Proteccion Personal (EPP).
--
-- Catalogo de EPP por organizacion (casco, guantes, protector
-- auditivo, arnes, etc.) y entregas individuales a trabajadores,
-- con vencimiento estimado calculado a partir de la vida util del
-- equipo, y firma de recibido (mismo patron ya usado en
-- consentimientos_firmados: imagen de firma como recurso PRIVADO
-- de Cloudinary, con URL firmada bajo demanda).
-- ============================================================

CREATE TABLE catalogo_epp (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    nombre                  VARCHAR(120) NOT NULL,
    tipo                    VARCHAR(60) NOT NULL, -- ej: "Protección auditiva", "Protección visual", "Arnés"
    vida_util_meses         SMALLINT CHECK (vida_util_meses IS NULL OR vida_util_meses > 0),
    norma_referencia        VARCHAR(150), -- ej: "ANSI Z87.1"
    activo                  BOOLEAN NOT NULL DEFAULT true,

    creado_por              UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_catepp_organizacion ON catalogo_epp(organizacion_id);

CREATE TABLE entregas_epp (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    trabajador_id           UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    epp_id                  UUID NOT NULL REFERENCES catalogo_epp(id) ON DELETE RESTRICT,
    puesto_trabajo_id       UUID REFERENCES puestos_trabajo(id) ON DELETE SET NULL,

    fecha_entrega           DATE NOT NULL,
    cantidad                SMALLINT NOT NULL DEFAULT 1 CHECK (cantidad > 0),
    motivo                  VARCHAR(20) NOT NULL DEFAULT 'entrega_inicial'
                                CHECK (motivo IN ('entrega_inicial', 'reposicion', 'dano', 'vencimiento')),

    -- Calculada por el controlador (fecha_entrega + vida_util_meses
    -- del EPP en ese momento). NULL si el EPP no tiene vida util
    -- definida.
    fecha_vencimiento_estimada DATE,
    estado                  VARCHAR(10) NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'vencido', 'repuesto')),

    -- Firma de recibido: mismo patron que consentimientos_firmados
    -- (migration existente) -- recurso PRIVADO de Cloudinary.
    firma_imagen_url        TEXT,
    firma_imagen_public_id  VARCHAR(300),

    entregado_por           UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_entepp_organizacion ON entregas_epp(organizacion_id);
CREATE INDEX idx_entepp_trabajador ON entregas_epp(trabajador_id);
CREATE INDEX idx_entepp_estado ON entregas_epp(organizacion_id, estado);
CREATE INDEX idx_entepp_vencimiento ON entregas_epp(fecha_vencimiento_estimada) WHERE estado = 'vigente';
