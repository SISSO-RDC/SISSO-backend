// ============================================================
// CREADO en Auditoria N.18 (G18-04, P1): estado EXPLICITO de la
// cobertura de contenido del catalogo sectorial.
//
// El motor sectorial genera propuestas a partir de las listas de
// catalogo_sectores. Cuando una lista esta vacia (hoy: puestos
// frecuentes en 13 de 14 sectores, EPP en 'otro'), antes el motor
// simplemente no producia nada de ese tipo -- sin decir que era por
// falta de contenido. Este modulo calcula, en cada consulta y a
// partir de las listas reales (nunca un valor guardado que pueda
// quedar desactualizado), que dimensiones tienen contenido y que
// dimensiones NO. No inventa contenido: solo lo declara.
// ============================================================

// columna de catalogo_sectores -> tipo de propuesta del motor
const DIMENSIONES = {
  areas: 'area',
  puestos_frecuentes: 'puesto',
  epp_sugerido: 'epp',
  riesgos: 'riesgo',
  examenes_sugeridos: 'examen',
  herramientas_ergonomicas: 'herramienta_ergonomica',
  kpis_sugeridos: 'kpi',
};

function calcularCoberturaContenido(sector) {
  const dimensiones = Object.entries(DIMENSIONES).map(([columna, tipo]) => {
    const elementos = Array.isArray(sector[columna]) ? sector[columna].length : 0;
    return { tipo, elementos, estado: elementos > 0 ? 'con_contenido' : 'sin_contenido' };
  });
  const sinContenido = dimensiones.filter((d) => d.estado === 'sin_contenido').map((d) => d.tipo);
  return {
    estadoContenido: sector.estado_contenido || 'borrador_sin_validar',
    contenidoValidadoPor: sector.contenido_validado_por || null,
    contenidoValidadoEn: sector.contenido_validado_en || null,
    dimensiones,
    dimensionesSinContenido: sinContenido,
    completo: sinContenido.length === 0,
  };
}

module.exports = { calcularCoberturaContenido, DIMENSIONES };
