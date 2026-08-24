-- ============================================================
-- Migracion 042: Planes, suscripcion y pagos (PayPhone).
--
-- Formaliza lo que hoy es un campo de texto libre
-- (organizaciones.plan = 'gratis'|'profesional'|'empresarial') en
-- un catalogo real con limites, y agrega el ciclo de vida de
-- suscripcion completo: trial -> activa -> vencida -> suspendida.
--
-- IMPORTANTE: organizaciones.activa YA EXISTIA y YA SE VALIDA en
-- el login (authController.js linea ~396). Lo que faltaba era:
--   (a) un endpoint de superadmin para apagarla a nivel de TODA la
--       organizacion (hoy solo existe por usuario individual), y
--   (b) revocar de inmediato TODOS los refresh tokens de la
--       organizacion al suspenderla (no solo bloquear logins
--       futuros), igual criterio que ya se aplica a nivel de
--       usuario individual (hallazgo GRAVE G2 de la auditoria de
--       seguridad).
-- Ambos se resuelven en el controlador, no en esta migracion.
--
-- `suspendida_manualmente` se agrega SEPARADO de `activa` para
-- poder distinguir la causa real de una organizacion inactiva:
-- el superadmin la suspendio a mano (ej: fin de contrato) vs. se
-- vencio la suscripcion por falta de pago. Esto importa porque
-- una reactivacion automatica por pago NUNCA debe revertir una
-- suspension manual del superadmin.
-- ============================================================

CREATE TABLE planes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo                  VARCHAR(20) UNIQUE NOT NULL CHECK (codigo IN ('inicial', 'crecimiento', 'corporativo')),
    nombre                  VARCHAR(60) NOT NULL,
    precio_mensual_usd      NUMERIC(8,2) NOT NULL,
    precio_por_trabajador_usd NUMERIC(6,3), -- solo aplica a 'corporativo' (facturacion variable)
    limite_trabajadores     INTEGER, -- NULL = sin limite (corporativo)
    limite_usuarios         INTEGER, -- NULL = sin limite
    activo                  BOOLEAN NOT NULL DEFAULT true,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO planes (codigo, nombre, precio_mensual_usd, precio_por_trabajador_usd, limite_trabajadores, limite_usuarios) VALUES
  ('inicial',      'Plan Inicial',      39.00, NULL, 10,   2),
  ('crecimiento',  'Plan Crecimiento',  99.00, NULL, 50,   5),
  ('corporativo',  'Plan Corporativo',  0.00,  0.90, NULL, NULL);

-- ------------------------------------------------------------
-- Columnas de suscripcion en organizaciones.
-- ------------------------------------------------------------
ALTER TABLE organizaciones ADD COLUMN plan_id UUID REFERENCES planes(id);
ALTER TABLE organizaciones ADD COLUMN estado_suscripcion VARCHAR(15) NOT NULL DEFAULT 'trial'
    CHECK (estado_suscripcion IN ('trial', 'activa', 'vencida', 'suspendida', 'cancelada'));
ALTER TABLE organizaciones ADD COLUMN fecha_inicio_trial DATE;
ALTER TABLE organizaciones ADD COLUMN fecha_fin_trial DATE;
ALTER TABLE organizaciones ADD COLUMN fecha_proxima_renovacion DATE;
ALTER TABLE organizaciones ADD COLUMN suspendida_manualmente BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE organizaciones ADD COLUMN motivo_suspension TEXT;

-- Organizaciones ya existentes (creadas antes de esta migracion):
-- se marcan como 'activa' en el plan Corporativo por defecto para
-- no interrumpir a ningun cliente actual; el superadmin puede
-- reasignar el plan correcto despues desde el panel.
UPDATE organizaciones SET
  plan_id = (SELECT id FROM planes WHERE codigo = 'corporativo'),
  estado_suscripcion = 'activa'
WHERE plan_id IS NULL;

CREATE INDEX idx_organizaciones_estado_suscripcion ON organizaciones(estado_suscripcion);

-- ------------------------------------------------------------
-- Pagos: un registro por cada transaccion confirmada (o rechazada)
-- por PayPhone. `referencia_pasarela` es el transactionId que
-- devuelve PayPhone, para poder conciliar manualmente si hace falta.
-- ------------------------------------------------------------
CREATE TABLE pagos_suscripcion (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    plan_id                 UUID REFERENCES planes(id) ON DELETE SET NULL,

    monto_usd               NUMERIC(8,2) NOT NULL,
    estado                  VARCHAR(12) NOT NULL CHECK (estado IN ('pendiente', 'aprobado', 'rechazado', 'reembolsado')),
    pasarela                VARCHAR(20) NOT NULL DEFAULT 'payphone',
    referencia_pasarela     VARCHAR(120), -- transactionId de PayPhone
    metodo_pago             VARCHAR(30),  -- ej: "tarjeta", "cuenta_bancaria" (lo que informe PayPhone)

    periodo_desde           DATE,
    periodo_hasta           DATE,

    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pagossus_organizacion ON pagos_suscripcion(organizacion_id);
CREATE INDEX idx_pagossus_referencia ON pagos_suscripcion(referencia_pasarela);


-- CORREGIDO en Auditoria N.07 (hallazgo GRAVE G-N07-02): se agrega
-- el auto-registro en schema_migrations, siguiendo la convencion ya
-- usada desde migration_030/031, para que esta migracion tambien sea
-- segura de pegar a mano en el SQL Editor de Neon (el flujo manual
-- que usa el equipo) sin quedar en un estado inconsistente frente a
-- migrate.js. ON CONFLICT DO NOTHING la hace ademas re-ejecutable.
INSERT INTO schema_migrations (version) VALUES ('042_planes_suscripcion')
ON CONFLICT (version) DO NOTHING;
