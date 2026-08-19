-- ============================================================
-- SISSO - Migracion 005: evaluaciones ergonomicas RULA
--
-- Corrige el error CRITICO #2 de la auditoria: "RULA tambien
-- incompleto. La logica es simplificada y no usa tablas reales.
-- Faltan: rotacion muneca, desviacion cubital/radial, fuerza,
-- uso muscular sostenido."
--
-- Esta migracion crea las tablas necesarias para soportar el
-- calculo RULA real, basado en el metodo publicado por
-- McAtamney, L. & Corlett, E.N. (1993). "RULA: a survey method
-- for the investigation of work-related upper limb disorders".
-- Applied Ergonomics, 24(2), 91-99.
--
-- El calculo en si vive en codigo (src/ergonomia/rula.js), no en
-- SQL; aqui solo se persisten los INPUTS observados y el
-- RESULTADO ya calculado, para trazabilidad.
--
-- Decision con el cliente: sesiones RULA usan su PROPIA tabla
-- (sesiones_evaluacion_rula), independiente de
-- sesiones_evaluacion_ergonomica (que es exclusiva de REBA).
--
-- Nota sobre piernas: el metodo RULA usa solo 2 niveles para piernas
-- (Tabla 12 del metodo), a diferencia de REBA que tiene un analisis
-- biomecanico mas detallado de piernas/rodillas. Nivel 1 cubre dos
-- situaciones (sentado con piernas/pies bien apoyados, O de pie con
-- peso simetrico y espacio para cambiar de posicion); nivel 2 es
-- cualquier otro caso. Se modela como booleano "piernas_bien_apoyadas".
-- ============================================================

