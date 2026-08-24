// ============================================================
// Controlador de consentimientos informados especificos por
// tipo de prueba, con firma grafica.
//
// Filosofia append-only (igual que historial_aptitud_medica):
// nunca se actualiza ni borra un consentimiento ya firmado. Si
// el trabajador necesita firmar de nuevo (ej. examen periodico
// del año siguiente), se crea una fila NUEVA.
//
// La revocacion (derecho reconocido en el Acuerdo Ministerial
// 5316) se modela como una actualizacion controlada de los
// campos revocado/revocado_en/motivo_revocacion sobre la MISMA
// fila, nunca borrando el registro de que el consentimiento
// existio y fue revocado: el historial de que "el trabajador
// firmo y luego revoco" es en si mismo un dato medico-legal
// relevante que no debe desaparecer.
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { subirEvidencia, generarUrlFirmada } = require('../servicios/cloudinaryService');
const { generarPdfFirmado, generarPdfEnBlanco } = require('../consentimientos/pdfConsentimiento');

const CARPETA_FIRMAS = 'sisso/firmas-consentimiento';

/**
 * Formatea una fecha (Date o string ISO) como DD/MM/AAAA.
 */
function formatearFecha(fecha) {
  const d = new Date(fecha);
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Descarga los bytes de una imagen ya subida a Cloudinary, para
 * poder incrustarla en el PDF (pdfkit necesita el buffer, no una URL).
 */
async function descargarImagen(url) {
  const respuesta = await fetch(url);
  if (!respuesta.ok) throw new Error(`No se pudo descargar la imagen de la firma (HTTP ${respuesta.status}).`);
  const arrayBuffer = await respuesta.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ------------------------------------------------------------
// GET /api/consentimientos/tipos
// Lista el catalogo de tipos de consentimiento disponibles (con
// su texto legal actual), para que el frontend pueda mostrar al
// trabajador el texto correcto antes de firmar.
// ------------------------------------------------------------
async function listarTipos(req, res) {
  try {
    const resultado = await query(
      `SELECT codigo, nombre, texto_legal, version
       FROM tipos_consentimiento
       WHERE activo = true
       ORDER BY nombre ASC`
    );
    return res.json({ tipos: resultado.rows });
  } catch (err) {
    console.error('Error en listarTipos (consentimientos):', err);
    return res.status(500).json({ error: 'Error interno al listar los tipos de consentimiento.' });
  }
}

// ------------------------------------------------------------
// POST /api/consentimientos/trabajadores/:trabajadorId/firmar
// Registra un consentimiento firmado. Requiere la imagen de la
// firma en base64 (canvas del frontend) y el codigo del tipo de
// consentimiento. Guarda un snapshot del texto legal y su
// version EN ESTE MOMENTO, no una referencia que pueda cambiar
// despues.
// ------------------------------------------------------------
async function firmarConsentimiento(req, res) {
  const { trabajadorId } = req.params;
  const { tipoConsentimientoCodigo, firmaBase64 } = req.body;

  if (!tipoConsentimientoCodigo || typeof tipoConsentimientoCodigo !== 'string') {
    return res.status(400).json({ error: 'tipoConsentimientoCodigo es obligatorio.' });
  }
  if (!firmaBase64 || typeof firmaBase64 !== 'string' || !firmaBase64.startsWith('data:image')) {
    return res.status(400).json({ error: 'firmaBase64 es obligatorio y debe ser una imagen en formato data URI (ej: la firma capturada en el canvas).' });
  }

  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    const tipoRes = await query(
      `SELECT codigo, texto_legal, version FROM tipos_consentimiento WHERE codigo = $1 AND activo = true`,
      [tipoConsentimientoCodigo]
    );
    if (tipoRes.rows.length === 0) {
      return res.status(404).json({ error: 'tipoConsentimientoCodigo no existe o no esta activo.' });
    }
    const tipo = tipoRes.rows[0];

    const firma = await subirEvidencia(firmaBase64, req.usuario.organizacionId, CARPETA_FIRMAS);

    const insertRes = await query(
      `INSERT INTO consentimientos_firmados
        (organizacion_id, trabajador_id, tipo_consentimiento_codigo, texto_legal_firmado, version_firmada,
         firma_imagen_url, firma_imagen_public_id, registrado_por, metodo_firma)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'electronica')
       RETURNING id, tipo_consentimiento_codigo, version_firmada, firma_imagen_url, metodo_firma, revocado, creado_en`,
      [
        req.usuario.organizacionId,
        trabajadorId,
        tipo.codigo,
        tipo.texto_legal,
        tipo.version,
        firma.url,
        firma.publicId,
        req.usuario.id,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'firmar_consentimiento_informado',
      critico: true, // Auditoria N.07 G-N07-01: escritura clinica/legal, la auditoria no debe fallar en silencio
      entidad: 'consentimiento_firmado',
      entidadId: insertRes.rows[0].id,
      detalle: { trabajadorId, tipoConsentimientoCodigo: tipo.codigo },
      req,
    });

    return res.status(201).json({ consentimiento: insertRes.rows[0] });
  } catch (err) {
    console.error('Error en firmarConsentimiento:', err);
    return res.status(500).json({ error: 'Error interno al registrar el consentimiento firmado.' });
  }
}

// ------------------------------------------------------------
// GET /api/consentimientos/trabajadores/:trabajadorId
// Lista todos los consentimientos firmados (vigentes y
// revocados) de un trabajador, mas reciente primero.
// ------------------------------------------------------------
async function listarPorTrabajador(req, res) {
  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    const resultado = await query(
      `SELECT c.id, c.tipo_consentimiento_codigo, t.nombre AS tipo_consentimiento_nombre,
              c.version_firmada, c.firma_imagen_url, c.metodo_firma, c.revocado, c.revocado_en, c.motivo_revocacion,
              c.creado_en, u.nombre_completo AS registrado_por_nombre
       FROM consentimientos_firmados c
       JOIN tipos_consentimiento t ON t.codigo = c.tipo_consentimiento_codigo
       JOIN usuarios u ON u.id = c.registrado_por
       WHERE c.trabajador_id = $1 AND c.organizacion_id = $2
       ORDER BY c.creado_en DESC`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );

    return res.json({ consentimientos: resultado.rows });
  } catch (err) {
    console.error('Error en listarPorTrabajador (consentimientos):', err);
    return res.status(500).json({ error: 'Error interno al listar los consentimientos del trabajador.' });
  }
}

