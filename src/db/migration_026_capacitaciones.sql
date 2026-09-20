-- ============================================================
-- SISSO - Migracion 026: Capacitaciones y asistencia.
--
-- Soporte minimo necesario para poder emitir el "certificado de
-- asistencia a capacitacion" (uno de los 3 tipos de Certificados
-- PDF acordados con el cliente, junto a HCU 081 -ya existente- y
-- certificado de aptitud independiente -que no requiere tabla
-- nueva, se genera desde trabajadores.aptitud-).
--
-- Diseño deliberadamente simple: una capacitacion tiene datos
-- generales (nombre, tema, instructor, fecha, horas) y una lista
-- de trabajadores asistentes. No se modela evaluacion de
-- aprendizaje ni asistencia parcial por dia (si la capacitacion
-- dura varios dias, se registra como una sola fila con las horas
-- totales); si el cliente necesita mas detalle en el futuro, se
-- amplia con una nueva migracion.
-- ============================================================

CREATE TABLE capacitaciones (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    nombre              VARCHAR(200) NOT NULL,
    tema                TEXT,
    instructor          VARCHAR(150),
    fecha               DATE NOT NULL,
    horas_duracion      NUMERIC(4,1) NOT NULL CHECK (horas_duracion > 0),

    creado_por          UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE capacitaciones_asistentes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    capacitacion_id     UUID NOT NULL REFERENCES capacitaciones(id) ON DELETE CASCADE,
    trabajador_id       UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    UNIQUE (capacitacion_id, trabajador_id)
);

CREATE INDEX idx_capacitaciones_organizacion ON capacitaciones(organizacion_id);
CREATE INDEX idx_capacitaciones_fecha ON capacitaciones(fecha);
CREATE INDEX idx_capacitaciones_asistentes_capacitacion ON capacitaciones_asistentes(capacitacion_id);
CREATE INDEX idx_capacitaciones_asistentes_trabajador ON capacitaciones_asistentes(trabajador_id);
