-- ============================================================
-- Migracion 033: Restricciones medicas como entidad longitudinal
-- propia (punto 25 / hallazgo G8 de la Auditoria SISSO N.06).
--
-- Hasta ahora la "restriccion" solo existia como texto libre
-- dentro de historial_aptitud_medica.restricciones (migration_006):
-- no tenia ciclo de vida propio (emitir / modificar / prorrogar /
-- levantar), ni fecha de vencimiento gestionable, ni forma de que
-- SSO/TH vieran "que debo ejecutar" sin ver el diagnostico que la
-- origino.
--
-- CORRIGE el punto 3.3 de la auditoria: el Medico Ocupacional
-- emite, modifica, prorroga y levanta una restriccion; SSO y TH
-- SOLO ejecutan la medida laboral resultante. Esto se separa en
-- dos niveles de datos en la misma fila:
--   - Nivel medico (motivo_clinico, diagnostico_cie10_relacionado):
--     visible unicamente para 'medico'.
--   - Nivel operativo (medida_laboral, un texto NO clinico que
--     describe la accion que SSO/TH deben ejecutar, ej: "no
--     levantar cargas mayores a 5kg", "rotacion de puesto cada 2h"):
--     visible para medico, sso y th. Esta separacion la impone el
--     controlador (restriccionesMedicasController.js), no solo la
--     tabla.
-- ============================================================

CREATE TABLE restricciones_medicas (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id             UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    trabajador_id               UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,

    -- Ciclo de vida. Una restriccion nunca se borra: se levanta
    -- (queda historico) o se deja vencer.
    estado                      VARCHAR(20) NOT NULL DEFAULT 'activa'
                                    CHECK (estado IN ('activa', 'prorrogada', 'levantada', 'vencida')),

    -- --- Nivel MEDICO (solo rol 'medico') ---
    motivo_clinico              TEXT NOT NULL,           -- criterio clinico que origina la restriccion
    diagnostico_cie10_relacionado VARCHAR(10) REFERENCES catalogo_cie10(codigo),
    enfermedad_profesional_id   UUID REFERENCES enfermedad_profesional(id) ON DELETE SET NULL,

    -- --- Nivel OPERATIVO (medico, sso, th) ---
    medida_laboral               TEXT NOT NULL,          -- que debe ejecutar SSO/TH, sin lenguaje clinico
    puesto_trabajo_id            UUID REFERENCES puestos_trabajo(id) ON DELETE SET NULL,

    fecha_emision                DATE NOT NULL,
    fecha_vigencia_hasta         DATE,                   -- NULL = indefinida hasta que el medico la levante
    fecha_levantamiento          DATE,
    motivo_levantamiento         TEXT,

    medico_emisor_id             UUID NOT NULL REFERENCES usuarios(id),
    medico_ultima_modificacion_id UUID REFERENCES usuarios(id),

    creado_en                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_restrmed_organizacion ON restricciones_medicas(organizacion_id);
CREATE INDEX idx_restrmed_trabajador ON restricciones_medicas(trabajador_id);
CREATE INDEX idx_restrmed_estado ON restricciones_medicas(organizacion_id, estado);
CREATE INDEX idx_restrmed_vigencia ON restricciones_medicas(fecha_vigencia_hasta) WHERE estado IN ('activa', 'prorrogada');

CREATE TRIGGER set_actualizado_en_restricciones_medicas
  BEFORE UPDATE ON restricciones_medicas
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

-- ------------------------------------------------------------
-- Historial de cambios (prorrogas y modificaciones), append-only,
-- para que quede trazabilidad de "quien emitio, quien modifico,
-- que criterio se uso, por que se modifico y cuando vencio"
-- (seccion 6.2 de la auditoria).
-- ------------------------------------------------------------
CREATE TABLE restricciones_medicas_historial (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restriccion_id              UUID NOT NULL REFERENCES restricciones_medicas(id) ON DELETE CASCADE,
    organizacion_id             UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    accion                       VARCHAR(20) NOT NULL CHECK (accion IN ('emitida', 'modificada', 'prorrogada', 'levantada', 'vencida_automaticamente')),
    detalle                      TEXT,
    medico_id                    UUID REFERENCES usuarios(id),
    fecha_vigencia_hasta_anterior DATE,
    fecha_vigencia_hasta_nueva    DATE,
    creado_en                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_restrmed_hist_restriccion ON restricciones_medicas_historial(restriccion_id);
CREATE INDEX idx_restrmed_hist_organizacion ON restricciones_medicas_historial(organizacion_id);
