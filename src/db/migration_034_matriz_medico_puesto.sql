-- ============================================================
-- Migracion 034: Matriz medico-ocupacional por puesto
-- (Punto 15 / CRITICO 2 de la Auditoria SISSO N.06).
--
-- Hasta ahora la relacion puesto -> riesgo -> examen requerido
-- existia de forma DISTRIBUIDA e implicita: puestos_trabajo.factores_riesgo
-- (migration_022) describe los riesgos del puesto, pero no habia
-- ninguna tabla que dijera formalmente "este puesto, por tener
-- exposicion a ruido, requiere audiometria cada 12 meses, la
-- responsabilidad es del Medico Ocupacional".
--
-- Esta migracion crea esa relacion formal. El CALCULO de vencimientos
-- y brechas de cobertura (ultima evaluacion / proxima evaluacion /
-- trabajadores sin cobertura) NO se guarda en una columna: se
-- calcula en el controlador cruzando esta tabla con:
--   - trabajadores.puesto_trabajo_id (migration_022)
--   - examenes_audiometria / examenes_espirometria / examenes_visiometria
--   - evaluaciones_ocupacionales (tipo_evaluacion = 'periodica')
-- para que el vencimiento siempre refleje datos reales y no quede
-- desactualizado.
--
-- Acceso: SOLO 'medico'. Es la relacion que decide que vigilancia
-- clinica recibe cada trabajador; no es informacion operativa de
-- SSO (SSO consulta el perfil de riesgo del puesto en si mismo via
-- puestos_trabajo, que ya tenia acceso previo).
-- ============================================================

CREATE TABLE matriz_medico_puesto (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    puesto_trabajo_id       UUID NOT NULL REFERENCES puestos_trabajo(id) ON DELETE CASCADE,

    -- Mismo vocabulario de tipos de examen que ya usa el sistema en
    -- las tablas correspondientes (evita inventar un catalogo nuevo).
    tipo_examen             VARCHAR(30) NOT NULL
                                CHECK (tipo_examen IN ('audiometria', 'espirometria', 'visiometria', 'evaluacion_periodica')),

    riesgo_que_lo_justifica TEXT NOT NULL, -- ej: "exposicion a ruido > 85dB"
    frecuencia_meses        SMALLINT NOT NULL CHECK (frecuencia_meses > 0),
    obligatorio             BOOLEAN NOT NULL DEFAULT true,
    responsable_id          UUID REFERENCES usuarios(id) ON DELETE SET NULL, -- medico responsable de la vigilancia de este requisito
    activo                  BOOLEAN NOT NULL DEFAULT true,

    creado_por              UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Un mismo puesto no deberia tener dos requisitos activos del
    -- mismo tipo de examen (serian contradictorios en frecuencia).
    UNIQUE (puesto_trabajo_id, tipo_examen)
);

CREATE INDEX idx_matrizmp_organizacion ON matriz_medico_puesto(organizacion_id);
CREATE INDEX idx_matrizmp_puesto ON matriz_medico_puesto(puesto_trabajo_id);

CREATE TRIGGER set_actualizado_en_matriz_medico_puesto
  BEFORE UPDATE ON matriz_medico_puesto
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();


-- CORREGIDO en Auditoria N.07 (hallazgo GRAVE G-N07-02): se agrega
-- el auto-registro en schema_migrations, siguiendo la convencion ya
-- usada desde migration_030/031, para que esta migracion tambien sea
-- segura de pegar a mano en el SQL Editor de Neon (el flujo manual
-- que usa el equipo) sin quedar en un estado inconsistente frente a
-- migrate.js. ON CONFLICT DO NOTHING la hace ademas re-ejecutable.
INSERT INTO schema_migrations (version) VALUES ('034_matriz_medico_puesto')
ON CONFLICT (version) DO NOTHING;
