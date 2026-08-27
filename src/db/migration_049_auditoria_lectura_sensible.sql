-- ============================================================
-- Migracion 049: cola durable para auditoria de lectura clinica
-- sensible.
--
-- CORRIGE el hallazgo GRAVE G-N09-07 de la Auditoria Integral SISSO
-- N.09: registrarAuditoria() sin `client` (que es el caso de TODAS
-- las lecturas, ya que una lectura no abre una transaccion de
-- escritura) es best-effort -- si el INSERT en `auditoria` falla,
-- el error se registra en consola y la lectura clinica continua sin
-- dejar rastro alguno de que ocurrio. Para lecturas de historia
-- clinica, aptitud o restricciones medicas, esa perdida de
-- trazabilidad es en si misma un problema de cumplimiento.
--
-- Esta migracion crea `auditoria_pendiente`: una cola durable minima
-- donde cae el intento de auditoria si el INSERT directo en
-- `auditoria` falla. La idea (ver utils/auditoria.js,
-- registrarAuditoria con lecturaSensible:true) es:
--   1. Intentar INSERT en `auditoria` (camino normal).
--   2. Si falla, intentar INSERT en `auditoria_pendiente` (mismo
--      contenido + el error que causo el fallo).
--   3. Si TAMBIEN falla el paso 2, recien ahi se relanza el error
--      hacia el controlador (fail-closed real: si no se pudo dejar
--      evidencia en NINGUN lado, la lectura no debe completarse
--      silenciosamente).
--   4. Si el paso 2 tuvo exito, la lectura puede responder con
--      normalidad -- hay cola durable, no hace falta bloquear al
--      usuario por una caida transitoria de la tabla `auditoria`.
--
-- Queda pendiente (fuera del alcance de esta migracion, requiere
-- infraestructura de cron/worker que este entorno no tiene) el
-- proceso periodico que drene auditoria_pendiente hacia auditoria y
-- alerte si el backlog crece; se deja `fn_backlog_auditoria_pendiente()`
-- como base para ese chequeo.
-- ============================================================

CREATE TABLE IF NOT EXISTS auditoria_pendiente (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id UUID,
    usuario_id      UUID,
    accion          VARCHAR(100) NOT NULL,
    entidad         VARCHAR(100),
    entidad_id      UUID,
    detalle         JSONB,
    ip_origen       VARCHAR(64),
    user_agent      TEXT,
    error_original  TEXT NOT NULL, -- por que fallo el INSERT directo en `auditoria`
    intentos_drenaje INTEGER NOT NULL DEFAULT 0,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    drenado_en      TIMESTAMPTZ -- NULL mientras siga pendiente de pasar a `auditoria`
);

CREATE INDEX IF NOT EXISTS idx_auditoria_pendiente_sin_drenar
  ON auditoria_pendiente(creado_en) WHERE drenado_en IS NULL;

COMMENT ON TABLE auditoria_pendiente IS
  'Cola durable de respaldo cuando el INSERT directo en auditoria falla, usada por '
  'registrarAuditoria({ lecturaSensible: true }). Ver hallazgo G-N09-07.';

-- Devuelve cuantas entradas siguen sin drenar hacia `auditoria`, para
-- que un endpoint de salud/monitoreo (o un chequeo manual periodico)
-- pueda alertar si el backlog crece, tal como pide la auditoria.
CREATE OR REPLACE FUNCTION fn_backlog_auditoria_pendiente()
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER FROM auditoria_pendiente WHERE drenado_en IS NULL;
$$ LANGUAGE sql STABLE;

INSERT INTO schema_migrations (version) VALUES ('049_auditoria_lectura_sensible')
ON CONFLICT (version) DO NOTHING;
