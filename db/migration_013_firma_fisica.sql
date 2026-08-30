-- ============================================================
-- SISSO - Migracion 013: metodo de firma en consentimientos.
--
-- Hasta ahora solo existia un flujo de firma: dibujar en el
-- canvas dentro del navegador (firma electronica). Se agrega un
-- segundo flujo: imprimir el consentimiento en blanco, firmarlo
-- en papel, y subir la foto/escaneo del documento firmado. Ambos
-- casos siguen guardando la imagen en Cloudinary de la misma
-- forma (firma_imagen_url / firma_imagen_public_id ya existentes);
-- esta columna solo distingue COMO se obtuvo esa imagen, para que
-- el historial y cualquier reporte posterior lo muestren claro.
-- ============================================================

ALTER TABLE consentimientos_firmados
  ADD COLUMN metodo_firma VARCHAR(20) NOT NULL DEFAULT 'electronica'
    CHECK (metodo_firma IN ('electronica', 'fisica_escaneada'));
