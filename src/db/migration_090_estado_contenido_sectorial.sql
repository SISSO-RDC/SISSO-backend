-- ============================================================
-- Migracion 090 (Auditoria N.18, G18-04, P1): estado EXPLICITO del
-- contenido del catalogo sectorial.
--
-- PROBLEMA: catalogo_sectores.puestos_frecuentes solo tiene contenido
-- para 'salud' (migration_085) y 'epp_sugerido' esta vacio para 'otro'.
-- El motor sectorial genera propuestas a partir de esas listas, asi
-- que para un sector sin contenido /generar devolvia 0 propuestas de
-- ese tipo sin decir por que -- la persona usuaria podia creer que el
-- sector "no requiere puestos", cuando en realidad el catalogo no
-- tiene contenido cargado ni validado para el.
--
-- SOLUCION (la alternativa que acepta el criterio de cierre de la
-- auditoria: "catalogo validado O estado explicito de no
-- disponibilidad"): no se inventa contenido ocupacional. Se agrega
-- un estado explicito de validacion del contenido por sector. TODOS
-- arrancan 'borrador_sin_validar': ningun contenido del catalogo ha
-- sido validado por un profesional de SSO/medicina ocupacional. Un
-- sector pasa a 'validado' solo cuando el superadmin registra quien
-- lo valido y cuando (constraint que lo exige). La cobertura por
-- dimension (cuantos elementos hay) NO se guarda: la calcula la API
-- en cada consulta a partir de las listas reales, para que nunca
-- quede desactualizada.
-- ============================================================

ALTER TABLE catalogo_sectores
  ADD COLUMN IF NOT EXISTS estado_contenido VARCHAR(25) NOT NULL DEFAULT 'borrador_sin_validar',
  ADD COLUMN IF NOT EXISTS contenido_validado_por VARCHAR(200),
  ADD COLUMN IF NOT EXISTS contenido_validado_en DATE,
  ADD COLUMN IF NOT EXISTS notas_contenido TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'catalogo_sectores_estado_contenido_chk'
  ) THEN
    ALTER TABLE catalogo_sectores
      ADD CONSTRAINT catalogo_sectores_estado_contenido_chk
      CHECK (
        estado_contenido IN ('borrador_sin_validar', 'validado')
        AND (
          estado_contenido = 'borrador_sin_validar'
          OR (contenido_validado_por IS NOT NULL AND contenido_validado_en IS NOT NULL)
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN catalogo_sectores.estado_contenido IS
  'borrador_sin_validar (default) | validado. Un sector solo pasa a validado con contenido_validado_por y '
  'contenido_validado_en (Auditoria N.18, G18-04). Que dimensiones tienen contenido lo calcula la API.';

INSERT INTO schema_migrations (version) VALUES ('090_estado_contenido_sectorial')
ON CONFLICT (version) DO NOTHING;
