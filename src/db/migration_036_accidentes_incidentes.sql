-- ============================================================
-- Migracion 036: Accidentes, incidentes y casi accidentes
-- (Punto 18 / CRITICO 1 de la Auditoria SISSO N.06).
--
-- Es la mayor brecha funcional identificada: no existia un ciclo
-- integral de investigacion preventiva. Esta migracion crea 4
-- tablas que forman ese ciclo completo:
--   1. accidentes_incidentes   -- el evento en si (que paso, cuando,
--                                  donde, gravedad operativa)
--   2. investigaciones_accidentes -- causas inmediatas y basicas
--   3. accidentes_acciones     -- acciones correctivas/preventivas,
--                                  responsable, plazo y cierre
--   4. accidentes_evidencias   -- fotos/documentos, subidos como
--                                  recurso PRIVADO de Cloudinary
--                                  (mismo patron que certificados de
--                                  ausentismo: requiere URL firmada)
--
-- SEPARACION CLINICA DELIBERADA (el punto 7.2 de la auditoria es
-- explicito: "la parte clinica del caso debe permanecer bajo el
-- Medico Ocupacional"): esta tabla NO guarda diagnostico_cie10 ni
-- evolucion clinica de la lesion. `tipo_lesion` es una clasificacion
-- operativa general (ej: "corte", "contusion", "quemadura") para
-- estadistica de seguridad, no un diagnostico medico. Si el
-- trabajador requiere atencion medica, el caso clinico real se
-- registra por separado en Historia Clinica / Enfermedad
-- Profesional (modulos ya existentes, exclusivos de 'medico'); aqui
-- solo queda el booleano `requiere_atencion_medica` como bandera
-- operativa de seguimiento, sin ningun dato clinico.
-- ============================================================

CREATE TABLE accidentes_incidentes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    tipo                    VARCHAR(20) NOT NULL CHECK (tipo IN ('accidente', 'incidente', 'casi_accidente')),
    trabajador_id           UUID REFERENCES trabajadores(id) ON DELETE SET NULL, -- NULL: casi accidente sin persona afectada
    puesto_trabajo_id       UUID REFERENCES puestos_trabajo(id) ON DELETE SET NULL,

    fecha_ocurrencia        DATE NOT NULL,
    hora_ocurrencia         TIME,
    lugar                   VARCHAR(200) NOT NULL,
    descripcion             TEXT NOT NULL,

    gravedad                VARCHAR(15) NOT NULL DEFAULT 'no_aplica'
                                CHECK (gravedad IN ('leve', 'moderada', 'grave', 'mortal', 'no_aplica')),
    tipo_lesion             VARCHAR(60), -- clasificacion operativa general, NO diagnostico clinico
    dias_perdidos           INTEGER NOT NULL DEFAULT 0 CHECK (dias_perdidos >= 0),
    requiere_atencion_medica BOOLEAN NOT NULL DEFAULT false, -- bandera de seguimiento; el caso clinico vive en otro modulo

    -- Ciclo de vida del expediente (no del trabajador).
    estado                  VARCHAR(20) NOT NULL DEFAULT 'reportado'
                                CHECK (estado IN ('reportado', 'en_investigacion', 'con_acciones', 'cerrado')),

    reportado_por           UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_accidinc_organizacion ON accidentes_incidentes(organizacion_id);
CREATE INDEX idx_accidinc_estado ON accidentes_incidentes(organizacion_id, estado);
CREATE INDEX idx_accidinc_fecha ON accidentes_incidentes(fecha_ocurrencia DESC);

CREATE TRIGGER set_actualizado_en_accidentes_incidentes
  BEFORE UPDATE ON accidentes_incidentes
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

-- ------------------------------------------------------------
-- Investigacion: causas inmediatas (actos/condiciones subestandar
-- directas) y causas basicas (factores personales/del trabajo de
-- fondo) -- terminologia estandar de investigacion de accidentes
-- (arbol de causas / metodo de la cadena causal).
-- ------------------------------------------------------------
CREATE TABLE investigaciones_accidentes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    accidente_id            UUID NOT NULL REFERENCES accidentes_incidentes(id) ON DELETE CASCADE,
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    metodo_investigacion    VARCHAR(60), -- ej: "Arbol de causas", "5 porques"
    causas_inmediatas       TEXT NOT NULL,
    causas_basicas          TEXT NOT NULL,
    factores_contribuyentes TEXT,

    investigador_id         UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha_investigacion     DATE NOT NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Una sola investigacion formal por caso (se puede editar; no
    -- tiene sentido tener dos arboles de causa distintos para el
    -- mismo evento).
    UNIQUE (accidente_id)
);

