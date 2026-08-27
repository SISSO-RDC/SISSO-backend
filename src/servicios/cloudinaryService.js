// ============================================================
// SISSO - Servicio de almacenamiento de archivos (fotos/video de
// evidencia ergonomica, firmas de consentimientos y evaluaciones,
// certificados medicos de ausentismo, logo de la organizacion).
//
// Usa Cloudinary porque Render no ofrece almacenamiento de
// archivos persistente (su filesystem es efimero: se borra en
// cada deploy/reinicio). Cloudinary se elegio sobre alternativas
// S3-compatibles porque permite crear cuenta gratuita SIN tarjeta
// de credito, lo cual era un requisito explicito en esta etapa
// del proyecto.
//
// Las credenciales NUNCA se escriben en codigo: siempre vienen
// de variables de entorno (.env en local, "Environment" en el
// dashboard de Render en produccion).
//
// CORREGIDO tras auditoria de seguridad (hallazgo G12): antes,
// todos los archivos se subian con el modo de entrega publico por
// defecto de Cloudinary. Eso significa que la URL devuelta al
// subir un archivo (secure_url) queda accesible para siempre por
// cualquiera que la consiga (quedo guardada en la base de datos, en
// logs, en el historial del navegador, compartida por error, etc.),
// sin que el backend pueda revocar ese acceso — el unico "control"
// era que el nombre del archivo (public_id) es dificil de adivinar,
// lo cual NO es control de acceso real para firmas de trabajadores,
// certificados medicos ni evidencia con posibles datos identificables.
//
// La correccion: subirEvidencia() ahora sube los archivos como
// recurso "authenticated" de Cloudinary por defecto (opciones.privado,
// true salvo que se indique lo contrario). Un recurso "authenticated"
// NO es accesible con la URL simple devuelta al subirlo — cada vez
// que alguien necesita verlo, el backend debe generar una URL firmada
// con una expiracion corta (generarUrlFirmada), despues de comprobar
// que esa persona tiene permiso para ver ESE archivo en particular
// (la misma autorizacion que ya protege el registro al que pertenece:
// ver por ejemplo consentimientosController.js:obtenerUrlFirma). Asi,
// revocar el acceso es automatico (la URL vieja expira sola) y no
// depende de que nadie adivine o no un nombre de archivo.
//
// El logo de la organizacion es la unica excepcion intencional
// (opciones.privado = false en organizacionController.js): no es un
// documento sensible, y necesita poder mostrarse en <img> sin pasar
// por el backend en cada carga de pagina.
// ============================================================
const cloudinary = require('cloudinary').v2;

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('ERROR: faltan variables de entorno de Cloudinary (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).');
  console.error('Copia .env.example a .env y completa los valores, o configuralas en Render.');
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Carpeta base por defecto (retrocompatibilidad con las llamadas
// existentes de REBA/RULA, que no pasan un tercer argumento).
const CARPETA_BASE_POR_DEFECTO = 'sisso/evidencia-ergonomia';

// Segundos de validez por defecto de una URL firmada: 5 minutos.
// Suficiente para que el navegador cargue la imagen o el backend
// la descargue para incrustarla en un PDF, corto para que una URL
// filtrada (compartida sin querer, quedada en un log, etc.) deje
// de servir casi de inmediato.
const SEGUNDOS_VALIDEZ_URL_FIRMADA = 300;

/**
 * Sube un archivo (foto, video, o imagen de firma) a Cloudinary.
 *
 * @param {string} base64DataUri - el archivo en formato data URI,
 *        ej: "data:image/jpeg;base64,/9j/4AAQ..." Es lo que envia
 *        el frontend tras leer el archivo con FileReader.
 * @param {string} organizacionId - se usa para organizar las
 *        carpetas por empresa cliente (multi-tenant tambien en
 *        el almacenamiento de archivos).
 * @param {string} [carpetaBase] - subcarpeta dentro de Cloudinary
 *        para separar tipos de contenido (ej: evidencia
 *        ergonomica vs. firmas de consentimiento). Si se omite,
 *        usa la carpeta de evidencia ergonomica por defecto, para
 *        no romper las llamadas ya existentes en REBA/RULA.
 * @param {{privado?: boolean}} [opciones] - privado=true (default)
 *        sube el archivo como recurso "authenticated" (requiere
 *        URL firmada para verlo, ver generarUrlFirmada). Pasar
 *        privado:false SOLO para contenido que debe ser publico a
 *        proposito (hoy, unicamente el logo de la organizacion).
 * @returns {Promise<{url: string, publicId: string, tipo: 'imagen'|'video'}>}
 *        `url` queda guardado como referencia informativa, pero para
 *        recursos privados NO es directamente accesible: hay que
 *        generar una URL firmada con generarUrlFirmada(publicId, ...).
 */
async function subirEvidencia(base64DataUri, organizacionId, carpetaBase = CARPETA_BASE_POR_DEFECTO, opciones = {}) {
  const { privado = true } = opciones;
  const esVideo = base64DataUri.startsWith('data:video');

  const resultado = await cloudinary.uploader.upload(base64DataUri, {
    folder: `${carpetaBase}/${organizacionId}`,
    resource_type: esVideo ? 'video' : 'image',
    type: privado ? 'authenticated' : 'upload',
    // Limite de tamano razonable para evitar subidas accidentales enormes
    // desde camaras de celular en alta resolucion.
    transformation: esVideo
      ? undefined
      : [{ width: 1600, height: 1600, crop: 'limit' }],
  });

  return {
    url: resultado.secure_url,
    publicId: resultado.public_id,
    tipo: esVideo ? 'video' : 'imagen',
  };
}

/**
 * Genera una URL firmada y con expiracion corta para acceder a un
 * recurso subido como privado (ver subirEvidencia). Quien llame a
 * esta funcion es responsable de haber verificado ANTES que el
 * usuario tiene permiso para ver ese recurso especifico — esta
 * funcion no conoce ni verifica ningun permiso, solo genera la URL.
 *
 * @param {string} publicId
 * @param {'imagen'|'video'} [tipo]
 * @param {number} [segundosValidez]
 * @returns {string|null} null si no hay publicId (recurso inexistente).
 */
function generarUrlFirmada(publicId, tipo = 'imagen', segundosValidez = SEGUNDOS_VALIDEZ_URL_FIRMADA) {
  if (!publicId) return null;
  return cloudinary.url(publicId, {
    resource_type: tipo === 'video' ? 'video' : 'image',
    type: 'authenticated',
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + segundosValidez,
  });
}

/**
 * Borra un archivo de Cloudinary usando su public_id. Se usa, por
 * ejemplo, si una evaluacion se elimina o se reemplaza la evidencia
 * por una nueva.
 *
 * @param {string} publicId
 * @param {'imagen'|'video'} tipo
 * @param {{privado?: boolean}} [opciones] - debe coincidir con el
 *        valor usado al subirlo (subirEvidencia), porque Cloudinary
 *        distingue el "type" del recurso al borrarlo igual que al
 *        leerlo. Default true (coincide con el default de subida).
 */
async function borrarEvidencia(publicId, tipo, opciones = {}) {
  if (!publicId) return;
  const { privado = true } = opciones;
  await cloudinary.uploader.destroy(publicId, {
    resource_type: tipo === 'video' ? 'video' : 'image',
    type: privado ? 'authenticated' : 'upload',
  });
}

/**
 * CORREGIDO en Auditoria N.09 (hallazgo GRAVE G-N09-06, P1): en
 * varios flujos (accidentes, REBA/RULA, ausentismo, consentimientos/
 * firmas, EPP, inspecciones) el archivo se subia a Cloudinary y
 * DESPUES se insertaba la fila en PostgreSQL como pasos separados.
 * Si el INSERT fallaba (validacion, constraint, caida de conexion),
 * la transaccion de BD hacia rollback pero el archivo ya subido a
 * Cloudinary quedaba huerfano -- y en varios de estos modulos ese
 * archivo es sensible (foto de accidente, firma, certificado
 * medico).
 *
 * Este helper implementa el patron compensatorio recomendado por la
 * auditoria: sube el archivo, ejecuta `operacionPosterior` (tipicamente
 * el INSERT/UPDATE en BD), y si esa operacion lanza una excepcion,
 * intenta borrar inmediatamente el archivo recien subido ANTES de
 * relanzar el error original. No sustituye una reconciliacion
 * periodica Cloudinary<->BD (recomendada tambien por la auditoria
 * para el caso en que el propio borrado de compensacion falle), pero
 * cierra la ventana de huerfanos en el caso comun.
 *
 * @param {string} base64DataUri
 * @param {string} organizacionId
 * @param {string} [carpetaBase]
 * @param {{privado?: boolean}} [opciones]
 * @param {(subida: {url: string, publicId: string, tipo: 'imagen'|'video'}) => Promise<any>} operacionPosterior
 * @returns {Promise<{subida: {url: string, publicId: string, tipo: 'imagen'|'video'}, resultado: any}>}
 */
async function subirEvidenciaConCompensacion(base64DataUri, organizacionId, carpetaBase, opciones, operacionPosterior) {
  const subida = await subirEvidencia(base64DataUri, organizacionId, carpetaBase, opciones);
  try {
    const resultado = await operacionPosterior(subida);
    return { subida, resultado };
  } catch (err) {
    try {
      await borrarEvidencia(subida.publicId, subida.tipo, opciones);
    } catch (errCompensacion) {
      // No ocultar el error original por un fallo de limpieza, pero
      // dejar rastro claro de que quedo un archivo huerfano en
      // Cloudinary que requiere reconciliacion manual.
      console.error(
        `ORFANO EN CLOUDINARY: no se pudo compensar (borrar) ${subida.publicId} tras fallo posterior. Requiere limpieza manual.`,
        errCompensacion
      );
    }
    throw err;
  }
}

module.exports = { subirEvidencia, borrarEvidencia, generarUrlFirmada, subirEvidenciaConCompensacion };
