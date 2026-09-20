-- ============================================================
-- Migracion 078: perfil sectorial de la organizacion.
--
-- Lote B del plan "Perfil inteligente de empresa" (ver
-- AUDITORIA_PARIDAD_DEMO_VS_PLATAFORMA.md y migration_077 para el
-- catalogo de sectores del que depende esta migracion).
--
-- Agrega a "organizaciones" el resultado del configurador de la
-- Fase 3 del plan: que sector eligio la empresa, cuantos
-- trabajadores declaro en el asistente (dato de configuracion
-- inicial -- NO reemplaza el conteo real de la tabla trabajadores,
-- que ya existe y sigue siendo la fuente de verdad operativa) y que
-- riesgos de los sugeridos por el sector confirmo como presentes.
--
-- FK a catalogo_sectores(clave) en vez de a su id: si la Fase
-- futura de import/export de configuracion entre entornos se
-- implementa alguna vez, la clave legible ('salud', 'mineria') es
-- mas estable que un UUID interno.
--
-- ON DELETE SET NULL en vez de RESTRICT: si algun dia se elimina en
-- duro un sector del catalogo (no deberia pasar -- el flujo normal
-- es desactivarlo, ver cambiarEstado en catalogoSectoresController),
-- no debe bloquear ni destruir el registro de la organizacion; el
-- perfil sectorial simplemente queda sin sector y visible para
-- corregir, en linea con el criterio de "no cambios destructivos"
-- de la Fase 10.
-- ============================================================

ALTER TABLE organizaciones
  ADD COLUMN IF NOT EXISTS sector_empresarial_clave VARCHAR(50)
    REFERENCES catalogo_sectores(clave) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS numero_trabajadores_declarado INTEGER,
  ADD COLUMN IF NOT EXISTS riesgos_presentes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS configuracion_sectorial_aplicada_en TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_organizaciones_sector_empresarial
  ON organizaciones(sector_empresarial_clave);

INSERT INTO schema_migrations (version) VALUES ('078_perfil_sectorial_organizacion')
ON CONFLICT (version) DO NOTHING;
