// ============================================================
// SISSO - Utilidad compartida para obtener la firma digital de un
// usuario (medico/sso/th/admin) lista para incrustar en un PDF
// (certificado de aptitud, de capacitacion, u otro documento que
// requiera firma). Reune: buscar si el usuario tiene firma
// registrada, generar una URL firmada de corta duracion (el
// recurso es privado en Cloudinary, ver cloudinaryService.js), y
// descargar los bytes.
//
// Falla de forma silenciosa (devuelve null) si el usuario no tiene
// firma digital cargada o si la descarga falla -- un certificado
// sin firma digital sigue siendo un documento valido (queda solo la
// linea con el nombre del responsable, como antes de esta
// correccion); no debe bloquear la emision del certificado.
//
// CORREGIDO en Auditoria N.15: la consulta seleccionaba "u.nombre",
// una columna que NUNCA existio en la tabla usuarios (la columna
// real es "nombre_completo", ver schema.sql) -- confirmado
// ejecutando la consulta literal contra una base real:
// "ERROR: column u.nombre does not exist". Como esta funcion
// atrapa cualquier error y devuelve null (ver el comentario de
// arriba, es el comportamiento CORRECTO ante una firma faltante o
// una descarga fallida), este bug de tipeo quedaba
// permanentemente enmascarado: la firma digital del profesional
// JAMAS se incrusto en NINGUN certificado que use esta funcion
// (aptitud, capacitacion, y ahora historia clinica), para NINGUN
// usuario que si tenia una firma valida registrada -- sin ningun
// error visible para nadie. Se corrige la columna y se agrega
// tests/firma_pdf.test.js para que un typo asi nunca vuelva a
// esconderse detras del manejo silencioso de errores.
// ============================================================
const { query } = require('../db/pool');
const { generarUrlFirmada } = require('../servicios/cloudinaryService');

/**
 * @param {string|null|undefined} usuarioId
 * @param {string} organizacionId
 * @returns {Promise<{buffer: Buffer, nombreResponsable: string, nombreCompleto: string, registroSenescytEspecialidad: string|null}|null>}
 */
async function obtenerFirmaParaPdf(usuarioId, organizacionId) {
  if (!usuarioId) return null;
  try {
    const resultado = await query(
      // CORREGIDO en Auditoria N.15 (pedido de la persona usuaria:
      // "en el certificado... irá el nombre del médico completo y
      // debajo el registro del senescyt"): se agrega
      // registro_senescyt_especialidad a esta consulta, que es la
      // fuente COMPARTIDA de credenciales para todo certificado que
      // incruste una firma (aptitud, capacitacion, y ahora tambien
      // los de historiaClinicaController.js) -- antes solo se
      // consultaba aqui el nombre y el rol, asi que ningun
      // certificado que dependiera de esta funcion podia mostrar el
      // registro SENESCYT sin importar que el usuario ya lo hubiera
      // registrado en "Mi Perfil".
      `SELECT f.imagen_public_id, u.nombre_completo AS nombre, u.rol, u.registro_senescyt_especialidad
       FROM firmas_digitales_usuario f
       JOIN usuarios u ON u.id = f.usuario_id
       WHERE f.usuario_id = $1 AND f.organizacion_id = $2`,
      [usuarioId, organizacionId]
    );
    if (resultado.rows.length === 0) return null;

    const urlFirmada = generarUrlFirmada(resultado.rows[0].imagen_public_id, 'imagen');
    if (!urlFirmada) return null;

    const respuesta = await fetch(urlFirmada);
    if (!respuesta.ok) return null;
    const arrayBuffer = await respuesta.arrayBuffer();

    const ETIQUETAS_ROL = { medico: 'Médico Ocupacional', sso: 'Seguridad y Salud Ocupacional', th: 'Talento Humano', admin: 'Administración' };
    return {
      buffer: Buffer.from(arrayBuffer),
      nombreResponsable: `${resultado.rows[0].nombre} — ${ETIQUETAS_ROL[resultado.rows[0].rol] || resultado.rows[0].rol}`,
      nombreCompleto: resultado.rows[0].nombre,
      registroSenescytEspecialidad: resultado.rows[0].registro_senescyt_especialidad || null,
    };
  } catch (err) {
    console.error('No se pudo obtener la firma digital para el PDF:', err.message);
    return null;
  }
}

