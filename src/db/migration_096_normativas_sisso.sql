-- ============================================================
-- Migracion 096: catalogo normativo de SISSO + integracion del
-- Reglamento SISAT (Acuerdo Ministerial MSP 00004-2026) + panel
-- de normativas + disclaimer de aceptacion.
--
-- CONTEXTO: el usuario provee el texto oficial del Acuerdo
-- Ministerial No. 00004-2026 del Ministerio de Salud Publica del
-- Ecuador ("Reglamento de los Servicios Integrales de Salud en el
-- Trabajo - SISAT"), vigente desde su publicacion en el Registro
-- Oficial (firmado 29-may-2026; el usuario indica que entro en
-- vigencia hace aprox. 3 meses respecto a esta fecha de trabajo).
-- SISAT deroga el Acuerdo Ministerial 1404 (1978, Servicios
-- Medicos de Empresas) y es de cumplimiento OBLIGATORIO para todo
-- empleador publico y privado del Ecuador.
--
-- Se pide: (1) integrar la normativa al SISSO, (2) un panel/boton
-- con TODAS las normativas sobre las que se sustenta SISSO, para
-- que el usuario las lea en PDF, y (3) un disclaimer que se vea
-- una sola vez por usuario y cuya aceptacion quede en base de
-- datos (la Demo lo tenia solo en pantalla, sin persistencia real).
--
-- DISENO:
--   - `normativas_sisso`: catalogo GLOBAL (sin organizacion_id),
--     mismo patron que catalogo_sectores/catalogo_paises_normativos
--     -- es informacion de referencia compartida por TODAS las
--     organizaciones, no un dato de ninguna empresa en particular.
--     Lectura: cualquier usuario autenticado. Escritura: solo
--     superadmin (ver normativasController.js).
--   - Cada fila trae `fuente_cita`: de donde se tomo el dato
--     (numero de acto, fecha, articulo). La mayoria de las normas
--     de fondo de este reglamento (Constitucion, Decision 584,
--     Ley Organica de Salud, Codigo del Trabajo, Decreto Ejecutivo
--     255, etc.) se citan textualmente en la seccion de
--     "Considerandos" del propio Acuerdo 00004-2026 -- ese es el
--     origen de fecha/numero/articulo de cada fila, NO una
--     verificacion independiente contra el Registro Oficial. Se
--     dice asi explicitamente para no repetir el error senalado en
--     N.16/migration_082 (afirmar cobertura legal sin desglose
--     verificable).
--   - `url_pdf` queda NULL en el seed: el superadmin debe cargar el
--     enlace real (Cloudinary o fuente oficial) desde el panel de
--     Normativas. Para SISAT, el usuario ya provee el PDF oficial
--     -- solo falta subirlo y pegar el enlace.
--   - `fecha_publicacion_ro` (Registro Oficial) queda NULL para
--     SISAT: el documento provisto trae la fecha de suscripcion
--     (29-may-2026) y la razon de desmaterializacion (01-jun-2026),
--     pero NO el numero/fecha de Registro Oficial en que se
--     publico -- ese dato es indispensable para calcular con
--     certeza las Disposiciones Transitorias (plazos de 6, 8, 12 y
--     24 meses) y no debe inventarse. El generador de obligaciones
--     legales (ver obligacionesLegalesController.js) exige que el
--     admin lo confirme antes de generar los vencimientos.
--
--   - Disclaimer: se agregan 2 columnas a `usuarios`
--     (disclaimer_normativo_aceptado_en / _version) en vez de una
--     tabla aparte -- es un hecho binario por usuario (acepto/no),
--     no un historial que haya que consultar; misma logica que
--     `requiere_cambio_password`, que ya vive como columna simple
--     en `usuarios`.
--
--   - `obligaciones_legales.plantilla_origen`: para poder generar
--     automaticamente las obligaciones de las Disposiciones
--     Transitorias de SISAT sin duplicar si se corre dos veces
--     (UNIQUE por organizacion+plantilla+titulo).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Catalogo normativo global
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS normativas_sisso (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pais_clave              VARCHAR(50) NOT NULL DEFAULT 'ecuador'
                                REFERENCES catalogo_paises_normativos(clave),

    tipo                    VARCHAR(30) NOT NULL
                                CHECK (tipo IN ('constitucion', 'ley', 'codigo', 'decreto_ejecutivo',
                                                 'acuerdo_ministerial', 'reglamento', 'resolucion',
                                                 'decision_can', 'sentencia', 'otro')),
    numero_acto             VARCHAR(80),
    titulo                  VARCHAR(250) NOT NULL,
    entidad_emisora         VARCHAR(150),

    fecha_expedicion        DATE,
    fecha_publicacion_ro    DATE,          -- Registro Oficial; NULL si aun no se confirma
    estado                  VARCHAR(20) NOT NULL DEFAULT 'vigente'
                                CHECK (estado IN ('vigente', 'derogada', 'pendiente_confirmar_vigencia')),
    deroga_a                VARCHAR(250),  -- texto libre: que norma anterior deja sin efecto
    derogada_por            VARCHAR(250),  -- texto libre: si esta fila fue derogada, por cual

    resumen                 TEXT,
    ambito_sisso            TEXT,          -- que modulos/decisiones de SISSO se apoyan en esta norma
    contenido_estructurado  JSONB,         -- resumen tecnico estructurado (ver seed de SISAT), NUNCA el texto integro
    url_pdf                 VARCHAR(500),  -- lo completa el superadmin desde el panel
    fuente_cita             VARCHAR(300) NOT NULL, -- de donde se tomo esta ficha (transparencia, no es "verificacion legal")

    activa                  BOOLEAN NOT NULL DEFAULT true,
    orden                   INTEGER NOT NULL DEFAULT 0,

    creado_por              UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_normativas_sisso_pais ON normativas_sisso(pais_clave);
CREATE INDEX IF NOT EXISTS idx_normativas_sisso_activa ON normativas_sisso(activa);

COMMENT ON TABLE normativas_sisso IS
  'Catalogo GLOBAL (sin organizacion_id) de las normas sobre las que se sustenta SISSO. '
  'No es una certificacion de cumplimiento legal integral -- fuente_cita indica de donde '
  'se tomo cada ficha. Ver migration_082 (cobertura_detalle) para el mismo criterio aplicado '
  'antes al perfil normativo de pais.';

-- ------------------------------------------------------------
-- 2. Seed: normas citadas en los "Considerandos" del Acuerdo
--    Ministerial MSP 00004-2026 (SISAT), mas el propio SISAT y el
--    acuerdo que deroga. fuente_cita deja explicito que el numero/
--    fecha/articulo de cada fila proviene de esa seccion del
--    documento, no de una verificacion aparte contra el Registro
--    Oficial.
-- ------------------------------------------------------------
INSERT INTO normativas_sisso (
  pais_clave, tipo, numero_acto, titulo, entidad_emisora, fecha_expedicion,
  fecha_publicacion_ro, estado, deroga_a, derogada_por, resumen, ambito_sisso,
  contenido_estructurado, fuente_cita, orden
) VALUES

('ecuador', 'constitucion', NULL, 'Constitución de la República del Ecuador (arts. 3, 32, 33, 154, 226, 326, 361)',
 'Asamblea Nacional', NULL, NULL, 'vigente', NULL, NULL,
 'Base constitucional del derecho a la salud, al trabajo en condiciones dignas y adecuadas, y de la rectoría estatal en salud (art. 361).',
 'Fundamento de todo el bloque de Seguridad y Salud en el Trabajo (SST) de SISSO: vigilancia de la salud, EPP, capacitaciones, matriz de riesgos.',
 NULL,
 'Citada en los Considerandos del Acuerdo Ministerial MSP 00004-2026 (SISAT), artículos 3.1, 32, 33, 154.1, 226 y 326.5-6.', 1),

('ecuador', 'decision_can', 'Decisión 584', 'Instrumento Andino de Seguridad y Salud en el Trabajo',
 'Consejo Andino de Ministros de Relaciones Exteriores (Comunidad Andina)', '2004-11-15', NULL, 'vigente', NULL, NULL,
 'Obliga a los Países Miembros (incluido Ecuador) a mejorar condiciones de SST, exigir exámenes médicos de preempleo/periódicos/retiro sin costo para el trabajador, y garantizar servicios de salud en el trabajo (arts. 4, 11, 14, 15).',
 'Fundamento normativo de EMOs sin costo, matriz de riesgos y servicios de salud en el trabajo (antecedente directo de SISAT).',
 NULL,
 'Citada en los Considerandos de SISAT: publicada en Suplemento del Registro Oficial No. 461 de 15-nov-2004.', 2),

('ecuador', 'resolucion', 'Resolución 957', 'Reglamento del Instrumento Andino de Seguridad y Salud en el Trabajo',
 'Secretaría General de la Comunidad Andina', NULL, '2008-03-12', 'vigente', NULL, NULL,
 'Desarrolla la Decisión 584: los Servicios de Salud en el Trabajo pueden organizarse por empresa, sector público, seguridad social u otro organismo competente.',
 'Base de la posibilidad de prestación externa/tercerizada de los SISAT en SISSO.',
 NULL,
 'Citada en los Considerandos de SISAT: publicada en Edición Especial del Registro Oficial No. 28 de 12-mar-2008.', 3),

('ecuador', 'ley', NULL, 'Ley Orgánica de Salud (arts. 4, 6.16, 117, 118, 120, 130)',
 'Asamblea Nacional / Ministerio de Salud Pública', NULL, NULL, 'vigente', NULL, NULL,
 'Establece al Ministerio de Salud Pública como autoridad sanitaria nacional y rectora en salud y seguridad en el trabajo; obligaciones del empleador de proteger la salud del trabajador; permisos de funcionamiento de establecimientos de salud.',
 'Fundamento de la autoridad de MSP sobre los SISAT y de los permisos de funcionamiento de establecimientos de salud en el trabajo.',
 NULL,
 'Citada en los Considerandos del Acuerdo Ministerial MSP 00004-2026 (SISAT).', 4),

('ecuador', 'codigo', NULL, 'Código del Trabajo (arts. 410, 430)',
 'Función Legislativa', NULL, NULL, 'vigente', NULL, NULL,
 'Obligación del empleador de asegurar condiciones de trabajo sin peligro para la salud/vida; asistencia médica y farmacéutica; servicio médico permanente obligatorio para empleadores con más de 100 trabajadores.',
 'Base histórica del servicio médico de empresa, antecesor conceptual directo de SISAT.',
 NULL,
 'Citado en los Considerandos del Acuerdo Ministerial MSP 00004-2026 (SISAT).', 5),

('ecuador', 'ley', NULL, 'Ley Orgánica de Salud Mental (art. 45)',
 'Asamblea Nacional', NULL, NULL, 'vigente', NULL, NULL,
 'Define qué profesionales cuentan como "profesionales de la salud mental" (psiquiatría, psicología con prácticas preprofesionales).',
 'Define el perfil de "Profesional de psicología" exigido como componente de los SISAT (art. 15.4 de SISAT).',
 NULL,
 'Citada en los Considerandos del Acuerdo Ministerial MSP 00004-2026 (SISAT), art. 45.', 6),

('ecuador', 'ley', NULL, 'Ley Orgánica del Servicio Público y su Reglamento General (arts. 23, 51, 120, 228)',
 'Asamblea Nacional / Ministerio del Trabajo', NULL, NULL, 'vigente', NULL, NULL,
 'Derecho irrenunciable de servidores públicos a un entorno de trabajo seguro; obligación institucional de programas integrales de salud ocupacional.',
 'Extiende el ámbito de aplicación de SISSO/SISAT a entidades del sector público, no solo privado.',
 NULL,
 'Citada en los Considerandos del Acuerdo Ministerial MSP 00004-2026 (SISAT).', 7),

('ecuador', 'decreto_ejecutivo', 'Decreto Ejecutivo 255', 'Reglamento de Seguridad y Salud en el Trabajo',
 'Presidencia de la República', NULL, '2024-05-09', 'vigente', NULL, NULL,
 'Marco regulatorio general de SST en Ecuador. Su Disposición Transitoria Novena ordenó a la autoridad sanitaria nacional expedir, en 5 meses, el reglamento de los Servicios Integrales de Salud en el Trabajo -- ese mandato es el origen directo de SISAT.',
 'Ya es la base de los umbrales de planes/suscripción de SISSO (10/50 trabajadores) y de buena parte del módulo de SSO/matriz de riesgos.',
 NULL,
 'Citado en los Considerandos de SISAT: publicado en Suplemento del Registro Oficial No. 554 de 09-may-2024.', 8),

('ecuador', 'acuerdo_ministerial', 'AM 00004-2026', 'Reglamento de los Servicios Integrales de Salud en el Trabajo (SISAT)',
 'Ministerio de Salud Pública del Ecuador', '2026-05-29', NULL, 'vigente', NULL, NULL,
 'Regula implementación, conformación y funcionamiento de los SISAT en todo lugar/centro de trabajo público y privado del Ecuador. Deroga el AM 1404 (1978). Define 5 categorías de empresa (I a V) según riesgo y número de trabajadores, personal mínimo exigido por categoría, 10 componentes de gestión (orientación y planificación, análisis y recopilación de información, comunicación y capacitación, acciones preventivas, accidentes de trabajo, preparación y respuesta ante emergencias, enfermedades profesionales, cuidado de la salud general, mantenimiento de registros, seguimiento y evaluación), derechos/responsabilidades de trabajador y empleador, confidencialidad de la información de salud, y disposiciones transitorias con plazos de 6, 8, 12 y 24 meses.',
 'Norma rectora nueva de todo el bloque clínico-ocupacional de SISSO: vigilancia de la salud, EMOs, matriz médico-puesto, expedientes de salud, gestor de casos, PMEE, primeros auxilios/emergencias, confidencialidad y reporte de certificados médicos.',
 '{
    "categorias": [
      {"categoria": "I", "empresa": "Micro/pequeña (1 a 24 trabajadores, riesgo medio y alto)"},
      {"categoria": "II", "empresa": "Pequeña (25 a 49 trabajadores, riesgo medio y alto)"},
      {"categoria": "III", "empresa": "Mediana tipo A (50 a 99 trabajadores)"},
      {"categoria": "IV", "empresa": "Mediana tipo B (100 a 199 trabajadores)"},
      {"categoria": "V", "empresa": "Gran empresa (200 trabajadores en adelante)"}
    ],
    "excepcion": "Micro/pequeña empresa de 1 a 24 trabajadores con actividad de BAJO riesgo: exceptuada de implementar SISAT, pero debe obtener Certificado de Salud en el Trabajo anual y realizar evaluaciones de salud ocupacional cuando la exposición lo requiera (art. 25). Excepción: si tiene menos de 50 trabajadores pero actividad de ALTO riesgo, debe cumplir la categoría III completa.",
    "personalMinimo": [
      "Profesional médico con especialidad en Medicina del Trabajo (mín. 3 años de formación) -- dirige los SISAT",
      "Profesional médico con formación de 4to nivel en seguridad y salud en el trabajo (\"Médico Ocupacional\") -- puede asumir la dirección en ausencia del especialista, salvo categorías donde la norma exige obligatoriamente al especialista",
      "Profesional de enfermería (licenciatura en enfermería y/o emergencias médicas)",
      "Profesional de psicología (salud mental, art. 45 LOSM) -- exigido a partir de 300 trabajadores",
      "Monitor o técnico de seguridad e higiene del trabajo -- soporte técnico transversal",
      "A partir de 1000 trabajadores: médico especialista en Medicina del Trabajo obligatorio, sin importar cuántos trabajadores más se agreguen"
    ],
    "tiempoTrabajo": "Categorías I-III: visitas periódicas, mínimo 40 minutos/mes por trabajador, documentadas. Categorías IV-V: personal permanente, 8 horas diarias.",
    "componentes10": [
      "1. Orientación y planificación", "2. Análisis y recopilación de información",
      "3. Comunicación y capacitación en SST", "4. Acciones preventivas para gestión de peligros y riesgos",
      "5. Accidentes de trabajo", "6. Preparación y respuesta ante emergencias",
      "7. Enfermedades profesionales y relacionadas con el trabajo", "8. Cuidado de la salud general",
      "9. Mantenimiento de registros", "10. Seguimiento y evaluación"
    ],
    "disposicionesTransitorias": [
      {"plazo": "1 año desde publicación en Registro Oficial", "obligacion": "Registro y habilitación de profesionales médicos/enfermería/psicología ante la Autoridad Sanitaria Nacional (vía ACESS o equivalente)."},
      {"plazo": "2 años desde publicación en Registro Oficial", "obligacion": "Certificación en soporte vital básico (BLS) para el profesional médico y de enfermería, renovable cada 2 años."},
      {"plazo": "2 años desde publicación en Registro Oficial", "obligacion": "Permiso de funcionamiento de los establecimientos de salud en el trabajo (empleadores y prestadores externalizados)."},
      {"plazo": "6 meses desde publicación en Registro Oficial", "obligacion": "La Autoridad Sanitaria Nacional emite lineamientos de disponibilidad de medicamentos por categoría SISAT (obligación de la autoridad, no de la empresa)."},
      {"plazo": "8 meses desde publicación en Registro Oficial", "obligacion": "La Autoridad Sanitaria Nacional expide normativa de tipología de establecimientos de salud (obligación de la autoridad, no de la empresa)."}
    ],
    "nota": "Este resumen estructurado no reemplaza el texto oficial del reglamento; ver PDF completo en el panel de Normativas."
  }'::jsonb,
 'Documento oficial (Acuerdo Ministerial No. 00004-2026, firmado 29-may-2026, razón de desmaterialización 01-jun-2026) provisto directamente por el usuario. Fecha de publicación en Registro Oficial PENDIENTE DE CONFIRMAR -- necesaria para calcular con certeza los plazos de las disposiciones transitorias (ver obligacionesLegalesController.js).',
 9),

('ecuador', 'acuerdo_ministerial', 'AM 1404', 'Reglamento para el Funcionamiento de los Servicios Médicos de Empresas (DEROGADO)',
 'Ministerio del Trabajo y Bienestar Social', '1978-10-25', '1978-10-25', 'derogada', NULL, 'AM 00004-2026 (SISAT)',
 'Reglamento histórico de servicios médicos de empresa, derogado expresamente por la Disposición Derogatoria Primera de SISAT.',
 'Se mantiene en el catálogo únicamente como referencia histórica/de trazabilidad -- SISSO ya no debe basar ninguna regla activa en este acuerdo.',
 NULL,
 'Citado en la Disposición Derogatoria Primera del Acuerdo Ministerial MSP 00004-2026 (SISAT): publicado en Registro Oficial No. 698 de 25-oct-1978.', 10)

ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- 3. Disclaimer de aceptacion (una sola vez por usuario, con
--    persistencia real en base de datos -- a diferencia de la
--    Demo, que solo lo mostraba en pantalla sin guardar nada).
-- ------------------------------------------------------------
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS disclaimer_normativo_aceptado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disclaimer_normativo_version VARCHAR(20);

COMMENT ON COLUMN usuarios.disclaimer_normativo_version IS
  'Version del texto del disclaimer que el usuario acepto. Si el texto cambia de fondo, '
  'se sube la constante DISCLAIMER_NORMATIVO_VERSION_ACTUAL en authController.js y a todo '
  'usuario con una version anterior (o NULL) se le vuelve a mostrar el disclaimer.';

-- ------------------------------------------------------------
-- 4. Marca de origen en obligaciones_legales, para poder generar
--    automaticamente las obligaciones de las Disposiciones
--    Transitorias de SISAT sin duplicar en corridas repetidas.
-- ------------------------------------------------------------
ALTER TABLE obligaciones_legales
  ADD COLUMN IF NOT EXISTS plantilla_origen VARCHAR(40);

CREATE UNIQUE INDEX IF NOT EXISTS uq_obligaciones_legales_plantilla
  ON obligaciones_legales(organizacion_id, plantilla_origen, titulo)
  WHERE plantilla_origen IS NOT NULL;

COMMENT ON COLUMN obligaciones_legales.plantilla_origen IS
  'NULL si la obligacion fue creada manualmente. Si fue generada por un plantillado automatico '
  '(ej. "SISAT-2026-transitorias"), evita duplicados en corridas repetidas del generador.';

INSERT INTO schema_migrations (version) VALUES ('096_normativas_sisso')
ON CONFLICT (version) DO NOTHING;
