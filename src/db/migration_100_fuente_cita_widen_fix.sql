-- ============================================================
-- Migracion 100: arregla el error "value too long for type
-- character varying(500)" que dejo migration_099 a medias (filas
-- 1-8 de 10 sí se aplicaron; SISAT y AM 1404 no).
--
-- CAUSA: fuente_cita ya se habia ampliado una vez (300->500 en el
-- lote SISAT), pero el texto que migration_099 le concatena a SISAT
-- y a AM 1404 (fuente_cita || '...') vuelve a superar el limite.
-- Se amplia a 1000 (con margen) y se reintentan SOLO esas 2 filas
-- (las otras 8 ya quedaron bien, no hace falta tocarlas).
--
-- FIX (mismo dia): migration_099 ahora incluye esta misma ampliacion
-- de columna y ya completa estas 2 filas por si sola en una base
-- nueva -- por lo tanto esta migracion queda como respaldo idempotente:
-- el "AND url_pdf IS NULL" evita duplicar el texto concatenado si
-- 099 ya dejo la fila lista, pero sigue corrigiendo Neon si esas 2
-- filas quedaron a medias de la corrida original de 099.
-- ============================================================

ALTER TABLE normativas_sisso ALTER COLUMN fuente_cita TYPE VARCHAR(1000);

UPDATE normativas_sisso SET
  url_pdf = 'https://www.registroficial.gob.ec/segundo-suplemento-no-304/',
  fecha_publicacion_ro = '2026-06-12',
  fuente_cita = fuente_cita || ' Fecha de publicación en Registro Oficial confirmada en el Segundo Suplemento No. 304 (12-jun-2026), '
    || 'https://www.registroficial.gob.ec/segundo-suplemento-no-304/ -- el enlace en url_pdf apunta a esa página oficial índice, '
    || 'no a un PDF suelto (no se encontró uno público); el superadmin puede reemplazarlo por una copia propia en Cloudinary.'
WHERE numero_acto = 'AM 00004-2026' AND url_pdf IS NULL;

UPDATE normativas_sisso SET
  url_pdf = 'https://pymservices.com/wp-content/uploads/2020/02/AM-1404-REGLAMENTO-DE-LOS-SERVICIOS-MEDICOS-DE-LAS-EMPRESAS-ACUERDO-MINISTERIAL-1404.pdf',
  fuente_cita = fuente_cita || ' ADVERTENCIA: no se encontró un PDF en dominio oficial .gob.ec para esta norma de 1978 (derogada); '
    || 'el enlace en url_pdf es de un tercero (pymservices.com), incluido solo por valor histórico/de trazabilidad.'
WHERE numero_acto = 'AM 1404' AND url_pdf IS NULL;

INSERT INTO schema_migrations (version) VALUES ('100_fuente_cita_widen_fix')
ON CONFLICT (version) DO NOTHING;
