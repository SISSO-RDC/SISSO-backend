-- ============================================================
-- Migracion 046: WITH CHECK explicito en las politicas RLS.
--
-- RESPONDE al hallazgo C1 de la Auditoria SISSO N.07 ("RLS-045 no
-- contiene politicas WITH CHECK para INSERT"), con una precision
-- importante verificada antes de escribir esta migracion:
--
-- El diagnostico del hallazgo C1 describia el sintoma esperado
-- correctamente (que decisiones de escritura bajo RLS dependen de
-- WITH CHECK), pero la conclusion de que las policies de
-- migration_045 BLOQUEAN el INSERT es incorrecta para este caso
-- concreto. Motivo (documentado por PostgreSQL y verificado aqui de
-- forma empirica antes de tocar produccion, no solo leido):
--
--   Para una policy sin FOR explicito (default: FOR ALL) que define
--   USING pero NO define WITH CHECK, PostgreSQL usa la MISMA
--   expresion USING como WITH CHECK para INSERT/UPDATE. Es
--   comportamiento documentado, no un bug ni un accidente:
--   "For policies that can have both USING and WITH CHECK
--   expressions (ALL and UPDATE), if no WITH CHECK expression is
--   defined, then the USING expression will be used both [...] and
--   which new rows will be allowed to be added."
--   (https://www.postgresql.org/docs/current/sql-createpolicy.html)
--
--   Verificacion empirica hecha para esta migracion: se recreo la
--   politica exacta de migration_045 en una base Postgres 16 nueva,
--   conectando como un rol NO due;o de la tabla y sin BYPASSRLS
--   (para replicar el rol de aplicacion real, no el rol admin de
--   Neon que crea las tablas). Resultado:
--     - INSERT con organizacion_id = app.organizacion_actual: OK.
--     - INSERT con organizacion_id de OTRA organizacion: rechazado
--       por RLS ("new row violates row-level security policy").
--     - UPDATE de una fila propia: OK.
--     - UPDATE que intenta reasignar organizacion_id a otro tenant:
--       rechazado por RLS.
--     - INSERT con es_superadmin=true hacia cualquier organizacion:
--       OK (bypass esperado para contextoInterno/superadmin).
--   Es decir: migration_045, TAL COMO ESTA aplicada hoy, ya bloquea
--   la escritura cross-tenant y permite la escritura legitima. No
--   hay una denegacion masiva de INSERT pendiente ni una perdida de
--   auditoria causada por RLS.
--
-- Por que aplicar esta migracion igual, si no es un bloqueador:
-- depender de que USING duplique como WITH CHECK es un
-- comportamiento correcto pero POCO OBVIO al leer el SQL: alguien
-- que audite o modifique esta migracion en el futuro (agregando,
-- por ejemplo, una politica FOR UPDATE mas especifica sin saber de
-- esta regla) podria introducir sin darse cuenta un WITH CHECK
-- ausente de verdad. Hacerlo explicito documenta la intencion en el
-- propio SQL y elimina la dependencia de una regla implicita.
--
-- Esta migracion NO cambia el comportamiento observable: cada
-- WITH CHECK agregado es identico a la expresion USING ya vigente
-- de la policy con el mismo nombre. Se implementa reemplazando cada
-- policy (DROP + CREATE con USING + WITH CHECK) en vez de con
-- ALTER POLICY porque ALTER POLICY no permite agregar WITH CHECK a
-- una policy que fue creada sin el en todas las versiones de
-- Postgres soportadas por Neon.
-- ============================================================

DO $$
DECLARE
  tabla text;
  tablas_organizacion text[] := ARRAY[
    'accidentes_acciones', 'accidentes_evidencias', 'accidentes_incidentes',
    'alertas', 'auditoria', 'ausencias', 'capa_acciones', 'capacitaciones',
    'catalogo_epp', 'catalogo_exposiciones', 'consentimientos_firmados',
    'cuestionarios_nordicos', 'enfermedad_profesional',
    'enfermedad_profesional_seguimientos', 'entregas_epp',
    'evaluaciones_niosh', 'evaluaciones_ocupacionales',
    'evaluaciones_psicosociales', 'evaluaciones_reba', 'evaluaciones_rula',
    'examenes_audiometria', 'examenes_espirometria', 'examenes_visiometria',
    'factores_psicosociales', 'historial_aptitud_medica', 'inspecciones',
    'inspecciones_hallazgos', 'inspecciones_items', 'investigaciones_accidentes',
    'matriz_medico_puesto', 'matriz_riesgos', 'mediciones_higiene_industrial',
    'pagos_suscripcion', 'programas_vigilancia_salud', 'puestos_trabajo',
    'registro_inmunizaciones', 'reglas_contraindicacion', 'restricciones_medicas',
    'restricciones_medicas_historial', 'sesiones_evaluacion_ergonomica',
    'sesiones_evaluacion_rula', 'trabajadores', 'vigilancia_salud_observaciones'
  ];
BEGIN
  FOREACH tabla IN ARRAY tablas_organizacion LOOP
    EXECUTE format('DROP POLICY IF EXISTS aislamiento_tenant ON %I', tabla);
    EXECUTE format(
      'CREATE POLICY aislamiento_tenant ON %I
         USING (
           organizacion_id = nullif(current_setting(''app.organizacion_actual'', true), '''')::uuid
           OR current_setting(''app.es_superadmin'', true) = ''true''
         )
         WITH CHECK (
           organizacion_id = nullif(current_setting(''app.organizacion_actual'', true), '''')::uuid
           OR current_setting(''app.es_superadmin'', true) = ''true''
         )', tabla, tabla
    );
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- organizaciones
-- ------------------------------------------------------------
DROP POLICY IF EXISTS aislamiento_tenant ON organizaciones;
CREATE POLICY aislamiento_tenant ON organizaciones
  USING (
    id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  )
  WITH CHECK (
    id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

-- ------------------------------------------------------------
-- usuarios (incluye la excepcion de "propia fila por id" para
-- login/MFA, igual que en migration_045)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS aislamiento_tenant ON usuarios;
CREATE POLICY aislamiento_tenant ON usuarios
  USING (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR id = nullif(current_setting('app.usuario_actual_id', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  )
  WITH CHECK (
    organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR id = nullif(current_setting('app.usuario_actual_id', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

-- ------------------------------------------------------------
-- capacitaciones_asistentes (filtro relacional via capacitaciones)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS aislamiento_tenant ON capacitaciones_asistentes;
CREATE POLICY aislamiento_tenant ON capacitaciones_asistentes
  USING (
    EXISTS (
      SELECT 1 FROM capacitaciones c
      WHERE c.id = capacitaciones_asistentes.capacitacion_id
        AND c.organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    )
    OR current_setting('app.es_superadmin', true) = 'true'
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM capacitaciones c
      WHERE c.id = capacitaciones_asistentes.capacitacion_id
        AND c.organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    )
    OR current_setting('app.es_superadmin', true) = 'true'
  );

-- ------------------------------------------------------------
-- refresh_tokens (filtro relacional via usuario dueño del token)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS aislamiento_tenant ON refresh_tokens;
CREATE POLICY aislamiento_tenant ON refresh_tokens
  USING (
    usuario_id = nullif(current_setting('app.usuario_actual_id', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  )
  WITH CHECK (
    usuario_id = nullif(current_setting('app.usuario_actual_id', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );


-- CORREGIDO en Auditoria N.07 (hallazgo GRAVE G-N07-02): se agrega
-- el auto-registro en schema_migrations, siguiendo la convencion ya
-- usada desde migration_030/031, para que esta migracion tambien sea
-- segura de pegar a mano en el SQL Editor de Neon (el flujo manual
-- que usa el equipo) sin quedar en un estado inconsistente frente a
-- migrate.js. ON CONFLICT DO NOTHING la hace ademas re-ejecutable.
INSERT INTO schema_migrations (version) VALUES ('046_rls_write_policies')
ON CONFLICT (version) DO NOTHING;
