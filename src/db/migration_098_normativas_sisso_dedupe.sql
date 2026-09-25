-- ============================================================
-- Migracion 098: elimina duplicados en normativas_sisso y agrega
-- el indice UNIQUE que faltaba para que no vuelva a pasar.
--
-- CAUSA RAIZ: migration_096 insertaba el seed con
-- "ON CONFLICT DO NOTHING" pero la tabla nunca tuvo ninguna
-- restriccion UNIQUE real sobre las columnas de negocio (solo el
-- `id` UUID autogenerado, que siempre es distinto) -- ese
-- ON CONFLICT nunca podia detectar nada, asi que si el script se
-- corrio dos veces en el SQL Editor de Neon, cada norma quedo
-- duplicada con un id distinto. No hay ninguna otra tabla con
-- clave foranea hacia normativas_sisso.id (ver migration_096/097),
-- asi que borrar los duplicados es seguro.
-- ============================================================

-- 1. Borra duplicados exactos (mismo pais/tipo/titulo/numero_acto),
--    conservando la fila fisicamente mas antigua (ctid) de cada grupo.
DELETE FROM normativas_sisso a
USING normativas_sisso b
WHERE a.ctid > b.ctid
  AND a.pais_clave = b.pais_clave
  AND a.tipo = b.tipo
  AND a.titulo = b.titulo
  AND COALESCE(a.numero_acto, '') = COALESCE(b.numero_acto, '');

-- 2. Indice UNICO real para que un futuro re-run del seed (o de
--    cualquier alta manual duplicada) sea efectivamente idempotente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_normativas_sisso_dedupe
  ON normativas_sisso (pais_clave, tipo, titulo, COALESCE(numero_acto, ''));

INSERT INTO schema_migrations (version) VALUES ('098_normativas_sisso_dedupe')
ON CONFLICT (version) DO NOTHING;
