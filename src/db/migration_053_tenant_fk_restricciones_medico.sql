-- ============================================================
-- Migracion 053: extender el trigger de integridad cross-tenant de
-- restricciones_medicas para cubrir tambien las referencias a
-- medicos.
--
-- CORRIGE el hallazgo GRAVE G10-02 de la Auditoria Integral SISSO
-- N.10: migration_048 aplico fn_verificar_tenant_fk() a
-- restricciones_medicas solo para trabajador_id y
-- puesto_trabajo_id, mejor dicho quedaron sin cubrir
-- medico_emisor_id y medico_ultima_modificacion_id -- en un sistema
-- clinico multi-tenant, el medico responsable de una restriccion
-- tambien debe pertenecer a la misma organizacion que el trabajador.
-- Como CREATE TRIGGER no permite "agregar" argumentos a un trigger
-- existente, se recrea con la lista completa de columnas.
-- ============================================================

DROP TRIGGER IF EXISTS trg_tenant_fk_restricciones ON restricciones_medicas;
CREATE TRIGGER trg_tenant_fk_restricciones
  BEFORE INSERT OR UPDATE ON restricciones_medicas
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk(
    'trabajador_id', 'trabajadores',
    'puesto_trabajo_id', 'puestos_trabajo',
    'medico_emisor_id', 'usuarios',
    'medico_ultima_modificacion_id', 'usuarios'
  );

INSERT INTO schema_migrations (version) VALUES ('053_tenant_fk_restricciones_medico')
ON CONFLICT (version) DO NOTHING;
