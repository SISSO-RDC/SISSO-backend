-- ============================================================
-- SISSO - Migracion 008: consentimientos informados especificos
-- por tipo de prueba, con firma grafica.
--
-- Corrige el error CRITICO #5 de la auditoria:
--
--   "El modal de consentimiento es general. Pero faltan
--    consentimientos especificos para: audiometria, espirometria,
--    pruebas biologicas, pruebas toxicologicas, pruebas
--    psicologicas. Legalmente esto es importante."
--
-- Base legal: Acuerdo Ministerial 5316 (Registro Oficial 510, 22
-- de febrero de 2016), "Modelo de Gestion de Aplicacion del
-- Consentimiento Informado en la Practica Asistencial", de
-- aplicacion obligatoria en todo el Sistema Nacional de Salud de
-- Ecuador. Este modelo exige, entre otros elementos: informar el
-- objetivo del procedimiento, los riesgos/beneficios/alternativas,
-- dejar constancia escrita (firma), y permitir al paciente
-- revocar su consentimiento en cualquier momento antes de la
-- intervencion.
--
-- Decisiones de diseño acordadas con el cliente:
--   - Texto legal FIJO por tipo de prueba (igual para todas las
--     organizaciones, no editable por cada empresa cliente). Se
--     prioriza consistencia legal sobre personalizacion.
--   - Firma GRAFICA (no solo un boton "Acepto"): el trabajador
--     firma con el dedo/mouse, la imagen se sube a Cloudinary
--     (igual que la evidencia de REBA/RULA) y se guarda su URL.
--   - 6 tipos de consentimiento: el general que ya existia, mas
--     los 5 especificos que señalo la auditoria.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CATALOGO DE TIPOS DE CONSENTIMIENTO (texto fijo, global)
--
-- No tiene organizacion_id: el texto legal es el mismo para
-- todas las organizaciones que usan SISSO, por decision del
-- cliente. Si en el futuro se requiere personalizacion, se
-- puede agregar una tabla de "plantillas por organizacion" sin
-- romper este catalogo base.
-- ------------------------------------------------------------
CREATE TABLE tipos_consentimiento (
    codigo          VARCHAR(50) PRIMARY KEY, -- ej: 'audiometria'
    nombre          VARCHAR(150) NOT NULL,   -- ej: 'Consentimiento informado para audiometria'
    texto_legal     TEXT NOT NULL,           -- texto completo a mostrar/firmar
    version         SMALLINT NOT NULL DEFAULT 1, -- se incrementa si el texto legal cambia (ver nota abajo)
    activo          BOOLEAN NOT NULL DEFAULT true,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_actualizado_en_tipos_consentimiento
  BEFORE UPDATE ON tipos_consentimiento
  FOR EACH ROW EXECUTE FUNCTION trigger_set_actualizado_en();

-- ------------------------------------------------------------
-- 2. CONSENTIMIENTOS FIRMADOS (append-only, igual filosofia que
-- historial_aptitud_medica e historial de auditoria: nunca se
-- actualiza ni borra una fila existente. Si el trabajador firma
-- de nuevo para la misma prueba en otra ocasion, se crea una
-- fila NUEVA).
--
-- Se guarda la VERSION del texto legal que el trabajador realmente
-- vio y firmo (copiada al momento de la firma, no una referencia
-- que pueda cambiar despues), para que el registro sea fiel
-- incluso si el texto de tipos_consentimiento se actualiza luego.
-- ------------------------------------------------------------
CREATE TABLE consentimientos_firmados (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacion_id         UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    trabajador_id           UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    tipo_consentimiento_codigo VARCHAR(50) NOT NULL REFERENCES tipos_consentimiento(codigo) ON DELETE RESTRICT,

    -- Snapshot del texto y version que el trabajador vio al firmar
    -- (no se recalcula despues; si tipos_consentimiento.texto_legal
    -- cambia mas adelante, este registro sigue mostrando lo que
    -- realmente se firmo en su momento).
    texto_legal_firmado     TEXT NOT NULL,
    version_firmada         SMALLINT NOT NULL,

    -- Firma grafica (Cloudinary), igual patron que evidencia de REBA/RULA.
    firma_imagen_url        TEXT NOT NULL,
    firma_imagen_public_id  VARCHAR(300) NOT NULL,

    -- Quien registro este consentimiento en el sistema (el medico
    -- u otro rol autorizado que acompaño al trabajador durante la
    -- firma). El trabajador NO tiene cuenta de usuario propia en
    -- este sistema, por lo que alguien del personal debe haber
    -- estado presente para registrar la firma.
    registrado_por          UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,

    revocado                BOOLEAN NOT NULL DEFAULT false,
    revocado_en             TIMESTAMPTZ,
    motivo_revocacion       TEXT,

    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consentimientos_organizacion ON consentimientos_firmados(organizacion_id);
CREATE INDEX idx_consentimientos_trabajador ON consentimientos_firmados(trabajador_id);
CREATE INDEX idx_consentimientos_tipo ON consentimientos_firmados(tipo_consentimiento_codigo);

-- ------------------------------------------------------------
-- 3. Carga inicial: 6 tipos de consentimiento.
--
-- Los 5 especificos que pide la auditoria + el general que ya
-- existia en el sistema (examen medico ocupacional periodico).
--
-- Los textos siguen la estructura exigida por el Acuerdo
-- Ministerial 5316: identificacion del procedimiento, objetivo,
-- en que consiste, molestias/riesgos esperables, beneficios,
-- voluntariedad y derecho a revocar, y manejo confidencial del
-- resultado (relevante en el contexto laboral, donde el
-- trabajador necesita saber que el empleador solo recibe la
-- aptitud, no el detalle clinico).
-- ------------------------------------------------------------
INSERT INTO tipos_consentimiento (codigo, nombre, texto_legal) VALUES

('examen_ocupacional_general',
 'Consentimiento informado general para examen médico ocupacional',
 'Declaro que he sido informado de manera clara por el médico ocupacional sobre el objetivo del examen médico ocupacional que se me va a realizar: evaluar mi estado de salud en relación con las exigencias y riesgos del puesto de trabajo que ocupo o al que aspiro, conforme a la normativa de seguridad y salud en el trabajo vigente en Ecuador.

Entiendo que este examen puede incluir evaluación clínica general, revisión de antecedentes personales y familiares, y exámenes complementarios según el perfil de riesgo de mi puesto, los cuales requerirán su propio consentimiento informado específico cuando corresponda.

Se me ha informado que los resultados clínicos detallados de este examen son confidenciales y forman parte de mi historia clínica ocupacional, a la cual solo tiene acceso el personal médico autorizado. Mi empleador únicamente recibirá la conclusión de aptitud laboral (apto, apto con restricciones, no apto u otra que corresponda), sin acceso a diagnósticos ni datos clínicos específicos, salvo que la ley disponga lo contrario.

Entiendo que mi participación es voluntaria dentro del marco de mis obligaciones laborales y de seguridad ocupacional, y que puedo solicitar aclaraciones al médico en cualquier momento antes, durante o después del examen. Conozco que tengo derecho a revocar este consentimiento antes de que se inicie cualquier procedimiento específico, entendiendo que ello puede tener consecuencias respecto a la determinación de mi aptitud para el puesto.

Habiendo comprendido la información anterior, otorgo mi consentimiento de forma libre e informada para la realización del examen médico ocupacional.'),

('audiometria',
 'Consentimiento informado para audiometría ocupacional',
 'Declaro que he sido informado de que se me realizará una audiometría, examen que tiene como objetivo evaluar el estado de mi audición y detectar de forma temprana cualquier alteración auditiva, especialmente la relacionada con la exposición a ruido en mi puesto de trabajo.

Se me ha explicado que el procedimiento consiste en escuchar una serie de tonos de diferente frecuencia e intensidad a través de audífonos, dentro de una cabina o ambiente con condiciones controladas de silencio, e indicar cuándo los percibo. Entiendo que este examen no es invasivo, no causa dolor y no implica riesgo conocido para mi salud, aunque puede requerir que permanezca en silencio y sin moverme por un periodo breve.

Comprendo que, para obtener un resultado confiable, se me puede solicitar evitar la exposición a ruido intenso en las horas previas al examen.

Se me ha informado que el resultado de esta audiometría es confidencial y forma parte de mi historia clínica ocupacional. En caso de detectarse una alteración relevante, seré informado por el médico ocupacional, quien definirá si corresponde alguna restricción, seguimiento o derivación, sin que mi empleador acceda al detalle clínico del resultado.

Entiendo que mi participación es voluntaria y que puedo solicitar aclaraciones antes de la realización del examen, así como revocar este consentimiento antes de iniciarlo.

Habiendo comprendido la información anterior, otorgo mi consentimiento de forma libre e informada para la realización de la audiometría.'),

('espirometria',
 'Consentimiento informado para espirometría ocupacional',
 'Declaro que he sido informado de que se me realizará una espirometría, examen que tiene como objetivo evaluar la función de mis pulmones, especialmente en relación con la exposición a polvos, humos, gases u otros agentes que puedan afectar mi vía respiratoria en el puesto de trabajo.

Se me ha explicado que el procedimiento consiste en respirar a través de una boquilla conectada a un equipo (espirómetro), realizando inspiraciones y espiraciones forzadas según las indicaciones del personal que realiza la prueba, repitiendo la maniobra varias veces para obtener un resultado confiable.

Entiendo que durante la prueba puedo experimentar mareo leve, tos o cansancio transitorio debido al esfuerzo respiratorio requerido, molestias que habitualmente desaparecen en pocos minutos. Se me ha indicado que debo informar al personal de salud si padezco alguna condición que pueda hacer riesgosa la realización de esfuerzos respiratorios forzados (por ejemplo, cirugía reciente, problemas cardíacos o respiratorios agudos), antes de iniciar la prueba.

Se me ha informado que el resultado de esta espirometría es confidencial y forma parte de mi historia clínica ocupacional. En caso de detectarse una alteración relevante, seré informado por el médico ocupacional, quien definirá el seguimiento correspondiente, sin que mi empleador acceda al detalle clínico del resultado.

Entiendo que mi participación es voluntaria y que puedo solicitar aclaraciones antes de la realización del examen, así como revocar este consentimiento antes de iniciarlo.

Habiendo comprendido la información anterior, otorgo mi consentimiento de forma libre e informada para la realización de la espirometría.'),

('pruebas_biologicas',
 'Consentimiento informado para pruebas biológicas (toma de muestras)',
 'Declaro que he sido informado de que se me realizará una o más pruebas biológicas (toma de muestra de sangre, orina u otro fluido corporal, según corresponda), con el objetivo de evaluar indicadores relacionados con mi estado de salud y/o mi exposición a agentes propios de mi puesto de trabajo (por ejemplo, control de exposición a sustancias químicas, biológicas, o vigilancia de la salud general).

Se me ha explicado en qué consiste el procedimiento específico (tipo de muestra, forma de obtenerla) antes de su realización, así como las molestias esperables, que pueden incluir dolor leve y transitorio, o la aparición de un pequeño hematoma en el sitio de punción, en el caso de toma de muestra sanguínea.

Se me ha informado que el resultado de esta prueba es confidencial y forma parte de mi historia clínica ocupacional. En caso de hallazgos relevantes, seré informado por el médico ocupacional, quien definirá el seguimiento correspondiente, sin que mi empleador acceda al detalle clínico del resultado, salvo cuando la normativa vigente disponga lo contrario.

Entiendo que mi participación es voluntaria y que puedo solicitar aclaraciones antes de la toma de la muestra, así como revocar este consentimiento antes de que se realice el procedimiento.

Habiendo comprendido la información anterior, otorgo mi consentimiento de forma libre e informada para la realización de esta prueba biológica.'),

('pruebas_toxicologicas',
 'Consentimiento informado para pruebas toxicológicas (alcohol y/o drogas)',
 'Declaro que he sido informado de que se me realizará una prueba toxicológica para la detección de alcohol y/o sustancias psicoactivas, en el marco de la vigilancia de la salud ocupacional y/o la política de seguridad laboral de mi empleador, conforme a lo establecido en el reglamento interno de trabajo y/o la normativa aplicable.

Se me ha explicado en qué consiste el procedimiento específico que se utilizará (prueba de aire espirado, muestra de orina, saliva u otra, según corresponda), la forma en que se garantiza la cadena de custodia de la muestra, y que el resultado puede tener implicaciones para mi situación laboral, conforme a lo dispuesto en el reglamento interno de trabajo y la legislación laboral vigente.

Se me ha informado que el resultado de esta prueba será tratado de forma confidencial, y que se me comunicará el resultado de manera personal y reservada. Entiendo que tengo derecho a conocer el procedimiento de confirmación o contraprueba disponible en caso de no estar de acuerdo con un resultado inicial, cuando dicho procedimiento exista.

Entiendo que mi participación en este tipo de pruebas puede estar prevista como una condición dentro del marco de mis obligaciones laborales y de seguridad, conforme a lo que disponga el reglamento interno de trabajo que he aceptado, sin perjuicio de mi derecho a solicitar aclaraciones antes de la realización de la prueba.

Habiendo comprendido la información anterior, otorgo mi consentimiento de forma libre e informada para la realización de esta prueba toxicológica.'),

('pruebas_psicologicas',
 'Consentimiento informado para pruebas psicológicas ocupacionales',
 'Declaro que he sido informado de que se me aplicará una o más pruebas psicológicas, con el objetivo de evaluar aspectos relacionados con mi perfil psicológico, aptitudes, o riesgo psicosocial, en el contexto de la vigilancia de mi salud ocupacional y/o los requerimientos de mi puesto de trabajo.

Se me ha explicado que el procedimiento puede incluir cuestionarios, entrevistas estructuradas y/o pruebas estandarizadas, que no implican riesgo físico, pero que requieren mi concentración y honestidad en las respuestas para que el resultado sea válido y útil.

Se me ha informado que el resultado de estas pruebas es confidencial y forma parte de mi historia clínica ocupacional. Entiendo que el médico ocupacional o el profesional de psicología responsable me informará sobre los hallazgos relevantes para mi salud, y que mi empleador únicamente podrá recibir las conclusiones relacionadas con mi aptitud para el puesto, sin acceso al detalle de mis respuestas individuales, salvo que la normativa vigente disponga lo contrario.

Entiendo que mi participación es voluntaria dentro del marco de mis obligaciones laborales, y que puedo solicitar aclaraciones antes de la aplicación de las pruebas, así como revocar este consentimiento antes de que inicien.

Habiendo comprendido la información anterior, otorgo mi consentimiento de forma libre e informada para la realización de estas pruebas psicológicas.');

-- ------------------------------------------------------------
-- NOTA SOBRE VERSIONADO DE TEXTOS LEGALES:
-- Si en el futuro se necesita modificar el texto_legal de un tipo
-- de consentimiento (por cambio normativo, por ejemplo), la
-- practica correcta es INSERTAR una fila nueva con el mismo
-- codigo reemplazado via UPDATE incrementando "version", nunca
-- borrar el texto anterior, porque consentimientos_firmados ya
-- guarda su propio snapshot y no depende de que el texto viejo
-- siga existiendo en tipos_consentimiento. Aun asi, se recomienda
-- revisar los formularios cada cierto tiempo, siguiendo el mismo
-- criterio que el Acuerdo Ministerial 5316 establece para
-- establecimientos de salud (revision periodica de formularios).
