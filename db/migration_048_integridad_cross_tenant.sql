-- ============================================================
-- Migracion 048: integridad referencial cross-tenant.
--
-- CORRIGE el hallazgo GRAVE G-N09-05 de la Auditoria Integral SISSO
-- N.09: muchas tablas tienen columnas como responsable_id, medico_id,
-- trabajador_id o puesto_trabajo_id que referencian usuarios(id),
-- trabajadores(id) o puestos_trabajo(id) directamente, SIN exigir
-- que esa fila referenciada pertenezca a la misma organizacion_id
-- que la fila que la referencia. RLS (migration_045) protege que un
-- usuario no pueda LEER filas de otra organizacion, pero no impide
-- que, al insertar o actualizar, se guarde un UUID valido que
-- pertenece a OTRA organizacion (por ejemplo, si ese UUID se conoce
-- o se filtra) -- eso es un problema de integridad, no de lectura,
-- y RLS no lo cubre.
--
-- Por que un TRIGGER generico y no claves foraneas compuestas:
-- la auditoria sugiere ambas opciones ("preferiblemente claves
-- compuestas o constraints de pertenencia; triggers ... donde una FK
-- compuesta sea impractica"). Una FK compuesta (organizacion_id,
-- responsable_id) exigiria que usuarios/trabajadores/puestos_trabajo
-- tuvieran una UNIQUE(organizacion_id, id) y que CADA tabla hija
-- declarara la FK compuesta -- viable, pero es un cambio de esquema
-- mucho mas invasivo (afecta ~25 tablas y sus migraciones de
-- creacion) para el mismo resultado practico que un trigger
-- reutilizable. Se opta por el trigger como via mas rapida de cerrar
-- el hallazgo sin reescribir el esquema completo; queda documentado
-- aqui como decision consciente, no como olvido.
--
-- El trigger es generico y reutilizable: recibe pares
-- (columna_local, tabla_referenciada) como argumentos y, para cada
-- par, si la columna local no es NULL, verifica que la fila
-- referenciada exista y que su organizacion_id coincida con el de la
-- fila que se esta insertando/actualizando.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_verificar_tenant_fk()
RETURNS TRIGGER AS $$
DECLARE
  i               INTEGER;
  col_local       TEXT;
  tabla_ref       TEXT;
  valor_local     UUID;
  org_referenciada UUID;
BEGIN
  IF TG_NARGS % 2 <> 0 THEN
    RAISE EXCEPTION 'fn_verificar_tenant_fk: numero de argumentos debe ser par (pares columna/tabla). Tabla: %', TG_TABLE_NAME;
  END IF;

  FOR i IN 0..(TG_NARGS / 2 - 1) LOOP
    col_local := TG_ARGV[i * 2];
    tabla_ref  := TG_ARGV[i * 2 + 1];

    EXECUTE format('SELECT ($1).%I', col_local) INTO valor_local USING NEW;

    IF valor_local IS NOT NULL THEN
      EXECUTE format('SELECT organizacion_id FROM %I WHERE id = $1', tabla_ref)
        INTO org_referenciada USING valor_local;

      IF org_referenciada IS NULL THEN
        RAISE EXCEPTION
          'Integridad cross-tenant: %.% = % no existe en %',
          TG_TABLE_NAME, col_local, valor_local, tabla_ref
          USING ERRCODE = 'foreign_key_violation';
      END IF;

      IF org_referenciada <> NEW.organizacion_id THEN
        RAISE EXCEPTION
          'Integridad cross-tenant: %.% (%) pertenece a la organizacion %, pero el registro de % es de la organizacion %',
          TG_TABLE_NAME, col_local, valor_local, org_referenciada, TG_TABLE_NAME, NEW.organizacion_id
          USING ERRCODE = 'foreign_key_violation';
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_verificar_tenant_fk() IS
  'Verifica que las FKs indicadas por argumentos (columna_local, tabla_referenciada) '
  'pertenezcan a la misma organizacion_id que la fila que las contiene. '
  'Ver migration_048 / hallazgo G-N09-05.';

