-- ============================================================
-- Migracion 082: cobertura normativa verificable por pais
-- (Auditoria N.16, hallazgo CRITICO C-16-03, P0).
--
-- PROBLEMA DETECTADO: catalogo_paises_normativos.descripcion_estado
-- para Ecuador afirmaba, en prosa y sin desglose, "Perfil normativo
-- completamente desarrollado". La auditoria señala que la existencia
-- de un catalogo no equivale a certificacion de cumplimiento
-- normativo completo, y pide reemplazar cualquier afirmacion
-- absoluta por una matriz verificable: que reglas estan
-- implementadas, cuales pendientes, norma fuente, version, fecha de
-- revision y responsable de validacion.
--
-- CORRECCION (P0, alcance acotado): se agrega `cobertura_detalle`
-- (JSONB) con esa estructura y se llena SOLO con lo que ya esta
-- verificablemente implementado en la plataforma hoy (catalogo
-- CIE-10 local, formatos de certificado, Decreto Ejecutivo 255,
-- modulos clinicos/SSO) -- listando tambien, de forma explicita, lo
-- que NO se ha validado formalmente (no se afirma cobertura legal
-- integral). Se corrige ademas el texto de descripcion_estado para
-- dejar de usar "completamente desarrollado" como afirmacion
-- absoluta.
--
-- Este campo es un punto de partida verificable, no una
-- certificacion legal -- construir la matriz normativa formal
-- (todas las reglas, articulos y vigencias reales) requiere revision
-- de un especialista legal ecuatoriano, tal como ya señala la nota
-- final de la Auditoria N.16. No se rellena `cobertura_detalle` para
-- los demas paises (en_desarrollo): siguen sin reglas implementadas.
-- ============================================================

ALTER TABLE catalogo_paises_normativos
  ADD COLUMN IF NOT EXISTS cobertura_detalle JSONB;

UPDATE catalogo_paises_normativos
SET descripcion_estado = 'Perfil normativo con implementación parcial verificada: catálogo CIE-10 local, formatos de certificado y varios módulos clínicos y de SSO están alineados a normativa ecuatoriana. No constituye una certificación de cumplimiento legal integral — ver desglose de cobertura.',
    cobertura_detalle = jsonb_build_object(
      'reglasImplementadas', jsonb_build_array(
        'Catálogo CIE-10 local editable (14498 códigos)',
        'Umbrales de tiers de suscripción alineados a Decreto Ejecutivo 255',
        'Formatos de certificado y aptitud médica ocupacional',
        'Matriz de riesgos y módulos clínicos/SSO/TTHH generales'
      ),
      'reglasPendientes', jsonb_build_array(
        'Validación formal por especialista legal ecuatoriano de la matriz normativa completa',
        'Reglas normativas versionadas por artículo/vigencia dentro del motor sectorial (Fase 16 del plan de fusión Demo→Plataforma)',
        'Vinculación explícita de cada examen/obligación del catálogo sectorial a una norma y artículo específicos'
      ),
      'normaFuente', 'Decreto Ejecutivo 255, Reglamento de Seguridad y Salud de los Trabajadores, Resoluciones del IESS',
      'version', 'N.16-2026-09',
      'fechaRevision', CURRENT_DATE::text,
      'responsableValidacion', 'Pendiente de validación por especialista legal externo'
    )
WHERE clave = 'ecuador';

INSERT INTO schema_migrations (version) VALUES ('082_cobertura_normativa_verificable')
ON CONFLICT (version) DO NOTHING;
