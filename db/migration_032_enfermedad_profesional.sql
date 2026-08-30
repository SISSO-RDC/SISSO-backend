-- ============================================================
-- Migracion 032: Enfermedad profesional (modulo medico exclusivo)
--
-- CORRIGE el punto 3.1 y el hallazgo G2 de la Auditoria SISSO N.06:
-- en la auditoria anterior la enfermedad profesional se planteo
-- erroneamente como una funcion operativa de SSO. Esta migracion
-- crea la enfermedad profesional como lo que realmente es: un
-- proceso CLINICO bajo criterio exclusivo del Medico Ocupacional
-- (sospecha, evaluacion, diagnostico, seguimiento).
--
-- SSO NUNCA tiene una fila propia de acceso a esta tabla: solo
-- puede intervenir sobre el factor de riesgo/exposicion asociado
-- (campo exposicion_relacionada, texto libre no clinico) y sobre
-- acciones preventivas, gestionadas en matriz_riesgos/CAPA (fuera
-- del alcance de esta migracion). El backend (enfermedadProfesionalRoutes.js)
-- es el que impone esto: SSO jamas puede leer diagnostico_cie10,
-- evolucion_clinica ni el detalle de seguimiento.
-- ============================================================

CREATE TABLE enfermedad_profesional (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    trabajador_id           UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,

    -- Estado del caso: sospecha -> en_evaluacion -> confirmada / descartada -> en_seguimiento -> cerrada
    estado                  VARCHAR(20) NOT NULL DEFAULT 'sospecha'
                                CHECK (estado IN ('sospecha', 'en_evaluacion', 'confirmada', 'descartada', 'en_seguimiento', 'cerrada')),

    -- Datos CLINICOS: visibles unicamente para 'medico' (impuesto en el controlador).
    fecha_sospecha          DATE NOT NULL,
    diagnostico_cie10       VARCHAR(10) REFERENCES catalogo_cie10(codigo),
    diagnostico_presuntivo  TEXT,               -- texto libre, mientras no hay CIE-10 confirmado
    evolucion_clinica       TEXT,               -- notas clinicas de evolucion del caso
    fecha_confirmacion      DATE,
    fecha_cierre            DATE,
    conclusion              TEXT,               -- conclusion clinica final del caso

    -- Dato NO CLINICO, unico campo visible para SSO en vistas agregadas/preventivas:
    -- descripcion de la exposicion/factor de riesgo relacionado, en lenguaje
    -- preventivo (ej: "exposicion a ruido continuo puesto X"), nunca el
    -- diagnostico ni la evolucion clinica del trabajador.
    exposicion_relacionada  TEXT,
    puesto_trabajo_id       UUID REFERENCES puestos_trabajo(id) ON DELETE SET NULL,

    medico_responsable_id   UUID NOT NULL REFERENCES usuarios(id),
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_enfprof_organizacion ON enfermedad_profesional(organizacion_id);
CREATE INDEX idx_enfprof_trabajador ON enfermedad_profesional(trabajador_id);
CREATE INDEX idx_enfprof_estado ON enfermedad_profesional(organizacion_id, estado);

CREATE TRIGGER set_actualizado_en_enfermedad_profesional
  BEFORE UPDATE ON enfermedad_profesional
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

-- ------------------------------------------------------------
-- Seguimientos: cada entrada de evolucion del caso a lo largo del
-- tiempo (esto es lo que le da caracter "longitudinal" al modulo,
-- punto 17 de la auditoria). Estrictamente clinico, solo medico.
-- ------------------------------------------------------------
CREATE TABLE enfermedad_profesional_seguimientos (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enfermedad_profesional_id UUID NOT NULL REFERENCES enfermedad_profesional(id) ON DELETE CASCADE,
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    fecha                   DATE NOT NULL,
    nota_clinica            TEXT NOT NULL,
    medico_id               UUID NOT NULL REFERENCES usuarios(id),
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_enfprof_seg_caso ON enfermedad_profesional_seguimientos(enfermedad_profesional_id);
CREATE INDEX idx_enfprof_seg_organizacion ON enfermedad_profesional_seguimientos(organizacion_id);


-- CORREGIDO en Auditoria N.07 (hallazgo GRAVE G-N07-02): se agrega
-- el auto-registro en schema_migrations, siguiendo la convencion ya
-- usada desde migration_030/031, para que esta migracion tambien sea
-- segura de pegar a mano en el SQL Editor de Neon (el flujo manual
-- que usa el equipo) sin quedar en un estado inconsistente frente a
-- migrate.js. ON CONFLICT DO NOTHING la hace ademas re-ejecutable.
INSERT INTO schema_migrations (version) VALUES ('032_enfermedad_profesional')
ON CONFLICT (version) DO NOTHING;
