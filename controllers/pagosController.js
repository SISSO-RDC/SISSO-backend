// ============================================================
// Controlador de Pagos (PayPhone) y estado de suscripcion.
//
// IMPORTANTE PARA QUIEN DESPLIEGUE ESTO: este controlador asume
// que ya existe una cuenta comercial de PayPhone
// (https://www.payphone.app) con:
//   - PAYPHONE_TOKEN: token de autenticacion de la API (Bearer)
//   - PAYPHONE_STORE_ID: identificador de la tienda/comercio
// Sin esas variables de entorno configuradas en Render, los
// endpoints de pago devolveran un error claro en vez de fallar en
// silencio. Los nombres de campos y endpoints siguen la API V2 de
// "Boton de Pago" documentada publicamente por PayPhone; no ha
// sido posible probarla en vivo desde este entorno (sin acceso de
// red al dominio de PayPhone), asi que se recomienda una prueba en
// modo sandbox antes de cobrar de verdad.
//
// PATRON DE SEGURIDAD DELIBERADO: el frontend NUNCA puede decirle
// al backend "ya pague, activame" directamente. Cuando el widget de
// PayPhone devuelve un transactionId, el backend llama al endpoint
// de CONFIRMACION de PayPhone (server-to-server, con el token
// secreto) para verificar el pago de forma independiente antes de
// activar cualquier cosa. Confiar en el reporte del cliente sin
// esta verificacion permitiria activar una suscripcion sin pagar.
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

const PAYPHONE_BASE_URL = 'https://pay.payphonetodoesposible.com/api';

function credencialesConfiguradas() {
  return !!(process.env.PAYPHONE_TOKEN && process.env.PAYPHONE_STORE_ID);
}

