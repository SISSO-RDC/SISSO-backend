// ============================================================
// CREADO a pedido de la persona usuaria: envio de correo para el
// boton de "Sugerencias y correcciones" de la pestana "Acerca de".
//
// Se usa Gmail SMTP con una contrasena de aplicacion (no la
// contrasena real de la cuenta) porque es una via de envio real
// y de costo cero -- no requiere dar de alta ninguna cuenta en un
// proveedor de terceros (SendGrid, Mailgun, etc.), solo activar la
// verificacion en 2 pasos en sisso.rdc@gmail.com y generar una
// "contrasena de aplicacion" desde myaccount.google.com/apppasswords.
//
// Si las variables de entorno no estan configuradas todavia, esta
// funcion NO revienta el servidor: lanza un error claro que el
// controlador atrapa y traduce a una respuesta 503 entendible, en
// vez de un stack trace generico. Esto sigue el mismo patron que
// pagosController.js usa cuando faltan las credenciales de PayPhone.
// ============================================================
const nodemailer = require('nodemailer');

let transportador = null;

function obtenerTransportador() {
  const usuario = process.env.CORREO_SUGERENCIAS_USUARIO;
  const claveApp = process.env.CORREO_SUGERENCIAS_APP_PASSWORD;

  if (!usuario || !claveApp) {
    throw new Error(
      'El envio de correo no esta configurado: faltan CORREO_SUGERENCIAS_USUARIO y/o CORREO_SUGERENCIAS_APP_PASSWORD en las variables de entorno.'
    );
  }

  if (!transportador) {
    transportador = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: usuario, pass: claveApp },
    });
  }
  return transportador;
}

// ------------------------------------------------------------
// Envia el correo de sugerencia/correccion al buzon de la
// plataforma. destino es fijo por diseno (sisso.rdc@gmail.com):
// este canal no debe poder usarse para mandar correo a cualquier
// direccion arbitraria.
// ------------------------------------------------------------
async function enviarCorreoSugerencia({ sugerencia, correccion, remitenteNombre, remitenteEmail, empresa, rol }) {
  const transportador = obtenerTransportador();
  const destino = process.env.CORREO_SUGERENCIAS_DESTINO || 'sisso.rdc@gmail.com';

  const cuerpoTexto =
    `Nueva sugerencia/correccion recibida desde SISSO.\n\n` +
    `Enviado por: ${remitenteNombre || 'Desconocido'} (${remitenteEmail || 'sin correo'})\n` +
    `Empresa: ${empresa || 'N/D'}\n` +
    `Rol: ${rol || 'N/D'}\n\n` +
    `--- Sugerencia ---\n${sugerencia || '(vacio)'}\n\n` +
    `--- Correccion ---\n${correccion || '(vacio)'}\n`;

  await transportador.sendMail({
    from: `SISSO Plataforma <${process.env.CORREO_SUGERENCIAS_USUARIO}>`,
    to: destino,
    replyTo: remitenteEmail || undefined,
    subject: `[SISSO] Sugerencia/correccion de ${empresa || 'empresa desconocida'}`,
    text: cuerpoTexto,
  });
}

module.exports = { enviarCorreoSugerencia };
