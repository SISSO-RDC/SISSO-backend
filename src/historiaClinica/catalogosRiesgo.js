// ============================================================
// SISSO - Catalogos FIJOS del formulario oficial MSP HCU 077
// (Acuerdo Ministerial 0341-2019). Estas listas NO son editables
// por el usuario (a diferencia de catalogo_exposiciones, que es un
// catalogo libre usado por el motor de reglas de contraindicacion
// del modulo de aptitud): son la taxonomia legal exacta que exige
// el instructivo del MSP para la matriz de riesgos laborales, la
// revision de organos y sistemas, y el examen fisico regional.
//
// Se usan tanto para validar en el backend lo que llega del
// frontend, como para que el frontend pueda pedir esta misma
// lista y generar los checkboxes sin tener que mantenerla
// duplicada en dos lugares.
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
// sus propios sub-items segun el formulario oficial)
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
const ORIENTACIONES_SEXUALES = ['lesbiana', 'gay', 'bisexual', 'heterosexual', 'no_sabe_no_responde'];
const IDENTIDADES_GENERO = ['femenino', 'masculino', 'transfemenino', 'transmasculino', 'ninguno', 'no_sabe_no_responde'];
const APTITUDES_MSP = ['apto', 'apto_en_observacion', 'apto_con_limitaciones', 'no_apto'];

module.exports = {
  RIESGOS_FISICOS, RIESGOS_MECANICOS, RIESGOS_QUIMICOS,
  RIESGOS_BIOLOGICOS, RIESGOS_ERGONOMICOS, RIESGOS_PSICOSOCIALES,
  SISTEMAS_REVISION, EXAMEN_FISICO_REGIONES,
  RELIGIONES, LATERALIDADES, ORIENTACIONES_SEXUALES, IDENTIDADES_GENERO, APTITUDES_MSP,
};