// ------------------------------------------------------------
// POST /api/consentimientos/:id/revocar
// Marca un consentimiento como revocado. NUNCA borra la fila:
// el Acuerdo Ministerial 5316 reconoce el derecho del paciente a
// revocar su consentimiento, pero el hecho de que existio y fue
// revocado es en si mismo parte del registro medico-legal.
// ------------------------------------------------------------
async function revocarConsentimiento(req, res) {
  const { motivoRevocacion } = req.body;

  if (!motivoRevocacion || motivoRevocacion.trim().length < 5) {
    return res.status(400).json({ error: 'motivoRevocacion es obligatorio (minimo 5 caracteres).' });
  }

  try {
    const resultado = await query(
      `UPDATE consentimientos_firmados
       SET revocado = true, revocado_en = now(), motivo_revocacion = $1
       WHERE id = $2 AND organizacion_id = $3 AND revocado = false
       RETURNING id, tipo_consentimiento_codigo, revocado, revocado_en`,
      [motivoRevocacion.trim(), req.params.id, req.usuario.organizacionId]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Consentimiento no encontrado, no pertenece a su organizacion, o ya estaba revocado.' });
    }

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'revocar_consentimiento_informado',
      critico: true, // Auditoria N.07 G-N07-01: escritura clinica/legal, la auditoria no debe fallar en silencio
      entidad: 'consentimiento_firmado',
      entidadId: req.params.id,
      detalle: { motivoRevocacion: motivoRevocacion.trim() },
      req,
    });

    return res.json({ consentimiento: resultado.rows[0] });
  } catch (err) {
    console.error('Error en revocarConsentimiento:', err);
    return res.status(500).json({ error: 'Error interno al revocar el consentimiento.' });
  }
}

