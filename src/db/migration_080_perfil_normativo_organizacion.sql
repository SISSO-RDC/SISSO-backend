-- ============================================================
-- Migracion 080: perfil normativo (pais) de la organizacion.
--
-- Lote C del plan "Perfil inteligente de empresa" (Fase 4).
--
-- DEFAULT 'ecuador' y NOT NULL: la plataforma opera exclusivamente
-- para Ecuador desde antes de este lote (CIE-10 local, formatos de
-- certificado, Decreto 255, etc.) -- todas las organizaciones
-- EXISTENTES son, de hecho, ecuatorianas. Ponerles 'ecuador' por
-- defecto documenta la realidad actual en vez de dejarlas en NULL
-- (que obligaria al wizard a forzar una eleccion sobre algo que ya
-- se sabe). Los administradores pueden cambiarlo despues desde el
-- configurador si su organizacion no es de Ecuador -- aunque, como
-- aclara el catalogo (migration_079), eso solo registra la
-- preferencia: no activa ninguna regla especifica de otro pais
-- todavia.
--
-- ON DELETE RESTRICT (a diferencia de sector_empresarial_clave, que
-- usa SET NULL): un pais del catalogo nunca deberia eliminarse en
-- duro -- ver mismo razonamiento que Fase 10 (no cambios
-- destructivos) -- asi que RESTRICT es una salvaguarda adicional
-- para que un DELETE accidental sobre el catalogo falle ruidosamente
-- en vez de dejar organizaciones sin perfil normativo en silencio.
-- ============================================================

ALTER TABLE organizaciones
  ADD COLUMN IF NOT EXISTS pais_normativo_clave VARCHAR(50) NOT NULL DEFAULT 'ecuador'
    REFERENCES catalogo_paises_normativos(clave) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_organizaciones_pais_normativo
  ON organizaciones(pais_normativo_clave);

INSERT INTO schema_migrations (version) VALUES ('080_perfil_normativo_organizacion')
ON CONFLICT (version) DO NOTHING;