-- ------------------------------------------------------------
-- Aplicacion a las tablas identificadas por la auditoria como de
-- mayor riesgo (datos clinicos, EPP, accidentes, CAPA, vigilancia,
-- puestos de trabajo). Se listan explicitamente table por table para
-- que cada trigger sea legible y facil de auditar por separado.
-- ------------------------------------------------------------

-- trabajadores.puesto_trabajo_id
DROP TRIGGER IF EXISTS trg_tenant_fk_trabajadores ON trabajadores;
CREATE TRIGGER trg_tenant_fk_trabajadores
  BEFORE INSERT OR UPDATE ON trabajadores
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('puesto_trabajo_id', 'puestos_trabajo');

-- sesiones_evaluacion_ergonomica (REBA): trabajador_id, evaluador_id
DROP TRIGGER IF EXISTS trg_tenant_fk_sesiones_reba ON sesiones_evaluacion_ergonomica;
CREATE TRIGGER trg_tenant_fk_sesiones_reba
  BEFORE INSERT OR UPDATE ON sesiones_evaluacion_ergonomica
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('trabajador_id', 'trabajadores', 'evaluador_id', 'usuarios');

-- sesiones_evaluacion_rula: trabajador_id, evaluador_id
DROP TRIGGER IF EXISTS trg_tenant_fk_sesiones_rula ON sesiones_evaluacion_rula;
CREATE TRIGGER trg_tenant_fk_sesiones_rula
  BEFORE INSERT OR UPDATE ON sesiones_evaluacion_rula
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('trabajador_id', 'trabajadores', 'evaluador_id', 'usuarios');

-- historial_aptitud_medica: trabajador_id, medico_id
DROP TRIGGER IF EXISTS trg_tenant_fk_aptitud_medica ON historial_aptitud_medica;
CREATE TRIGGER trg_tenant_fk_aptitud_medica
  BEFORE INSERT OR UPDATE ON historial_aptitud_medica
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('trabajador_id', 'trabajadores', 'medico_id', 'usuarios');

-- consentimientos_firmados: trabajador_id, registrado_por
DROP TRIGGER IF EXISTS trg_tenant_fk_consentimientos ON consentimientos_firmados;
CREATE TRIGGER trg_tenant_fk_consentimientos
  BEFORE INSERT OR UPDATE ON consentimientos_firmados
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('trabajador_id', 'trabajadores', 'registrado_por', 'usuarios');

-- examenes_audiometria: trabajador_id, medico_id
DROP TRIGGER IF EXISTS trg_tenant_fk_audiometria ON examenes_audiometria;
CREATE TRIGGER trg_tenant_fk_audiometria
  BEFORE INSERT OR UPDATE ON examenes_audiometria
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('trabajador_id', 'trabajadores', 'medico_id', 'usuarios');

-- examenes_espirometria: trabajador_id, medico_id
DROP TRIGGER IF EXISTS trg_tenant_fk_espirometria ON examenes_espirometria;
CREATE TRIGGER trg_tenant_fk_espirometria
  BEFORE INSERT OR UPDATE ON examenes_espirometria
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('trabajador_id', 'trabajadores', 'medico_id', 'usuarios');

-- evaluaciones_ocupacionales (historia clinica): trabajador_id, medico_id
DROP TRIGGER IF EXISTS trg_tenant_fk_historia_clinica ON evaluaciones_ocupacionales;
CREATE TRIGGER trg_tenant_fk_historia_clinica
  BEFORE INSERT OR UPDATE ON evaluaciones_ocupacionales
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('trabajador_id', 'trabajadores', 'medico_id', 'usuarios');

-- registro_inmunizaciones: trabajador_id, registrado_por
DROP TRIGGER IF EXISTS trg_tenant_fk_inmunizaciones ON registro_inmunizaciones;
CREATE TRIGGER trg_tenant_fk_inmunizaciones
  BEFORE INSERT OR UPDATE ON registro_inmunizaciones
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('trabajador_id', 'trabajadores', 'registrado_por', 'usuarios');

-- examenes_visiometria: trabajador_id, medico_id
DROP TRIGGER IF EXISTS trg_tenant_fk_visiometria ON examenes_visiometria;
CREATE TRIGGER trg_tenant_fk_visiometria
  BEFORE INSERT OR UPDATE ON examenes_visiometria
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('trabajador_id', 'trabajadores', 'medico_id', 'usuarios');

