-- ============================================================
-- SISSO - Migracion 007: correccion de catalogo_cie10
--
-- La migracion 006 creo la tabla catalogo_cie10 con 4 columnas
-- de jerarquia (codigo_padre_1 a codigo_padre_4), pero el archivo
-- fuente real (cie-10.csv) tiene 5 niveles de ancestros
-- (code_0 a code_4), confirmado al revisar filas de nivel 5:
-- ej. C020 tiene code_0='C00-D49', code_1='C00-C97',
-- code_2='C00-C75', code_3='C00-C14', code_4='C02'.
--
-- Esta migracion agrega la quinta columna que faltaba, para que
-- el script/endpoint de carga (que si genera 5 valores de
-- jerarquia) pueda insertar sin el error
-- "INSERT has more expressions than target columns".
--
-- Es seguro correr esta migracion aunque migration_006 ya se
-- haya ejecutado: solo agrega una columna nueva, no modifica
-- ni borra las existentes.
-- ============================================================

ALTER TABLE catalogo_cie10
  ADD COLUMN IF NOT EXISTS codigo_padre_5 VARCHAR(10);

COMMENT ON COLUMN catalogo_cie10.codigo_padre_1 IS 'Nivel de jerarquia mas general (ej: capitulo, A00-B99)';
COMMENT ON COLUMN catalogo_cie10.codigo_padre_5 IS 'Nivel de jerarquia mas especifico antes del codigo final (ej: C02 para C020)';