// ------------------------------------------------------------
// GET /api/consentimientos/:id/firma-url
//
// CORREGIDO tras auditoria de seguridad (hallazgo G12): la imagen
// de la firma ya no es accesible con una URL publica permanente
// (ver cloudinaryService.js). Este endpoint genera una URL firmada
// de corta duracion, DESPUES de comprobar que el consentimiento
// pertenece a la organizacion del usuario (misma comprobacion que
// ya hacen descargarPdf/revocarConsentimiento).
// ------------------------------------------------------------
async function obtenerUrlFirma(req, res) {
  try {
    const resultado = await query(
      `SELECT firma_imagen_public_id FROM consentimientos_firmados
       WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, req.usuario.organizacionId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Consentimiento no encontrado.' });
    }
    const publicId = resultado.rows[0].firma_imagen_public_id;
    if (!publicId) {
      return res.status(404).json({ error: 'Este consentimiento no tiene una imagen de firma asociada.' });
    }

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'ver_firma_consentimiento',
      entidad: 'consentimiento_firmado',
      entidadId: req.params.id,
      req,
    });

    return res.json({ url: generarUrlFirmada(publicId, 'imagen') });
  } catch (err) {
    console.error('Error en obtenerUrlFirma (consentimientos):', err);
    return res.status(500).json({ error: 'Error interno al generar el enlace de la firma.' });
  }
}

// ------------------------------------------------------------
// GET /api/consentimientos/:id/pdf
// Descarga el PDF de un consentimiento YA FIRMADO (electronico o
// fisico escaneado), con el texto legal que realmente se firmo y
// la imagen de la firma incrustada. Sirve como respaldo/archivo.
// ------------------------------------------------------------
async function descargarPdf(req, res) {
  try {
    const resultado = await query(
      `SELECT c.id, c.texto_legal_firmado, c.firma_imagen_url, c.firma_imagen_public_id, c.metodo_firma,
              c.revocado, c.revocado_en, c.motivo_revocacion, c.creado_en,
              t.nombre AS tipo_consentimiento_nombre,
              tr.nombre_completo AS trabajador_nombre, tr.documento AS trabajador_documento,
              u.nombre_completo AS registrado_por_nombre,
              o.nombre AS organizacion_nombre
       FROM consentimientos_firmados c
       JOIN tipos_consentimiento t ON t.codigo = c.tipo_consentimiento_codigo
       JOIN trabajadores tr ON tr.id = c.trabajador_id
       JOIN usuarios u ON u.id = c.registrado_por
       JOIN organizaciones o ON o.id = c.organizacion_id
       WHERE c.id = $1 AND c.organizacion_id = $2`,
      [req.params.id, req.usuario.organizacionId]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Consentimiento no encontrado.' });
    }
    const c = resultado.rows[0];

    let imagenFirmaBuffer = null;
    try {
      // CORREGIDO (hallazgo G12): c.firma_imagen_url ya no es
      // directamente accesible (recurso privado en Cloudinary, ver
      // cloudinaryService.js); generamos una URL firmada de corta
      // duracion justo antes de usarla, en vez de guardar/reusar una
      // URL publica permanente.
      const urlFirmada = generarUrlFirmada(c.firma_imagen_public_id, 'imagen');
      if (urlFirmada) imagenFirmaBuffer = await descargarImagen(urlFirmada);
    } catch (e) {
      console.error('No se pudo descargar la imagen de la firma para el PDF:', e.message);
      // Seguimos generando el PDF sin la imagen (mejor un PDF incompleto que ningun PDF).
    }

    const doc = generarPdfFirmado({
      nombreOrganizacion: c.organizacion_nombre,
      nombreTipoConsentimiento: c.tipo_consentimiento_nombre,
      textoLegalFirmado: c.texto_legal_firmado,
      trabajador: { nombreCompleto: c.trabajador_nombre, documento: c.trabajador_documento },
      fechaFirma: formatearFecha(c.creado_en),
      metodoFirma: c.metodo_firma,
      registradoPorNombre: c.registrado_por_nombre,
      imagenFirmaBuffer,
      revocado: c.revocado,
      motivoRevocacion: c.motivo_revocacion,
      revocadoEn: c.revocado_en ? formatearFecha(c.revocado_en) : null,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="consentimiento-${c.tipo_consentimiento_nombre.replace(/[^a-z0-9]+/gi, '-')}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error('Error en descargarPdf (consentimientos):', err);
    return res.status(500).json({ error: 'Error interno al generar el PDF del consentimiento.' });
  }
}

// ------------------------------------------------------------
// GET /api/consentimientos/tipos/:codigo/pdf-blanco?trabajadorId=X
// PDF EN BLANCO para imprimir y firmar a mano (primer paso del
// flujo de firma fisica). El segundo paso es subir la foto del
// documento ya firmado con POST .../firmar-fisico.
// ------------------------------------------------------------
async function descargarPdfEnBlanco(req, res) {
  const { codigo } = req.params;
  const { trabajadorId } = req.query;

  if (!trabajadorId) {
    return res.status(400).json({ error: 'El parametro trabajadorId es obligatorio.' });
  }

  try {
    const tipoRes = await query(
      `SELECT codigo, nombre, texto_legal FROM tipos_consentimiento WHERE codigo = $1 AND activo = true`,
      [codigo]
    );
    if (tipoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tipo de consentimiento no encontrado.' });
    }

    const trabajadorRes = await query(
      `SELECT tr.nombre_completo, tr.documento, o.nombre AS organizacion_nombre
       FROM trabajadores tr
       JOIN organizaciones o ON o.id = tr.organizacion_id
       WHERE tr.id = $1 AND tr.organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    const tipo = tipoRes.rows[0];
    const trabajador = trabajadorRes.rows[0];

    const doc = generarPdfEnBlanco({
      nombreOrganizacion: trabajador.organizacion_nombre,
      nombreTipoConsentimiento: tipo.nombre,
      textoLegal: tipo.texto_legal,
      trabajador: { nombreCompleto: trabajador.nombre_completo, documento: trabajador.documento },
      fecha: formatearFecha(new Date()),
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="consentimiento-en-blanco-${tipo.codigo}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error('Error en descargarPdfEnBlanco:', err);
    return res.status(500).json({ error: 'Error interno al generar el PDF en blanco.' });
  }
}

// ------------------------------------------------------------
// POST /api/consentimientos/trabajadores/:trabajadorId/firmar-fisico
// Segundo paso del flujo de firma fisica: sube la foto/escaneo del
// documento YA FIRMADO EN PAPEL (imprimido con
// GET .../pdf-blanco). Se guarda igual que una firma electronica
// (misma tabla, mismo almacenamiento en Cloudinary), solo que
// metodo_firma queda como 'fisica_escaneada' para que el
// historial muestre como se obtuvo.
// ------------------------------------------------------------
async function firmarFisico(req, res) {
  const { trabajadorId } = req.params;
  const { tipoConsentimientoCodigo, imagenBase64 } = req.body;

  if (!tipoConsentimientoCodigo || typeof tipoConsentimientoCodigo !== 'string') {
    return res.status(400).json({ error: 'tipoConsentimientoCodigo es obligatorio.' });
  }
  if (!imagenBase64 || typeof imagenBase64 !== 'string' || !imagenBase64.startsWith('data:image')) {
    return res.status(400).json({ error: 'imagenBase64 es obligatorio: la foto o escaneo del documento firmado, en formato data URI.' });
  }

  try {
    const trabajadorRes = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [trabajadorId, req.usuario.organizacionId]
    );
    if (trabajadorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en su organizacion.' });
    }

    const tipoRes = await query(
      `SELECT codigo, texto_legal, version FROM tipos_consentimiento WHERE codigo = $1 AND activo = true`,
      [tipoConsentimientoCodigo]
    );
    if (tipoRes.rows.length === 0) {
      return res.status(404).json({ error: 'tipoConsentimientoCodigo no existe o no esta activo.' });
    }
    const tipo = tipoRes.rows[0];

    const imagen = await subirEvidencia(imagenBase64, req.usuario.organizacionId, CARPETA_FIRMAS);

    const insertRes = await query(
      `INSERT INTO consentimientos_firmados
        (organizacion_id, trabajador_id, tipo_consentimiento_codigo, texto_legal_firmado, version_firmada,
         firma_imagen_url, firma_imagen_public_id, registrado_por, metodo_firma)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'fisica_escaneada')
       RETURNING id, tipo_consentimiento_codigo, version_firmada, firma_imagen_url, metodo_firma, revocado, creado_en`,
      [
        req.usuario.organizacionId,
        trabajadorId,
        tipo.codigo,
        tipo.texto_legal,
        tipo.version,
        imagen.url,
        imagen.publicId,
        req.usuario.id,
      ]
    );

    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'firmar_consentimiento_fisico_escaneado',
      critico: true, // Auditoria N.07 G-N07-01: escritura clinica/legal, la auditoria no debe fallar en silencio
      entidad: 'consentimiento_firmado',
      entidadId: insertRes.rows[0].id,
      detalle: { trabajadorId, tipoConsentimientoCodigo: tipo.codigo },
      req,
    });

    return res.status(201).json({ consentimiento: insertRes.rows[0] });
  } catch (err) {
    console.error('Error en firmarFisico:', err);
    return res.status(500).json({ error: 'Error interno al registrar el documento firmado fisicamente.' });
  }
}

module.exports = {
  listarTipos, firmarConsentimiento, listarPorTrabajador, revocarConsentimiento,
  descargarPdf, descargarPdfEnBlanco, firmarFisico, obtenerUrlFirma,
};
