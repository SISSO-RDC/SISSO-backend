// ============================================================
// CREADO en Auditoria N.19 (hallazgos GRAVES G19-03 y G19-04).
//
// Los controladores de consulta usaban `SELECT tabla.*`: cualquier
// columna nueva (incluida una sensible) salia automaticamente en la
// respuesta HTTP sin que nadie decidiera exponerla. Ahora cada tabla
// cuyo detalle se devuelve con todas sus columnas tiene una LISTA
// EXPLICITA (allowlist) aqui:
//
//   expuestas    -> columnas que la API puede devolver.
//   noExpuestas  -> columnas que se decidio, por escrito, NO devolver.
//
// La prueba tests/allowlist_columnas.test.js compara esta lista con el
// esquema real: si una migracion agrega una columna y nadie la
// clasifica en `expuestas` o `noExpuestas`, la prueba FALLA. Asi la
// exposicion de un dato nuevo es siempre una decision consciente, no un
// efecto secundario de `.*`.
//
// Esta version PRESERVA la salida actual de cada endpoint (misma
// informacion que antes), salvo que las 5 columnas bloqueadas por la
// Sentencia 59-19-IN/24 ya ni siquiera se leen de la base de datos.
// Reducir aun mas lo expuesto por rol (DTO por clasificacion D0-D4)
// requiere la clasificacion formal de datos, pendiente (G19-03).
// ============================================================

