// ============================================================
// CREADO en Auditoria N.14 (hallazgos GRAVES G14-02 y G14-03, P1):
// el umbral de k-anonimato (UMBRAL_K_ANONIMATO = 5) vivia como una
// constante local duplicable dentro de reportesController.js. El
// dashboard (dashboardController.js) hacia agregaciones por area
// (REBA promedio/maximo) sin aplicar NINGUNA redaccion por grupo
// pequeño, exponiendo en la practica el puntaje ergonomico de un
// unico trabajador identificable cuando un area tenia pocas
// evaluaciones. Se centraliza el umbral y el criterio aqui para que
// cualquier endpoint que agregue por area/grupo lo aplique de forma
// consistente (dashboard, reportes BI, resumen de riesgo
// psicosocial), en vez de que cada controlador reimplemente (o se
// olvide de reimplementar) su propia logica de supresion.
// ============================================================

const UMBRAL_K_ANONIMATO = 5;

/**
 * Devuelve true si un grupo de `n` personas es demasiado pequeño
 * para mostrar un desglose sin riesgo razonable de reidentificar a
 * alguien.
 */
function esGrupoPequeno(n) {
  return typeof n !== 'number' || Number.isNaN(n) || n < UMBRAL_K_ANONIMATO;
}

/**
 * Filtra un arreglo de filas agregadas (ej. una fila por area),
 * suprimiendo (reemplazando por un marcador `redactado:true`) las
 * filas cuyo conteo de personas subyacente sea menor al umbral.
 * `obtenerConteo` extrae ese conteo de cada fila.
 */
function redactarFilasPorGrupoPequeno(filas, obtenerConteo, etiquetaCampo = 'area') {
  return filas.map((fila) => {
    const n = obtenerConteo(fila);
    if (!esGrupoPequeno(n)) return fila;
    return {
      [etiquetaCampo]: fila[etiquetaCampo],
      redactado: true,
      trabajadoresEvaluados: n,
      nota: `Desglose oculto: este grupo tiene ${n} trabajador(es) evaluado(s), menos del mínimo de ${UMBRAL_K_ANONIMATO} requerido para mostrar el detalle sin riesgo de identificar a una persona en particular.`,
    };
  });
}

module.exports = { UMBRAL_K_ANONIMATO, esGrupoPequeno, redactarFilasPorGrupoPequeno };