// ------------------------------------------------------------
// GET /api/organizacion/suscripcion
// El admin de la organizacion consulta su propio estado: plan,
// trial, proxima renovacion. Solo lectura.
// ------------------------------------------------------------
async function obtenerEstadoSuscripcion(req, res) {
  try {
    const resultado = await query(
      `SELECT o.estado_suscripcion, o.fecha_inicio_trial, o.fecha_fin_trial, o.fecha_proxima_renovacion,
              o.suspendida_manualmente, p.codigo AS plan_codigo, p.nombre AS plan_nombre,
              p.precio_mensual_usd, p.precio_por_trabajador_usd, p.limite_trabajadores, p.limite_usuarios
       FROM organizaciones o
       LEFT JOIN planes p ON p.id = o.plan_id
       WHERE o.id = $1`,
      [req.usuario.organizacionId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Organizacion no encontrada.' });
    }
    return res.json({ suscripcion: resultado.rows[0] });
  } catch (err) {
    console.error('Error en obtenerEstadoSuscripcion:', err);
    return res.status(500).json({ error: 'Error interno al obtener la suscripcion.' });
  }
}

// ------------------------------------------------------------
// POST /api/pagos/payphone/iniciar
// Prepara los datos que el frontend necesita para abrir el boton/
// widget de PayPhone (monto en centavos, referencia de transaccion
// propia). No cobra nada todavia -- eso lo hace el widget del lado
// del cliente.
// ------------------------------------------------------------
async function iniciarPago(req, res) {
  if (!credencialesConfiguradas()) {
    return res.status(503).json({ error: 'La pasarela de pago no esta configurada todavia (faltan credenciales de PayPhone).' });
  }

  const orgId = req.usuario.organizacionId;
  try {
    const orgRes = await query(
      `SELECT o.id, p.codigo AS plan_codigo, p.precio_mensual_usd
       FROM organizaciones o LEFT JOIN planes p ON p.id = o.plan_id
       WHERE o.id = $1`,
      [orgId]
    );
    if (orgRes.rows.length === 0 || !orgRes.rows[0].precio_mensual_usd) {
      return res.status(400).json({ error: 'Esta organizacion no tiene un plan con precio fijo asignado. Contacte al proveedor para el plan Corporativo.' });
    }

    const montoUsd = Number(orgRes.rows[0].precio_mensual_usd);
    const clientTransactionId = `SISSO-${orgId.slice(0, 8)}-${Date.now()}`;

    await query(
      `INSERT INTO pagos_suscripcion (organizacion_id, plan_id, monto_usd, estado, pasarela, referencia_pasarela)
       VALUES ($1, (SELECT plan_id FROM organizaciones WHERE id = $1), $2, 'pendiente', 'payphone', $3)`,
      [orgId, montoUsd, clientTransactionId]
    );

    return res.json({
      storeId: process.env.PAYPHONE_STORE_ID,
      clientTransactionId,
      montoUsd,
      montoCentavos: Math.round(montoUsd * 100),
    });
  } catch (err) {
    console.error('Error en iniciarPago (PayPhone):', err);
    return res.status(500).json({ error: 'Error interno al iniciar el pago.' });
  }
}

// ------------------------------------------------------------
// POST /api/pagos/payphone/confirmar
// El frontend llama esto DESPUES de que el widget de PayPhone
// devuelve un transactionId. El backend verifica el pago llamando
// al endpoint de confirmacion de PayPhone antes de activar nada.
// ------------------------------------------------------------
async function confirmarPago(req, res) {
  if (!credencialesConfiguradas()) {
    return res.status(503).json({ error: 'La pasarela de pago no esta configurada todavia.' });
  }

  const { transactionId, clientTransactionId } = req.body;
  if (!transactionId || !clientTransactionId) {
    return res.status(400).json({ error: 'transactionId y clientTransactionId son obligatorios.' });
  }

  const orgId = req.usuario.organizacionId;

  try {
    const pagoPendienteRes = await query(
      `SELECT id, monto_usd FROM pagos_suscripcion
       WHERE organizacion_id = $1 AND referencia_pasarela = $2 AND estado = 'pendiente'`,
      [orgId, clientTransactionId]
    );
    if (pagoPendienteRes.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontro un pago pendiente con esa referencia para esta organizacion.' });
    }

    // Verificacion server-to-server contra PayPhone. Ver nota de
    // seguridad al inicio del archivo: esto es lo que impide que
    // alguien active su cuenta sin pagar de verdad.
    const respuestaPayphone = await fetch(`${PAYPHONE_BASE_URL}/button/V2/Confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.PAYPHONE_TOKEN}`,
      },
      body: JSON.stringify({ id: transactionId, clientTxId: clientTransactionId }),
    });

    if (!respuestaPayphone.ok) {
      await query(`UPDATE pagos_suscripcion SET estado = 'rechazado' WHERE id = $1`, [pagoPendienteRes.rows[0].id]);
      return res.status(402).json({ error: 'PayPhone no pudo confirmar el pago.' });
    }

    const datosPayphone = await respuestaPayphone.json();
    const aprobado = datosPayphone.transactionStatus === 'Approved';

    if (!aprobado) {
      await query(`UPDATE pagos_suscripcion SET estado = 'rechazado' WHERE id = $1`, [pagoPendienteRes.rows[0].id]);
      return res.status(402).json({ error: `El pago no fue aprobado (estado: ${datosPayphone.transactionStatus || 'desconocido'}).` });
    }

    const hoy = new Date();
    const proximaRenovacion = new Date();
    proximaRenovacion.setDate(proximaRenovacion.getDate() + 30);

    await query(
      `UPDATE pagos_suscripcion SET
         estado = 'aprobado', referencia_pasarela = $1, metodo_pago = $2,
         periodo_desde = $3, periodo_hasta = $4
       WHERE id = $5`,
      [
        String(transactionId), datosPayphone.cardType || datosPayphone.paymentMethod || null,
        hoy.toISOString().slice(0, 10), proximaRenovacion.toISOString().slice(0, 10), pagoPendienteRes.rows[0].id,
      ]
    );

    // Reactiva la organizacion SOLO si no esta suspendida a mano
    // por el superadmin -- una suspension manual siempre gana sobre
    // un pago (ver comentario en migration_042).
    await query(
      `UPDATE organizaciones SET
         estado_suscripcion = 'activa',
         fecha_proxima_renovacion = $1,
         activa = CASE WHEN suspendida_manualmente THEN activa ELSE true END
       WHERE id = $2`,
      [proximaRenovacion.toISOString().slice(0, 10), orgId]
    );

    await registrarAuditoria({
      organizacionId: orgId, usuarioId: req.usuario.id, accion: 'pago_suscripcion_aprobado',
      entidad: 'pagos_suscripcion', entidadId: pagoPendienteRes.rows[0].id,
      detalle: { transactionId, montoUsd: pagoPendienteRes.rows[0].monto_usd }, req,
    });

    return res.json({ mensaje: 'Pago confirmado. Suscripción activada.', proximaRenovacion: proximaRenovacion.toISOString().slice(0, 10) });
  } catch (err) {
    console.error('Error en confirmarPago (PayPhone):', err);
    return res.status(500).json({ error: 'Error interno al confirmar el pago.' });
  }
}

module.exports = { obtenerEstadoSuscripcion, iniciarPago, confirmarPago };