-- ------------------------------------------------------------
-- 1. SESIONES DE EVALUACION RULA
-- ------------------------------------------------------------
CREATE TABLE sesiones_evaluacion_rula (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id     UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    trabajador_id       UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    evaluador_id        UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    puesto_evaluado     VARCHAR(150) NOT NULL,
    tarea_observada     VARCHAR(300),
    fecha_evaluacion    DATE NOT NULL DEFAULT CURRENT_DATE,
    notas_generales     TEXT,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sesiones_rula_organizacion ON sesiones_evaluacion_rula(organizacion_id);
CREATE INDEX idx_sesiones_rula_trabajador ON sesiones_evaluacion_rula(trabajador_id);

CREATE TRIGGER set_actualizado_en_sesiones_rula
  BEFORE UPDATE ON sesiones_evaluacion_rula
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

-- ------------------------------------------------------------
-- 2. EVALUACIONES RULA (una fila = una postura puntual)
--
-- Igual que en REBA: brazo, antebrazo, muneca y la rotacion de
-- muneca se capturan POR LADO, porque el metodo original evalua
-- cada lado del cuerpo de forma independiente y se reporta el
-- lado con mayor puntuacion.
-- ------------------------------------------------------------
CREATE TABLE evaluaciones_rula (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    sesion_id               UUID NOT NULL REFERENCES sesiones_evaluacion_rula(id) ON DELETE CASCADE,
    nombre_postura          VARCHAR(150) NOT NULL,
    orden                   INTEGER NOT NULL DEFAULT 1,

    -- ---- GRUPO A: brazo, antebrazo, muneca, rotacion de muneca (lado derecho) ----
    -- 4 niveles base segun la Tabla 1 del metodo original (extension 20-flexion 20,
    -- extension>20-o-flexion 20-45, flexion 45-90, flexion>90). Con los modificadores
    -- (+1 hombro elevado, +1 abducido, -1 apoyado) el valor final usado en la Tabla A
    -- de cruce llega hasta 6, pero el INPUT que observa el evaluador es uno de estos 4.
    brazo_derecho                VARCHAR(40) NOT NULL CHECK (brazo_derecho IN (
                                    'extension_20_a_flexion_20', 'extension_mayor_20_o_flexion_20_45',
                                    'flexion_45_90', 'flexion_mayor_90'
                                )),
    brazo_derecho_hombro_elevado BOOLEAN NOT NULL DEFAULT false, -- +1 si el hombro esta elevado
    brazo_derecho_abducido       BOOLEAN NOT NULL DEFAULT false, -- +1 si el brazo esta en abduccion
    brazo_derecho_apoyado        BOOLEAN NOT NULL DEFAULT false, -- -1 si el brazo esta apoyado o la postura es a favor de gravedad

    antebrazo_derecho             VARCHAR(30) NOT NULL CHECK (antebrazo_derecho IN ('flexion_60_100', 'flexion_menor_60_o_mayor_100')),
    antebrazo_derecho_cruza_linea_media BOOLEAN NOT NULL DEFAULT false, -- +1 si el antebrazo cruza la linea media del cuerpo o sale del lado del cuerpo

    muneca_derecha                VARCHAR(30) NOT NULL CHECK (muneca_derecha IN ('posicion_neutra', 'flexion_o_extension_0_15', 'flexion_o_extension_mayor_15')),
    muneca_derecha_desviacion_radial_cubital BOOLEAN NOT NULL DEFAULT false, -- +1 si hay desviacion radial o cubital

    muneca_derecha_rotacion       VARCHAR(30) NOT NULL CHECK (muneca_derecha_rotacion IN ('rango_medio', 'rango_extremo')),

    -- ---- GRUPO A: brazo, antebrazo, muneca, rotacion de muneca (lado izquierdo) ----
    brazo_izquierdo               VARCHAR(40) NOT NULL CHECK (brazo_izquierdo IN (
                                    'extension_20_a_flexion_20', 'extension_mayor_20_o_flexion_20_45',
                                    'flexion_45_90', 'flexion_mayor_90'
                                )),
    brazo_izquierdo_hombro_elevado BOOLEAN NOT NULL DEFAULT false,
    brazo_izquierdo_abducido       BOOLEAN NOT NULL DEFAULT false,
    brazo_izquierdo_apoyado        BOOLEAN NOT NULL DEFAULT false,

    antebrazo_izquierdo             VARCHAR(30) NOT NULL CHECK (antebrazo_izquierdo IN ('flexion_60_100', 'flexion_menor_60_o_mayor_100')),
    antebrazo_izquierdo_cruza_linea_media BOOLEAN NOT NULL DEFAULT false,

    muneca_izquierda                VARCHAR(30) NOT NULL CHECK (muneca_izquierda IN ('posicion_neutra', 'flexion_o_extension_0_15', 'flexion_o_extension_mayor_15')),
    muneca_izquierda_desviacion_radial_cubital BOOLEAN NOT NULL DEFAULT false,

    muneca_izquierda_rotacion       VARCHAR(30) NOT NULL CHECK (muneca_izquierda_rotacion IN ('rango_medio', 'rango_extremo')),

    -- ---- Modificador del GRUPO A: uso muscular y fuerza/carga ----
    -- El metodo aplica el MISMO modificador de actividad muscular y
    -- de fuerza/carga a ambos lados (no es por lado).
    grupo_a_musculo_estatico_o_repetido BOOLEAN NOT NULL DEFAULT false, -- +1 si la postura se mantiene estatica >1 min o se repite >4 veces/min
    grupo_a_fuerza_carga            VARCHAR(30) NOT NULL CHECK (grupo_a_fuerza_carga IN (
                                        'menor_2kg_intermitente', 'entre_2_10kg_intermitente',
                                        'entre_2_10kg_estatico_o_repetido', 'mayor_10kg_o_repetido_o_brusco'
                                    )),

    -- ---- GRUPO B: cuello, tronco, piernas ----
    cuello                  VARCHAR(30) NOT NULL CHECK (cuello IN (
                                'flexion_0_10', 'flexion_10_20', 'flexion_mayor_20', 'extension'
                            )),
    cuello_torsion          BOOLEAN NOT NULL DEFAULT false, -- +1 si hay torsion del cuello
    cuello_inclinacion_lateral BOOLEAN NOT NULL DEFAULT false, -- +1 si hay inclinacion lateral del cuello

    -- Tronco: 4 niveles segun la Tabla 10 del metodo. El nivel 1 cubre dos
    -- situaciones distintas con la MISMA puntuacion (de pie erguido sin
    -- flexion/extension, O sentado bien apoyado con angulo tronco-piernas
    -- >90°): se guarda cual de las dos en "tronco_sentado" solo para fines
    -- de reporte, sin que afecte el calculo.
    tronco                  VARCHAR(30) NOT NULL CHECK (tronco IN (
                                'erguido_o_sentado_apoyado', 'flexion_0_20',
                                'flexion_20_60', 'flexion_mayor_60'
                            )),
    tronco_sentado           BOOLEAN NOT NULL DEFAULT false, -- solo informativo: si la tarea se realiza sentado
    tronco_torsion          BOOLEAN NOT NULL DEFAULT false, -- +1 si hay torsion del tronco
    tronco_inclinacion_lateral BOOLEAN NOT NULL DEFAULT false, -- +1 si hay inclinacion lateral del tronco

    -- Pregunta oficial de piernas en RULA: es un SI/NO simple, no
    -- una tabla biomecanica como en REBA. "Piernas y pies bien
    -- apoyados en postura equilibrada (simetrica, peso distribuido)".
    piernas_bien_apoyadas    BOOLEAN NOT NULL DEFAULT true,

    -- ---- Modificador del GRUPO B: uso muscular y fuerza/carga ----
    grupo_b_musculo_estatico_o_repetido BOOLEAN NOT NULL DEFAULT false,
    grupo_b_fuerza_carga            VARCHAR(30) NOT NULL CHECK (grupo_b_fuerza_carga IN (
                                        'menor_2kg_intermitente', 'entre_2_10kg_intermitente',
                                        'entre_2_10kg_estatico_o_repetido', 'mayor_10kg_o_repetido_o_brusco'
                                    )),

    -- ---- Lado usado para el calculo final ----
    lado_evaluado            VARCHAR(20) NOT NULL CHECK (lado_evaluado IN ('derecho', 'izquierdo', 'ambos_iguales')),

    -- ---- RESULTADOS CALCULADOS (nunca editables a mano) ----
    puntuacion_a_derecha     SMALLINT NOT NULL, -- tabla A lado derecho, ya con musculo+fuerza sumados
    puntuacion_a_izquierda   SMALLINT NOT NULL, -- tabla A lado izquierdo, ya con musculo+fuerza sumados
    puntuacion_b             SMALLINT NOT NULL, -- tabla B: cuello+tronco+piernas, ya con musculo+fuerza sumados
    puntuacion_c             SMALLINT NOT NULL, -- tabla C: cruce de A (lado mas desfavorable) y B
    nivel_riesgo             VARCHAR(20) NOT NULL CHECK (nivel_riesgo IN (
                                'aceptable', 'puede_requerir_cambios', 'requiere_cambios_pronto', 'requiere_cambios_ya'
                            )),
    accion_requerida         TEXT NOT NULL,

    -- ---- Evidencia visual (Cloudinary) ----
    evidencia_url             TEXT,
    evidencia_public_id       VARCHAR(300),
    evidencia_tipo            VARCHAR(10) CHECK (evidencia_tipo IN ('imagen', 'video')),

    creado_en                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_eval_rula_organizacion ON evaluaciones_rula(organizacion_id);
CREATE INDEX idx_eval_rula_sesion ON evaluaciones_rula(sesion_id);

CREATE TRIGGER set_actualizado_en_evaluaciones_rula
  BEFORE UPDATE ON evaluaciones_rula
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();
