-- ============================================================
-- Migracion 079: catalogo de paises / perfiles normativos.
--
-- Lote C del plan "Perfil inteligente de empresa" (Fase 4:
-- "arquitectura preparada para normativa por pais"). Deliberadamente
-- el ULTIMO lote implementado -- el usuario pidio dejarlo para el
-- final.
--
-- IMPORTANTE (textual del plan, Fase 4): "No declarar cumplimiento
-- legal automatico solamente por seleccionar un pais. La seleccion
-- debe establecer un 'perfil normativo' que determine
-- configuraciones disponibles." Esta tabla y su "estado" son
-- exactamente eso: un registro de que perfil eligio la organizacion,
-- no una certificacion de cumplimiento. `estado='en_desarrollo'`
-- para todo lo que no sea Ecuador es intencional y visible en el
-- catalogo -- el frontend (Lote C, wizard paso 4) debe mostrar esos
-- paises como "perfil normativo disponible / en desarrollo", tal
-- cual pide el plan, nunca como si ya tuvieran reglas activas.
--
-- Misma arquitectura que catalogo_sectores (migration_077): tabla
-- GLOBAL de referencia, sin organizacion_id, sin RLS (no es un dato
-- de ninguna organizacion en particular).
-- ============================================================

CREATE TABLE IF NOT EXISTS catalogo_paises_normativos (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clave               VARCHAR(50) UNIQUE NOT NULL,
    nombre              VARCHAR(150) NOT NULL,
    bandera_emoji       VARCHAR(10),
    estado              VARCHAR(20) NOT NULL DEFAULT 'en_desarrollo'
                          CHECK (estado IN ('completo', 'en_desarrollo')),
    normativa_principal TEXT,
    descripcion_estado  TEXT,
    activo              BOOLEAN NOT NULL DEFAULT true,
    orden               INTEGER NOT NULL DEFAULT 0,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalogo_paises_normativos_activo ON catalogo_paises_normativos(activo);

-- Semilla: los 6 paises que pide la Fase 4. Solo Ecuador con
-- estado='completo' -- es el unico con reglas realmente
-- implementadas en el resto de la plataforma hoy (CIE-10 local,
-- Decreto Ejecutivo 255, formatos de certificado, etc.).
INSERT INTO catalogo_paises_normativos (
    clave, nombre, bandera_emoji, estado, normativa_principal, descripcion_estado, orden
) VALUES
  ('ecuador', 'Ecuador', '🇪🇨', 'completo',
   'Decreto Ejecutivo 255, Reglamento de Seguridad y Salud de los Trabajadores, Resoluciones del IESS',
   'Perfil normativo completamente desarrollado: catálogo CIE-10, formatos de certificado, matriz de riesgos y todos los módulos clínicos y de SSO están alineados a la normativa ecuatoriana vigente.', 1),
  ('peru', 'Perú', '🇵🇪', 'en_desarrollo',
   'Ley N° 29783 de Seguridad y Salud en el Trabajo y su Reglamento (D.S. 005-2012-TR)',
   'Perfil normativo disponible / en desarrollo. Seleccionarlo NO habilita todavía reglas ni formatos específicos de Perú.', 2),
  ('colombia', 'Colombia', '🇨🇴', 'en_desarrollo',
   'Decreto 1072 de 2015 (Sistema de Gestión de Seguridad y Salud en el Trabajo)',
   'Perfil normativo disponible / en desarrollo. Seleccionarlo NO habilita todavía reglas ni formatos específicos de Colombia.', 3),
  ('mexico', 'México', '🇲🇽', 'en_desarrollo',
   'NOM-030-STPS-2009 y Reglamento Federal de Seguridad y Salud en el Trabajo',
   'Perfil normativo disponible / en desarrollo. Seleccionarlo NO habilita todavía reglas ni formatos específicos de México.', 4),
  ('chile', 'Chile', '🇨🇱', 'en_desarrollo',
   'Ley N° 16.744 sobre Accidentes del Trabajo y Enfermedades Profesionales',
   'Perfil normativo disponible / en desarrollo. Seleccionarlo NO habilita todavía reglas ni formatos específicos de Chile.', 5),
  ('argentina', 'Argentina', '🇦🇷', 'en_desarrollo',
   'Ley N° 19.587 de Higiene y Seguridad en el Trabajo y sus decretos reglamentarios',
   'Perfil normativo disponible / en desarrollo. Seleccionarlo NO habilita todavía reglas ni formatos específicos de Argentina.', 6)
ON CONFLICT (clave) DO NOTHING;

CREATE OR REPLACE FUNCTION fn_actualizar_timestamp_catalogo_paises()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_catalogo_paises_actualizado_en ON catalogo_paises_normativos;
CREATE TRIGGER trg_catalogo_paises_actualizado_en
  BEFORE UPDATE ON catalogo_paises_normativos
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp_catalogo_paises();

INSERT INTO schema_migrations (version) VALUES ('079_catalogo_paises_normativos')
ON CONFLICT (version) DO NOTHING;
