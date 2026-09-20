-- ============================================================
-- SISSO - Migracion 006: motor de aptitud medica con
-- justificacion clinica obligatoria y reglas de contraindicacion.
--
-- Corrige los errores CRITICOS #3 y #16 de la auditoria:
--
--   "Aptitud medica automatizable sin razonamiento clinico...
--    No veo motor de validacion clinica para: exposicion real,
--    compatibilidad riesgo-enfermedad... Debe existir
--    'justificacion clinica obligatoria'."
--
--   "Falta trazabilidad medico-legal. Necesitas: quien cambio
--    aptitud, cuando, por que, version previa. Audit trail
--    obligatorio."
--
-- IMPORTANTE: este motor NUNCA decide la aptitud de forma
-- automatica. Solo ALERTA cuando detecta una posible
-- contraindicacion (absoluta o relativa) entre el diagnostico
-- del trabajador y la exposicion del puesto, y exige que el
-- medico escriba una justificacion clinica para registrar
-- cualquier aptitud. La decision final siempre es humana.
--
-- Decisiones de diseño acordadas con el cliente:
--   - Catalogo CIE-10 completo (~14500 codigos), cargado desde
--     una fuente publica de codigo abierto (ver
--     scripts/cargar_cie10.js), no transcrito a mano.
--   - Catalogo de exposiciones/riesgos: generico inicial,
--     editable despues.
--   - Reglas de contraindicacion: tabla editable en BD, no fija
--     en codigo, para que el equipo medico pueda ajustarlas sin
--     requerir un despliegue de codigo.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CATALOGO CIE-10 (lectura global, no es dato de organizacion)
-- ------------------------------------------------------------
CREATE TABLE catalogo_cie10 (
    codigo          VARCHAR(10) PRIMARY KEY,
    codigo_padre_1  VARCHAR(10), -- capitulo (ej: A00-B99)
    codigo_padre_2  VARCHAR(10), -- grupo (ej: G40-G47)
    codigo_padre_3  VARCHAR(10),
    codigo_padre_4  VARCHAR(10),
    descripcion     VARCHAR(250) NOT NULL,
    nivel           SMALLINT NOT NULL, -- 0=capitulo .. 5=mas especifico
    fuente          VARCHAR(100)
);

CREATE INDEX idx_cie10_descripcion ON catalogo_cie10 USING gin (to_tsvector('spanish', descripcion));
CREATE INDEX idx_cie10_padre1 ON catalogo_cie10(codigo_padre_1);

-- ------------------------------------------------------------
-- 2. CATALOGO DE EXPOSICIONES / RIESGOS DE PUESTO
--
-- Catalogo generico inicial. El equipo SISSO puede agregar mas
-- filas aqui sin tocar codigo (es una tabla de referencia simple,
-- no hay logica en codigo que dependa de cuales existen).
-- ------------------------------------------------------------
CREATE TABLE catalogo_exposiciones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id UUID REFERENCES organizaciones(id) ON DELETE CASCADE, -- NULL = catalogo global compartido
    codigo          VARCHAR(50) NOT NULL, -- slug corto, ej: 'trabajo_alturas'
    nombre          VARCHAR(150) NOT NULL, -- ej: 'Trabajo en alturas (>1.8m)'
    descripcion     TEXT,
    categoria       VARCHAR(50) NOT NULL CHECK (categoria IN (
                        'fisico', 'quimico', 'biologico', 'ergonomico', 'psicosocial', 'mecanico', 'electrico'
                    )),
    activo          BOOLEAN NOT NULL DEFAULT true,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Catalogo unico por organizacion+codigo, o global+codigo si organizacion_id es NULL.
CREATE UNIQUE INDEX idx_exposiciones_codigo_org ON catalogo_exposiciones(codigo, COALESCE(organizacion_id, '00000000-0000-0000-0000-000000000000'));

