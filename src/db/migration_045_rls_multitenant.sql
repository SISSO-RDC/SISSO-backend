-- ============================================================
-- Migracion 045: Row-Level Security (RLS) multi-tenant real.
--
-- CORRIGE el hallazgo GRAVE G3 de la Auditoria Integral 2026-08-22:
-- "RLS sigue siendo opcional... el aislamiento depende
-- fundamentalmente del backend/controladores/queries. Un error en
-- un controlador nuevo, un JOIN mal filtrado, o un endpoint que
-- olvide agregar organizacion_id = $N podria filtrar datos entre
-- empresas sin que la base de datos lo impida."
--
-- A diferencia del archivo OPCIONAL_rls_multitenant_g3.sql (que
-- quedo deliberadamente sin aplicar por los riesgos que explica),
-- esta migracion SI se aplica de punta a punta porque ya se
-- resolvieron las 2 condiciones que ese archivo pedia:
--   1. src/utils/contextoSolicitud.js + cambios en
--      middleware/auth.js propagan organizacion_id/usuario_id/
--      es_superadmin a un contexto async por peticion.
--   2. src/db/pool.js fija esas variables con set_config(..., true)
--      [LOCAL, se revierte solo al terminar la transaccion] antes
--      de cada consulta -- nunca con "SET" simple sobre una
--      conexion que vuelve a un pool compartido, para que jamas se
--      filtre entre peticiones de usuarios distintos.
--
-- IMPORTANTE -- FORCE ROW LEVEL SECURITY: por defecto, PostgreSQL
-- deja que el DUEÑO de una tabla la salte sin aplicar las policies,
-- aunque RLS este "activado". El rol de conexion de SISSO en Neon
-- es tipicamente el dueño de todas estas tablas (las creo via
-- migraciones), asi que sin FORCE ROW LEVEL SECURITY esta migracion
-- daria una falsa sensacion de seguridad: las policies existirian
-- pero nunca se aplicarian de verdad. Por eso cada tabla recibe
-- AMBOS comandos.
--
-- current_setting(..., true) devuelve NULL si la variable de sesion
-- nunca se fijo (en vez de tirar error), y nullif(..., '')
-- convierte string vacio a NULL antes de castear a uuid -- evita
-- que un contexto sin organizacion (login, superadmin, MFA pendiente)
-- rompa la consulta con un error de casteo en vez de simplemente no
-- matchear.
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
    'sesiones_evaluacion_rula', 'trabajadores', 'vigilancia_salud_observaciones',
    'capacitaciones_asistentes', 'refresh_tokens'
  ];
BEGIN
  FOREACH tabla IN ARRAY tablas_organizacion LOOP
    -- Ambas tablas de excepcion (capacitaciones_asistentes y
    -- refresh_tokens) no tienen columna organizacion_id propia --
    -- se filtran por relacion (ver policies dedicadas mas abajo),
    -- asi que se excluyen del bucle generico.
    IF tabla NOT IN ('capacitaciones_asistentes', 'refresh_tokens') THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabla);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabla);
      EXECUTE format(
        'CREATE POLICY aislamiento_tenant ON %I USING (
           organizacion_id = nullif(current_setting(''app.organizacion_actual'', true), '''')::uuid
           OR current_setting(''app.es_superadmin'', true) = ''true''
         )', tabla
      );
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- organizaciones: no tiene columna organizacion_id (ES el
-- tenant), se filtra por su propio id.
-- ------------------------------------------------------------
ALTER TABLE organizaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizaciones FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON organizaciones USING (
  id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
  OR current_setting('app.es_superadmin', true) = 'true'
);

-- ------------------------------------------------------------
-- usuarios: caso especial. Ademas del filtro normal por
-- organizacion_id, se permite que cualquiera vea/edite su PROPIA
-- fila por id -- imprescindible para los flujos de login y
-- configuracion de MFA, que corren ANTES de que exista una
-- organizacion confirmada en el contexto (ver middleware/auth.js,
-- autenticarOMfaPendiente).
-- ------------------------------------------------------------
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON usuarios USING (
  organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
  OR id = nullif(current_setting('app.usuario_actual_id', true), '')::uuid
  OR current_setting('app.es_superadmin', true) = 'true'
);

-- ------------------------------------------------------------
-- capacitaciones_asistentes: se filtra via la capacitacion a la
-- que pertenece (no tiene organizacion_id propia).
-- ------------------------------------------------------------
ALTER TABLE capacitaciones_asistentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacitaciones_asistentes FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON capacitaciones_asistentes USING (
  EXISTS (
    SELECT 1 FROM capacitaciones c
    WHERE c.id = capacitaciones_asistentes.capacitacion_id
      AND c.organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
  )
  OR current_setting('app.es_superadmin', true) = 'true'
);

-- ------------------------------------------------------------
-- refresh_tokens: se filtra via el usuario dueño del token.
-- ------------------------------------------------------------
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON refresh_tokens USING (
  usuario_id = nullif(current_setting('app.usuario_actual_id', true), '')::uuid
  OR current_setting('app.es_superadmin', true) = 'true'
);
