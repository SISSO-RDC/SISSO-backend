-- ============================================================
-- SISSO - Migracion 012: reseteo de contrasena por admin.
--
-- Hasta ahora NO existia ninguna forma de resetear la contrasena
-- de un usuario: ni el propio usuario podia cambiarla, ni el admin
-- podia resetearla si alguien la olvidaba. Esta migracion agrega
-- el campo necesario para soportar ambos flujos (ver
-- authController.js: resetearPassword y cambiarPassword).
--
-- requiere_cambio_password: se pone en TRUE cuando un admin resetea
-- la contrasena de otro usuario (le asigna una temporal). El
-- frontend debe forzar la pantalla de cambio de contrasena la
-- proxima vez que ese usuario inicie sesion, antes de dejarlo usar
-- el resto del sistema. Se vuelve FALSE en cuanto el usuario
-- establece su propia contrasena nueva.
-- ============================================================

ALTER TABLE usuarios
  ADD COLUMN requiere_cambio_password BOOLEAN NOT NULL DEFAULT false;