-- cuestionarios_nordicos: trabajador_id
DROP TRIGGER IF EXISTS trg_tenant_fk_nordico ON cuestionarios_nordicos;
CREATE TRIGGER trg_tenant_fk_nordico
  BEFORE INSERT OR UPDATE ON cuestionarios_nordicos
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('trabajador_id', 'trabajadores');

-- evaluaciones_niosh: trabajador_id, evaluado_por
DROP TRIGGER IF EXISTS trg_tenant_fk_niosh ON evaluaciones_niosh;
CREATE TRIGGER trg_tenant_fk_niosh
  BEFORE INSERT OR UPDATE ON evaluaciones_niosh
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('trabajador_id', 'trabajadores', 'evaluado_por', 'usuarios');

-- matriz_riesgos: puesto_trabajo_id
DROP TRIGGER IF EXISTS trg_tenant_fk_matriz_riesgos ON matriz_riesgos;
CREATE TRIGGER trg_tenant_fk_matriz_riesgos
  BEFORE INSERT OR UPDATE ON matriz_riesgos
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('puesto_trabajo_id', 'puestos_trabajo');

-- ausencias: trabajador_id, registrado_por
DROP TRIGGER IF EXISTS trg_tenant_fk_ausencias ON ausencias;
CREATE TRIGGER trg_tenant_fk_ausencias
  BEFORE INSERT OR UPDATE ON ausencias
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('trabajador_id', 'trabajadores', 'registrado_por', 'usuarios');

-- enfermedad_profesional: trabajador_id, puesto_trabajo_id, medico_responsable_id
DROP TRIGGER IF EXISTS trg_tenant_fk_enfermedad_profesional ON enfermedad_profesional;
CREATE TRIGGER trg_tenant_fk_enfermedad_profesional
  BEFORE INSERT OR UPDATE ON enfermedad_profesional
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk(
    'trabajador_id', 'trabajadores',
    'puesto_trabajo_id', 'puestos_trabajo',
    'medico_responsable_id', 'usuarios'
  );

-- enfermedad_profesional_seguimientos: medico_id
DROP TRIGGER IF EXISTS trg_tenant_fk_ep_seguimientos ON enfermedad_profesional_seguimientos;
CREATE TRIGGER trg_tenant_fk_ep_seguimientos
  BEFORE INSERT OR UPDATE ON enfermedad_profesional_seguimientos
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('medico_id', 'usuarios');

-- restricciones_medicas: trabajador_id, puesto_trabajo_id
DROP TRIGGER IF EXISTS trg_tenant_fk_restricciones ON restricciones_medicas;
CREATE TRIGGER trg_tenant_fk_restricciones
  BEFORE INSERT OR UPDATE ON restricciones_medicas
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('trabajador_id', 'trabajadores', 'puesto_trabajo_id', 'puestos_trabajo');

-- matriz_medico_puesto: puesto_trabajo_id, responsable_id
DROP TRIGGER IF EXISTS trg_tenant_fk_matriz_medico_puesto ON matriz_medico_puesto;
CREATE TRIGGER trg_tenant_fk_matriz_medico_puesto
  BEFORE INSERT OR UPDATE ON matriz_medico_puesto
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('puesto_trabajo_id', 'puestos_trabajo', 'responsable_id', 'usuarios');

-- programas_vigilancia_salud: puesto_trabajo_id, responsable_id
DROP TRIGGER IF EXISTS trg_tenant_fk_vigilancia_programas ON programas_vigilancia_salud;
CREATE TRIGGER trg_tenant_fk_vigilancia_programas
  BEFORE INSERT OR UPDATE ON programas_vigilancia_salud
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('puesto_trabajo_id', 'puestos_trabajo', 'responsable_id', 'usuarios');

-- vigilancia_salud_observaciones: registrado_por
DROP TRIGGER IF EXISTS trg_tenant_fk_vigilancia_observaciones ON vigilancia_salud_observaciones;
CREATE TRIGGER trg_tenant_fk_vigilancia_observaciones
  BEFORE INSERT OR UPDATE ON vigilancia_salud_observaciones
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('registrado_por', 'usuarios');

