-- ============================================================
-- Migracion 035: Vigilancia de la salud (Punto 16 / CRITICO 4 de
-- la Auditoria SISSO N.06).
--
-- CORRIGE el punto 3.2 de la auditoria: ya existen datos de
-- audiometria, espirometria, visiometria, ergonomia y ausentismo,
-- pero no habia una entidad que los agrupara en PROGRAMAS de
-- vigilancia longitudinales con tendencia. Esta migracion crea el
-- "programa" (ej: "Vigilancia de ruido - planta 1") y sus
-- observaciones periodicas agregadas.
--
-- Separacion de datos deliberada:
--   - programas_vigilancia_salud: metadata del programa, visible
--     para medico Y sso (sso necesita saber que existe el programa
--     y su estado para poder actuar preventivamente sobre el riesgo).
--   - vigilancia_salud_observaciones: cada corte periodico. Guarda
--     UNICAMENTE cifras agregadas (total_evaluados, total_con_hallazgo,
--     tendencia) -- JAMAS un listado de trabajadores ni resultados
--     individuales. Esta es la pieza que corrige el punto 3.2: "la
--     informacion clinica individual debe permanecer protegida...
--     SSO debe recibir informacion preventiva, agregada".
--     El detalle clinico individual de cada trabajador sigue viviendo
--     donde ya vivia (examenes_audiometria, etc.), accesible solo a
--     'medico'.
-- ============================================================

CREATE TABLE programas_vigilancia_salud (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    nombre                  VARCHAR(150) NOT NULL,
    tipo_riesgo             VARCHAR(30) NOT NULL
                                CHECK (tipo_riesgo IN ('ruido', 'quimico', 'ergonomico', 'biologico', 'psicosocial', 'otro')),
    descripcion             TEXT,
    puesto_trabajo_id       UUID REFERENCES puestos_trabajo(id) ON DELETE SET NULL, -- NULL = aplica a toda la organizacion

    -- Que tabla de examen alimenta este programa (para vincular con
    -- el tipo de dato que se agrega en cada observacion).
    tipo_examen_asociado    VARCHAR(30)
                                CHECK (tipo_examen_asociado IN ('audiometria', 'espirometria', 'visiometria', 'evaluacion_periodica', 'ergonomia', 'ausentismo', 'otro')),

    estado                  VARCHAR(20) NOT NULL DEFAULT 'activo'
                                CHECK (estado IN ('activo', 'en_pausa', 'cerrado')),

    responsable_id          UUID REFERENCES usuarios(id) ON DELETE SET NULL,

    creado_por              UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_progvig_organizacion ON programas_vigilancia_salud(organizacion_id);

CREATE TRIGGER set_actualizado_en_programas_vigilancia_salud
  BEFORE UPDATE ON programas_vigilancia_salud
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

-- ------------------------------------------------------------
-- Observaciones periodicas: SOLO cifras agregadas.
-- ------------------------------------------------------------
CREATE TABLE vigilancia_salud_observaciones (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programa_id             UUID NOT NULL REFERENCES programas_vigilancia_salud(id) ON DELETE CASCADE,
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    periodo_etiqueta        VARCHAR(30) NOT NULL, -- ej: "2026-T3", "2026-08"
    fecha_corte             DATE NOT NULL,

    total_evaluados         INTEGER NOT NULL DEFAULT 0,
    total_con_hallazgo       INTEGER NOT NULL DEFAULT 0, -- ej: hipoacusia detectada, restriccion espirometrica, etc.
    tendencia               VARCHAR(15) NOT NULL DEFAULT 'estable'
                                CHECK (tendencia IN ('mejora', 'estable', 'empeora')),

    -- Nota preventiva agregada: recomendaciones/acciones, NUNCA
    -- nombres de trabajadores ni resultados individuales. Se
    -- refuerza en el controlador (validacion de longitud minima,
    -- no de contenido -- el criterio de "no clinico" lo aplica el
    -- medico al redactar, igual que exposicion_relacionada en
    -- enfermedad_profesional).
    nota_preventiva          TEXT,

    registrado_por           UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en                TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (programa_id, periodo_etiqueta)
);

CREATE INDEX idx_vigobs_programa ON vigilancia_salud_observaciones(programa_id);
CREATE INDEX idx_vigobs_organizacion ON vigilancia_salud_observaciones(organizacion_id);
CREATE INDEX idx_vigobs_fecha ON vigilancia_salud_observaciones(fecha_corte DESC);


-- CORREGIDO en Auditoria N.07 (hallazgo GRAVE G-N07-02): se agrega
-- el auto-registro en schema_migrations, siguiendo la convencion ya
-- usada desde migration_030/031, para que esta migracion tambien sea
-- segura de pegar a mano en el SQL Editor de Neon (el flujo manual
-- que usa el equipo) sin quedar en un estado inconsistente frente a
-- migrate.js. ON CONFLICT DO NOTHING la hace ademas re-ejecutable.
INSERT INTO schema_migrations (version) VALUES ('035_vigilancia_salud')
ON CONFLICT (version) DO NOTHING;