-- Catalogo inicial generico (organizacion_id NULL = visible para todas las organizaciones).
INSERT INTO catalogo_exposiciones (codigo, nombre, categoria) VALUES
  ('trabajo_alturas', 'Trabajo en alturas (>1.8 m)', 'fisico'),
  ('espacios_confinados', 'Trabajo en espacios confinados', 'fisico'),
  ('ruido_alto', 'Exposicion a ruido >85 dB', 'fisico'),
  ('calor_extremo', 'Exposicion a calor extremo / estres termico', 'fisico'),
  ('frio_extremo', 'Exposicion a frio extremo', 'fisico'),
  ('radiacion_ionizante', 'Exposicion a radiacion ionizante', 'fisico'),
  ('vibracion', 'Exposicion a vibracion mano-brazo o cuerpo entero', 'fisico'),
  ('quimicos_irritantes', 'Exposicion a quimicos irritantes / polvos / harinas', 'quimico'),
  ('solventes_organicos', 'Exposicion a solventes organicos', 'quimico'),
  ('plaguicidas', 'Exposicion a plaguicidas', 'quimico'),
  ('agentes_biologicos', 'Exposicion a agentes biologicos (virus, bacterias, hongos)', 'biologico'),
  ('manipulacion_cargas', 'Manipulacion manual de cargas', 'ergonomico'),
  ('posturas_forzadas', 'Posturas forzadas / movimientos repetitivos', 'ergonomico'),
  ('conduccion_vehiculos', 'Conduccion de vehiculos livianos o pesados', 'mecanico'),
  ('operacion_maquinaria', 'Operacion de maquinaria con partes en movimiento', 'mecanico'),
  ('operacion_montacargas_grua', 'Operacion de montacargas / grua', 'mecanico'),
  ('riesgo_electrico', 'Trabajo con riesgo electrico / alta tension', 'electrico'),
  ('riesgo_corte_trauma', 'Riesgo de corte o trauma (herramientas cortantes, prensas)', 'mecanico'),
  ('estres_laboral_alto', 'Carga psicosocial / estres laboral alto', 'psicosocial'),
  ('turnos_nocturnos', 'Trabajo en turnos nocturnos / rotativos', 'psicosocial');

