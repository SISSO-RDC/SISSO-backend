-- ============================================================
-- Migracion 062: corrige el plazo de respuesta de
-- solicitudes_titular de 30 a 15 dias calendario.
--
-- CORRIGE parte del hallazgo CRITICO C12-03 de la Auditoria
-- Integral SISSO N.12: la Ley Organica de Proteccion de Datos
-- Personales de Ecuador (LOPDP) establece un plazo de 15 dias
-- (no 30) para atender las solicitudes de ejercicio de derechos del
-- titular. El plazo anterior (documentado en migration_057 como
-- "punto de partida operativo... debe confirmarse con asesoria
-- juridica") no llego a corregirse tras esa confirmacion.
--
-- No se recorta retroactivamente el plazo de solicitudes YA
-- vencidas (no tendria sentido legal ni practico), pero SI se
-- recalculan las que siguen abiertas y aun no vencidas, para que no
-- queden con un plazo de 30 dias heredado del bug.
-- ============================================================

ALTER TABLE solicitudes_titular
  ALTER COLUMN fecha_limite_respuesta SET DEFAULT (CURRENT_DATE + INTERVAL '15 days');

UPDATE solicitudes_titular
SET fecha_limite_respuesta = fecha_recibida + INTERVAL '15 days'
WHERE estado NOT IN ('respondida', 'rechazada', 'cancelada')
  AND fecha_limite_respuesta > CURRENT_DATE
  AND fecha_limite_respuesta = fecha_recibida + INTERVAL '30 days'; -- solo las que aun tienen el plazo viejo sin modificar a mano

-- CREADO en Auditoria N.12 (C12-03): canal directo para que el
-- propio titular (no solo RRHH/SSO) pueda registrar su solicitud,
-- identificando la organizacion por su `codigo` publico (el mismo
-- codigo que ya se usa para el registro de usuarios, ver
-- authController.js). Se distingue del flujo interno con la columna
-- `origen`.
ALTER TABLE solicitudes_titular
  ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NOT NULL DEFAULT 'interno'
  CHECK (origen IN ('interno', 'canal_directo_titular'));

COMMENT ON COLUMN solicitudes_titular.origen IS
  'interno = registrada por RRHH/SSO/admin en nombre del titular. canal_directo_titular = el propio titular la envio via el endpoint publico. C12-03.';

INSERT INTO schema_migrations (version) VALUES ('062_derechos_titular_plazo_15_dias')
ON CONFLICT (version) DO NOTHING;
