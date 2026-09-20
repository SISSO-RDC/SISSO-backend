-- ============================================================
-- SISSO - Migracion 025: Ausentismo laboral.
--
-- Registro de ausencias por trabajador, clasificadas siguiendo
-- el mismo criterio que usa el IESS (Instituto Ecuatoriano de
-- Seguridad Social) para los tipos de contingencia que dan
-- derecho a subsidio por incapacidad temporal (enfermedad
-- general, accidente de trabajo, enfermedad profesional,
-- maternidad), mas los permisos/ausencias de origen laboral que
-- no pasan por el IESS pero que SSO/RRHH tambien necesita
-- controlar para calcular indices de ausentismo reales.
--
-- Decisiones de diseño acordadas con el cliente:
--   - Doble via de registro: manual (un formulario por ausencia)
--     e importacion masiva por Excel/CSV, mismo patron que la
--     carga masiva de trabajadores (migration_002 /
--     trabajadoresController.importarMasivo).
--   - dias_calendario es una columna GENERADA (no se calcula en
--     el backend ni se puede desincronizar): siempre
--     fecha_fin - fecha_inicio + 1.
--   - diagnostico_cie10 es opcional y reutiliza el catalogo CIE-10
--     global ya cargado (migration_006), para los tipos de
--     ausencia de origen medico. No se exige para permisos,
--     vacaciones, calamidad domestica, etc.
--   - certificado_url/certificado_public_id (Cloudinary) es
--     opcional: respaldo del certificado medico/IESS escaneado,
--     mismo patron de almacenamiento que evidencia REBA/RULA y
--     firmas de consentimiento.
-- ============================================================

CREATE TABLE ausencias (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    trabajador_id           UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,

    -- Clasificacion alineada al criterio de contingencias del IESS
    -- para las 4 primeras (enfermedad_general, accidente_trabajo,
    -- enfermedad_profesional, maternidad dan derecho a subsidio),
    -- mas tipos adicionales de ausencia laboral que SSO/RRHH
    -- necesita para el calculo real del indice de ausentismo.
    tipo                    VARCHAR(30) NOT NULL CHECK (tipo IN (
                                'enfermedad_general', 'accidente_trabajo', 'enfermedad_profesional',
                                'maternidad', 'paternidad', 'accidente_transito',
                                'calamidad_domestica', 'permiso_con_sueldo', 'permiso_sin_sueldo',
                                'falta_injustificada', 'otro'
                            )),

    -- Si esta contingencia especifica da derecho a subsidio del
    -- IESS (enfermedad_general, accidente_trabajo,
    -- enfermedad_profesional, maternidad, tipicamente). Se guarda
    -- como columna editable (no derivada de "tipo" en codigo duro)
    -- porque la elegibilidad real depende de dias de aportacion y
    -- otros factores que SSO/RRHH conoce caso por caso.
    subsidiado_iess         BOOLEAN NOT NULL DEFAULT false,

    fecha_inicio            DATE NOT NULL,
    fecha_fin               DATE NOT NULL CHECK (fecha_fin >= fecha_inicio),
    dias_calendario         INTEGER GENERATED ALWAYS AS (fecha_fin - fecha_inicio + 1) STORED,

    -- Diagnostico opcional (solo aplica a tipos de origen medico).
    -- Sin FOREIGN KEY estricta a nivel de constraint compuesto por
    -- el mismo motivo documentado en migration_006 (reglas_contraindicacion):
    -- aqui SI podemos usar FK simple porque catalogo_cie10.codigo
    -- es PRIMARY KEY (unico por si solo, a diferencia de
    -- catalogo_exposiciones.codigo).
    diagnostico_cie10       VARCHAR(10) REFERENCES catalogo_cie10(codigo) ON DELETE SET NULL,

    numero_certificado      VARCHAR(60), -- numero de aviso de entrada / certificado IESS o medico
    certificado_url         TEXT,        -- respaldo escaneado (Cloudinary), opcional
    certificado_public_id   VARCHAR(300),

    observaciones           TEXT,

    -- Si la fila vino de una importacion masiva, para trazabilidad
    -- (mismo criterio que otros modulos: siempre saber el origen
    -- de un dato cuando no fue tecleado registro por registro).
    origen                  VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'importacion_masiva')),

    registrado_por          UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,

    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ausencias_organizacion ON ausencias(organizacion_id);
CREATE INDEX idx_ausencias_trabajador ON ausencias(trabajador_id);
CREATE INDEX idx_ausencias_fecha_inicio ON ausencias(fecha_inicio);
CREATE INDEX idx_ausencias_tipo ON ausencias(tipo);

CREATE TRIGGER set_actualizado_en_ausencias
  BEFORE UPDATE ON ausencias
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();
