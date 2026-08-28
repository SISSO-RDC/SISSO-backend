-- ============================================================
-- Migracion 051: catalogo de finalidades de tratamiento y base
-- juridica (gobernanza de datos).
--
-- CORRIGE PARCIALMENTE el hallazgo CRITICO C10-02 de la Auditoria
-- Integral SISSO N.10: no existia un catalogo centralizado de
-- "para que" y "bajo que base juridica" se trata cada categoria de
-- datos personales/sensibles que SISSO recolecta (historia clinica,
-- accidentes, EPP, capacitaciones, ausentismo, evaluaciones
-- ergonomicas, riesgo psicosocial, matriz de riesgos). Cada modulo
-- se construyo con su propia justificacion implicita, sin un lugar
-- unico donde documentarla y consultarla.
--
-- ALCANCE DE ESTA MIGRACION (deliberadamente acotado): crea el
-- catalogo y lo enlaza a evaluaciones_ocupacionales (que ya recibio
-- base_juridica en texto libre via migration_050) y a
-- tipos_consentimiento (que ya tenia texto_legal/version pero no un
-- codigo de finalidad canonico). Enlazar el catalogo a CADA tabla
-- clinica/operativa de SISSO (accidentes, EPP, capacitaciones,
-- ausentismo, ergonomia, riesgo psicosocial, matriz de riesgos,
-- vigilancia de la salud) es un trabajo mas grande -- se deja como
-- siguiente iniciativa, ya con el catalogo y el patron establecidos
-- aqui para que extenderlo a cada tabla sea mecanico (agregar
-- finalidad_tratamiento_codigo REFERENCES finalidades_tratamiento).
-- ============================================================

CREATE TABLE IF NOT EXISTS finalidades_tratamiento (
    codigo                    VARCHAR(60) PRIMARY KEY,
    nombre                    VARCHAR(150) NOT NULL,
    descripcion               TEXT NOT NULL,
    base_juridica             TEXT NOT NULL,
    categoria_datos           VARCHAR(30) NOT NULL CHECK (categoria_datos IN ('sensible', 'personal', 'agregado_anonimizado')),
    plazo_conservacion_meses  INTEGER, -- NULL = indefinido mientras dure la relacion laboral + plazo legal aplicable (a definir con asesoria juridica)
    activo                    BOOLEAN NOT NULL DEFAULT true,
    creado_en                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE finalidades_tratamiento IS
  'Catalogo central de finalidades y base juridica de tratamiento de datos personales/sensibles en SISSO. '
  'Ver migration_051 / hallazgo C10-02. Los plazos de conservacion son un punto de partida operativo, '
  'no una determinacion legal definitiva -- requieren validacion con asesoria juridica (ver hallazgo C10-02, '
  'punto 7 de la correccion recomendada).';

INSERT INTO finalidades_tratamiento (codigo, nombre, descripcion, base_juridica, categoria_datos, plazo_conservacion_meses) VALUES
  ('vigilancia_salud_ocupacional',
   'Vigilancia de la salud en el trabajo',
   'Historia clinica ocupacional, examenes complementarios (audiometria, espirometria, visiometria), '
   || 'aptitud medica, enfermedad profesional, restricciones medicas.',
   'Medicina del trabajo / vigilancia de la salud ocupacional. En transicion normativa tras la Sentencia '
   || '59-19-IN/24 de la Corte Constitucional del Ecuador (Acuerdo Ministerial MSP 0341-2019 declarado '
   || 'inconstitucional con efectos diferidos); no se solicita orientacion sexual ni identidad de genero.',
   'sensible', NULL),
  ('gestion_accidentes_incidentes',
   'Gestion de accidentes, incidentes y casi accidentes',
   'Investigacion de accidentes/incidentes laborales, acciones correctivas y su verificacion.',
   'Obligacion legal de prevencion de riesgos laborales y notificacion de accidentes (Decreto Ejecutivo 255 '
   || 'y normativa de seguridad y salud en el trabajo aplicable).',
   'sensible', NULL),
  ('gestion_capa',
   'Acciones correctivas y preventivas (CAPA)',
   'Seguimiento de hallazgos de auditorias/inspecciones y su remediacion.',
   'Interes legitimo del empleador en la mejora continua del sistema de gestion de SST.',
   'personal', 84),
  ('gestion_epp',
   'Entrega y control de equipo de proteccion personal',
   'Registro de entregas de EPP, firmas de recepcion, vencimientos.',
   'Obligacion legal de dotacion de EPP (normativa de seguridad y salud en el trabajo).',
   'personal', 84),
  ('gestion_capacitaciones',
   'Capacitaciones en seguridad y salud ocupacional',
   'Registro de asistencia y aprobacion de capacitaciones obligatorias.',
   'Obligacion legal de capacitacion en SST.',
   'personal', 84),
  ('gestion_ausentismo',
   'Gestion de ausentismo laboral',
   'Registro de ausencias, tipo, dias, y certificados medicos asociados.',
   'Gestion de nomina/RRHH y obligaciones con el IESS; el diagnostico especifico (CIE-10) es dato sensible '
   || 'reservado al personal medico.',
   'sensible', NULL),
  ('evaluaciones_ergonomicas',
   'Evaluaciones ergonomicas (REBA, RULA, NIOSH, cuestionario Nordico)',
   'Evaluacion de riesgo ergonomico por puesto de trabajo y, en el caso del cuestionario Nordico, sintomas '
   || 'musculoesqueleticos reportados por el trabajador.',
   'Obligacion legal de identificacion y evaluacion de riesgos ergonomicos.',
   'sensible', NULL),
  ('gestion_riesgo_psicosocial',
   'Evaluacion de riesgo psicosocial',
   'Cuestionarios y resultados de evaluacion de factores de riesgo psicosocial.',
   'Obligacion legal de identificacion y evaluacion de riesgo psicosocial laboral.',
   'sensible', NULL),
  ('matriz_riesgos_puesto',
   'Matriz de riesgos por puesto de trabajo',
   'Identificacion de peligros y clasificacion de riesgo por puesto de trabajo (no asociado a un trabajador '
   || 'individual, sino al puesto).',
   'Obligacion legal de identificacion de peligros y evaluacion de riesgos laborales.',
   'agregado_anonimizado', NULL),
  ('indicadores_reportes_agregados',
   'Indicadores SSO y reportes BI',
   'Cifras agregadas de gestion de SST para toma de decisiones gerenciales, con supresion de grupos '
   || 'pequenos (k-anonimato) para evitar reidentificacion.',
   'Interes legitimo del empleador en la gestion del sistema de SST.',
   'agregado_anonimizado', NULL)
ON CONFLICT (codigo) DO NOTHING;

-- ------------------------------------------------------------
-- Enlazar el catalogo a las dos tablas que ya tenian un campo de
-- base juridica en texto libre, para que ese texto quede tambien
-- referenciado a un codigo canonico consultable.
-- ------------------------------------------------------------
ALTER TABLE evaluaciones_ocupacionales
  ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo);

UPDATE evaluaciones_ocupacionales
SET finalidad_tratamiento_codigo = 'vigilancia_salud_ocupacional'
WHERE finalidad_tratamiento_codigo IS NULL;

ALTER TABLE tipos_consentimiento
  ADD COLUMN IF NOT EXISTS finalidad_tratamiento_codigo VARCHAR(60) REFERENCES finalidades_tratamiento(codigo);

INSERT INTO schema_migrations (version) VALUES ('051_gobernanza_finalidades_tratamiento')
ON CONFLICT (version) DO NOTHING;