CREATE INDEX idx_investacc_organizacion ON investigaciones_accidentes(organizacion_id);

-- ------------------------------------------------------------
-- Acciones correctivas/preventivas del caso. Esta tabla es
-- deliberadamente compatible en forma con lo que sera el futuro
-- modulo CAPA transversal (punto 19 / G1 de la auditoria): mismos
-- campos de responsable/plazo/estado/verificacion, para que cuando
-- se construya CAPA como modulo central, estas acciones puedan
-- migrarse o enlazarse sin rediseñar el concepto desde cero.
-- ------------------------------------------------------------
CREATE TABLE accidentes_acciones (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    accidente_id            UUID NOT NULL REFERENCES accidentes_incidentes(id) ON DELETE CASCADE,
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    descripcion             TEXT NOT NULL,
    responsable_id          UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha_limite            DATE NOT NULL,

    -- CORRIGE el patron generico de "verificar checkbox = cerrado"
    -- que senala el punto 7.3/G1 de la auditoria: 'completada' es
    -- solo que el responsable dice haberla hecho; 'verificada'
    -- exige que alguien MAS (verificado_por) confirme que la accion
    -- realmente fue eficaz antes de poder cerrar el caso padre.
    estado                  VARCHAR(15) NOT NULL DEFAULT 'pendiente'
                                CHECK (estado IN ('pendiente', 'en_progreso', 'completada', 'verificada')),
    fecha_cierre            DATE,
    verificado_por          UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    nota_verificacion       TEXT,

    creado_por              UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_accidacc_organizacion ON accidentes_acciones(organizacion_id);
CREATE INDEX idx_accidacc_accidente ON accidentes_acciones(accidente_id);
CREATE INDEX idx_accidacc_estado ON accidentes_acciones(organizacion_id, estado);

CREATE TRIGGER set_actualizado_en_accidentes_acciones
  BEFORE UPDATE ON accidentes_acciones
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

-- ------------------------------------------------------------
-- Evidencia (fotos/documentos). Se guarda SOLO el public_id de
-- Cloudinary (recurso privado/authenticated) -- nunca una URL
-- publica directa -- siguiendo exactamente el mismo patron ya
-- corregido para certificados de ausentismo (hallazgo G12): el
-- backend genera una URL firmada de corta duracion bajo demanda,
-- tras verificar que quien la pide tiene permiso sobre este caso.
-- ------------------------------------------------------------
CREATE TABLE accidentes_evidencias (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    accidente_id            UUID NOT NULL REFERENCES accidentes_incidentes(id) ON DELETE CASCADE,
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    tipo_archivo            VARCHAR(10) NOT NULL CHECK (tipo_archivo IN ('imagen', 'video')),
    public_id               VARCHAR(300) NOT NULL,
    descripcion             TEXT,

    subido_por              UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_accidev_accidente ON accidentes_evidencias(accidente_id);
CREATE INDEX idx_accidev_organizacion ON accidentes_evidencias(organizacion_id);


-- CORREGIDO en Auditoria N.07 (hallazgo GRAVE G-N07-02): se agrega
-- el auto-registro en schema_migrations, siguiendo la convencion ya
-- usada desde migration_030/031, para que esta migracion tambien sea
-- segura de pegar a mano en el SQL Editor de Neon (el flujo manual
-- que usa el equipo) sin quedar en un estado inconsistente frente a
-- migrate.js. ON CONFLICT DO NOTHING la hace ademas re-ejecutable.
INSERT INTO schema_migrations (version) VALUES ('036_accidentes_incidentes')
ON CONFLICT (version) DO NOTHING;
