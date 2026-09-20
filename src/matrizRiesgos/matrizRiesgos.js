// ============================================================
// SISSO - Matriz de Riesgos, metodologia IPER (Identificacion de
// Peligros y Evaluacion de Riesgos): Riesgo = Probabilidad x
// Consecuencia, escala 5x5 (1 a 25).
//
// Es la metodologia mas reconocida en auditorias del IESS en
// Ecuador (junto con el Triple Criterio PGV, historicamente el
// metodo oficial del MDT para microempresas). La normativa
// ecuatoriana (Resolucion C.D. 513 del IESS, Decreto Ejecutivo 255
// Art. 10) exige identificar peligros y evaluar riesgos en todos
// los puestos de trabajo, documentado y actualizado, pero NO
// impone una metodologia unica -cualquiera validada
// internacionalmente y reproducible es aceptada-. Se eligio IPER
// por ser la mas solicitada en auditorias IESS para empresas
// medianas y la que permite mayor granularidad (5x5 en vez de 3x3).
//
// Escala de probabilidad (1-5): que tan seguido se espera que el
// peligro se materialice en un daño.
// Escala de consecuencia (1-5): que tan severo seria el daño si el
// peligro se materializa.
// Nivel de riesgo = Probabilidad x Consecuencia (1 a 25), clasificado en:
//   1-2:   trivial      (mantener controles existentes)
//   3-4:   tolerable    (monitorear periodicamente)
//   5-9:   moderado     (reducir el riesgo en un plazo determinado)
//   10-16: importante   (no iniciar el trabajo hasta reducir el riesgo)
//   17-25: intolerable  (no iniciar ni continuar el trabajo)
// ============================================================

const TIPOS_PELIGRO = ['fisico', 'mecanico', 'quimico', 'biologico', 'ergonomico', 'psicosocial'];

const ETIQUETAS_PROBABILIDAD = {
  1: 'Raro — solo en circunstancias excepcionales, sin registro previo',
  2: 'Improbable — casos aislados en la industria, no en la organización',
  3: 'Posible — ha ocurrido al menos una vez, o es frecuente en la industria',
  4: 'Probable — ha ocurrido varias veces en la organización',
  5: 'Casi certero — ocurre frecuente o continuamente',
};

const ETIQUETAS_CONSECUENCIA = {
  1: 'Insignificante — lesión sin incapacidad (primeros auxilios)',
  2: 'Menor — incapacidad temporal menor a 3 días',
  3: 'Moderada — incapacidad temporal de 3 a 30 días',
  4: 'Mayor — incapacidad prolongada (>30 días) o enfermedad ocupacional crónica',
  5: 'Catastrófica — muerte o incapacidad permanente total',
};

/**
 * Clasifica el nivel de riesgo segun la matriz IPER 5x5.
 * @param {number} probabilidad - 1 a 5
 * @param {number} consecuencia - 1 a 5
 * @returns {{ nivelRiesgo: number, clasificacion: string }}
 */
function clasificarRiesgo(probabilidad, consecuencia) {
  if (!probabilidad || !consecuencia || probabilidad < 1 || probabilidad > 5 || consecuencia < 1 || consecuencia > 5) {
    return { nivelRiesgo: null, clasificacion: null };
  }
  const nivelRiesgo = probabilidad * consecuencia;
  let clasificacion;
  if (nivelRiesgo <= 2) clasificacion = 'trivial';
  else if (nivelRiesgo <= 4) clasificacion = 'tolerable';
  else if (nivelRiesgo <= 9) clasificacion = 'moderado';
  else if (nivelRiesgo <= 16) clasificacion = 'importante';
  else clasificacion = 'intolerable';
  return { nivelRiesgo, clasificacion };
}

module.exports = {
  TIPOS_PELIGRO, ETIQUETAS_PROBABILIDAD, ETIQUETAS_CONSECUENCIA, clasificarRiesgo,
};
