-- ============================================================
-- SISSO - Migracion 004: evaluaciones ergonomicas REBA
--
-- Corrige el error CRITICO #1 de la auditoria: el prototipo
-- anterior calculaba REBA con una formula simplificada e
-- incorrecta (score = round((A+B)/2)+1). Esta migracion crea
-- las tablas necesarias para soportar el calculo REBA real,
-- basado en las tablas oficiales A, B y C de Hignett & McAtamney
-- (2000). El calculo en si vive en codigo (src/ergonomia/reba.js),
-- no en SQL; aqui solo se persisten los INPUTS que el evaluador
-- observo y el RESULTADO ya calculado, para trazabilidad.
--
-- Modelo de datos (decidido con el cliente):
--   sesiones_evaluacion_ergonomica
--     -> "carpeta" de una visita de evaluacion: que trabajador,
--        que puesto/tarea, quien evaluo, cuando.
--   evaluaciones_reba
--     -> una o mas posturas puntuales DENTRO de esa sesion.
--        Ej: "levantando carga", "postura sostenida", "depositando".
--        El riesgo del puesto = la postura con el score mas alto,
--        nunca un promedio entre posturas (asi se usa REBA en la
--        practica real).
--
-- Sigue el mismo patron multi-tenant que el resto del esquema:
-- toda fila relevante incluye organizacion_id.
-- ============================================================