module.exports = { obtenerFirmaParaPdf, dibujarBloqueFirma };

// ============================================================
// CREADO en Auditoria N.15 (bug real reportado por el usuario, con
// captura de pantalla del PDF resultante): el bloque de firma de
// historia clinica (pdfPreocupacional.js) tenia el ORDEN VISUAL
// invertido -- imprimia el nombre del profesional y su registro
// SENESCYT PRIMERO, y el espacio/linea para firmar DESPUES. El orden
// correcto de cualquier bloque de firma impreso (y el que el usuario
// pidio explicitamente, "en ese orden", para aplicar en TODOS los
// documentos con firma) es:
//
//   1. Titulo (ej. "Firma y credencial del profesional que suscribe:")
//   2. ESPACIO EN BLANCO considerable para firmar a mano, o la
//      imagen de la firma digital si esta registrada
//   3. Linea horizontal
//   4. Nombre completo del firmante (debajo de la linea)
//   5. Credencial (registro SENESCYT), debajo del nombre
//
// Esta funcion es la UNICA fuente de este bloque -- pdfPreocupacional.js,
// pdfCertificado.js, pdfCertificadoAptitud.js y
// pdfCertificadoRestriccion.js la importan en vez de reimplementarla,
// para que este orden no pueda volver a divergir entre documentos
// (que es exactamente como se origino este bug: cada archivo tenia su
// propia copia).
//
// @param {PDFDocument} doc
// @param {object} opciones
// @param {number} opciones.margen
// @param {number} opciones.anchoUtil
// @param {string} [opciones.titulo]
// @param {{buffer: Buffer, nombreCompleto?: string, nombreResponsable?: string, registroSenescytEspecialidad?: string|null}|null} opciones.firma
// @param {string} [opciones.nombreFallback] - texto si no hay firma/nombre registrado
// @param {boolean} [opciones.mostrarSenescyt] - false para bloques de firma que no son de un profesional de salud (ej. el trabajador en un consentimiento)
function dibujarBloqueFirma(doc, opciones) {
  const {
    margen, anchoUtil,
    titulo = 'Firma y credencial del profesional que suscribe:',
    firma,
    nombreFallback = 'No registrado',
    mostrarSenescyt = true,
  } = opciones;

  if (doc.y > doc.page.height - margen - 140) doc.addPage();
  doc.moveDown(0.8);
  doc.moveTo(margen, doc.y).lineTo(margen + anchoUtil, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown(0.8);
  doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a').text(titulo);
  doc.moveDown(0.4);

  // ---- 2. Espacio para firmar (imagen o blanco) ----
  const ALTO_ZONA_FIRMA = 70;
  const yInicioZona = doc.y;
  if (firma && firma.buffer) {
    try {
      doc.image(firma.buffer, margen, yInicioZona, { fit: [200, ALTO_ZONA_FIRMA] });
    } catch (err) {
      console.error('No se pudo incrustar la imagen de la firma en el PDF:', err.message);
    }
  }
  // El espacio se reserva SIEMPRE (con o sin imagen real), para que
  // quien imprima el documento pueda firmar a mano si lo necesita.
  doc.y = yInicioZona + ALTO_ZONA_FIRMA;

  // ---- 3. Linea ----
  doc.moveTo(margen, doc.y).lineTo(margen + 220, doc.y).strokeColor('#94a3b8').stroke();
  doc.moveDown(0.3);

  // ---- 4. Nombre (debajo de la linea) ----
  const nombre = firma?.nombreCompleto || firma?.nombreResponsable || nombreFallback;
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text(nombre);

  // ---- 5. Credencial (debajo del nombre) ----
  if (mostrarSenescyt) {
    doc.fontSize(9).font('Helvetica').fillColor('#334155');
    if (firma?.registroSenescytEspecialidad) {
      doc.text(`Registro SENESCYT (especialidad Salud Ocupacional / Medicina del Trabajo): ${firma.registroSenescytEspecialidad}`);
    } else {
      doc.font('Helvetica-Oblique').fillColor('#94a3b8')
        .text('Este profesional aún no registró su número de registro SENESCYT de la especialidad (pestaña "Mi Perfil").');
    }
  }
}
