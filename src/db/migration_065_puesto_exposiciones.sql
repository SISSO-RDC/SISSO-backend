-- ============================================================
-- Migracion 065: crea puesto_exposiciones, la fuente de verdad
-- estructurada que faltaba para que el motor de aptitud derive
-- exposiciones automaticamente en vez de depender solo de lo que
-- el usuario escriba en el payload de la evaluacion.
--
-- CORRIGE el hallazgo CRITICO C-03 de la Auditoria N.13: el motor
-- (detectarContraindicaciones) recibia diagnosticosCie10 y
-- exposicionesPuesto directamente de req.body, sin verificar que
-- fueran el conjunto completo/vigente. Para exposicionesPuesto en
-- particular no existia NINGUNA tabla que declarara, con los mismos
-- codigos que el motor ya entiende (catalogo_exposiciones), a que
-- exposiciones esta sometido un puesto de trabajo.
--
-- DECISION DE DISENO IMPORTANTE (evitar un riesgo peor que el que se
-- corrige): puestos_trabajo.factores_riesgo (migration_022) ya
-- describe el perfil de riesgo de un puesto, pero en un vocabulario
-- de catalogo DISTINTO (riesgosFisicos/riesgosQuimicos/... de
-- src/historiaClinica/catalogosRiesgo.js), sin correspondencia 1:1
-- con los codigos de catalogo_exposiciones ('trabajo_alturas',
-- 'ruido_alto', etc.). Intentar traducir uno al otro por coincidencia
-- de texto (ej. buscar la palabra "altura" en un campo libre) es
-- exactamente el tipo de heuristica fragil que esta misma auditoria
-- senala como riesgo en otros modulos -- por eso NO se implementa
-- esa traduccion automatica por texto. En su lugar, se crea esta
-- tabla para que la organizacion declare la exposicion de forma
-- EXPLICITA y con el codigo correcto (el mismo que ya usa el motor),
-- una sola vez por puesto, en vez de que cada evaluacion dependa de
-- que el medico recuerde escribirlo en el body cada vez.
-- ============================================================

CREATE TABLE IF NOT EXISTS puesto_exposiciones (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    puesto_trabajo_id   UUID NOT NULL REFERENCES puestos_trabajo(id) ON DELETE CASCADE,

    -- Mismo codigo que catalogo_exposiciones.codigo (sin FK directa,
    -- mismo criterio ya usado por reglas_contraindicacion.exposicion_codigo:
    -- la validacion de que exista y este activo se hace a nivel de
    -- aplicacion, porque catalogo_exposiciones no tiene una clave
    -- unica simple sobre solo `codigo`, ver migration_006).
    exposicion_codigo   VARCHAR(50) NOT NULL,

    creado_por          UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (puesto_trabajo_id, exposicion_codigo)
);

CREATE INDEX idx_puesto_exposiciones_organizacion ON puesto_exposiciones(organizacion_id);
CREATE INDEX idx_puesto_exposiciones_puesto ON puesto_exposiciones(puesto_trabajo_id);

ALTER TABLE puesto_exposiciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE puesto_exposiciones FORCE ROW LEVEL SECURITY;

CREATE POLICY aislamiento_tenant ON puesto_exposiciones
  USING (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  ) WITH CHECK (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

COMMENT ON TABLE puesto_exposiciones IS
  'Fuente de verdad de exposiciones por puesto para el motor de aptitud (Auditoria N.13, C-03). '
  'Declaracion EXPLICITA por parte de la organizacion (admin/sso), usando los mismos codigos que '
  'catalogo_exposiciones/reglas_contraindicacion. No se deriva automaticamente de factores_riesgo '
  '(vocabulario distinto, ver comentario de esta migracion).';

INSERT INTO schema_migrations (version) VALUES ('065_puesto_exposiciones')
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------
-- Columnas de trazabilidad de procedencia en
-- historial_aptitud_medica (C-03, complemento): guarda de donde
-- salio cada diagnostico/exposicion usado (derivado vs. agregado
-- manualmente) y si la evaluacion quedo marcada incompleta por
-- falta de puesto asignado, para que el historial sea fiel a lo que
-- el motor realmente pudo derivar en ese momento.
-- ------------------------------------------------------------
ALTER TABLE historial_aptitud_medica
  ADD COLUMN IF NOT EXISTS procedencia_datos JSONB,
  ADD COLUMN IF NOT EXISTS evaluacion_incompleta BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN historial_aptitud_medica.procedencia_datos IS
  'Trazabilidad C-03: { diagnosticosDerivados, diagnosticosManualAdicionales, exposicionesDerivadas, exposicionesManualAdicionales }.';
COMMENT ON COLUMN historial_aptitud_medica.evaluacion_incompleta IS
  'true si el trabajador no tenia puesto asignado al momento de evaluar (no se pudieron derivar exposiciones). C-03.';
