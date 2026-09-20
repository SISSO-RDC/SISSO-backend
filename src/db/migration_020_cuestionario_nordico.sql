-- ============================================================
-- SISSO - Migracion 020: Cuestionario Nordico Estandarizado
-- (Kuorinka 1987) de sintomas musculo-esqueleticos.
--
-- Es una encuesta de auto-reporte (9 zonas corporales), no una
-- medicion con formula de puntaje como REBA/RULA. Por eso se
-- guarda como UNA aplicacion = UN registro con las 9 zonas en
-- JSONB (mismo patron que los bloques repetibles/matriz de
-- Historia Clinica Ocupacional), en vez de una fila por zona.
-- Ver src/nordico/nordico.js para el detalle completo de las
-- zonas, las preguntas y el criterio de "atencion prioritaria".
-- ============================================================

CREATE TABLE cuestionarios_nordicos (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id                 UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    trabajador_id                   UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    aplicado_por                    UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,

    fecha_aplicacion                DATE NOT NULL DEFAULT CURRENT_DATE,

    -- { cuello: { tuvoMolestias12Meses, lado, duracionEpisodio,
    --     tiempoTotal12Meses, tiempoImpedimentoTrabajo,
    --     cambioPuestoTrabajo, recibioTratamiento,
    --     molestiasUltimos7Dias, intensidad (0-5), atribucion },
    --   hombro: {...igual, con "lado"...}, ... 9 zonas en total }
    regiones                        JSONB NOT NULL,

    -- ---- Resumen calculado por el backend (src/nordico/nordico.js) ----
    regiones_con_molestia_12_meses  SMALLINT NOT NULL DEFAULT 0,
    regiones_con_molestia_7_dias    SMALLINT NOT NULL DEFAULT 0,
    regiones_prioritarias           TEXT[] NOT NULL DEFAULT '{}',
    requiere_atencion_prioritaria   BOOLEAN NOT NULL DEFAULT false,

    observaciones_generales         TEXT,

    creado_en                       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_nordico_organizacion ON cuestionarios_nordicos(organizacion_id);
CREATE INDEX idx_nordico_trabajador ON cuestionarios_nordicos(trabajador_id);
