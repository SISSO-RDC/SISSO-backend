-- ============================================================
-- Migracion 072: catalogo versionado agente-metodo-norma-jurisdiccion
-- de limites permisibles de higiene industrial, con snapshot en
-- cada medicion.
--
-- CORRIGE el hallazgo GRAVE G14-10 (Auditoria N.14, P1): las
-- mediciones de higiene industrial evaluaban cumplimiento contra un
-- `limite_permisible` que el CLIENTE enviaba libremente en cada
-- peticion (POST /api/higiene-industrial/mediciones), sin ningun
-- catalogo que fijara ese numero a un agente/metodo/norma/
-- jurisdiccion/fecha de vigencia concretos. Si la norma cambia (o si
-- alguien simplemente escribe un numero distinto), el registro
-- historico no conserva la base exacta contra la que se evaluo.
-- ============================================================

CREATE TABLE IF NOT EXISTS catalogo_limites_higiene (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agente                  VARCHAR(150) NOT NULL,
    metodo_referencia       VARCHAR(150) NOT NULL,
    norma                   VARCHAR(150) NOT NULL,
    jurisdiccion            VARCHAR(100) NOT NULL DEFAULT 'Ecuador',
    version                 VARCHAR(50) NOT NULL,
    unidad                  VARCHAR(30) NOT NULL,
    limite_valor            NUMERIC(12,4) NOT NULL,
    criterio                VARCHAR(10) NOT NULL CHECK (criterio IN ('maximo', 'minimo')),
    fecha_vigencia_desde    DATE NOT NULL,
    fecha_vigencia_hasta    DATE,
    fuente_url_o_referencia TEXT,
    creado_por              UUID REFERENCES usuarios(id),
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (fecha_vigencia_hasta IS NULL OR fecha_vigencia_hasta >= fecha_vigencia_desde)
);

COMMENT ON TABLE catalogo_limites_higiene IS
  'G14-10: catalogo global (no por organizacion -- son normas publicas) de limites permisibles versionados. Cada medicion de higiene industrial que se vincule a una fila de este catalogo (via mediciones_higiene_industrial.catalogo_limite_id) conserva un snapshot inmutable de norma/version/jurisdiccion/limite en el momento de la medicion, para que un cambio posterior del catalogo NUNCA reinterprete retroactivamente una medicion historica.';

-- Solo un catalogo activo (vigente) por agente+metodo+norma+jurisdiccion
-- a la vez -- evita ambiguedad al vincular una medicion nueva.
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalogo_limites_higiene_vigente
  ON catalogo_limites_higiene (agente, metodo_referencia, norma, jurisdiccion)
  WHERE fecha_vigencia_hasta IS NULL;

ALTER TABLE mediciones_higiene_industrial
  ADD COLUMN IF NOT EXISTS catalogo_limite_id UUID REFERENCES catalogo_limites_higiene(id),
  ADD COLUMN IF NOT EXISTS limite_norma_snapshot VARCHAR(150),
  ADD COLUMN IF NOT EXISTS limite_version_snapshot VARCHAR(50),
  ADD COLUMN IF NOT EXISTS limite_jurisdiccion_snapshot VARCHAR(100),
  ADD COLUMN IF NOT EXISTS limite_verificable_en_catalogo BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN mediciones_higiene_industrial.limite_verificable_en_catalogo IS
  'G14-10: true solo si esta medicion se vinculo a una fila de catalogo_limites_higiene (limite_permisible fue tomado del catalogo, no escrito libremente). false (default, incluye todas las mediciones anteriores a esta correccion): el limite_permisible sigue siendo el valor libre historico, sin base normativa verificable en el sistema -- se mantiene por compatibilidad, no se reinterpreta.';

-- Semilla minima de referencia (Ecuador, Decreto Ejecutivo 2393 /
-- normativa INSHT/ACGIH de uso habitual en higiene ocupacional
-- ecuatoriana para ruido). Se documenta como punto de partida, NO
-- como catalogo exhaustivo -- cada organizacion/SSO debe completar y
-- verificar los limites de los agentes que efectivamente mide con
-- la norma vigente correspondiente antes de confiar en el
-- cumplimiento calculado.
INSERT INTO catalogo_limites_higiene (agente, metodo_referencia, norma, jurisdiccion, version, unidad, limite_valor, criterio, fecha_vigencia_desde, fuente_url_o_referencia)
VALUES ('ruido_continuo_8h', 'dosimetria_ponderada_a', 'Decreto Ejecutivo 2393, Art. 55', 'Ecuador', '1986', 'dBA', 85, 'maximo', '1986-11-17', 'Reglamento de Seguridad y Salud de los Trabajadores (Ecuador)')
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('072_catalogo_limites_higiene_versionado')
ON CONFLICT (version) DO NOTHING;
