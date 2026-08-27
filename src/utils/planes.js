// ============================================================
// CORREGIDO en Auditoria N.09 (hallazgo GRAVE/MODERADO G-N09-08,
// P1/P2): la migracion 042 define limite_trabajadores y
// limite_usuarios por plan, pero ningun controlador los verificaba
// antes de crear el recurso -- un cliente en el plan 'inicial' podia
// superar en la practica el limite comercial sin ningun bloqueo
// tecnico.
//
// verificarLimitePlan(client, organizacionId, recurso, cantidadAAgregar)
// centraliza esa comprobacion. SIEMPRE recibe un `client` de una
// transaccion en curso (withTransaction) y hace
// `SELECT ... FOR UPDATE` sobre la fila de la organizacion antes de
// contar: eso serializa altas concurrentes contra el mismo limite
// -- sin el FOR UPDATE, dos requests simultaneos podrian leer el
// mismo conteo "por debajo del limite" y ambos terminar
// confirmando su INSERT, superando igual el limite (condicion de
// carrera que la propia auditoria senala explicitamente).
// ============================================================
const RECURSOS = {
  trabajadores: { columnaLimite: 'limite_trabajadores', tabla: 'trabajadores', filtroActivo: 'AND activo = true' },
  usuarios: { columnaLimite: 'limite_usuarios', tabla: 'usuarios', filtroActivo: 'AND activo = true' },
};

async function verificarLimitePlan(client, organizacionId, recurso, cantidadAAgregar = 1) {
  const config = RECURSOS[recurso];
  if (!config) {
    throw new Error(`verificarLimitePlan: recurso desconocido "${recurso}".`);
  }

  const orgRes = await client.query(
    `SELECT o.id, p.${config.columnaLimite} AS limite
     FROM organizaciones o
     LEFT JOIN planes p ON p.id = o.plan_id
     WHERE o.id = $1
     FOR UPDATE`,
    [organizacionId]
  );
  if (orgRes.rows.length === 0) {
    throw new Error('Organizacion no encontrada al verificar limite de plan.');
  }

  const limite = orgRes.rows[0].limite;
  // NULL = plan sin limite para ese recurso (ej. corporativo).
  if (limite === null || limite === undefined) return;

  const conteoRes = await client.query(
    `SELECT COUNT(*)::int AS total FROM ${config.tabla} WHERE organizacion_id = $1 ${config.filtroActivo}`,
    [organizacionId]
  );
  const actual = conteoRes.rows[0].total;

  if (actual + cantidadAAgregar > limite) {
    const err = new Error(
      `Limite del plan alcanzado: ya tiene ${actual} de ${recurso === 'trabajadores' ? 'trabajadores' : 'usuarios'} activos `
      + `de un maximo de ${limite} para su plan actual.`
      + (cantidadAAgregar > 1 ? ` Esta operacion intenta agregar ${cantidadAAgregar} mas.` : ' Actualice de plan para agregar mas.')
    );
    err.codigo = 'LIMITE_PLAN_EXCEDIDO';
    err.limite = limite;
    err.actual = actual;
    throw err;
  }
}

module.exports = { verificarLimitePlan };
