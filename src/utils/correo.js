// ============================================================
// CREADO a pedido de la persona usuaria: envio de correo para el
// boton de "Sugerencias y correcciones" de la pestana "Acerca de".
//
// CORREGIDO: la primera version usaba Gmail SMTP con una
// "contrasena de aplicacion", lo cual exige activar la verificacion
// en 2 pasos en sisso.rdc@gmail.com -- la persona usuaria prefirio
// no tocar la seguridad de esa cuenta de Gmail. Se reemplaza por
// EmailJS (https://www.emailjs.com), un servicio gratuito (200
// correos/mes en el plan free) que envia el correo por su cuenta
// via su API REST, usando una Service ID / Template ID / Public
// Key / Private Key -- ninguna de las 4 es una contrasena de Gmail,
// y no requiere 2FA en ninguna cuenta.
//
// Se llama al endpoint REST de EmailJS (no al SDK de navegador)
// para que el envio siga ocurriendo del lado del servidor, detras
// del mismo rate limiting y autenticacion que ya protegia el
// endpoint POST /api/plataforma/sugerencias -- exponer el envio
// directo desde el navegador habria significado perder ese control.
//
// Si las variables de entorno no estan configuradas todavia, esta
// funcion NO revienta el servidor: lanza un error claro que el
// controlador atrapa y traduce a una respuesta 503 entendible, en
// vez de un stack trace generico. Mismo patron que pagosController.js
// usa cuando faltan las credenciales de PayPhone.
// ============================================================

const EMAILJS_ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';

function obtenerCredenciales() {
  const serviceId = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_TEMPLATE_ID;
  const publicKey = process.env.EMAILJS_PUBLIC_KEY;
  const privateKey = process.env.EMAILJS_PRIVATE_KEY;

  if (!serviceId || !templateId || !publicKey || !privateKey) {
    throw new Error(
      'El envio de correo no esta configurado: faltan una o mas de EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY en las variables de entorno.'
    );
  }
  return { serviceId, templateId, publicKey, privateKey };
}

// ------------------------------------------------------------
// Envia el correo de sugerencia/correccion via la API REST de
// EmailJS. El destinatario final (sisso.rdc@gmail.com) se define
// UNA VEZ dentro de la plantilla de EmailJS ("To Email"), no aqui
// -- este canal solo puede enviar a la direccion fija que la
// plantilla ya tiene configurada, nunca a una direccion arbitraria
// que alguien mande en el body de la peticion.
// ------------------------------------------------------------
async function enviarCorreoSugerencia({ sugerencia, correccion, remitenteNombre, remitenteEmail, empresa, rol }) {
  const { serviceId, templateId, publicKey, privateKey } = obtenerCredenciales();

  const respuesta = await fetch(EMAILJS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      accessToken: privateKey,
      template_params: {
        nombre: remitenteNombre || 'Desconocido',
        email: remitenteEmail || 'sin correo',
        empresa: empresa || 'N/D',
        rol: rol || 'N/D',
        sugerencia: sugerencia || '(vacio)',
        correccion: correccion || '(vacio)',
      },
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => '');
    throw new Error(`EmailJS respondio con error (${respuesta.status}): ${detalle || 'sin detalle'}`);
  }
}

module.exports = { enviarCorreoSugerencia };
