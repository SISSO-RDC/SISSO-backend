// ============================================================
// SISSO - Catalogos de apoyo para la Historia Clinica Ocupacional.
//
// CORREGIDO en Auditoria N.10 (hallazgo CRITICO C10-01, P0): este
// archivo declaraba estas listas como "el formulario oficial MSP
// HCU 077 (Acuerdo Ministerial 0341-2019)", como si ese Acuerdo
// siguiera siendo la norma vigente que hay que replicar
// literalmente. La Corte Constitucional del Ecuador, mediante
// Sentencia 59-19-IN/24 (11 de julio de 2024), declaro la
// inconstitucionalidad del Acuerdo Ministerial 0341-2019 con
// efectos diferidos (un ano desde su notificacion para que el MSP
// emita normativa sustitutiva), y establecio expresamente que --
// mientras tanto -- no debe solicitarse a los trabajadores
// informacion sobre orientacion sexual e identidad de genero.
//
// Mientras no exista la normativa sustitutiva, SISSO no debe tratar
// el Acuerdo 0341-2019 como fuente de verdad obligatoria. Los
// catalogos de riesgos laborales (Bloque F), revision de organos y
// sistemas (Bloque I) y examen fisico regional (Bloque K) se
// conservan porque describen contenido clinico-ocupacional general
// razonable (no son en si mismos el problema senalado por la
// Corte), pero se documentan como criterio operativo de SISSO, no
// como transcripcion obligatoria de un Acuerdo declarado
// inconstitucional.
//
// ORIENTACIONES_SEXUALES / IDENTIDADES_GENERO se retiran de las
// exportaciones activas: el modulo ya NO debe ofrecer estos campos
// en el flujo de captura por defecto (ver historiaClinicaController.js).
// Se dejan comentadas (no eliminadas del archivo) unicamente como
// referencia para quien necesite entender el modelo de datos
// heredado de versiones anteriores a esta correccion.
// ============================================================

// ------------------------------------------------------------
// Bloque F: matriz de riesgos del puesto de trabajo (6 categorias)
// ------------------------------------------------------------
const RIESGOS_FISICOS = [
  'temperaturas_altas', 'temperaturas_bajas', 'radiacion_ionizante', 'radiacion_no_ionizante',
  'ruido', 'vibracion', 'iluminacion', 'ventilacion', 'fluido_electrico', 'otros',
];

const RIESGOS_MECANICOS = [
  'atrapamiento_entre_maquinas', 'atrapamiento_entre_superficies', 'atrapamiento_entre_objetos',
  'caida_de_objetos', 'caidas_al_mismo_nivel', 'caidas_a_diferente_nivel', 'contacto_electrico',
  'proyeccion_de_particulas_fragmentos', 'proyeccion_de_fluidos', 'pinchazos', 'cortes',
  'atropellamientos_por_vehiculos', 'choques_colision_vehicular', 'otros',
];

const RIESGOS_QUIMICOS = [
  'solidos', 'polvos', 'humos', 'liquidos', 'contacto_con_superficies_de_trabajo',
  'vapores', 'aerosoles', 'neblinas', 'gaseosos', 'otros',
];

const RIESGOS_BIOLOGICOS = [
  'virus', 'hongos', 'bacterias', 'parasitos', 'exposicion_a_vectores',
  'exposicion_a_animales_selvaticos', 'otros',
];

const RIESGOS_ERGONOMICOS = [
  'manejo_manual_de_cargas', 'movimientos_repetitivos', 'posturas_forzadas', 'trabajos_con_pvd', 'otros',
];

const RIESGOS_PSICOSOCIALES = [
  'monotonia_del_trabajo', 'sobrecarga_laboral', 'minuciosidad_de_la_tarea', 'alta_responsabilidad',
  'autonomia_en_la_toma_de_decisiones', 'supervision_y_estilos_de_direccion_deficiente',
  'conflicto_de_rol', 'falta_de_claridad_en_las_funciones', 'incorrecta_distribucion_del_trabajo',
  'turnos_rotativos', 'relaciones_interpersonales', 'inestabilidad_laboral', 'otros',
];

