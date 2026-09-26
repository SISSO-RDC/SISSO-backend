-- ============================================================
-- Migracion 099: enlaces reales a los textos oficiales para TODAS
-- las normativas del catalogo (migration_096), a pedido explicito
-- del usuario ("que al dar click se hayan llevado a las normativas
-- reales"). Hasta esta migracion, url_pdf quedaba NULL a proposito
-- (ver migration_096) porque no se iba a inventar un enlace.
--
-- METODO: se busco cada norma una por una (web search), priorizando
-- siempre un dominio oficial .gob.ec (Ministerio emisor, u otra
-- entidad publica que la aloje) sobre repositorios de terceros
-- (Scribd, Studocu, consultoras). Se dejan 2 excepciones marcadas
-- explicitamente abajo porque NO se encontro un PDF oficial:
--
--   1. SISAT (AM 00004-2026): no hay un PDF suelto oficial publico
--      -- el Registro Oficial (registroficial.gob.ec) solo publica
--      la pagina-indice del "Segundo Suplemento No. 304" (12-jun-2026),
--      que SI confirma la cita exacta (y de paso resuelve el dato
--      que faltaba en migration_096: fecha_publicacion_ro). Se usa
--      esa pagina oficial como destino en vez de un PDF de tercero.
--      El superadmin puede reemplazar este enlace mas adelante por
--      una copia propia subida a Cloudinary (el documento que el
--      usuario ya proveyo), que serviria mejor para "leer en PDF".
--   2. AM 1404 (derogado, 1978): no se encontro ningun PDF en
--      dominio .gob.ec (es una norma de 1978, no todo el archivo
--      historico esta digitalizado en sitios oficiales). Se usa el
--      unico PDF disponible (pymservices.com, una consultora) SOLO
--      porque la norma esta derogada y es de valor historico/de
--      trazabilidad, nunca operativo -- se marca explicitamente
--      como "fuente no oficial" en fuente_cita para que quede claro
--      si alguna vez se audita este dato.
--
-- Todos los demas (8 de 10 filas) SI tienen PDF oficial en dominio
-- .gob.ec confirmado por busqueda directa en esta fecha.
-- ============================================================

UPDATE normativas_sisso SET url_pdf = 'https://www.defensa.gob.ec/wp-content/uploads/downloads/2021/02/Constitucion-de-la-Republica-del-Ecuador_act_ene-2021.pdf'
WHERE titulo = 'Constitución de la República del Ecuador (arts. 3, 32, 33, 154, 226, 326, 361)';

UPDATE normativas_sisso SET url_pdf = 'https://www.gob.ec/sites/default/files/regulations/2018-11/Documento_Decisi%C3%B3n-Acuerdo-Cartagena-584.pdf'
WHERE numero_acto = 'Decisión 584';

UPDATE normativas_sisso SET url_pdf = 'https://www.gob.ec/sites/default/files/regulations/2018-11/Documento_Resoluci%C3%B3n-Secretar%C3%ADa-Andina-957.pdf'
WHERE numero_acto = 'Resolución 957';

UPDATE normativas_sisso SET url_pdf = 'https://www.salud.gob.ec/wp-content/uploads/2017/03/LEY-ORG%C3%81NICA-DE-SALUD4.pdf'
WHERE titulo = 'Ley Orgánica de Salud (arts. 4, 6.16, 117, 118, 120, 130)';

UPDATE normativas_sisso SET url_pdf = 'https://www.trabajo.gob.ec/wp-content/uploads/downloads/2024/01/CODIGO_DEL_TRABAJO.pdf'
WHERE titulo = 'Código del Trabajo (arts. 410, 430)';

UPDATE normativas_sisso SET url_pdf = 'https://www.congope.gob.ec/wp-content/uploads/2024/12/Ley-Organica-Salud-Mental.pdf'
WHERE titulo = 'Ley Orgánica de Salud Mental (art. 45)';

UPDATE normativas_sisso SET url_pdf = 'https://gadbulan.gob.ec/azuay/wp-content/uploads/2026/02/Ley-Organica-de-Servicio-Publico-LOSEP-03-octubre-2025.pdf'
WHERE titulo = 'Ley Orgánica del Servicio Público y su Reglamento General (arts. 23, 51, 120, 228)';

UPDATE normativas_sisso SET url_pdf = 'https://www.trabajo.gob.ec/wp-content/uploads/2024/01/DECRETO-EJECUTIVO-255-REGLAMENTO-DE-SEGURIDAD-Y-SALUD-DE-LOS-TRABAJADORES.pdf'
WHERE numero_acto = 'Decreto Ejecutivo 255';

-- SISAT: se completa tambien fecha_publicacion_ro, confirmada por el
-- propio Registro Oficial (Segundo Suplemento No. 304, 12-jun-2026) --
-- este es el dato que migration_096 dejaba pendiente para poder
-- calcular con certeza las Disposiciones Transitorias.
UPDATE normativas_sisso SET
  url_pdf = 'https://www.registroficial.gob.ec/segundo-suplemento-no-304/',
  fecha_publicacion_ro = '2026-06-12',
  fuente_cita = fuente_cita || ' Fecha de publicación en Registro Oficial confirmada en el Segundo Suplemento No. 304 (12-jun-2026), '
    || 'https://www.registroficial.gob.ec/segundo-suplemento-no-304/ -- el enlace en url_pdf apunta a esa página oficial índice, '
    || 'no a un PDF suelto (no se encontró uno público); el superadmin puede reemplazarlo por una copia propia en Cloudinary.'
WHERE numero_acto = 'AM 00004-2026';

-- AM 1404 (derogado, 1978): unico PDF encontrado NO es de dominio oficial.
UPDATE normativas_sisso SET
  url_pdf = 'https://pymservices.com/wp-content/uploads/2020/02/AM-1404-REGLAMENTO-DE-LOS-SERVICIOS-MEDICOS-DE-LAS-EMPRESAS-ACUERDO-MINISTERIAL-1404.pdf',
  fuente_cita = fuente_cita || ' ADVERTENCIA: no se encontró un PDF en dominio oficial .gob.ec para esta norma de 1978 (derogada); '
    || 'el enlace en url_pdf es de un tercero (pymservices.com), incluido solo por valor histórico/de trazabilidad.'
WHERE numero_acto = 'AM 1404';

INSERT INTO schema_migrations (version) VALUES ('099_normativas_urls_reales')
ON CONFLICT (version) DO NOTHING;