-- accidentes_incidentes: trabajador_id, puesto_trabajo_id
DROP TRIGGER IF EXISTS trg_tenant_fk_accidentes ON accidentes_incidentes;
CREATE TRIGGER trg_tenant_fk_accidentes
  BEFORE INSERT OR UPDATE ON accidentes_incidentes
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('trabajador_id', 'trabajadores', 'puesto_trabajo_id', 'puestos_trabajo');

-- accidentes_acciones: responsable_id, verificado_por
DROP TRIGGER IF EXISTS trg_tenant_fk_accidentes_acciones ON accidentes_acciones;
CREATE TRIGGER trg_tenant_fk_accidentes_acciones
  BEFORE INSERT OR UPDATE ON accidentes_acciones
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('responsable_id', 'usuarios', 'verificado_por', 'usuarios');

-- capa_acciones: responsable_id, verificado_por, evaluado_por
DROP TRIGGER IF EXISTS trg_tenant_fk_capa ON capa_acciones;
CREATE TRIGGER trg_tenant_fk_capa
  BEFORE INSERT OR UPDATE ON capa_acciones
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk(
    'responsable_id', 'usuarios',
    'verificado_por', 'usuarios',
    'evaluado_por', 'usuarios'
  );

-- inspecciones: puesto_trabajo_id
DROP TRIGGER IF EXISTS trg_tenant_fk_inspecciones ON inspecciones;
CREATE TRIGGER trg_tenant_fk_inspecciones
  BEFORE INSERT OR UPDATE ON inspecciones
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('puesto_trabajo_id', 'puestos_trabajo');

-- evaluaciones_psicosociales: trabajador_id, puesto_trabajo_id
DROP TRIGGER IF EXISTS trg_tenant_fk_psicosocial ON evaluaciones_psicosociales;
CREATE TRIGGER trg_tenant_fk_psicosocial
  BEFORE INSERT OR UPDATE ON evaluaciones_psicosociales
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('trabajador_id', 'trabajadores', 'puesto_trabajo_id', 'puestos_trabajo');

-- mediciones_higiene_industrial: puesto_trabajo_id, responsable_id
DROP TRIGGER IF EXISTS trg_tenant_fk_higiene ON mediciones_higiene_industrial;
CREATE TRIGGER trg_tenant_fk_higiene
  BEFORE INSERT OR UPDATE ON mediciones_higiene_industrial
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('puesto_trabajo_id', 'puestos_trabajo', 'responsable_id', 'usuarios');

-- entregas_epp: trabajador_id, puesto_trabajo_id, entregado_por
DROP TRIGGER IF EXISTS trg_tenant_fk_epp ON entregas_epp;
CREATE TRIGGER trg_tenant_fk_epp
  BEFORE INSERT OR UPDATE ON entregas_epp
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk(
    'trabajador_id', 'trabajadores',
    'puesto_trabajo_id', 'puestos_trabajo',
    'entregado_por', 'usuarios'
  );

-- alertas: trabajador_id, responsable_id
DROP TRIGGER IF EXISTS trg_tenant_fk_alertas ON alertas;
CREATE TRIGGER trg_tenant_fk_alertas
  BEFORE INSERT OR UPDATE ON alertas
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_tenant_fk('trabajador_id', 'trabajadores', 'responsable_id', 'usuarios');

-- ------------------------------------------------------------
-- NOTA para quien continue este trabajo: capacitaciones_asistentes
-- (migration_026) referencia trabajador_id pero NO tiene columna
-- organizacion_id propia (hereda la organizacion via
-- capacitacion_id -> capacitaciones.organizacion_id). El trigger
-- generico de arriba asume organizacion_id local y no cubre este
-- caso; si se necesita, requiere una variante del trigger que
-- resuelva primero la organizacion via el JOIN a capacitaciones.
-- Pendiente, fuera del alcance de esta migracion.
-- ------------------------------------------------------------

INSERT INTO schema_migrations (version) VALUES ('048_integridad_cross_tenant')
ON CONFLICT (version) DO NOTHING;
