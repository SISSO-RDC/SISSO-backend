-- ============================================================
-- Migracion 047: tabla auditoria append-only (inmutable).
--
-- CORRIGE el hallazgo GRAVE G-N08-05 de la Auditoria Integral SISSO
-- N.08: "la revision no demuestra un mecanismo tecnico que impida
-- modificar o eliminar registros de auditoria por un rol
-- administrativo de la aplicacion o por operaciones internas".
--
-- Por que un TRIGGER y no solo REVOKE UPDATE/DELETE:
-- REVOKE es la primera idea intuitiva, pero en PostgreSQL el DUEÑO
-- de una tabla conserva TODOS los privilegios sobre ella sin
-- importar lo que se le revoque explicitamente (a diferencia de RLS,
-- que si se puede forzar sobre el dueño con FORCE ROW LEVEL
-- SECURITY, como ya se hizo en migration_045). El rol que usa la
-- aplicacion (el mismo que corrio las migraciones) ES el dueño de
-- `auditoria`, asi que un REVOKE por si solo seria seguridad de
-- fachada: no protegeria contra el propio codigo de la aplicacion
-- ni contra alguien con las credenciales de ese rol.
--
-- Un trigger BEFORE UPDATE/DELETE que siempre lanza una excepcion,
-- en cambio, se ejecuta SIEMPRE -- inclusive para el dueño de la
-- tabla y para cualquier rol futuro que se use para conectarse,
-- exactamente el mismo principio que motivo usar un trigger (y no
-- una simple politica) para forzar el fallo en
-- tests/atomicidad_auditoria.test.js. Es la forma mas fuerte de
-- "append-only" disponible sin salir de PostgreSQL.
--
-- EXCEPCION NECESARIA (encontrada al probar esta migracion contra
-- datos reales, no solo en teoria): auditoria.organizacion_id y
-- auditoria.usuario_id tienen FOREIGN KEY ... ON DELETE SET NULL
-- hacia organizaciones/usuarios. Si algun dia se elimina una
-- organizacion o un usuario (ej. baja definitiva de un cliente),
-- Postgres necesita poder poner esa columna en NULL en las filas
-- de auditoria que la referencian -- esa es una operacion de
-- integridad referencial del propio motor, no una alteracion de
-- CONTENIDO del registro de auditoria (que sigue existiendo, con su
-- accion/detalle/fecha intactos; solo pierde el vinculo directo a
-- una entidad que ya no existe). El trigger distingue explicitamente
-- este caso y lo permite columna por columna (organizacion_id puede
-- quedar igual o pasar a NULL; usuario_id puede quedar igual o pasar
-- a NULL, de forma independiente entre si, porque una eliminacion
-- puede afectar solo una organizacion, solo un usuario, o ambos a la
-- vez); cualquier otro UPDATE -- tocar accion, detalle, entidad_id,
-- fechas, o poner esas 2 columnas en un valor que NO sea NULL --
-- se sigue bloqueando siempre. DELETE se bloquea sin excepciones: no
-- hay ninguna necesidad referencial que lo justifique.
--
-- Via de escape documentada (para el caso legal/de cumplimiento
-- infrecuente en que una fila de auditoria deba corregirse o
-- purgarse, ej. una orden de un ente regulador): un superadmin con
-- acceso directo a la base de datos en Neon puede ejecutar
-- `DROP TRIGGER auditoria_inmutable ON auditoria;`, hacer el cambio
-- puntual, y volver a crearlo con el mismo cuerpo de esta migracion.
-- Deliberadamente NO se expone esto como un endpoint HTTP ni como
-- una excepcion basada en rol dentro de la propia base de datos:
-- cualquier bypass programatico (aunque fuera "solo para
-- superadmin") reintroduce exactamente el riesgo que este trigger
-- existe para cerrar.
-- ============================================================

CREATE OR REPLACE FUNCTION auditoria_bloquear_modificacion() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Permitir EXCLUSIVAMENTE el caso de ON DELETE SET NULL de las
    -- FK hacia organizaciones/usuarios: cada una de esas 2 columnas
    -- puede quedar sin cambios O pasar a NULL (una eliminacion puede
    -- afectar solo la organizacion, solo el usuario, o ambos a la
    -- vez), y absolutamente ninguna otra columna puede cambiar.
    IF NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.accion IS NOT DISTINCT FROM OLD.accion
       AND NEW.entidad IS NOT DISTINCT FROM OLD.entidad
       AND NEW.entidad_id IS NOT DISTINCT FROM OLD.entidad_id
       AND NEW.detalle IS NOT DISTINCT FROM OLD.detalle
       AND NEW.ip_origen IS NOT DISTINCT FROM OLD.ip_origen
       AND NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent
       AND NEW.creado_en IS NOT DISTINCT FROM OLD.creado_en
       AND (NEW.organizacion_id IS NOT DISTINCT FROM OLD.organizacion_id OR NEW.organizacion_id IS NULL)
       AND (NEW.usuario_id IS NOT DISTINCT FROM OLD.usuario_id OR NEW.usuario_id IS NULL)
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'La tabla auditoria es append-only: no se permite modificar el contenido de un registro existente. (Auditoria N.08, G-N08-05)';
  END IF;

  RAISE EXCEPTION 'La tabla auditoria es append-only: no se permite eliminar registros existentes. (Auditoria N.08, G-N08-05)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auditoria_inmutable ON auditoria;
CREATE TRIGGER auditoria_inmutable
  BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_bloquear_modificacion();

INSERT INTO schema_migrations (version) VALUES ('047_auditoria_append_only')
ON CONFLICT (version) DO NOTHING;