-- ------------------------------------------------------------
-- 3. REGLAS DE CONTRAINDICACION
--
-- Tabla editable: el equipo medico/admin puede agregar, modificar
-- o desactivar reglas via la API (no se requiere reprogramar).
-- Cada regla vincula un PATRON de diagnostico (uno o mas codigos
-- CIE-10, o un prefijo de capitulo) con una exposicion del
-- catalogo, y dice si es absoluta o relativa.
--
-- Importante: una regla puede referenciar un codigo CIE-10
-- especifico (ej: G40 = Epilepsia) o un RANGO/prefijo (ej: 'F1'
-- para cubrir todo el capitulo de trastornos por sustancias). Se
-- modela con un campo de tipo de coincidencia para que el motor
-- sepa como interpretar 'codigo_cie10_patron'.
-- ------------------------------------------------------------
CREATE TABLE reglas_contraindicacion (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID REFERENCES organizaciones(id) ON DELETE CASCADE, -- NULL = regla global (catalogo inicial compartido)
    nombre                  VARCHAR(200) NOT NULL, -- ej: 'Epilepsia activa + trabajo en alturas'
    codigo_cie10_patron     VARCHAR(10) NOT NULL, -- ej: 'G40' (codigo exacto) o 'F1' (prefijo de capitulo)
    tipo_coincidencia       VARCHAR(20) NOT NULL DEFAULT 'exacto' CHECK (tipo_coincidencia IN ('exacto', 'prefijo')),
    -- exposicion_codigo NO lleva FOREIGN KEY a catalogo_exposiciones
    -- a proposito: catalogo_exposiciones.codigo NO es unico por si
    -- solo (solo es unico junto con organizacion_id, ver
    -- idx_exposiciones_codigo_org, porque distintas organizaciones
    -- pueden definir su propio codigo repetido con nombre/descripcion
    -- propios). Postgres exige que un FK apunte a una columna con
    -- restriccion UNIQUE simple, no a un indice compuesto/expresion,
    -- asi que un FK aqui fallaria al crear la tabla (SQLSTATE 42830).
    -- La validacion de que exposicion_codigo exista y este activo
    -- para la organizacion correspondiente ya se hace en la
    -- aplicacion (ver aptitudController.js:crearRegla), antes del
    -- INSERT, que es equivalente en la practica.
    exposicion_codigo       VARCHAR(50) NOT NULL,
    severidad               VARCHAR(20) NOT NULL CHECK (severidad IN ('absoluta', 'relativa')),
    descripcion_riesgo      TEXT NOT NULL, -- explicacion clinica de por que existe la regla, se muestra al medico
    sugerencia_accion       TEXT, -- ej: 'Restriccion temporal hasta control. Reevaluar en 3 meses.'
    fuente_referencia       VARCHAR(300), -- ej: 'NIOSH / consenso clinico internacional', para trazabilidad de por que existe la regla
    activa                  BOOLEAN NOT NULL DEFAULT true,
    creado_por              UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reglas_contraindicacion_patron ON reglas_contraindicacion(codigo_cie10_patron);
CREATE INDEX idx_reglas_contraindicacion_exposicion ON reglas_contraindicacion(exposicion_codigo);
CREATE INDEX idx_reglas_contraindicacion_organizacion ON reglas_contraindicacion(organizacion_id);

CREATE TRIGGER set_actualizado_en_reglas_contraindicacion
  BEFORE UPDATE ON reglas_contraindicacion
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

-- Set inicial de 12 reglas (6 absolutas + 6 relativas), acordado
-- con el cliente como punto de partida basado en consenso clinico
-- internacional (NIOSH/OSHA) y normativa de proteccion a la
-- maternidad, dado que la normativa ecuatoriana (CD 513, Decreto
-- 2393, Decreto 255/FEMO) exige justificacion clinica del medico
-- ocupacional pero no publica una tabla exhaustiva de
-- contraindicaciones especificas; eso queda a criterio tecnico
-- del profesional, que es exactamente lo que este motor soporta
-- sin reemplazar. organizacion_id NULL = visible para todas las
-- organizaciones; cada organizacion puede agregar las suyas.
INSERT INTO reglas_contraindicacion
  (nombre, codigo_cie10_patron, tipo_coincidencia, exposicion_codigo, severidad, descripcion_riesgo, sugerencia_accion, fuente_referencia)
VALUES
  -- --- ABSOLUTAS ---
  ('Epilepsia activa + trabajo en alturas', 'G40', 'exacto', 'trabajo_alturas', 'absoluta',
   'Riesgo de caida grave por crisis convulsiva subita en altura. Contraindicacion de alto consenso en medicina ocupacional.',
   'No apto para esta exposicion mientras la epilepsia no este controlada (minimo 1 año libre de crisis, segun criterio del especialista tratante).',
   'NIOSH / consenso internacional de medicina ocupacional'),

  ('Epilepsia activa + espacios confinados', 'G40', 'exacto', 'espacios_confinados', 'absoluta',
   'Riesgo de atrapamiento o asfixia por crisis convulsiva en espacio confinado, con dificultad de rescate inmediato.',
   'No apto para esta exposicion mientras la epilepsia no este controlada.',
   'NIOSH / consenso internacional de medicina ocupacional'),

  ('Epilepsia activa + operacion de maquinaria', 'G40', 'exacto', 'operacion_maquinaria', 'absoluta',
   'Riesgo de lesion grave por perdida subita de control durante crisis, con maquinaria en movimiento.',
   'No apto para esta exposicion mientras la epilepsia no este controlada.',
   'NIOSH / consenso internacional de medicina ocupacional'),

  ('Trastorno vestibular activo + trabajo en alturas', 'H81', 'exacto', 'trabajo_alturas', 'absoluta',
   'Riesgo de caida por desequilibrio o vertigo subito en altura.',
   'No apto para esta exposicion mientras el trastorno vestibular no este controlado y confirmado por especialista.',
   'Consenso clinico de medicina ocupacional'),

  ('Embarazo confirmado + radiacion ionizante', 'Z321', 'exacto', 'radiacion_ionizante', 'absoluta',
   'Riesgo de dano teratogenico al feto por exposicion a radiacion ionizante. Proteccion legal obligatoria de la maternidad.',
   'No apto para esta exposicion durante todo el embarazo. Reubicacion temporal obligatoria.',
   'Normativa de proteccion a la maternidad / consenso internacional'),

  ('Embarazo confirmado + solventes organicos', 'Z321', 'exacto', 'solventes_organicos', 'absoluta',
   'Riesgo de dano teratogenico documentado por exposicion a solventes organicos durante el embarazo.',
   'No apto para esta exposicion durante todo el embarazo. Reubicacion temporal obligatoria.',
   'Normativa de proteccion a la maternidad / consenso internacional'),

  -- --- RELATIVAS ---
  ('Hipertension no controlada + calor extremo', 'I10', 'exacto', 'calor_extremo', 'relativa',
   'El estres termico puede agravar la hipertension no controlada y aumentar riesgo cardiovascular agudo.',
   'Restriccion temporal hasta lograr control de cifras tensionales. Reevaluar en 1-3 meses con nuevo control medico.',
   'Consenso clinico de medicina ocupacional'),

  ('Asma / EPOC + quimicos irritantes', 'J45', 'exacto', 'quimicos_irritantes', 'relativa',
   'La exposicion a polvos, harinas o quimicos irritantes puede desencadenar crisis respiratorias agudas.',
   'Uso obligatorio de proteccion respiratoria certificada. Vigilancia espirometrica periodica. Evaluar severidad antes de definir aptitud.',
   'Consenso clinico de medicina ocupacional'),

  ('Diabetes con riesgo de hipoglicemia + conduccion', 'E10', 'exacto', 'conduccion_vehiculos', 'relativa',
   'Riesgo de hipoglicemia subita durante la conduccion, con perdida de control del vehiculo.',
   'Evaluar control glicemico y antecedentes de hipoglicemia severa antes de definir aptitud. Restriccion si hay descontrol.',
   'Consenso clinico de medicina ocupacional'),

  ('Trastorno discal / lumbalgia cronica + manipulacion de cargas', 'M51', 'exacto', 'manipulacion_cargas', 'relativa',
   'El levantamiento de cargas puede agravar el trastorno discal y generar incapacidad recurrente.',
   'Restriccion de peso maximo segun evaluacion biomecanica (cruzar con resultado REBA/NIOSH del puesto). Considerar rotacion de tareas.',
   'Consenso clinico de medicina ocupacional'),

  ('Anticoagulantes + riesgo de corte o trauma', 'Z921', 'exacto', 'riesgo_corte_trauma', 'relativa',
   'El uso de anticoagulantes aumenta el riesgo de hemorragia significativa ante cualquier trauma o corte.',
   'Evaluar tipo de anticoagulante, dosis e indicacion antes de definir aptitud. Considerar EPP adicional.',
   'Consenso clinico de medicina ocupacional'),

  ('Tratamiento con sedantes/benzodiacepinas + conduccion o alturas', 'Z921', 'exacto', 'conduccion_vehiculos', 'relativa',
   'Los sedantes y benzodiacepinas pueden alterar el nivel de alerta y los reflejos, aumentando riesgo de accidente.',
   'Evaluar tipo de farmaco, dosis y horario de administracion antes de definir aptitud.',
   'Consenso clinico de medicina ocupacional');

-- ------------------------------------------------------------
-- 4. HISTORIAL DE APTITUD MEDICA (con justificacion obligatoria)
--
-- Corrige el punto critico #3 y #16: cada vez que se registra o
-- cambia la aptitud de un trabajador, se crea una FILA NUEVA
-- (nunca se sobreescribe la anterior), con justificacion clinica
-- obligatoria y las alertas que el motor de reglas detecto en
-- ese momento (guardadas como snapshot, para que el historial
-- muestre exactamente que sabia el medico cuando decidio).
-- ------------------------------------------------------------
CREATE TABLE historial_aptitud_medica (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    trabajador_id           UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    medico_id               UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,

    -- Mismo vocabulario que el campo "aptitud" ya existente en la
    -- tabla trabajadores (migration_002), por decision del cliente:
    -- mantener un sistema simple en toda la aplicacion en lugar de
    -- adoptar la nomenclatura A/B/C/D del FEMO/Decreto 255. Si en
    -- el futuro un reporte oficial exige el formato FEMO, se puede
    -- mapear estos valores a A/B/C/D en la capa de generacion del
    -- reporte, sin tener que cambiar el modelo de datos.
    aptitud                 VARCHAR(20) NOT NULL CHECK (aptitud IN ('apto', 'con_restricciones', 'no_apto', 'pendiente')),

    puesto_evaluado         VARCHAR(150) NOT NULL,
    diagnosticos_cie10       TEXT[] NOT NULL DEFAULT '{}', -- codigos CIE-10 considerados en esta evaluacion
    exposiciones_puesto      TEXT[] NOT NULL DEFAULT '{}', -- codigos de catalogo_exposiciones del puesto evaluado

    -- Snapshot de las alertas que el motor de reglas mostro al
    -- medico EN EL MOMENTO de esta decision (no se recalcula despues,
    -- para que el historial sea fiel a lo que el medico realmente vio).
    alertas_detectadas       JSONB NOT NULL DEFAULT '[]',

    -- Obligatorio: el medico SIEMPRE debe escribir su razonamiento
    -- clinico, haya o no alertas. Esto es lo que la auditoria pedia
    -- como "justificacion clinica obligatoria".
    justificacion_clinica    TEXT NOT NULL CHECK (length(trim(justificacion_clinica)) >= 20),

    restricciones            TEXT, -- texto libre de restricciones especificas si aptitud = B o C
    vigencia_hasta           DATE, -- fecha de vencimiento de esta aptitud (proximo examen periodico)

    creado_en                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_historial_aptitud_organizacion ON historial_aptitud_medica(organizacion_id);
CREATE INDEX idx_historial_aptitud_trabajador ON historial_aptitud_medica(trabajador_id);
CREATE INDEX idx_historial_aptitud_creado_en ON historial_aptitud_medica(creado_en DESC);

-- Nota deliberada: NO hay UPDATE ni DELETE permitidos a nivel de
-- aplicacion sobre esta tabla (solo INSERT). Es un libro de
-- registro append-only, igual que la tabla "auditoria" general.
-- El campo "aptitud" en trabajadores (de migration_002) se debe
-- seguir actualizando como cache del estado MAS RECIENTE, pero la
-- fuente de verdad y el historial completo viven aqui.
