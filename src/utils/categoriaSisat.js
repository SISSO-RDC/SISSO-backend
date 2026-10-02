// ============================================================
// Calculo de la categoria SISAT (I a V) de una organizacion y del
// personal minimo de salud ocupacional que le exige el Acuerdo
// Ministerial MSP 00004-2026 (Reglamento SISAT), Tabla 2 (umbrales
// por numero de trabajadores + nivel de riesgo) y Tabla 3 (personal
// minimo por categoria).
//
// Fuente de cada regla (para que quien audite esto despues no tenga
// que re-leer las 30 paginas del reglamento):
//   - art. 16 / Tabla 2: umbrales de categoria I-V.
//   - "Es importante mencionar..." (parrafo final del art. 16):
//     excepcion que fuerza categoria III si hay <50 trabajadores y
//     riesgo ALTO.
//   - art. 25: excepcion total de implementar SISAT si hay <=24
//     trabajadores y riesgo BAJO (solo exige Certificado de Salud en
//     el Trabajo anual).
//   - art. 15 + Tabla 3: personal minimo por categoria.
//   - art. 17.2 y Tabla 3, nota 2: a partir de 300 trabajadores se
//     suma psicologia; a partir de 1000, medico especialista en
//     Medicina del Trabajo (fijo, no vuelve a subir con mas
//     trabajadores).
//
// IMPORTANTE: esta funcion NUNCA adivina el nivel de riesgo de un
// sector. Si `nivelRiesgo` no es 'bajo'/'medio'/'alto', devuelve
// `requiereClasificacionRiesgo: true` y ninguna propuesta de
// personal -- ver migration_097_categoria_sisat.sql para por que
// (catalogo_sectores.nivel_riesgo_sisat queda NULL hasta que un
// superadmin lo confirme sector por sector, nunca se infiere de
// catalogo_sectores.riesgos).
// ============================================================

const NIVELES_VALIDOS = new Set(['bajo', 'medio', 'alto']);

function calcularCategoriaSisat({ numeroTrabajadores, nivelRiesgo }) {
  if (numeroTrabajadores === null || numeroTrabajadores === undefined || numeroTrabajadores < 0) {
    return { categoria: null, exceptuada: false, requiereClasificacionRiesgo: false, personalMinimo: [], motivo: 'Sin número de trabajadores disponible.' };
  }
  if (!NIVELES_VALIDOS.has(nivelRiesgo)) {
    return {
      categoria: null, exceptuada: false, requiereClasificacionRiesgo: true, personalMinimo: [],
      motivo: 'El sector de esta organización aún no tiene clasificado su nivel de riesgo para SISAT (catalogo_sectores.nivel_riesgo_sisat). Un superadmin debe confirmarlo antes de calcular la categoría.',
    };
  }

  // art. 25: excepcion total (micro/pequeña, 1-24 trabajadores, riesgo bajo)
  if (nivelRiesgo === 'bajo' && numeroTrabajadores <= 24) {
    return {
      categoria: null, exceptuada: true, requiereClasificacionRiesgo: false, personalMinimo: [],
      motivo: 'Exceptuada de implementar SISAT (art. 25: 1-24 trabajadores, riesgo bajo). Igual debe obtener el Certificado de Salud en el Trabajo anual.',
    };
  }

  let categoria;
  if (numeroTrabajadores <= 24) categoria = 'I';
  else if (numeroTrabajadores <= 49) categoria = 'II';
  else if (numeroTrabajadores <= 99) categoria = 'III';
  else if (numeroTrabajadores <= 199) categoria = 'IV';
  else categoria = 'V';

  // Excepcion del parrafo final del art. 16: <50 trabajadores + riesgo alto -> categoria III minimo.
  if (nivelRiesgo === 'alto' && numeroTrabajadores < 50 && (categoria === 'I' || categoria === 'II')) {
    categoria = 'III';
  }

  return {
    categoria,
    exceptuada: false,
    requiereClasificacionRiesgo: false,
    personalMinimo: personalMinimoPorCategoria(categoria, numeroTrabajadores),
    motivo: null,
  };
}

function personalMinimoPorCategoria(categoria, numeroTrabajadores) {
  if (categoria === 'I' || categoria === 'II' || categoria === 'III') {
    return [
      { rol: 'Médico Ocupacional (formación 4to nivel en seguridad y salud en el trabajo)', regimen: 'Visitas periódicas — mínimo 40 min/mes por trabajador' },
    ];
  }

  // IV y V: personal permanente, 8h/dia.
  const personal = [
    { rol: 'Médico Ocupacional (formación 4to nivel en seguridad y salud en el trabajo)', regimen: 'Tiempo completo (8h/día)' },
    { rol: 'Profesional de enfermería', regimen: 'Tiempo completo (8h/día)' },
  ];

  if (categoria === 'V') {
    if (numeroTrabajadores >= 300) {
      personal.push({ rol: 'Profesional de psicología (salud mental)', regimen: 'Tiempo completo (8h/día) — obligatorio desde 300 trabajadores' });
    }
    if (numeroTrabajadores >= 1000) {
      personal.push({ rol: 'Médico Especialista en Medicina del Trabajo', regimen: 'Tiempo completo (8h/día) — obligatorio desde 1000 trabajadores, dirige los SISAT' });
    }
  }

  return personal;
}

module.exports = { calcularCategoriaSisat, personalMinimoPorCategoria };
