-- ============================================================
-- Migracion 103 (Oct 2026): firma electronica criptografica por
-- certificado .p12 (PKCS#12), a pedido de la persona usuaria.
--
-- IMPORTANTE -- esto es un concepto DISTINTO de "firma electronica"
-- tal como ya se usaba en consentimientos_firmados.metodo_firma
-- (migration_013): esa es solo dibujar la firma en un canvas del
-- navegador (una imagen). Esta migracion es la firma electronica
-- AVANZADA/criptografica real, con validez legal segun la Ley de
-- Comercio Electronico, Firmas Electronicas y Mensajes de Datos de
-- Ecuador: un certificado X.509 + llave privada (contenidos en un
-- archivo .p12) emitido por una entidad certificadora acreditada,
-- que se usa para firmar digitalmente el PDF completo (PKCS#7/CMS),
-- no para pegar una imagen.
--
-- Es personal e intransferible: UNA fila por usuario (no por
-- organizacion), porque el certificado identifica a la PERSONA
-- (medico u otro profesional), no a la empresa.
--
-- SEGURIDAD: tanto el .p12 como su passphrase se guardan cifrados
-- (AES-256-GCM, ver src/utils/crypto.js) con una clave DEDICADA
-- (FIRMA_ELECTRONICA_ENCRYPTION_KEY), separada de MFA_ENCRYPTION_KEY
-- a proposito -- la decision de guardar tambien la passphrase (y no
-- solo el .p12) fue explicita de la persona usuaria (Opcion A:
-- firma automatica real, sin tener que reingresar la contraseña del
-- certificado en cada documento), a cambio de ese riesgo adicional.
-- Cada uso se audita (ver registrarAuditoria en el controlador).
-- ============================================================

CREATE TABLE IF NOT EXISTS firmas_electronicas_usuario (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id              UUID NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,

    certificado_p12_cifrado TEXT NOT NULL, -- .p12 original en base64, luego cifrado (formato iv:tag:datos de crypto.js)
    passphrase_cifrada      TEXT NOT NULL, -- passphrase del .p12, cifrada por separado

    titular_cn              VARCHAR(200) NOT NULL, -- Common Name del certificado (para mostrar "este es tu certificado de X")
    emisor_cn               VARCHAR(200), -- entidad certificadora que lo emitio, si el certificado lo declara
    numero_serie            VARCHAR(100),
    fecha_emision           TIMESTAMPTZ,
    fecha_vencimiento       TIMESTAMPTZ NOT NULL, -- del certificado X.509 (notAfter) -- NUNCA se firma con uno vencido

    activo                  BOOLEAN NOT NULL DEFAULT false, -- la casilla "usar esta firma automaticamente"

    creado_por              UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_firmas_electronicas_usuario_organizacion ON firmas_electronicas_usuario(organizacion_id);

ALTER TABLE firmas_electronicas_usuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE firmas_electronicas_usuario FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON firmas_electronicas_usuario
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');

-- Registro de cada vez que se usa un certificado para firmar un documento
-- real -- mitigacion clave del riesgo de guardar la passphrase (Opcion A):
-- si alguna firma aparece sin explicacion, este log es lo primero a revisar.
CREATE TABLE IF NOT EXISTS firmas_electronicas_usos (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- ON DELETE SET NULL (no CASCADE) a proposito: si el usuario o su
    -- certificado se eliminan algun dia, este log de uso DEBE sobrevivir
    -- (es evidencia de que firmas ya se generaron), igual criterio que
    -- auditoria.usuario_id en migration_047. Nullable por lo mismo.
    firma_electronica_id    UUID REFERENCES firmas_electronicas_usuario(id) ON DELETE SET NULL,
    -- SET NULL (no CASCADE), mismo motivo que firma_electronica_id arriba:
    -- si la organizacion se elimina, este log de uso debe sobrevivir.
    organizacion_id         UUID REFERENCES organizaciones(id) ON DELETE SET NULL,

    documento_tipo          VARCHAR(60) NOT NULL, -- ej: 'certificado_aptitud', 'certificado_capacitacion'
    documento_id            UUID, -- id del registro origen cuando aplica (no siempre existe uno)

    exitoso                 BOOLEAN NOT NULL,
    error_detalle           TEXT, -- si exitoso=false, por que fallo (certificado vencido, passphrase invalida, etc.)

    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_firmas_electronicas_usos_firma ON firmas_electronicas_usos(firma_electronica_id);
CREATE INDEX idx_firmas_electronicas_usos_organizacion ON firmas_electronicas_usos(organizacion_id);

ALTER TABLE firmas_electronicas_usos ENABLE ROW LEVEL SECURITY;
ALTER TABLE firmas_electronicas_usos FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_tenant ON firmas_electronicas_usos
  USING (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true')
  WITH CHECK (organizacion_id = nullif(current_setting('app.organizacion_actual', true), '')::uuid
         OR current_setting('app.es_superadmin', true) = 'true');
-- Append-only deliberado, mismo criterio e igual mecanismo que la tabla
-- `auditoria` general (ver migration_047): un REVOKE por si solo no sirve
-- porque el rol dueño de la tabla conserva todos sus privilegios sin
-- importar lo que se le revoque -- se necesita un trigger que rechace
-- SIEMPRE, incluso para ese rol.
CREATE OR REPLACE FUNCTION firmas_electronicas_usos_bloquear_modificacion() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Unica excepcion permitida: la FK poniendo firma_electronica_id en
    -- NULL porque el certificado referenciado se elimino. Cualquier otro
    -- cambio, a cualquier columna, se sigue bloqueando siempre.
    IF NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.documento_tipo IS NOT DISTINCT FROM OLD.documento_tipo
       AND NEW.documento_id IS NOT DISTINCT FROM OLD.documento_id
       AND NEW.exitoso IS NOT DISTINCT FROM OLD.exitoso
       AND NEW.error_detalle IS NOT DISTINCT FROM OLD.error_detalle
       AND NEW.creado_en IS NOT DISTINCT FROM OLD.creado_en
       AND (NEW.organizacion_id IS NOT DISTINCT FROM OLD.organizacion_id OR NEW.organizacion_id IS NULL)
       AND (NEW.firma_electronica_id IS NOT DISTINCT FROM OLD.firma_electronica_id OR NEW.firma_electronica_id IS NULL)
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'firmas_electronicas_usos es append-only: no se permite modificar un registro de uso existente.';
  END IF;
  RAISE EXCEPTION 'firmas_electronicas_usos es append-only: no se permite eliminar un registro de uso existente.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS firmas_electronicas_usos_inmutable ON firmas_electronicas_usos;
CREATE TRIGGER firmas_electronicas_usos_inmutable
  BEFORE UPDATE OR DELETE ON firmas_electronicas_usos
  FOR EACH ROW EXECUTE FUNCTION firmas_electronicas_usos_bloquear_modificacion();

INSERT INTO schema_migrations (version) VALUES ('103_firma_electronica_criptografica')
ON CONFLICT (version) DO NOTHING;
