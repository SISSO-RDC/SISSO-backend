-- ============================================================
-- SISSO - Migracion 014: Historia Clinica Ocupacional segun el
-- Acuerdo Ministerial MSP 0341-2019 ("Aplicacion de la historia
-- clinica ocupacional"), formularios SNS-MSP HCU 077 a HCU 083.
--
-- Esta migracion implementa la PRIMERA pieza: el formulario
-- HCU 077 (Evaluacion preocupacional - inicio). La tabla se llama
-- de forma generica ("evaluaciones_ocupacionales", con una columna
-- discriminadora "tipo_evaluacion") a proposito, para que agregar
-- despues HCU 078 (periodica), HCU 079 (reintegro) y HCU 080
-- (retiro) sea EXTENDER esta tabla (nuevas columnas nullable +
-- ampliar el CHECK de tipo_evaluacion), no crear tablas separadas
-- ni duplicar toda la logica de antecedentes/revision por
-- sistemas/examen fisico que los 4 formularios comparten casi
-- integramente segun el instructivo oficial.
--
-- DECISION DE DISENO - JSONB vs columnas:
-- El formulario oficial tiene bloques que son listas repetibles o
-- matrices de casillas (antecedentes laborales anteriores,
-- antecedentes familiares por parentesco, revision de 10 sistemas,
-- examen fisico de 13 regiones corporales, matriz de 6 categorias
-- de riesgo laboral con ~50 items). Modelar cada item como columna
-- individual crearia una tabla de cientos de columnas, la mayoria
-- NULL casi siempre. Se uso JSONB para esos bloques, con la forma
-- exacta de cada uno documentada en el comentario de su columna y
-- validada en la aplicacion (historiaClinicaController.js), no en
-- la base de datos. Los campos que SI se buscan/filtran o tienen
-- significado clinico critico (aptitud, fecha, signos vitales)
-- quedan como columnas reales.
--
-- RELACION CON EL MODULO DE APTITUD EXISTENTE (historial_aptitud_
-- medica, migration_006): son cosas distintas y COMPLEMENTARIAS.
-- historial_aptitud_medica es el veredicto rapido de aptitud
-- (apto/con_restricciones/no_apto/pendiente) cruzado contra el
-- motor de reglas de contraindicacion. El "Bloque N" de este
-- formulario usa la taxonomia de 4 valores que exige el MSP
-- (apto/apto_en_observacion/apto_con_limitaciones/no_apto), que no
-- es identica. Por ahora quedan como registros independientes (no
-- se sincronizan automaticamente); es un punto de mejora futura si
-- se necesita, pero forzar la sincronizacion ahora habria
-- complicado mucho esta primera entrega.
-- ============================================================

CREATE TABLE evaluaciones_ocupacionales (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id             UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    trabajador_id               UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    medico_id                   UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,

    -- Discriminador: por ahora solo 'preocupacional_inicio'. Se
    -- amplia este CHECK cuando se agreguen los otros formularios.
    tipo_evaluacion             VARCHAR(30) NOT NULL DEFAULT 'preocupacional_inicio'
                                    CHECK (tipo_evaluacion IN ('preocupacional_inicio')),

    fecha_atencion              DATE NOT NULL DEFAULT CURRENT_DATE,
    hora_atencion                TIME,

    -- ---- Bloque A: datos del establecimiento/empresa y usuario ----
    -- (nombre, documento, sexo, edad, puesto y area del trabajador
    -- YA VIVEN en la tabla trabajadores; aqui solo se guardan los
    -- campos que son EXCLUSIVOS de este formulario)
    numero_archivo               VARCHAR(50),
    religion                     VARCHAR(30),  -- catolica | evangelica | testigos_jehova | mormona | otra | ninguna
    grupo_sanguineo              VARCHAR(5),   -- ej: O+, A-, AB+
    lateralidad                  VARCHAR(15),  -- izquierdo | derecho | ambidiestro
    orientacion_sexual           VARCHAR(20),  -- lesbiana | gay | bisexual | heterosexual | no_sabe_no_responde (campo del formulario oficial MSP; el trabajador puede optar por "no sabe/no responde")
    identidad_genero             VARCHAR(20),  -- femenino | masculino | transfemenino | transmasculino | ninguno | no_sabe_no_responde
    discapacidad_tiene           BOOLEAN NOT NULL DEFAULT false,
    discapacidad_tipo            VARCHAR(100),
    discapacidad_porcentaje      NUMERIC(4,1),
    fecha_ingreso_trabajo        DATE,
    puesto_trabajo_ciuo          VARCHAR(20),  -- codigo CIUO opcional, ej "2221.01.02"
    area_trabajo                 VARCHAR(150),
    actividades_relevantes       TEXT,
    -- Antecedentes ginecobstetricos (solo aplica si el trabajador
    -- es mujer; queda NULL si no aplica): { menarquiaEdad,
    -- ciclosDias, fechaUltimaMenstruacion }
    antecedentes_ginecobstetricos JSONB,

    -- ---- Bloque B: motivo de consulta ----
    motivo_consulta              TEXT NOT NULL DEFAULT 'Evaluación médica ocupacional para el ingreso al puesto de trabajo.',

    -- ---- Bloque C: antecedentes personales ----
    antecedentes_clinicos_quirurgicos TEXT,
    -- { gestas, partos, cesareas, abortos, hijosVivos, hijosMuertos,
    --   vidaSexualActiva, metodoPlanificacion: {usa, tipo},
    --   examenes: { papanicolau, colposcopia, ecoMamario, mamografia }
    --     cada examen: { realizado, fecha, resultado } }
    antecedentes_ginecologicos_examenes JSONB,
    -- { antigenoProstatico: {realizado,fecha,resultado},
    --   ecoProstatico: {realizado,fecha,resultado},
    --   metodoPlanificacion: {usa,tipo}, hijosVivos, hijosMuertos }
    antecedentes_reproductivos_masculinos JSONB,
    -- { tabaco: {consume,tiempoConsumoMeses,cantidad,exConsumidor,tiempoAbstinenciaMeses},
    --   alcohol: {...igual...}, otrasDrogas: {consume,cual,...igual...} }
    habitos_toxicos               JSONB,
    -- { actividadFisica: {realiza,cual,tiempoCantidad},
    --   medicacionHabitual: {toma,cual,tiempoCantidad} }
    estilo_vida                   JSONB,

    -- ---- Bloque D: antecedentes de trabajo (empleos anteriores) ----
    -- Array: [{ empresa, puestoTrabajo, actividades, tiempoMeses,
    --   riesgos: ['fisico','mecanico',...], observaciones }]
    antecedentes_laborales_previos JSONB NOT NULL DEFAULT '[]',
    -- { fueCalificado, especificarEntidad, fecha, observaciones }
    accidentes_trabajo_previos    JSONB,
    enfermedades_profesionales_previas JSONB,

    -- ---- Bloque E: antecedentes familiares ----
    -- { cardiovascular, metabolica, neurologica, oncologica,
    --   infecciosa, hereditariaCongenita, discapacidades, otros }
    -- cada uno: texto libre con el parentesco (o null si no aplica)
    antecedentes_familiares       JSONB,

    -- ---- Bloque F: factores de riesgo del puesto de trabajo actual ----
    -- { puestoArea, actividades, riesgosFisicos: [...], riesgosMecanicos: [...],
    --   riesgosQuimicos: [...], riesgosBiologicos: [...],
    --   riesgosErgonomicos: [...], riesgosPsicosociales: [...],
    --   medidasPreventivas }
    -- Los valores validos de cada lista de riesgos estan en
    -- src/historiaClinica/catalogosRiesgo.js (taxonomia fija del
    -- formulario oficial MSP, no editable por el usuario).
    factores_riesgo_actual        JSONB,

    -- ---- Bloque G: actividades extra laborales ----
    actividades_extra_laborales   TEXT,

    -- ---- Bloque H: enfermedad actual ----
    enfermedad_actual             TEXT,

    -- ---- Bloque I: revision actual de organos y sistemas ----
    -- { pielAnexos: {conPatologia, descripcion}, organosSentidos: {...},
    --   respiratorio: {...}, cardiovascular: {...}, digestivo: {...},
    --   genitoUrinario: {...}, musculoEsqueletico: {...}, endocrino: {...},
    --   hemoLinfatico: {...}, nervioso: {...} }
    revision_organos_sistemas     JSONB,

    -- ---- Bloque J: constantes vitales y antropometria ----
    presion_arterial_sistolica    SMALLINT,  -- mmHg
    presion_arterial_diastolica   SMALLINT,  -- mmHg
    temperatura_c                 NUMERIC(4,1),
    frecuencia_cardiaca           SMALLINT,  -- lat/min
    saturacion_oxigeno            SMALLINT,  -- %
    frecuencia_respiratoria       SMALLINT,  -- resp/min
    peso_kg                       NUMERIC(5,2),
    talla_cm                      SMALLINT,
    imc                           NUMERIC(4,1),  -- calculado por el backend: peso / (talla_m)^2
    perimetro_abdominal_cm        NUMERIC(5,1),

    -- ---- Bloque K: examen fisico regional (13 regiones) ----
    -- { piel: {cicatrices:{conPatologia,desc}, tatuajes:{...}},
    --   ojos: {parpados:{...}, conjuntivas:{...}, pupilas:{...}, cornea:{...}, motilidad:{...}},
    --   oido: {conductoAuditivoExterno:{...}, pabellon:{...}, timpanos:{...}},
    --   oroFaringe: {labios:{...}, lengua:{...}, faringe:{...}, amigdalas:{...}, dentadura:{...}},
    --   nariz: {tabique:{...}, cornetes:{...}, mucosas:{...}, senosParanasales:{...}},
    --   cuello: {tiroidesMasas:{...}},
    --   torax: {mamas:{...}, pulmones:{...}, corazon:{...}},
    --   abdomen: {visceras:{...}, paredAbdominal:{...}},
    --   columna: {flexibilidad:{...}, desviacion:{...}, dolor:{...}},
    --   pelvis: {pelvis:{...}, genitales:{...}},
    --   extremidades: {vascular:{...}, miembrosSuperiores:{...}, miembrosInferiores:{...}},
    --   neurologico: {fuerza:{...}, sensibilidad:{...}, marcha:{...}, reflejos:{...}} }
    examen_fisico_regional         JSONB,

    -- ---- Bloque L: resultados de examenes generales/especificos ----
    -- Array: [{ examen, fecha, resultado }]. Los examenes propios
    -- de SISSO (audiometria, espirometria) tambien pueden anexarse
    -- aqui por nombre para tener la foto completa en un solo lugar,
    -- ademas de vivir en sus propios modulos con mas detalle.
    resultados_examenes            JSONB NOT NULL DEFAULT '[]',

    -- ---- Bloque M: diagnostico ----
    -- Array: [{ descripcion, codigoCie10, tipo: 'enfermedad_profesional'|'enfermedad_comun',
    --   condicion: 'presuntivo'|'definitivo' }]
    diagnosticos                   JSONB NOT NULL DEFAULT '[]',

    -- ---- Bloque N: aptitud medica para el trabajo ----
    -- Taxonomia oficial MSP (distinta de historial_aptitud_medica.aptitud, ver nota arriba)
    aptitud_msp                    VARCHAR(25) CHECK (aptitud_msp IN ('apto', 'apto_en_observacion', 'apto_con_limitaciones', 'no_apto')),
    aptitud_observacion            TEXT,
    aptitud_limitacion             TEXT,

    -- ---- Bloque O: recomendaciones y/o tratamiento ----
    recomendaciones_tratamiento    TEXT,

    -- ---- Bloque P: datos del profesional ----
    -- medico_id + fecha_atencion + hora_atencion ya cubren nombre/
    -- fecha/hora (se obtienen via join con usuarios). Codigo
    -- profesional (MSP/ACESS) es especifico de este formulario:
    codigo_profesional_salud       VARCHAR(50),

    -- ---- Bloque Q: firma del usuario ----
    -- Mismo patron que consentimientos: firma grafica subida a
    -- Cloudinary. Puede ser NULL si aun no se ha firmado (el medico
    -- puede guardar el formulario primero y recoger la firma
    -- despues, en la misma consulta).
    firma_imagen_url               TEXT,
    firma_imagen_public_id         VARCHAR(300),

    creado_en                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_evaluaciones_ocup_organizacion ON evaluaciones_ocupacionales(organizacion_id);
CREATE INDEX idx_evaluaciones_ocup_trabajador ON evaluaciones_ocupacionales(trabajador_id);
CREATE INDEX idx_evaluaciones_ocup_tipo ON evaluaciones_ocupacionales(tipo_evaluacion);

CREATE TRIGGER set_actualizado_en_evaluaciones_ocupacionales
  BEFORE UPDATE ON evaluaciones_ocupacionales
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();