-- ------------------------------------------------------------
-- 1. SESIONES DE EVALUACION ERGONOMICA
-- ------------------------------------------------------------
CREATE TABLE sesiones_evaluacion_ergonomica (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    trabajador_id       UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    evaluador_id        UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    puesto_evaluado     VARCHAR(150) NOT NULL, -- puede no coincidir con el puesto actual del trabajador si se evalua un puesto distinto
    tarea_observada     VARCHAR(300),           -- ej: "Levantamiento manual de cajas en linea de empaque"
    fecha_evaluacion    DATE NOT NULL DEFAULT CURRENT_DATE,
    notas_generales     TEXT,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sesiones_ergo_organizacion ON sesiones_evaluacion_ergonomica(organizacion_id);
CREATE INDEX idx_sesiones_ergo_trabajador ON sesiones_evaluacion_ergonomica(trabajador_id);

CREATE TRIGGER set_actualizado_en_sesiones_ergo
  BEFORE UPDATE ON sesiones_evaluacion_ergonomica
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

-- ------------------------------------------------------------
-- 2. EVALUACIONES REBA (una fila = una postura puntual)
--
-- Los campos de postura usan los NOMBRES DE NIVEL que usa el
-- metodo original (no numeros sueltos sin significado), para que
-- quede claro en la base de datos que postura especifica eligio
-- el evaluador en cada segmento corporal. La conversion de estos
-- niveles a las puntuaciones 1-4 de las tablas A/B/C ocurre en
-- codigo (src/ergonomia/reba.js), nunca aqui.
--
-- Brazo, antebrazo y muneca se capturan POR LADO (derecho e
-- izquierdo), porque el cuerpo es asimetrico y a veces el lado
-- dominante tiene una puntuacion distinta al no dominante.
-- ------------------------------------------------------------
CREATE TABLE evaluaciones_reba (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    sesion_id               UUID NOT NULL REFERENCES sesiones_evaluacion_ergonomica(id) ON DELETE CASCADE,
    nombre_postura          VARCHAR(150) NOT NULL, -- ej: "Levantando la carga desde el suelo"
    orden                   INTEGER NOT NULL DEFAULT 1, -- orden de la postura dentro de la sesion

    -- ---- GRUPO A: tronco, cuello, piernas ----
    tronco                  VARCHAR(30) NOT NULL CHECK (tronco IN (
                                'erguido', 'flexion_0_20', 'extension_mayor_20',
                                'flexion_20_60', 'flexion_mayor_60'
                            )),
    tronco_torsion_lateral  BOOLEAN NOT NULL DEFAULT false, -- +1 si hay torsion o inclinacion lateral del tronco

    cuello                  VARCHAR(30) NOT NULL CHECK (cuello IN ('flexion_0_20', 'flexion_mayor_20_o_extension')),
    cuello_torsion_lateral  BOOLEAN NOT NULL DEFAULT false, -- +1 si hay torsion o inclinacion lateral del cuello

    piernas                 VARCHAR(30) NOT NULL CHECK (piernas IN (
                                'soporte_bilateral_estable', 'soporte_unilateral_inestable'
                            )),
    piernas_flexion_rodilla VARCHAR(30) NOT NULL DEFAULT 'ninguna' CHECK (piernas_flexion_rodilla IN (
                                'ninguna', 'flexion_30_60', 'flexion_mayor_60'
                            )),

    -- ---- Modificadores del grupo A (tabla de carga/fuerza) ----
    carga_fuerza             VARCHAR(30) NOT NULL CHECK (carga_fuerza IN (
                                'menor_5kg', 'entre_5_10kg', 'mayor_10kg'
                            )),
    carga_brusca_o_rapida    BOOLEAN NOT NULL DEFAULT false, -- +1 adicional si la fuerza/carga se aplica de forma brusca o rapida

    -- ---- GRUPO B: brazo, antebrazo, muneca (lado derecho) ----
    brazo_derecho            VARCHAR(30) NOT NULL CHECK (brazo_derecho IN (
                                'extension_20_o_flexion_0_20', 'extension_mayor_20_o_flexion_20_45',
                                'flexion_45_90', 'flexion_mayor_90'
                            )),
    brazo_derecho_abduccion_o_rotacion BOOLEAN NOT NULL DEFAULT false, -- +1 si hay abduccion o rotacion del hombro
    brazo_derecho_apoyado   BOOLEAN NOT NULL DEFAULT false, -- -1 si el brazo esta apoyado o la postura es a favor de gravedad

    antebrazo_derecho        VARCHAR(30) NOT NULL CHECK (antebrazo_derecho IN ('flexion_60_100', 'flexion_menor_60_o_mayor_100')),

    muneca_derecha           VARCHAR(30) NOT NULL CHECK (muneca_derecha IN ('flexion_0_15', 'flexion_mayor_15')),
    muneca_derecha_torsion_o_desviacion BOOLEAN NOT NULL DEFAULT false, -- +1 si hay torsion/desviacion radial-cubital

    -- ---- GRUPO B: brazo, antebrazo, muneca (lado izquierdo) ----
    brazo_izquierdo          VARCHAR(30) NOT NULL CHECK (brazo_izquierdo IN (
                                'extension_20_o_flexion_0_20', 'extension_mayor_20_o_flexion_20_45',
                                'flexion_45_90', 'flexion_mayor_90'
                            )),
    brazo_izquierdo_abduccion_o_rotacion BOOLEAN NOT NULL DEFAULT false,
    brazo_izquierdo_apoyado  BOOLEAN NOT NULL DEFAULT false,

    antebrazo_izquierdo      VARCHAR(30) NOT NULL CHECK (antebrazo_izquierdo IN ('flexion_60_100', 'flexion_menor_60_o_mayor_100')),

    muneca_izquierda         VARCHAR(30) NOT NULL CHECK (muneca_izquierda IN ('flexion_0_15', 'flexion_mayor_15')),
    muneca_izquierda_torsion_o_desviacion BOOLEAN NOT NULL DEFAULT false,

    -- ---- Modificadores del grupo B (tabla de agarre/acoplamiento) ----
    -- Se evalua el agarre que predomina en la tarea (no por lado),
    -- tal como especifica el metodo original.
    agarre                   VARCHAR(30) NOT NULL CHECK (agarre IN (
                                'bueno', 'regular', 'malo', 'inaceptable'
                            )),

    -- ---- Modificador final (tabla de actividad) ----
    -- Los 3 modificadores de actividad NO son excluyentes entre si;
    -- el metodo permite sumar mas de uno si aplican simultaneamente.
    actividad_posturas_estaticas  BOOLEAN NOT NULL DEFAULT false, -- 1 o mas partes del cuerpo estaticas >1 minuto
    actividad_movimientos_repetidos BOOLEAN NOT NULL DEFAULT false, -- movimientos repetidos >4 veces/minuto (excluye caminar)
    actividad_cambios_posturales_rapidos BOOLEAN NOT NULL DEFAULT false, -- cambios de postura amplios e inestables

    -- ---- Lado usado para el calculo final ----
    -- REBA exige reportar el score del lado MAS desfavorable; se
    -- guarda cual fue, para que el informe pueda explicarlo.
    lado_evaluado            VARCHAR(20) NOT NULL CHECK (lado_evaluado IN ('derecho', 'izquierdo', 'ambos_iguales')),

    -- ---- RESULTADOS CALCULADOS (nunca editables a mano; los   ----
    -- ---- escribe el backend despues de correr reba.js)        ----
    puntuacion_a             SMALLINT NOT NULL, -- tabla A: tronco+cuello+piernas, con modificador de carga/fuerza
    puntuacion_b_derecho     SMALLINT NOT NULL, -- tabla B lado derecho, con modificador de agarre
    puntuacion_b_izquierdo   SMALLINT NOT NULL, -- tabla B lado izquierdo, con modificador de agarre
    puntuacion_c             SMALLINT NOT NULL, -- tabla C: cruce de A y B (del lado mas desfavorable)
    puntuacion_actividad     SMALLINT NOT NULL, -- suma de los 3 modificadores de actividad (0-3)
    puntuacion_final         SMALLINT NOT NULL, -- C + actividad
    nivel_riesgo             VARCHAR(20) NOT NULL CHECK (nivel_riesgo IN (
                                'inapreciable', 'bajo', 'medio', 'alto', 'muy_alto'
                            )),
    accion_requerida         TEXT NOT NULL, -- texto descriptivo segun tabla oficial de niveles de actuacion

    -- ---- Evidencia visual (Cloudinary) ----
    evidencia_url             TEXT,           -- URL segura de Cloudinary (foto o video de la postura)
    evidencia_public_id       VARCHAR(300),   -- public_id de Cloudinary, necesario para poder borrar el archivo despues
    evidencia_tipo            VARCHAR(10) CHECK (evidencia_tipo IN ('imagen', 'video')),

    creado_en                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_eval_reba_organizacion ON evaluaciones_reba(organizacion_id);
CREATE INDEX idx_eval_reba_sesion ON evaluaciones_reba(sesion_id);

CREATE TRIGGER set_actualizado_en_evaluaciones_reba
  BEFORE UPDATE ON evaluaciones_reba
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

-- ------------------------------------------------------------
-- NOTA PARA LA SIGUIENTE MIGRACION (RULA):
-- Seguira el mismo patron de sesiones_evaluacion_ergonomica,
-- reutilizando la misma tabla de sesiones (una sesion puede
-- en el futuro tener evaluaciones REBA y/o RULA asociadas).
-- ------------------------------------------------------------
