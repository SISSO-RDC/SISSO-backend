-- ============================================================
-- Migracion 087: quinto tipo materializado del motor sectorial
-- (Auditoria N.17, C-17-03) -- 'examen'.
--
-- POR QUE UNA TABLA NUEVA (mismo criterio que 'area'/'riesgo' en
-- migration_084/086, no el de 'puesto'/'epp'): NO existe ningun
-- catalogo real de "que examenes periodicos incluye el protocolo
-- medico de esta organizacion" en todo el sistema. Las tablas que
-- si existen (audiometria, espirometria, visiometria,
-- historia_clinica) son REGISTROS CLINICOS de examenes ya
-- realizados a un trabajador especifico -- un concepto
-- completamente distinto al de este catalogo, que es la
-- planificacion/protocolo a nivel organizacion, no un resultado
-- individual. Insertar aqui en cualquiera de esas tablas clinicas
-- habria sido incorrecto (fabricaria examenes "realizados" que
-- nadie realizo).
--
-- 'tipo' se restringe a los 3 valores YA establecidos en la
-- Auditoria N.16 (migration_081, C-16-02: "Obligatorio" se
-- degrado a estos 3 porque ninguno tenia norma/articulo/vigencia
-- verificable) -- esta restriccion evita que alguien reintroduzca
-- "Obligatorio" sin una fuente verificada, la misma disciplina que
-- N.16 ya impuso en catalogo_sectores.
-- ============================================================

CREATE TABLE IF NOT EXISTS examenes_organizacion (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id   UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    nombre            VARCHAR(150) NOT NULL,
    tipo              VARCHAR(30) NOT NULL DEFAULT 'Sugerido por sector'
      CHECK (tipo IN ('Sugerido por sector', 'Condicionado a exposición', 'Requiere criterio médico')),
    frecuencia        VARCHAR(100), -- texto libre, ej: "Ingreso + anual" (igual que catalogo_sectores)
    norma_referencia  VARCHAR(150), -- ver comentario de migration_081 -- NULL mientras no este verificada

    origen            VARCHAR(20) NOT NULL DEFAULT 'sectorial'
      CHECK (origen IN ('sectorial', 'manual')),

    activo            BOOLEAN NOT NULL DEFAULT true,
    creado_por        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (organizacion_id, nombre)
);

CREATE INDEX idx_examenes_organizacion_organizacion ON examenes_organizacion(organizacion_id);

ALTER TABLE examenes_organizacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE examenes_organizacion FORCE ROW LEVEL SECURITY;

CREATE POLICY aislamiento_tenant ON examenes_organizacion
  USING (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  ) WITH CHECK (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

COMMENT ON TABLE examenes_organizacion IS
  'Catalogo REAL del protocolo de examenes periodicos que la organizacion reconoce como aplicables '
  '(Auditoria N.17, C-17-03, quinto tipo materializado). NO son registros clinicos de examenes ya '
  'realizados (eso es audiometria/espirometria/visiometria/historia_clinica) -- es la planificacion, '
  'a nivel organizacion, de que deberia incluir su programa de vigilancia de la salud.';

INSERT INTO schema_migrations (version) VALUES ('087_materializacion_examenes')
ON CONFLICT (version) DO NOTHING;
