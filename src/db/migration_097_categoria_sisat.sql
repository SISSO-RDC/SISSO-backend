-- ============================================================
-- Migracion 097: categorizacion SISAT (I-V) enganchada al motor
-- sectorial ya existente (propuestas_configuracion_sectorial,
-- migration_083), a pedido explicito del usuario tras la
-- integracion del Acuerdo Ministerial MSP 00004-2026 (ver
-- migration_096_normativas_sisso.sql).
--
-- QUE SE INTENTO PRIMERO Y SE DESCARTO: derivar automaticamente el
-- "nivel de riesgo" de cada sector tomando el nivel mas alto
-- presente en catalogo_sectores.riesgos (que ya trae 'alto'/'medio'/
-- 'bajo' POR CADA riesgo puntual, ej. "riesgo psicosocial: alto").
-- Se probo mecanicamente y da 'alto' en 12 de los 14 sectores
-- sembrados (incluidos "Legal" y "Educacion", por su riesgo
-- psicosocial) -- NO es lo mismo que la clasificacion de riesgo por
-- actividad economica que exige el propio SISAT (que sigue tablas
-- oficiales por actividad/CIIU de la autoridad de trabajo, no un
-- maximo entre riesgos puntuales). Usar ese atajo habria etiquetado
-- casi todo el catalogo como "alto riesgo" sin ninguna fuente que lo
-- respalde -- exactamente el tipo de dato inventado que las
-- auditorias N.16-N.19 vienen corrigiendo en todo SISSO. Por eso
-- esta migracion agrega la columna en NULL para las 14 filas
-- existentes: el superadmin la clasifica a mano, sector por sector,
-- desde el panel de Catalogo de Sectores (mismo patron ya usado para
-- "estado_contenido": explicito y auditable, nunca asumido).
-- ============================================================

ALTER TABLE catalogo_sectores
  ADD COLUMN IF NOT EXISTS nivel_riesgo_sisat VARCHAR(10)
    CHECK (nivel_riesgo_sisat IS NULL OR nivel_riesgo_sisat IN ('bajo', 'medio', 'alto'));

COMMENT ON COLUMN catalogo_sectores.nivel_riesgo_sisat IS
  'Clasificacion de riesgo POR ACTIVIDAD para efectos del Reglamento SISAT '
  '(Acuerdo Ministerial MSP 00004-2026, Tabla 2 y art. 25) -- NO se deriva '
  'automaticamente de catalogo_sectores.riesgos (ver comentario de '
  'migration_097). Queda NULL hasta que un superadmin la confirme '
  'explicitamente sector por sector; mientras este NULL, el calculo de '
  'categoria SISAT de una organizacion de ese sector se abstiene de '
  'proponer nada y lo declara como pendiente (ver src/utils/categoriaSisat.js '
  'y configuracionSectorialController.js: generarPropuestas).';

INSERT INTO schema_migrations (version) VALUES ('097_categoria_sisat')
ON CONFLICT (version) DO NOTHING;
