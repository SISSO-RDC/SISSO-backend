-- ============================================================
-- Migracion 076: registro SENESCYT de la especialidad (Salud
-- Ocupacional / Medicina del Trabajo) por usuario.
--
-- CREADO a pedido de la persona usuaria (05/09/2026): "en la parte
-- final tanto del certificado medico como en la ficha de la historia
-- clinica, debera constar el nombre completo del profesional y el
-- registro Senescyt de la especialidad sea de Salud Ocupacional o
-- Medicina del Trabajo". Hasta ahora solo existia un campo de texto
-- libre `codigo_profesional_salud` en CADA evaluacion (que el medico
-- reescribe a mano en cada formulario, opcional, sin validacion) --
-- inconsistente entre evaluaciones y facil de olvidar.
--
-- Se agrega como un campo PERSISTENTE por usuario, en el mismo
-- lugar donde ya vive la firma digital de cada persona
-- (firmas_digitales_usuario / la pestaña "Mi Firma Digital" de
-- Configuracion) -- se registra una sola vez y se imprime
-- automaticamente en cada documento que ese medico firme, en vez de
-- volver a escribirlo cada vez.
--
-- NULLABLE y sin CHECK de formato: el numero de registro SENESCYT no
-- sigue un patron unico verificable por SISSO, y forzar un formato
-- incorrecto bloquearia a un medico real. Solo tiene sentido para
-- usuarios con rol 'medico', pero no se restringe a nivel de columna
-- (un CHECK basado en el rol de la fila requeriria una funcion o
-- trigger; el rol de un usuario no cambia con frecuencia y la
-- aplicacion ya controla quien ve/edita este campo).
-- ============================================================

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS registro_senescyt_especialidad VARCHAR(50);

COMMENT ON COLUMN usuarios.registro_senescyt_especialidad IS
  'Numero de registro SENESCYT de la especialidad medica (Salud Ocupacional o '
  'Medicina del Trabajo), NO el registro profesional general. Se captura una '
  'vez por usuario (pestaña "Mi Firma Digital" de Configuracion) y se imprime '
  'automaticamente en los documentos que ese usuario firma.';

INSERT INTO schema_migrations (version) VALUES ('076_registro_senescyt_usuario')
ON CONFLICT (version) DO NOTHING;
