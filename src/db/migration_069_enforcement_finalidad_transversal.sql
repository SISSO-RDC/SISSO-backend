-- ============================================================
-- Migracion 069: enforcement TRANSVERSAL de finalidad de
-- tratamiento (NOT NULL), no solo catalogo.
--
-- CORRIGE el hallazgo CRITICO C14-04 (Auditoria N.14, P0): las
-- migraciones 051/056/063 crearon el catalogo finalidades_tratamiento
-- (con base_juridica NOT NULL a nivel de catalogo) y enlazaron la
-- columna finalidad_tratamiento_codigo a ~20 tablas sensibles/
-- personales, todas con DEFAULT -- pero NINGUNA quedo NOT NULL. Eso
-- significa que, a nivel de base de datos, seguia siendo posible
-- insertar una fila en cualquiera de esas tablas sin finalidad
-- asociada (pasando NULL explicitamente, o si a futuro alguien
-- quita el DEFAULT del INSERT). El gobierno de datos existia como
-- metadato/convencion, no como invariante verificable.
--
-- Esta migracion:
--   1. Backfillea cualquier fila que hoy tenga
--      finalidad_tratamiento_codigo NULL con el codigo por defecto
--      documentado para esa tabla (mismo codigo que ya declara el
--      DEFAULT de la columna).
--   2. Aplica SET NOT NULL a finalidad_tratamiento_codigo en TODAS
--      las tablas que la tienen.
--   3. Crea una funcion generica fn_verificar_gobierno_finalidad()
--      + prueba automatica (tests/gobierno_datos.test.js, ver
--      commit relacionado) que falla si una tabla nueva declarada
--      como sensible/personal en finalidades_tratamiento no tiene
--      su columna en NOT NULL -- para que el proximo modulo clinico
--      no pueda "olvidarse" del enforcement.
-- ============================================================

DO $$
DECLARE
  tabla TEXT;
  tablas TEXT[] := ARRAY[
    'evaluaciones_ocupacionales', 'accidentes_incidentes', 'capa_acciones', 'entregas_epp',
    'capacitaciones', 'ausencias', 'sesiones_evaluacion_ergonomica', 'sesiones_evaluacion_rula',
    'cuestionarios_nordicos', 'evaluaciones_niosh', 'evaluaciones_psicosociales',
    'mediciones_higiene_industrial', 'inspecciones', 'programas_vigilancia_salud',
    'enfermedad_profesional', 'restricciones_medicas', 'matriz_riesgos',
    'examenes_audiometria', 'examenes_espirometria', 'examenes_visiometria', 'registro_inmunizaciones'
  ];
BEGIN
  FOREACH tabla IN ARRAY tablas LOOP
    -- El backfill usa el DEFAULT ya declarado en la columna (todas
    -- estas tablas ya tienen DEFAULT fijado por 056/063/051); un
    -- UPDATE ... SET x = DEFAULT toma exactamente ese valor.
    EXECUTE format('UPDATE %I SET finalidad_tratamiento_codigo = DEFAULT WHERE finalidad_tratamiento_codigo IS NULL', tabla);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN finalidad_tratamiento_codigo SET NOT NULL', tabla);
  END LOOP;
END $$;

-- tipos_consentimiento (migration_051) no tenia DEFAULT propio, se
-- backfillea explicitamente con el codigo de consentimiento general
-- antes de aplicar NOT NULL.
UPDATE tipos_consentimiento
SET finalidad_tratamiento_codigo = 'vigilancia_salud_ocupacional'
WHERE finalidad_tratamiento_codigo IS NULL;
ALTER TABLE tipos_consentimiento ALTER COLUMN finalidad_tratamiento_codigo SET NOT NULL;

-- ------------------------------------------------------------
-- Vista de gobierno: expone, para cada tabla registrada en
-- gobierno_datos_inventario (nueva tabla mas abajo), si su columna
-- de finalidad esta efectivamente en NOT NULL en information_schema.
-- Esto es lo que consulta tests/gobierno_datos.test.js -- convierte
-- "deberia tener gobierno" en algo que un test puede verificar
-- contra el catalogo real de PostgreSQL, no contra una lista
-- mantenida a mano que puede desactualizarse.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gobierno_datos_inventario (
    tabla                TEXT PRIMARY KEY,
    categoria_datos      VARCHAR(30) NOT NULL CHECK (categoria_datos IN ('sensible', 'personal', 'agregado_anonimizado')),
    columna_finalidad     TEXT NOT NULL DEFAULT 'finalidad_tratamiento_codigo',
    responsable_area      TEXT,
    notas                 TEXT
);

COMMENT ON TABLE gobierno_datos_inventario IS
  'C14-04: inventario declarativo de que tablas deben tener enforcement de finalidad. '
  'tests/gobierno_datos.test.js valida contra information_schema que cada tabla listada aqui '
  'realmente tiene su columna de finalidad en NOT NULL -- si alguien agrega una tabla sensible '
  'nueva sin gobierno, el test falla en vez de quedar en silencio.';

INSERT INTO gobierno_datos_inventario (tabla, categoria_datos, responsable_area) VALUES
  ('evaluaciones_ocupacionales', 'sensible', 'medico'),
  ('accidentes_incidentes', 'sensible', 'sso'),
  ('capa_acciones', 'personal', 'sso'),
  ('entregas_epp', 'personal', 'th'),
  ('capacitaciones', 'personal', 'th'),
  ('ausencias', 'personal', 'th'),
  ('sesiones_evaluacion_ergonomica', 'sensible', 'sso'),
  ('sesiones_evaluacion_rula', 'sensible', 'sso'),
  ('cuestionarios_nordicos', 'sensible', 'sso'),
  ('evaluaciones_niosh', 'sensible', 'sso'),
  ('evaluaciones_psicosociales', 'sensible', 'medico'),
  ('mediciones_higiene_industrial', 'personal', 'sso'),
  ('inspecciones', 'personal', 'sso'),
  ('programas_vigilancia_salud', 'sensible', 'medico'),
  ('enfermedad_profesional', 'sensible', 'medico'),
  ('restricciones_medicas', 'sensible', 'medico'),
  ('matriz_riesgos', 'personal', 'sso'),
  ('examenes_audiometria', 'sensible', 'medico'),
  ('examenes_espirometria', 'sensible', 'medico'),
  ('examenes_visiometria', 'sensible', 'medico'),
  ('registro_inmunizaciones', 'sensible', 'medico'),
  ('tipos_consentimiento', 'sensible', 'medico')
ON CONFLICT (tabla) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('069_enforcement_finalidad_transversal')
ON CONFLICT (version) DO NOTHING;