// ------------------------------------------------------------
// Bloque I: revision actual de organos y sistemas (10 sistemas)
// ------------------------------------------------------------
const SISTEMAS_REVISION = [
  'piel_anexos', 'organos_sentidos', 'respiratorio', 'cardiovascular', 'digestivo',
  'genito_urinario', 'musculo_esqueletico', 'endocrino', 'hemo_linfatico', 'nervioso',
];

// ------------------------------------------------------------
// Bloque K: examen fisico regional (13 regiones, cada una con
// sus propios sub-items)
// ------------------------------------------------------------
const EXAMEN_FISICO_REGIONES = {
  piel: ['cicatrices', 'tatuajes'],
  ojos: ['parpados', 'conjuntivas', 'pupilas', 'cornea', 'motilidad'],
  oido: ['conducto_auditivo_externo', 'pabellon', 'timpanos'],
  oro_faringe: ['labios', 'lengua', 'faringe', 'amigdalas', 'dentadura'],
  nariz: ['tabique', 'cornetes', 'mucosas', 'senos_paranasales'],
  cuello: ['tiroides_masas'],
  torax: ['mamas', 'pulmones', 'corazon'],
  abdomen: ['visceras', 'pared_abdominal'],
  columna: ['flexibilidad', 'desviacion', 'dolor'],
  pelvis: ['pelvis', 'genitales'],
  extremidades: ['vascular', 'miembros_superiores', 'miembros_inferiores'],
  neurologico: ['fuerza', 'sensibilidad', 'marcha', 'reflejos'],
};

const RELIGIONES = ['catolica', 'evangelica', 'testigos_jehova', 'mormona', 'otra', 'ninguna'];
const LATERALIDADES = ['izquierdo', 'derecho', 'ambidiestro'];
// DEPRECADO (Auditoria N.10, C10-01): NO usar para nueva captura de
// datos. Se conserva solo como referencia del modelo heredado; ver
// comentario de cabecera.
// const ORIENTACIONES_SEXUALES_DEPRECADO = ['lesbiana', 'gay', 'bisexual', 'heterosexual', 'no_sabe_no_responde'];
// const IDENTIDADES_GENERO_DEPRECADO = ['femenino', 'masculino', 'transfemenino', 'transmasculino', 'ninguno', 'no_sabe_no_responde'];
const APTITUDES_MSP = ['apto', 'apto_en_observacion', 'apto_con_limitaciones', 'no_apto'];

// CORREGIDO en Auditoria N.10 (C10-01): catalogo de la nueva capa
// normativa. Mientras el MSP no emita la normativa sustitutiva del
// Acuerdo 0341-2019, SISSO documenta cada evaluacion con estos
// valores en vez de asumir el Acuerdo como marco vigente.
const NORMA_APLICADA_ACTUAL = 'transicion_post_sentencia_59_19_IN_24';
const VERSION_FORMULARIO_ACTUAL = '2.0-sin-orientacion-sexual-ni-identidad-genero';
const BASE_JURIDICA_ACTUAL =
  'Vigilancia de la salud en el trabajo (finalidad de medicina ocupacional). El Acuerdo Ministerial MSP '
  + '0341-2019 fue declarado inconstitucional con efectos diferidos por la Corte Constitucional del Ecuador '
  + '(Sentencia 59-19-IN/24, 11/07/2024); mientras el MSP no emita normativa sustitutiva, no se solicita '
  + 'orientacion sexual ni identidad de genero, conforme a lo ordenado por la Corte.';

module.exports = {
  RIESGOS_FISICOS, RIESGOS_MECANICOS, RIESGOS_QUIMICOS,
  RIESGOS_BIOLOGICOS, RIESGOS_ERGONOMICOS, RIESGOS_PSICOSOCIALES,
  SISTEMAS_REVISION, EXAMEN_FISICO_REGIONES,
  RELIGIONES, LATERALIDADES, APTITUDES_MSP,
  NORMA_APLICADA_ACTUAL, VERSION_FORMULARIO_ACTUAL, BASE_JURIDICA_ACTUAL,
};
