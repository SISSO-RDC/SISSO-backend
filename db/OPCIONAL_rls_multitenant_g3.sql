-- ============================================================
-- SISSO - Migracion 032 (OPCIONAL): Row-Level Security (RLS).
--
-- Corresponde al hallazgo GRAVE G3 de la auditoria de seguridad:
-- "Ausencia de PostgreSQL RLS: reforzar el aislamiento por tenant a
-- nivel de BD". Hoy el aislamiento multiempresa (organizacion_id)
-- se aplica SOLO en el codigo de la aplicacion (cada consulta
-- agrega "WHERE organizacion_id = $N"). Eso funciona mientras cada
-- consulta se escriba correctamente, pero un error humano futuro
-- (un desarrollador que olvida el WHERE en una consulta nueva)
-- podria filtrar datos entre empresas sin que la base de datos lo
-- impida.
--
-- ================================================================
-- POR QUE ESTA MIGRACION NO SE APLICA AUTOMATICAMENTE
-- ================================================================
-- Habilitar RLS de verdad requiere DOS partes, no solo el SQL:
--
-- 1. Esta migracion (politicas RLS por tabla, comparando
--    organizacion_id contra un parametro de sesion de Postgres).
-- 2. Un cambio en src/db/pool.js para que CADA peticion HTTP fije
--    ese parametro de sesion (SET LOCAL app.organizacion_actual)
--    dentro de una transaccion, usando el organizacion_id que ya
--    viene autenticado en req.usuario. Como SISSO usa un POOL de
--    conexiones compartido (no una conexion por usuario), hay que
--    tener cuidado de que ese SET LOCAL este SIEMPRE atado a la
--    transaccion de esa peticion especifica y nunca se filtre a la
--    siguiente peticion que reutilice la misma conexion del pool.
--
-- Aplicar el paso 1 sin el paso 2 no rompe nada (las policies caen
-- en su clausula por defecto y siguen dejando pasar todo mientras
-- el rol de conexion tenga BYPASSRLS, que es el default de un
-- usuario normal de Postgres/Neon). Aplicar el paso 1 SIN verificar
-- primero que el rol de conexion de SISSO en Neon NO tenga
-- BYPASSRLS puede dar una falsa sensacion de seguridad (las
-- policies existen pero no se aplican). Por eso esta migracion se
-- entrega COMENTADA y con instrucciones, para que SISSO decida
-- cuando programar el cambio de pool.js junto con pruebas de
-- regresion sobre TODOS los modulos antes de forzarla en
-- produccion.
--
-- PASOS PARA ACTIVARLA:
--   a. Confirmar en Neon que el rol de conexion NO es superusuario
--      y no tiene BYPASSRLS: ALTER ROLE <rol> NOBYPASSRLS;
--   b. Modificar pool.js: en cada peticion autenticada, abrir una
--      transaccion, ejecutar
--        SET LOCAL app.organizacion_actual = '<organizacion_id>';
--      y recien despues correr las consultas del controlador.
--   c. Quitar el bloque de comentario /* ... */ de abajo.
--   d. Probar en un entorno de pruebas con datos de 2+ empresas
--      antes de aplicar en produccion.
-- ================================================================

/*

ALTER TABLE trabajadores          ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluaciones_ocupacionales ENABLE ROW LEVEL SECURITY;
ALTER TABLE puestos_trabajo       ENABLE ROW LEVEL SECURITY;
ALTER TABLE matriz_riesgos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacitaciones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ausentismo            ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria             ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios              ENABLE ROW LEVEL SECURITY;
-- ... (repetir para el resto de tablas con organizacion_id)

CREATE POLICY aislamiento_tenant_trabajadores ON trabajadores
  USING (organizacion_id = current_setting('app.organizacion_actual', true)::uuid);

CREATE POLICY aislamiento_tenant_usuarios ON usuarios
  USING (
    organizacion_id = current_setting('app.organizacion_actual', true)::uuid
    OR rol = 'superadmin'  -- el superadmin no pertenece a ninguna organizacion
  );

-- ... (una policy analoga por cada tabla con organizacion_id)

INSERT INTO schema_migrations (version) VALUES ('032_rls_multitenant')
ON CONFLICT (version) DO NOTHING;

*/
