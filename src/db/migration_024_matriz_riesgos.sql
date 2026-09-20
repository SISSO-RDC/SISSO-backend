-- ============================================================
-- SISSO - Migracion 024: Matriz de Riesgos (metodologia IPER,
-- Probabilidad x Consecuencia, 5x5). Ver
-- src/matrizRiesgos/matrizRiesgos.js para el detalle completo de
-- la metodologia y las fuentes.
--
-- Se enlaza opcionalmente a puestos_trabajo (migration_022): un
-- item de la matriz puede estar asociado a un puesto formalmente
-- catalogado, o registrarse con el nombre del puesto en texto
-- libre si aun no esta en el catalogo (no se obliga a crear el
-- puesto primero, para no friccionar el registro inicial de la
-- matriz completa de la empresa).
-- ============================================================

CREATE TABLE matriz_riesgos (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    puesto_trabajo_id       UUID REFERENCES puestos_trabajo(id) ON DELETE SET NULL,
    puesto_texto_libre      VARCHAR(150), -- usado cuando no se vincula a un puesto del catalogo

    proceso                 VARCHAR(150),
    actividad               VARCHAR(200),
    tipo_peligro            VARCHAR(20) NOT NULL CHECK (tipo_peligro IN ('fisico', 'mecanico', 'quimico', 'biologico', 'ergonomico', 'psicosocial')),
    peligro_especifico      TEXT NOT NULL, -- ej: "ruido continuo > 85dB", "manejo de solventes"
    riesgo_potencial        TEXT,          -- el daño esperado, ej: "hipoacusia inducida por ruido"
    trabajadores_expuestos  SMALLINT,

    probabilidad            SMALLINT NOT NULL CHECK (probabilidad BETWEEN 1 AND 5),
    consecuencia             SMALLINT NOT NULL CHECK (consecuencia BETWEEN 1 AND 5),
    nivel_riesgo             SMALLINT,      -- calculado por el backend: probabilidad * consecuencia
    clasificacion            VARCHAR(15) CHECK (clasificacion IN ('trivial', 'tolerable', 'moderado', 'importante', 'intolerable')),

    controles_existentes    TEXT,
    controles_adicionales   TEXT,
    responsable_control     VARCHAR(150),
    plazo_control           DATE,

    activo                  BOOLEAN NOT NULL DEFAULT true,
    creado_por              UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_matriz_riesgos_organizacion ON matriz_riesgos(organizacion_id);
CREATE INDEX idx_matriz_riesgos_puesto ON matriz_riesgos(puesto_trabajo_id);
CREATE INDEX idx_matriz_riesgos_clasificacion ON matriz_riesgos(clasificacion);

CREATE TRIGGER set_actualizado_en_matriz_riesgos
  BEFORE UPDATE ON matriz_riesgos
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();
