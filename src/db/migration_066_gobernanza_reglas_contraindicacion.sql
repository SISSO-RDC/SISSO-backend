-- ============================================================
-- Migracion 066: gobernanza clinica de reglas_contraindicacion.
--
-- CORRIGE el hallazgo CRITICO C-04 de la Auditoria N.13: admin podia
-- crear reglas de contraindicacion (severidad absoluta/relativa) sin
-- ninguna aprobacion clinica -- una regla incorrecta creada por
-- administracion podia generar una alerta falsa o una falsa
-- sensacion de seguridad.
--
-- CORRECCION: se separa "creacion tecnica" de "aprobacion clinica".
-- Toda regla nueva creada por 'admin' nace en estado 'borrador' y NO
-- participa en detectarContraindicaciones hasta que un 'medico' la
-- apruebe explicitamente. Una regla creada directamente por 'medico'
-- puede auto-aprobarse (el medico ya es la autoridad clinica). Las
-- reglas sembradas en migration_006 (literatura clinica de
-- referencia, ya curadas antes de esta correccion) se marcan como
-- aprobadas retroactivamente para no romper el motor con la base
-- ya validada.
-- ============================================================

ALTER TABLE reglas_contraindicacion
  ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'aprobada', 'retirada')),
  ADD COLUMN IF NOT EXISTS autor_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revisor_medico_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fecha_revision TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS fecha_vigencia_desde DATE;

-- Las reglas sembradas por migration_006 (catalogo global de
-- referencia clinica, ya curado) se dan por aprobadas retroactivamente.
UPDATE reglas_contraindicacion
SET estado = 'aprobada', fecha_revision = creado_en, fecha_vigencia_desde = creado_en::date
WHERE organizacion_id IS NULL AND estado = 'borrador';

-- Cualquier otra regla preexistente (creada por una organizacion
-- antes de esta correccion) tambien se marca aprobada de forma
-- retroactiva -- no tendria sentido desactivar de golpe reglas que
-- ya estaban en uso productivo sin previo aviso; el requisito de
-- aprobacion aplica hacia adelante, para reglas NUEVAS.
UPDATE reglas_contraindicacion
SET estado = 'aprobada', fecha_revision = now(), autor_id = creado_por
WHERE organizacion_id IS NOT NULL AND estado = 'borrador';

COMMENT ON COLUMN reglas_contraindicacion.estado IS
  'Gobernanza clinica (C-04): borrador = creada, aun no usable por el motor; aprobada = revisada por medico, participa en detectarContraindicaciones; retirada = ya no se usa pero se conserva para trazabilidad.';
COMMENT ON COLUMN reglas_contraindicacion.revisor_medico_id IS
  'Medico que aprobo la regla. Obligatorio (a nivel de aplicacion) antes de pasar a estado=aprobada. C-04.';

INSERT INTO schema_migrations (version) VALUES ('066_gobernanza_reglas_contraindicacion')
ON CONFLICT (version) DO NOTHING;
