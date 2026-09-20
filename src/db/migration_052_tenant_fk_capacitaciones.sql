-- ============================================================
-- Migracion 052: integridad cross-tenant para
-- capacitaciones_asistentes (pendiente dejado explicito en
-- migration_048).
--
-- CORRIGE el hallazgo GRAVE G10-01 de la Auditoria Integral SISSO
-- N.10: capacitaciones_asistentes no tiene columna organizacion_id
-- propia (la hereda via capacitacion_id -> capacitaciones), asi que
-- el trigger generico fn_verificar_tenant_fk() de migration_048 (que
-- asume NEW.organizacion_id local) no puede aplicarse tal cual. Este
-- trigger resuelve primero la organizacion de la capacitacion y
-- luego valida que el trabajador pertenezca a esa misma
-- organizacion, antes de permitir inscribirlo como asistente.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_verificar_tenant_capacitaciones_asistentes()
RETURNS TRIGGER AS $$
DECLARE
  org_capacitacion UUID;
  org_trabajador UUID;
BEGIN
  SELECT organizacion_id INTO org_capacitacion FROM capacitaciones WHERE id = NEW.capacitacion_id;
  IF org_capacitacion IS NULL THEN
    RAISE EXCEPTION 'Integridad cross-tenant: capacitacion % no existe' , NEW.capacitacion_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT organizacion_id INTO org_trabajador FROM trabajadores WHERE id = NEW.trabajador_id;
  IF org_trabajador IS NULL THEN
    RAISE EXCEPTION 'Integridad cross-tenant: trabajador % no existe', NEW.trabajador_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF org_capacitacion <> org_trabajador THEN
    RAISE EXCEPTION
      'Integridad cross-tenant: el trabajador % (organizacion %) no pertenece a la organizacion % de la capacitacion %',
      NEW.trabajador_id, org_trabajador, org_capacitacion, NEW.capacitacion_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_fk_capacitaciones_asistentes ON capacitaciones_asistentes;
CREATE TRIGGER trg_tenant_fk_capacitaciones_asistentes
  BEFORE INSERT OR UPDATE ON capacitaciones_asistentes
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_capacitaciones_asistentes();

INSERT INTO schema_migrations (version) VALUES ('052_tenant_fk_capacitaciones_asistentes')
ON CONFLICT (version) DO NOTHING;
