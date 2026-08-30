-- ============================================================
-- SISSO - Migracion 018: registro de inmunizaciones (HCU 083).
--
-- A diferencia de los otros 4 formularios de Historia Clinica
-- Ocupacional, este NO es una "evaluacion" puntual sino un
-- REGISTRO ACUMULATIVO: cada dosis de cada vacuna que recibe el
-- trabajador a lo largo del tiempo es una fila nueva (igual patron
-- que examenes_audiometria/examenes_espirometria: series
-- historicas por trabajador, no un formulario que se llena una vez
-- y ya). Por eso tiene su propia tabla en vez de vivir dentro de
-- evaluaciones_ocupacionales.
--
-- Nota sobre roles: el instructivo oficial del MSP asigna este
-- registro tipicamente a enfermeria. SISSO no tiene un rol
-- "enfermera" separado; se mantiene restringido a 'medico', igual
-- que el resto de la Historia Clinica Ocupacional, para no romper
-- el patron de separacion de datos clinicos ya establecido en el
-- sistema. Si en el futuro se necesita un rol de enfermeria con
-- acceso mas acotado, este es el punto donde se agregaria.
-- ============================================================

CREATE TABLE registro_inmunizaciones (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    trabajador_id           UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    registrado_por          UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,

    vacuna_nombre           VARCHAR(100) NOT NULL,  -- ej: "Tetanos-Difteria", "Hepatitis B", "Influenza estacional", u "Otra: ..."
    numero_dosis            VARCHAR(20) NOT NULL,   -- ej: "1ra", "2da", "3ra", "refuerzo", "unica"
    fecha_aplicacion        DATE NOT NULL,
    lote                    VARCHAR(50),
    esquema_completo        BOOLEAN NOT NULL DEFAULT false,
    establecimiento_salud   VARCHAR(200),
    responsable_nombre      VARCHAR(200),           -- quien aplico la vacuna (puede no ser quien la registra en el sistema)
    observaciones           TEXT,

    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inmunizaciones_organizacion ON registro_inmunizaciones(organizacion_id);
CREATE INDEX idx_inmunizaciones_trabajador ON registro_inmunizaciones(trabajador_id);
