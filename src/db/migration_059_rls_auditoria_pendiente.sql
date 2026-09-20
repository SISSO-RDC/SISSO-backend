-- ============================================================
-- Migracion 059: RLS sobre auditoria_pendiente.
--
-- CORRIGE el hallazgo GRAVE G12-08 de la Auditoria Integral SISSO
-- N.12: auditoria_pendiente (migration_049) contiene usuario,
-- organizacion, accion, entidad, IP, user-agent y el error original
-- -- el mismo tipo de dato sensible que `auditoria`, que si tiene
-- RLS + FORCE + append-only (migration_045/047) -- pero
-- auditoria_pendiente se quedo sin ninguna de esas defensas.
--
-- DISEÑO DE LA POLITICA (distinto de auditoria_pendiente = catalogo
-- global, NO es lo mismo que C12-01): aqui organizacion_id NULL NO
-- significa "compartido"; significa "el fallo ocurrio en un flujo
-- sin organizacion confirmada todavia" (ej. intento de login). Por
-- eso esas filas NO se hacen visibles a todas las organizaciones --
-- solo al superadmin, que es quien opera el drenaje
-- (superadminController.drenarAuditoria/verBacklogAuditoria, ambos
-- ya autenticados como superadmin).
--
-- INSERT: se permite si la fila que se intenta insertar corresponde
-- a la organizacion en contexto (o no tiene organizacion, o el
-- contexto es superadmin) -- exactamente lo que
-- utils/auditoria.js ya hace al usar `query()` con el contexto de
-- la peticion que disparo el fallo original.
--
-- SELECT/UPDATE: reservado al superadmin (drenaje y backlog). Una
-- organizacion normal jamas necesita leer esta cola de respaldo
-- directamente.
--
-- DELETE: nadie via RLS (la fila queda como evidencia permanente,
-- igual que en `auditoria`; el drenaje solo actualiza drenado_en).
-- ============================================================

ALTER TABLE auditoria_pendiente ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_pendiente FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auditoria_pendiente_insert ON auditoria_pendiente;
CREATE POLICY auditoria_pendiente_insert ON auditoria_pendiente
  FOR INSERT WITH CHECK (
    organizacion_id IS NULL
    OR organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
    OR current_setting('app.es_superadmin', true) = 'true'
  );

DROP POLICY IF EXISTS auditoria_pendiente_select_superadmin ON auditoria_pendiente;
CREATE POLICY auditoria_pendiente_select_superadmin ON auditoria_pendiente
  FOR SELECT USING (
    current_setting('app.es_superadmin', true) = 'true'
  );

DROP POLICY IF EXISTS auditoria_pendiente_update_superadmin ON auditoria_pendiente;
CREATE POLICY auditoria_pendiente_update_superadmin ON auditoria_pendiente
  FOR UPDATE USING (
    current_setting('app.es_superadmin', true) = 'true'
  ) WITH CHECK (
    current_setting('app.es_superadmin', true) = 'true'
  );

-- Nadie puede DELETE via RLS (ninguna politica FOR DELETE = denegado
-- por defecto con FORCE ROW LEVEL SECURITY activo).

INSERT INTO schema_migrations (version) VALUES ('059_rls_auditoria_pendiente')
ON CONFLICT (version) DO NOTHING;