const COLUMNAS = {
  accidentes_acciones: {
    expuestas: [
      'id', 'accidente_id', 'organizacion_id', 'descripcion', 'responsable_id', 'fecha_limite', 'estado',
      'fecha_cierre', 'verificado_por', 'nota_verificacion', 'creado_por', 'creado_en', 'actualizado_en'
    ],
    noExpuestas: [],
  },
  accidentes_incidentes: {
    expuestas: [
      'id', 'organizacion_id', 'tipo', 'trabajador_id', 'puesto_trabajo_id', 'fecha_ocurrencia',
      'hora_ocurrencia', 'lugar', 'descripcion', 'gravedad', 'tipo_lesion', 'dias_perdidos',
      'requiere_atencion_medica', 'estado', 'reportado_por', 'creado_en', 'actualizado_en',
      'finalidad_tratamiento_codigo'
    ],
    noExpuestas: [],
  },
  ausencias: {
    expuestas: [
      'id', 'organizacion_id', 'trabajador_id', 'tipo', 'subsidiado_iess', 'fecha_inicio', 'fecha_fin',
      'dias_calendario', 'diagnostico_cie10', 'numero_certificado', 'certificado_url',
      'certificado_public_id', 'observaciones', 'origen', 'registrado_por', 'creado_en', 'actualizado_en',
      'finalidad_tratamiento_codigo'
    ],
    noExpuestas: [],
  },
  capa_acciones: {
    expuestas: [
      'id', 'organizacion_id', 'origen_tipo', 'origen_id', 'origen_descripcion', 'tipo', 'hallazgo',
      'descripcion_accion', 'responsable_id', 'fecha_limite', 'estado', 'fecha_implementacion',
      'verificado_por', 'fecha_verificacion', 'nota_verificacion', 'fecha_revision_eficacia',
      'evaluado_por', 'fecha_evaluacion_eficacia', 'nota_eficacia', 'creado_por', 'creado_en',
      'actualizado_en', 'finalidad_tratamiento_codigo'
    ],
    noExpuestas: [],
  },
  cuestionarios_nordicos: {
    expuestas: [
      'id', 'organizacion_id', 'trabajador_id', 'aplicado_por', 'fecha_aplicacion', 'regiones',
      'regiones_con_molestia_12_meses', 'regiones_con_molestia_7_dias', 'regiones_prioritarias',
      'requiere_atencion_prioritaria', 'observaciones_generales', 'creado_en',
      'finalidad_tratamiento_codigo'
    ],
    noExpuestas: [],
  },
  enfermedad_profesional: {
    expuestas: [
      'id', 'organizacion_id', 'trabajador_id', 'estado', 'fecha_sospecha', 'diagnostico_cie10',
      'diagnostico_presuntivo', 'evolucion_clinica', 'fecha_confirmacion', 'fecha_cierre', 'conclusion',
      'exposicion_relacionada', 'puesto_trabajo_id', 'medico_responsable_id', 'creado_en',
      'actualizado_en', 'finalidad_tratamiento_codigo'
    ],
    noExpuestas: [],
  },
  evaluaciones_niosh: {
    expuestas: [
      'id', 'organizacion_id', 'trabajador_id', 'evaluado_por', 'fecha_evaluacion', 'nombre_tarea',
      'horizontal_cm', 'vertical_cm', 'distancia_vertical_cm', 'angulo_asimetria', 'frecuencia_por_min',
      'duracion', 'calidad_agarre', 'peso_carga_kg', 'hm', 'vm', 'dm', 'am', 'fm', 'cm', 'rwl_kg', 'li',
      'clasificacion', 'observaciones', 'creado_en', 'finalidad_tratamiento_codigo'
    ],
    noExpuestas: [],
  },
  evaluaciones_ocupacionales: {
    expuestas: [
      'id', 'organizacion_id', 'trabajador_id', 'medico_id', 'tipo_evaluacion', 'fecha_atencion',
      'hora_atencion', 'numero_archivo', 'grupo_sanguineo', 'lateralidad', 'discapacidad_tiene', 'discapacidad_tipo', 'discapacidad_porcentaje',
      'fecha_ingreso_trabajo', 'puesto_trabajo_ciuo', 'area_trabajo', 'actividades_relevantes',
      'motivo_consulta', 'antecedentes_clinicos_quirurgicos', 'estilo_vida',
      'antecedentes_laborales_previos', 'accidentes_trabajo_previos',
      'enfermedades_profesionales_previas', 'antecedentes_familiares', 'factores_riesgo_actual',
      'actividades_extra_laborales', 'enfermedad_actual', 'revision_organos_sistemas',
      'presion_arterial_sistolica', 'presion_arterial_diastolica', 'temperatura_c', 'frecuencia_cardiaca',
      'saturacion_oxigeno', 'frecuencia_respiratoria', 'peso_kg', 'talla_cm', 'imc',
      'perimetro_abdominal_cm', 'examen_fisico_regional', 'resultados_examenes', 'diagnosticos',
      'aptitud_msp', 'aptitud_observacion', 'aptitud_limitacion', 'recomendaciones_tratamiento',
      'codigo_profesional_salud', 'firma_imagen_url', 'firma_imagen_public_id', 'creado_en',
      'actualizado_en', 'fecha_inicio_labores', 'fecha_salida', 'tiempo_permanencia_meses',
      'factores_riesgo_texto_libre', 'retiro_se_realizo_evaluacion', 'retiro_observaciones', 'incidentes',
      'tiempo_puesto_actual_meses', 'fecha_ultimo_dia_laboral', 'fecha_reingreso', 'total_dias_ausencia',
      'causa_salida', 'aptitud_reubicacion', 'norma_aplicada', 'version_formulario', 'fecha_vigencia',
      'base_juridica', 'campos_sensibles_bloqueados_desde', 'finalidad_tratamiento_codigo'
    ],
    noExpuestas: ['religion', 'antecedentes_ginecobstetricos', 'antecedentes_ginecologicos_examenes', 'antecedentes_reproductivos_masculinos', 'habitos_toxicos', 'orientacion_sexual', 'identidad_genero'],
  },
  evaluaciones_psicosociales: {
    expuestas: [
      'id', 'organizacion_id', 'tipo_evaluacion', 'trabajador_id', 'puesto_trabajo_id', 'area', 'metodo',
      'fecha_evaluacion', 'puntaje_global', 'nivel_riesgo', 'estado', 'evaluador_id',
      'evaluacion_anterior_id', 'capa_id', 'derivado_atencion_medica', 'observaciones_generales',
      'creado_por', 'creado_en', 'actualizado_en', 'finalidad_tratamiento_codigo'
    ],
    noExpuestas: [],
  },
  examenes_audiometria: {
    expuestas: [
      'id', 'organizacion_id', 'trabajador_id', 'medico_id', 'fecha_examen', 'es_basal', 'ca_od_500',
      'ca_od_1000', 'ca_od_2000', 'ca_od_3000', 'ca_od_4000', 'ca_od_6000', 'ca_od_8000', 'ca_oi_500',
      'ca_oi_1000', 'ca_oi_2000', 'ca_oi_3000', 'ca_oi_4000', 'ca_oi_6000', 'ca_oi_8000', 'co_od_500',
      'co_od_1000', 'co_od_2000', 'co_od_3000', 'co_od_4000', 'co_oi_500', 'co_oi_1000', 'co_oi_2000',
      'co_oi_3000', 'co_oi_4000', 'pta_od', 'pta_oi', 'sts_od', 'sts_oi', 'sts_od_positivo',
      'sts_oi_positivo', 'id_audiometria_basal', 'patron_od', 'patron_oi', 'observaciones', 'creado_en',
      'actualizado_en', 'baseline_vigente', 'baseline_revisada_en', 'baseline_revision_motivo',
      'baseline_revisada_por', 'finalidad_tratamiento_codigo', 'equipo_marca', 'equipo_modelo',
      'equipo_numero_serie', 'equipo_fecha_calibracion', 'equipo_resultado_verificacion_biologica',
      'ambiente_cabina_sonoamortiguada', 'ambiente_nivel_ruido_fondo_dba', 'ambiente_cumple_ansi_s3_1',
      'operador_id', 'es_retest_confirmatorio', 'examen_original_retest_id', 'sts_confirmado_en_retest',
      'decision_medica_documentada'
    ],
    noExpuestas: [],
  },
  examenes_espirometria: {
    expuestas: [
      'id', 'organizacion_id', 'trabajador_id', 'medico_id', 'fecha_examen', 'sexo_usado',
      'edad_anios_usada', 'talla_cm_usada', 'peso_kg_usado', 'fvc_pre', 'fev1_pre', 'pef_pre',
      'fef2575_pre', 'fvc_post', 'fev1_post', 'pef_post', 'fef2575_post', 'minutos_post_broncodilatador',
      'fvc_predicho', 'fev1_predicho', 'pef_predicho', 'fef2575_predicho', 'fev1_fvc_predicho', 'fvc_lln',
      'fev1_lln', 'fvc_pct_predicho', 'fev1_pct_predicho', 'pef_pct_predicho', 'fef2575_pct_predicho',
      'fev1_fvc_medido', 'patron', 'reversibilidad_positiva', 'cambio_fev1_pct', 'cambio_fev1_ml',
      'cambio_fvc_pct', 'cambio_fvc_ml', 'observaciones', 'creado_en', 'actualizado_en', 'fev1_fvc_lln',
      'cambio_fev1_pct_predicho', 'cambio_fvc_pct_predicho', 'calidad_numero_maniobras',
      'calidad_repetibilidad_fvc_ml', 'calidad_repetibilidad_fev1_ml', 'calidad_grado', 'interpretable',
      'criterio_interpretativo', 'finalidad_tratamiento_codigo', 'metadatos_referencia',
      'calidad_numero_maniobras_aceptables', 'calidad_evaluacion_simplificada',
      'calidad_aceptabilidad_maniobras', 'calidad_equipo', 'reversibilidad_protocolo',
      'reversibilidad_protocolo_valido', 'reversibilidad_motivo_no_evaluable'
    ],
    noExpuestas: [],
  },
  examenes_visiometria: {
    expuestas: [
      'id', 'organizacion_id', 'trabajador_id', 'medico_id', 'fecha_examen', 'od_lejana_sin_correccion',
      'od_lejana_con_correccion', 'oi_lejana_sin_correccion', 'oi_lejana_con_correccion',
      'ao_lejana_sin_correccion', 'ao_lejana_con_correccion', 'od_cercana_sin_correccion',
      'od_cercana_con_correccion', 'oi_cercana_sin_correccion', 'oi_cercana_con_correccion',
      'ao_cercana_sin_correccion', 'ao_cercana_con_correccion', 'usa_correccion_optica',
      'tipo_correccion', 'ishihara_laminas_correctas', 'ishihara_laminas_totales',
      'percepcion_profundidad', 'balance_muscular', 'clasificacion_od', 'clasificacion_oi',
      'clasificacion_ao', 'clasificacion_colores', 'vision_monocular_severa', 'aptitud_sugerida',
      'aptitud_definida', 'observaciones', 'creado_en', 'finalidad_tratamiento_codigo'
    ],
    noExpuestas: [],
  },
  incidentes_seguridad_datos: {
    expuestas: [
      'id', 'organizacion_id', 'descripcion', 'gravedad', 'categorias_datos_afectados',
      'cantidad_titulares_afectados_estimada', 'estado', 'responsable_id', 'fecha_deteccion',
      'fecha_contencion', 'fecha_resolucion', 'medidas_tomadas', 'notificado_autoridad',
      'fecha_notificacion_autoridad', 'notificado_titulares', 'creado_por', 'creado_en'
    ],
    noExpuestas: [],
  },
  inspecciones: {
    expuestas: [
      'id', 'organizacion_id', 'tipo', 'area', 'puesto_trabajo_id', 'fecha_programada', 'fecha_ejecucion',
      'inspector_id', 'estado', 'observaciones_generales', 'creado_por', 'creado_en', 'actualizado_en',
      'finalidad_tratamiento_codigo'
    ],
    noExpuestas: [],
  },
  investigaciones_accidentes: {
    expuestas: [
      'id', 'accidente_id', 'organizacion_id', 'metodo_investigacion', 'causas_inmediatas',
      'causas_basicas', 'factores_contribuyentes', 'investigador_id', 'fecha_investigacion', 'creado_en'
    ],
    noExpuestas: [],
  },
  matriz_riesgos: {
    expuestas: [
      'id', 'organizacion_id', 'puesto_trabajo_id', 'puesto_texto_libre', 'proceso', 'actividad',
      'tipo_peligro', 'peligro_especifico', 'riesgo_potencial', 'trabajadores_expuestos', 'probabilidad',
      'consecuencia', 'nivel_riesgo', 'clasificacion', 'controles_existentes', 'controles_adicionales',
      'responsable_control', 'plazo_control', 'activo', 'creado_por', 'creado_en', 'actualizado_en',
      'finalidad_tratamiento_codigo'
    ],
    noExpuestas: [],
  },
  mediciones_higiene_industrial: {
    expuestas: [
      'id', 'organizacion_id', 'tipo_medicion', 'puesto_trabajo_id', 'area', 'parametro', 'valor_medido',
      'unidad', 'limite_permisible', 'cumple', 'equipo_utilizado', 'metodo_referencia', 'fecha_medicion',
      'responsable_id', 'capa_id', 'observaciones', 'creado_en', 'finalidad_tratamiento_codigo',
      'catalogo_limite_id', 'limite_norma_snapshot', 'limite_version_snapshot',
      'limite_jurisdiccion_snapshot', 'limite_verificable_en_catalogo'
    ],
    noExpuestas: [],
  },
  puestos_trabajo: {
    expuestas: [
      'id', 'organizacion_id', 'nombre_puesto', 'area', 'codigo_ciuo', 'descripcion_actividades',
      'numero_trabajadores_estimado', 'factores_riesgo', 'epp_requerido', 'medidas_preventivas', 'activo',
      'creado_por', 'creado_en', 'actualizado_en', 'matriz_exposicion_confirmada_sin_riesgo',
      'matriz_exposicion_confirmada_por', 'matriz_exposicion_confirmada_en',
      'matriz_exposicion_confirmada_motivo'
    ],
    noExpuestas: [],
  },
  sesiones_evaluacion_ergonomica: {
    expuestas: [
      'id', 'organizacion_id', 'trabajador_id', 'evaluador_id', 'puesto_evaluado', 'tarea_observada',
      'fecha_evaluacion', 'notas_generales', 'creado_en', 'actualizado_en', 'finalidad_tratamiento_codigo'
    ],
    noExpuestas: [],
  },
  sesiones_evaluacion_rula: {
    expuestas: [
      'id', 'organizacion_id', 'trabajador_id', 'evaluador_id', 'puesto_evaluado', 'tarea_observada',
      'fecha_evaluacion', 'notas_generales', 'creado_en', 'actualizado_en', 'finalidad_tratamiento_codigo'
    ],
    noExpuestas: [],
  },
  documentos_control: {
    expuestas: [
      'id', 'organizacion_id', 'numero_documento', 'titulo', 'categoria', 'version', 'reemplaza_a',
      'estado', 'propietario_id', 'aprobador_id', 'fecha_aprobacion', 'fecha_proxima_revision',
      'requiere_acuse', 'public_id', 'creado_por', 'creado_en'
    ],
    noExpuestas: [],
  },
  documentos_control_acuses: {
    expuestas: ['id', 'documento_id', 'organizacion_id', 'usuario_id', 'leido_en'],
    noExpuestas: [],
  },
  obligaciones_legales: {
    expuestas: [
      'id', 'organizacion_id', 'titulo', 'descripcion', 'jurisdiccion', 'frecuencia', 'responsable_id',
      'proxima_fecha_vencimiento', 'estado_cumplimiento', 'ultimo_cumplimiento_en', 'ultimo_cumplimiento_nota',
      'documento_evidencia_id', 'estado_verificacion', 'fuente_norma', 'articulo_referencia',
      'fecha_validacion', 'verificado_por', 'verificado_en', 'capa_id', 'creado_por', 'creado_en',
      'plantilla_origen'
    ],
    noExpuestas: [],
  },
  auditorias: {
    expuestas: [
      'id', 'organizacion_id', 'tipo', 'norma_referencia', 'alcance', 'auditor_nombre',
      'fecha_programada', 'fecha_ejecucion', 'estado', 'creado_por', 'creado_en'
    ],
    noExpuestas: [],
  },
  auditoria_hallazgos: {
    expuestas: ['id', 'auditoria_id', 'organizacion_id', 'tipo', 'descripcion', 'capa_id', 'creado_en'],
    noExpuestas: [],
  },
  reportes_peligro: {
    expuestas: [
      'id', 'organizacion_id', 'clasificacion', 'descripcion', 'area', 'ubicacion_texto',
      'reportante_nombre', 'anonimo', 'estado', 'nota_triage', 'revisado_por', 'revisado_en',
      'capa_id', 'creado_en'
    ],
    noExpuestas: [],
  },
  reportes_peligro_evidencias: {
    expuestas: [
      'id', 'reporte_id', 'organizacion_id', 'tipo_archivo', 'public_id', 'creado_en'
    ],
    noExpuestas: [],
  },
  solicitudes_titular: {
    expuestas: [
      'id', 'organizacion_id', 'trabajador_id', 'tipo_solicitud', 'descripcion', 'solicitante_nombre',
      'solicitante_documento', 'identidad_verificada', 'metodo_verificacion', 'estado', 'responsable_id',
      'fecha_recibida', 'fecha_limite_respuesta', 'fecha_respuesta', 'respuesta_texto', 'evidencia_url',
      'evidencia_public_id', 'creado_por', 'creado_en', 'actualizado_en', 'origen'
    ],
    noExpuestas: [],
  },
};

/**
 * Devuelve "alias.col1, alias.col2, ..." para interpolar en un SELECT en
 * lugar de "alias.*".
 * @param {string} tabla  nombre de la tabla (clave de COLUMNAS)
 * @param {string} alias  alias usado en la consulta
 * @param {{excluir?: string[]}} [opciones] columnas adicionales a omitir
 */
function columnas(tabla, alias, opciones = {}) {
  const def = COLUMNAS[tabla];
  if (!def) throw new Error(`columnas(): tabla sin allowlist: ${tabla}`);
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`columnas(): alias invalido: ${alias}`);
  const excluir = new Set(opciones.excluir || []);
  return def.expuestas.filter((c) => !excluir.has(c)).map((c) => `${alias}.${c}`).join(', ');
}

module.exports = { COLUMNAS, columnas };
