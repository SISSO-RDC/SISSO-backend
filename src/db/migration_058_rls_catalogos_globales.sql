-- ============================================================
-- Migracion 058: corrige RLS de catalogos globales compartidos.
--
-- CORRIGE el hallazgo CRITICO C12-01 de la Auditoria Integral SISSO
-- N.12: catalogo_exposiciones y reglas_contraindicacion fueron
-- disenadas desde migration_006 con organizacion_id NULL como
-- significado explicito de "catalogo global compartido entre todas
-- las organizaciones" (reglas de referencia como epilepsia +
-- alturas, epilepsia + espacios confinados, trastorno vestibular +
-- alturas, etc.).
--
-- migration_045 incluyo ambas tablas dentro del arreglo generico
-- tablas_organizacion, cuya politica exige
-- "organizacion_id = <tenant actual>" y NO contempla
-- "organizacion_id IS NULL" como fila valida. El resultado: RLS se
-- evalua ANTES que el WHERE del controlador, asi que una fila
-- global queda bloqueada sin importar que la consulta de la
-- aplicacion la pida explicitamente con
-- "WHERE organizacion_id IS NULL OR organizacion_id = $1". Esto
-- puede dejar al motor de contraindicaciones sin las reglas
-- globales, con un fallo SILENCIOSO (HTTP 200, arreglo vacio o
-- incompleto) que es clinicamente mas peligroso que un error visible.
--
-- CORRECCION: reemplazar la politica generica en estas dos tablas
-- por una politica especial que permite:
--   1. Filas globales (organizacion_id IS NULL) -- visibles para
--      CUALQUIER organizacion autenticada, nunca para peticiones sin
--      contexto de organizacion ni superadmin.
--   2. Filas propias del tenant actual.
--   3. Superadmin (todas).
--
-- Se agrega ademas una politica WITH CHECK separada para
-- INSERT/UPDATE: una organizacion normal NUNCA puede escribir una
-- fila global (organizacion_id NULL) ni una fila de otra
-- organizacion -- solo el superadmin gestiona el catalogo global.
-- ============================================================

-- ------------------------------------------------------------
-- catalogo_exposiciones
-- ------------------------------------------------------------
DROP POLICY IF EXISTS aislamiento_tenant ON catalogo_exposiciones;

CREATE POLICY lectura_catalogo_global_y_tenant ON catalogo_exposiciones
  FOR SELECT USING (
    (
      organizacion_id IS NULL
      AND nullif(current_setting('app.organizacion_actual', true), '') IS NOT NULL
    )
    OR organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

CREATE POLICY escritura_catalogo_tenant_o_superadmin ON catalogo_exposiciones
  FOR INSERT WITH CHECK (
    (
      organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
      AND organizacion_id IS NOT NULL
    )
    OR current_setting('app.es_superadmin', true) = 'true'
  );

CREATE POLICY actualizacion_catalogo_tenant_o_superadmin ON catalogo_exposiciones
  FOR UPDATE USING (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  ) WITH CHECK (
    (
      organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
      AND organizacion_id IS NOT NULL
    )
    OR current_setting('app.es_superadmin', true) = 'true'
  );

CREATE POLICY borrado_catalogo_tenant_o_superadmin ON catalogo_exposiciones
  FOR DELETE USING (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

-- ------------------------------------------------------------
-- reglas_contraindicacion (misma semantica exacta)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS aislamiento_tenant ON reglas_contraindicacion;

CREATE POLICY lectura_reglas_global_y_tenant ON reglas_contraindicacion
  FOR SELECT USING (
    (
      organizacion_id IS NULL
      AND nullif(current_setting('app.organizacion_actual', true), '') IS NOT NULL
    )
    OR organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

CREATE POLICY escritura_reglas_tenant_o_superadmin ON reglas_contraindicacion
  FOR INSERT WITH CHECK (
    (
      organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
      AND organizacion_id IS NOT NULL
    )
    OR current_setting('app.es_superadmin', true) = 'true'
  );

CREATE POLICY actualizacion_reglas_tenant_o_superadmin ON reglas_contraindicacion
  FOR UPDATE USING (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  ) WITH CHECK (
    (
      organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
      AND organizacion_id IS NOT NULL
    )
    OR current_setting('app.es_superadmin', true) = 'true'
  );

CREATE POLICY borrado_reglas_tenant_o_superadmin ON reglas_contraindicacion
  FOR DELETE USING (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

-- ------------------------------------------------------------
-- Salvaguarda de regresion (parte de la correccion obligatoria
-- C12-01, punto 5): si una migracion futura vuelve a aplicar la
-- politica generica "aislamiento_tenant" sobre estas dos tablas,
-- esta funcion permite comprobarlo en una prueba automatizada sin
-- tener que inspeccionar catalogos de Postgres a mano desde JS.
-- Ver tests/rls.test.js.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_verificar_politicas_catalogos_globales()
RETURNS TABLE(tabla text, tiene_politica_generica_incorrecta boolean) AS $$
BEGIN
  RETURN QUERY
  SELECT p.tablename::text,
         bool_or(p.policyname = 'aislamiento_tenant')
  FROM pg_policies p
  WHERE p.tablename IN ('catalogo_exposiciones', 'reglas_contraindicacion')
  GROUP BY p.tablename;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION fn_verificar_politicas_catalogos_globales() IS
  'Salvaguarda del hallazgo C12-01: si vuelve true, una migracion posterior '
  'reintrodujo la politica generica sobre catalogos globales y las reglas '
  'compartidas quedarian bloqueadas otra vez.';

INSERT INTO schema_migrations (version) VALUES ('058_rls_catalogos_globales')
ON CONFLICT (version) DO NOTHING;
