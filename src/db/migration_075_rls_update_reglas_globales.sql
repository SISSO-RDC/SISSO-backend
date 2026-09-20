-- ============================================================
-- Migracion 075: corrige politica RLS de UPDATE sobre
-- reglas_contraindicacion para permitir retirar reglas GLOBALES.
--
-- CORRIGE hallazgo de la Auditoria Integral SISSO N.15 (detectado
-- al ejecutar la suite completa contra PostgreSQL real con un rol
-- SIN privilegios de superusuario, tal como exige C15-03 -- este
-- bug era invisible en cualquier corrida de pruebas que usara un
-- rol de base de datos superusuario, porque un superusuario de
-- Postgres omite RLS por completo sin importar FORCE ROW LEVEL
-- SECURITY).
--
-- Sintoma: aptitudController.retirarRegla() permite explicitamente
-- que un rol 'medico' retire una regla GLOBAL de contraindicacion
-- (organizacion_id IS NULL) -- ver el chequeo de rol en el propio
-- controlador y la prueba tests/auditoria_n14_p0.test.js
-- ("C14-05: medico SI puede retirar una regla GLOBAL de
-- contraindicacion"). Sin embargo, la politica RLS de UPDATE creada
-- en migration_058_rls_catalogos_globales.sql
-- (actualizacion_reglas_tenant_o_superadmin) solo evalua a true
-- cuando "organizacion_id = <tenant actual>" o "es_superadmin" --
-- JAMAS cuando "organizacion_id IS NULL". migration_066 agrego la
-- gobernanza (estado, revisor_medico_id) pero nunca toco esta
-- politica.
--
-- Efecto real: el UPDATE del controlador afecta 0 filas para
-- CUALQUIER regla global, sin importar el rol -- la API responde
-- 404 "Regla no encontrada" incluso para un medico autorizado. Es
-- el mismo patron que motiva el hallazgo GRAVE G15-02 de esta
-- auditoria ("dependencia fuerte de reglas de autorizacion
-- distribuidas"): el controlador implementaba correctamente la
-- restriccion de rol (medico si, admin no), pero una capa de
-- seguridad mas profunda (RLS) diverguio y termino bloqueando
-- incluso el camino que el controlador SI autoriza.
--
-- La restriccion de "solo medico, nunca admin" para reglas GLOBALES
-- sigue viviendo en el controlador (es una decision de negocio
-- sobre el ROL exacto, y las politicas RLS de esta base no tienen
-- visibilidad del rol de aplicacion, solo de organizacion_id /
-- es_superadmin). Esta migracion solo alinea la capa RLS para que
-- dependencia de row_security dentro de la misma organizacion PUEDA
-- completar el UPDATE que el controlador ya decidio autorizar --
-- exactamente el mismo criterio que la politica de SELECT
-- (lectura_reglas_global_y_tenant) ya usa desde migration_058.
--
-- Nota de diseno: una regla global es, por definicion, compartida
-- entre TODAS las organizaciones (catalogo de referencia clinica,
-- no un dato propio de un tenant). Permitir que la politica RLS de
-- UPDATE la alcance no amplia el acceso de escritura a filas de
-- OTRAS organizaciones (esas siguen protegidas por
-- "organizacion_id = tenant actual"): unicamente habilita el caso
-- ya previsto y probado de "organizacion_id IS NULL", igual que la
-- politica de lectura.
-- ============================================================

DROP POLICY IF EXISTS actualizacion_reglas_tenant_o_superadmin ON reglas_contraindicacion;

CREATE POLICY actualizacion_reglas_tenant_o_superadmin ON reglas_contraindicacion
  FOR UPDATE USING (
    (
      organizacion_id IS NULL
      AND nullif(current_setting('app.organizacion_actual', true), '') IS NOT NULL
    )
    OR organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  ) WITH CHECK (
    -- La fila resultante (NEW) puede seguir siendo global (el
    -- controlador solo cambia "estado", nunca "organizacion_id"),
    -- ser propia del tenant actual, o cualquier cosa si es
    -- superadmin. Lo que NUNCA se permite es que una fila termine
    -- perteneciendo a OTRA organizacion distinta de la actual.
    organizacion_id IS NULL
    OR organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

COMMENT ON POLICY actualizacion_reglas_tenant_o_superadmin ON reglas_contraindicacion IS
  'Corregido en migration_075 (Auditoria N.15): ahora permite UPDATE sobre filas '
  'globales (organizacion_id IS NULL), igual que la politica de SELECT. La '
  'restriccion de que SOLO un medico (nunca un admin) pueda retirar una regla '
  'global sigue viviendo en aptitudController.retirarRegla(), no en RLS.';

INSERT INTO schema_migrations (version) VALUES ('075_rls_update_reglas_globales')
ON CONFLICT (version) DO NOTHING;
