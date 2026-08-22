-- ============================================================
-- Migracion 043: Alertas como objetos persistentes (hallazgo G9
-- de la Auditoria SISSO N.06): "Deben pasar de señales calculadas
-- a objetos persistentes gestionables."
--
-- Hasta ahora (alertasController.js) las alertas eran el resultado
-- de consultas SQL calculadas en el momento, sin ninguna fila real
-- en la base de datos: no se podia marcar una como vista, asignarle
-- un responsable, dejar una nota de gestion, ni saber si ya se
-- habia atendido. Cada GET /api/alertas devolvia exactamente las
-- mismas señales una y otra vez, sin memoria de que paso con ellas.
--
-- Esta migracion crea la tabla `alertas` con ciclo de vida real, y
-- el controlador (ver pagosController.js -- no, ver alertasController.js
-- actualizado) sincroniza esta tabla contra las mismas señales que
-- ya se calculaban antes, pero ahora las INSERTA una sola vez (con
-- ON CONFLICT DO NOTHING sobre el origen) para no pisar el estado
-- de gestion de una alerta que el usuario ya empezo a atender.
--
-- Referencia polimorfica (origen_entidad + origen_id, sin FK): la
-- señal puede venir de trabajadores, evaluaciones_ocupacionales,
-- examenes_audiometria, examenes_espirometria, examenes_visiometria,
-- cuestionarios_nordicos, evaluaciones_niosh o
-- consentimientos_firmados -- mismo criterio ya usado en
-- capa_acciones (migration_037).
-- ============================================================

CREATE TABLE alertas (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    categoria               VARCHAR(40) NOT NULL CHECK (categoria IN (
        'emo_vencido', 'consentimiento_revocado', 'aptitud_no_apto',
        'historia_clinica_limitada', 'audiometria_sts', 'espirometria_anormal',
        'visiometria_requiere_evaluacion', 'nordico_prioritario', 'niosh_riesgo_alto'
    )),
    -- Preserva EXACTAMENTE la separacion de roles ya correcta en el
    -- controlador original: admin/th solo ven categorias
    -- administrativas; medico/sso ven todo.
    es_clinica              BOOLEAN NOT NULL DEFAULT false,

    origen_entidad          VARCHAR(60) NOT NULL, -- ej: 'trabajadores', 'examenes_audiometria'
    origen_id               UUID NOT NULL,

    trabajador_id           UUID REFERENCES trabajadores(id) ON DELETE CASCADE,
    titulo                  TEXT NOT NULL,
    detalle                 TEXT,

    estado                  VARCHAR(12) NOT NULL DEFAULT 'nueva'
                                CHECK (estado IN ('nueva', 'vista', 'en_gestion', 'resuelta', 'descartada')),
    responsable_id          UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    nota_gestion            TEXT,

    fecha_deteccion         DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_resolucion        DATE,

    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Evita duplicar la misma alerta cada vez que se sincroniza
    -- contra la misma señal de origen.
    UNIQUE (organizacion_id, categoria, origen_entidad, origen_id)
);

CREATE INDEX idx_alertas_organizacion ON alertas(organizacion_id);
CREATE INDEX idx_alertas_estado ON alertas(organizacion_id, estado);
CREATE INDEX idx_alertas_clinica ON alertas(organizacion_id, es_clinica);
CREATE INDEX idx_alertas_trabajador ON alertas(trabajador_id);

CREATE TRIGGER set_actualizado_en_alertas
  BEFORE UPDATE ON alertas
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();
