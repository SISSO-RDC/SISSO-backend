-- ============================================================
-- Migracion 068: estado explicito de "matriz de exposicion" por
-- puesto de trabajo.
--
-- CORRIGE el hallazgo CRITICO C14-02 (Auditoria N.14, P0):
-- derivarDatosClinicosParaAptitud() (aptitudController.js) marcaba
-- evaluacionIncompleta=true UNICAMENTE cuando el trabajador no
-- tenia puesto_trabajo_id. Si el puesto existia pero
-- puesto_exposiciones tenia CERO filas, el motor asumia que esa
-- ausencia de filas era una afirmacion valida ("este puesto no
-- tiene exposiciones"), cuando en realidad puede ser simplemente
-- que nadie configuro la matriz todavia (omision administrativa).
-- Esto podia producir una falsa ausencia de contraindicacion.
--
-- Esta migracion agrega, a puestos_trabajo, los campos necesarios
-- para distinguir explicitamente:
--   SIN_PUESTO                    -> trabajador sin puesto asignado
--   PUESTO_SIN_MATRIZ              -> puesto existe, 0 filas en
--                                     puesto_exposiciones Y nadie
--                                     confirmo explicitamente que
--                                     el puesto no tiene exposiciones
--   PUESTO_CON_MATRIZ_VALIDADA     -> puesto tiene >=1 fila en
--                                     puesto_exposiciones, O un
--                                     responsable confirmo
--                                     explicitamente "sin
--                                     exposiciones" con fecha y
--                                     usuario
--
-- La logica de calculo de este estado vive en aptitudController.js
-- (derivarDatosClinicosParaAptitud). Esta migracion solo agrega el
-- soporte de datos para la confirmacion explicita de "puesto sin
-- exposiciones" (que es distinto de "puesto no revisado").
-- ============================================================

ALTER TABLE puestos_trabajo
  ADD COLUMN IF NOT EXISTS matriz_exposicion_confirmada_sin_riesgo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS matriz_exposicion_confirmada_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS matriz_exposicion_confirmada_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS matriz_exposicion_confirmada_motivo TEXT;

COMMENT ON COLUMN puestos_trabajo.matriz_exposicion_confirmada_sin_riesgo IS
  'C14-02: true SOLO si un responsable (sso/admin/medico) confirmo explicitamente que este puesto no tiene exposiciones ocupacionales, tras revisar la matriz. false (default) significa "no revisado" -- NUNCA se interpreta como "sin exposicion" por el motor de aptitud.';
COMMENT ON COLUMN puestos_trabajo.matriz_exposicion_confirmada_motivo IS
  'C14-02: justificacion obligatoria de por que el puesto no tiene exposiciones (ej. "trabajo administrativo de oficina, sin exposicion a ruido/quimicos/alturas").';

-- Cuando se declara al menos una exposicion real, cualquier
-- confirmacion previa de "sin riesgo" queda obsoleta -- se revierte
-- automaticamente para forzar una nueva revision si se intenta
-- volver a marcar el puesto como sin exposiciones despues.
CREATE OR REPLACE FUNCTION fn_invalidar_confirmacion_sin_riesgo()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE puestos_trabajo
     SET matriz_exposicion_confirmada_sin_riesgo = false,
         matriz_exposicion_confirmada_por = NULL,
         matriz_exposicion_confirmada_en = NULL,
         matriz_exposicion_confirmada_motivo = NULL
   WHERE id = NEW.puesto_trabajo_id
     AND matriz_exposicion_confirmada_sin_riesgo = true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invalidar_confirmacion_sin_riesgo ON puesto_exposiciones;
CREATE TRIGGER trg_invalidar_confirmacion_sin_riesgo
  AFTER INSERT ON puesto_exposiciones
  FOR EACH ROW EXECUTE FUNCTION fn_invalidar_confirmacion_sin_riesgo();

-- Auditoria explicita de que estado tenia la matriz de exposicion
-- de un puesto EN EL MOMENTO de cada evaluacion de aptitud, para
-- que el historial clinico sea fiel a lo que el motor pudo derivar.
ALTER TABLE historial_aptitud_medica
  ADD COLUMN IF NOT EXISTS estado_matriz_exposicion VARCHAR(30);

COMMENT ON COLUMN historial_aptitud_medica.estado_matriz_exposicion IS
  'C14-02: SIN_PUESTO | PUESTO_SIN_MATRIZ | PUESTO_CON_MATRIZ_VALIDADA, calculado al momento de esta evaluacion.';

INSERT INTO schema_migrations (version) VALUES ('068_matriz_exposicion_validada')
ON CONFLICT (version) DO NOTHING;
