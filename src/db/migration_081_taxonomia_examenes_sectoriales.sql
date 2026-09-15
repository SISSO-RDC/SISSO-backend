-- ============================================================
-- Migracion 081: taxonomia de examenes sugeridos por sector
-- (Auditoria N.16, hallazgo CRITICO C-16-02, P0).
--
-- PROBLEMA DETECTADO: el seed de migration_077 (catalogo_sectores)
-- etiqueta 59 examenes de 14 sectores como "tipo":"Obligatorio" sin
-- ninguna referencia de norma, articulo, jurisdiccion, version ni
-- vigencia. Un catalogo GLOBAL compartido por todas las
-- organizaciones no puede declarar una obligacion clinica/normativa
-- que no puede sustentar -- el sector, por si solo, no determina la
-- necesidad de una prueba individual (eso depende de puesto,
-- exposicion, evaluacion de riesgos, vigilancia de salud,
-- antecedentes, protocolo aplicable y criterio del medico
-- ocupacional, o de una norma especifica que si establezca la
-- obligacion).
--
-- CORRECCION: se reclasifican los tres valores usados hasta ahora a
-- la taxonomia de 4 niveles que pide la auditoria. Como NINGUN
-- registro actual tiene norma/articulo/jurisdiccion/version/vigencia
-- verificados, NINGUNO puede quedar en "Obligatorio por norma
-- especifica y versionada" todavia -- esa categoria queda vacia
-- hasta que se cargue una referencia normativa real y revisada
-- (mismo criterio que ya se aplica a GLI-2012 en espirometria: no
-- declarar algo que no esta verificado).
--
--   "Obligatorio"        -> "Sugerido por sector"      (downgrade,
--                            sin norma que lo respalde)
--   "Segun exposicion"   -> "Condicionado a exposición"
--   "Recomendado"        -> "Requiere criterio médico"
--
-- Se agrega ademas el campo "normaReferencia" (null por defecto) a
-- cada entrada, como slot preparado para cuando SI se cargue una
-- referencia normativa real -- ver tambien migration_082 (comentario
-- CHECK) y catalogoSectoresController.js, que ya permite editar
-- examenes_sugeridos vía PUT solo a superadmin.
--
-- No se toca "puestos_frecuentes", "epp_sugerido", "kpis_sugeridos"
-- ni "herramientas_ergonomicas": la auditoria (G-16-04/05/06) los
-- marca como pendientes funcionales (P1, "borrador para revision de
-- SSO"), no como un problema de taxonomia como este.
-- ============================================================

UPDATE catalogo_sectores
SET examenes_sugeridos = (
  SELECT COALESCE(jsonb_agg(
    CASE elem->>'tipo'
      WHEN 'Obligatorio' THEN
        (elem || jsonb_build_object('tipo', 'Sugerido por sector'))
        || CASE WHEN elem ? 'normaReferencia' THEN '{}'::jsonb
                ELSE jsonb_build_object('normaReferencia', NULL) END
      WHEN 'Segun exposicion' THEN
        (elem || jsonb_build_object('tipo', 'Condicionado a exposición'))
        || CASE WHEN elem ? 'normaReferencia' THEN '{}'::jsonb
                ELSE jsonb_build_object('normaReferencia', NULL) END
      WHEN 'Recomendado' THEN
        (elem || jsonb_build_object('tipo', 'Requiere criterio médico'))
        || CASE WHEN elem ? 'normaReferencia' THEN '{}'::jsonb
                ELSE jsonb_build_object('normaReferencia', NULL) END
      ELSE elem
    END
  ), '[]'::jsonb)
  FROM jsonb_array_elements(examenes_sugeridos) elem
)
WHERE examenes_sugeridos IS NOT NULL AND jsonb_array_length(examenes_sugeridos) > 0;

INSERT INTO schema_migrations (version) VALUES ('081_taxonomia_examenes_sectoriales')
ON CONFLICT (version) DO NOTHING;
