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
const { query, withTransaction } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { subirEvidencia, borrarEvidencia, generarUrlFirmada } = require('../servicios/cloudinaryService');
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

    // CORREGIDO en Auditoria N.09 (G-N09-06): la firma es un dato
    // biometrico/sensible; si la transaccion de BD falla despues de
    // subirla, se compensa borrandola de Cloudinary.
    let insertRes;
    try {
      insertRes = await withTransaction(async (client) => {
      const resultadoConsulta = await client.query(
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
        entidad: 'consentimiento_firmado',
        entidadId: resultadoConsulta.rows[0].id,
        detalle: { trabajadorId, tipoConsentimientoCodigo: tipo.codigo },
        req,
        client,
      });

        return resultadoConsulta;
      });
    } catch (errTransaccion) {
      await borrarEvidencia(firma.publicId, 'imagen').catch((errBorrado) =>
        console.error(`ORFANO EN CLOUDINARY: no se pudo compensar (borrar) ${firma.publicId}.`, errBorrado)
      );
      throw errTransaccion;
    }

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

    // CORREGIDO en Auditoria N.10 (hallazgo GRAVE G10-05, P1): esta
    // consulta es "gestion de estado" (que consentimientos existen,
    // vigencia, quien lo registro) y debe quedar separada de "leer
    // el contenido firmado". Se retira firma_imagen_url de aqui: el
    // contenido (imagen/PDF) solo se obtiene via obtenerUrlFirma()/
    // descargarPdf(), que ahora aplican la restriccion por
    // categoria del tipo de consentimiento.
    const resultado = await query(
      `SELECT c.id, c.tipo_consentimiento_codigo, t.nombre AS tipo_consentimiento_nombre, t.categoria,
              c.version_firmada, c.metodo_firma, c.revocado, c.revocado_en, c.motivo_revocacion,
              c.creado_en, u.nombre_completo AS registrado_por_nombre
       FROM consentimientos_firmados c
       JOIN tipos_consentimiento t ON t.codigo = c.tipo_consentimiento_codigo
       JOIN usuarios u ON u.id = c.registrado_por
       WHERE c.trabajador_id = $1 AND c.organizacion_id = $2
       ORDER BY c.creado_en DESC`,
      [req.params.trabajadorId, req.usuario.organizacionId]
    );

    // CORREGIDO en Auditoria N.11 (hallazgo GRAVE G11-05, P1): N.10
    // ya habia separado el CONTENIDO firmado (reservado a medico
    // cuando categoria='clinico'), pero SSO/TH seguian viendo el
    // NOMBRE del tipo de consentimiento (ej. "pruebas_psicologicas",
    // "pruebas_toxicologicas") en el listado -- saber que un
    // trabajador tiene ese tipo especifico de consentimiento firmado
    // ya revela indirectamente informacion de salud, incluso sin ver
    // el documento. SSO/TH conservan la GESTION DE ESTADO
    // (cuantos hay, vigentes/revocados, fecha) para tipos clinicos,
    // pero el nombre especifico del procedimiento queda oculto tras
    // una etiqueta generica. Para tipos 'operativo' (sin equivalente
    // clinico) se sigue mostrando el nombre completo.
    const esRolRestringido = req.usuario.rol !== 'medico';
    const consentimientos = resultado.rows.map((c) => {
      if (esRolRestringido && c.categoria === 'clinico') {
        // CORREGIDO en Auditoria N.12 (hallazgo GRAVE G12-06, P1):
        // el mapeo anterior solo ocultaba el nombre/codigo del tipo,
        // pero motivo_revocacion (texto libre) seguia viajando
        // intacto -- ese campo puede contener la justificacion
        // clinica de por que se revoco (ej. referencia a un
        // diagnostico), exactamente el tipo de dato que esta regla
        // ya trata como reservado para el nombre del tipo.
        return {
          ...c,
          tipo_consentimiento_codigo: 'clinico_reservado',
          tipo_consentimiento_nombre: 'Consentimiento clínico (detalle reservado a médico)',
          motivo_revocacion: c.motivo_revocacion ? '(reservado a médico)' : null,
        };
      }
      return c;
    });

    return res.json({ consentimientos });
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
    // CORREGIDO en Auditoria N.12 (hallazgo GRAVE G12-06, P1): SSO/TH
    // podian revocar CUALQUIER consentimiento, incluidos los de
    // categoria='clinico' (ej. pruebas psicologicas/toxicologicas),
    // pese a que ya tienen vedado ver su contenido firmado. Revocar
    // un consentimiento clinico es una decision que debe involucrar
    // al medico -- no solo un cambio de estado administrativo.
    if (req.usuario.rol !== 'medico') {
      const tipoRes = await query(
        `SELECT t.categoria FROM consentimientos_firmados c
         JOIN tipos_consentimiento t ON t.codigo = c.tipo_consentimiento_codigo
         WHERE c.id = $1 AND c.organizacion_id = $2`,
        [req.params.id, req.usuario.organizacionId]
      );
      if (tipoRes.rows.length > 0 && tipoRes.rows[0].categoria === 'clinico') {
        return res.status(403).json({ error: 'Revocar un consentimiento clinico requiere intervencion del medico ocupacional.' });
      }
    }

    // CORREGIDO en Auditoria N.08 (C-N08-01): UPDATE + auditoria en
    // la misma transaccion -- ver firmarConsentimiento arriba para
    // la explicacion completa del patron.
    const resultado = await withTransaction(async (client) => {
      const resultadoConsulta = await client.query(
        `UPDATE consentimientos_firmados
         SET revocado = true, revocado_en = now(), motivo_revocacion = $1
         WHERE id = $2 AND organizacion_id = $3 AND revocado = false
         RETURNING id, tipo_consentimiento_codigo, revocado, revocado_en`,
        [motivoRevocacion.trim(), req.params.id, req.usuario.organizacionId]
      );

      if (resultadoConsulta.rows.length === 0) {
        // No hay fila que auditar: devolvemos un resultado vacio y
        // dejamos que el codigo fuera de la transaccion responda 404.
        return resultadoConsulta;
      }

      await registrarAuditoria({
        organizacionId: req.usuario.organizacionId,
        usuarioId: req.usuario.id,
        accion: 'revocar_consentimiento_informado',
        entidad: 'consentimiento_firmado',
        entidadId: req.params.id,
        detalle: { motivoRevocacion: motivoRevocacion.trim() },
        req,
        client,
      });

      return resultadoConsulta;
    });

    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Consentimiento no encontrado, no pertenece a su organizacion, o ya estaba revocado.' });
    }

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
      `SELECT c.firma_imagen_public_id, t.categoria
       FROM consentimientos_firmados c
       JOIN tipos_consentimiento t ON t.codigo = c.tipo_consentimiento_codigo
       WHERE c.id = $1 AND c.organizacion_id = $2`,
      [req.params.id, req.usuario.organizacionId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Consentimiento no encontrado.' });
    }

    // CORREGIDO en Auditoria N.10 (hallazgo GRAVE G10-05, P1): el
    // contenido firmado de un tipo de consentimiento 'clinico' queda
    // reservado a 'medico' -- la sola existencia de una firma para
    // "pruebas_psicologicas" u otro tipo clinico ya revela
    // informacion de salud. SSO/TH conservan la gestion de estado
    // (listarPorTrabajador, revocar) pero no el contenido.
    if (resultado.rows[0].categoria === 'clinico' && req.usuario.rol !== 'medico') {
      return res.status(403).json({
        error: 'Solo un usuario con rol medico puede acceder al contenido firmado de este tipo de consentimiento.',
      });
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
      lecturaSensible: true,
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
              t.nombre AS tipo_consentimiento_nombre, t.categoria,
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

    // CORREGIDO en Auditoria N.10 (G10-05): mismo criterio que
    // obtenerUrlFirma() -- el PDF firmado de un tipo 'clinico' es
    // contenido, no gestion de estado.
    if (c.categoria === 'clinico' && req.usuario.rol !== 'medico') {
      return res.status(403).json({
        error: 'Solo un usuario con rol medico puede descargar el documento firmado de este tipo de consentimiento.',
      });
    }

    // CORREGIDO en Auditoria N.10 (hallazgo GRAVE G10-05, P1):
    // descargarPdf() generaba el documento sin ningun registro de
    // auditoria -- un PDF descargable/imprimible es al menos tan
    // sensible como el JSON de detalle. Se registra ANTES de
    // generar el documento (fail-closed).
    await registrarAuditoria({
      organizacionId: req.usuario.organizacionId,
      usuarioId: req.usuario.id,
      accion: 'descarga_pdf_consentimiento',
      entidad: 'consentimiento_firmado',
      entidadId: req.params.id,
      detalle: { tipoConsentimientoCodigo: c.tipo_consentimiento_nombre },
      req,
      lecturaSensible: true,
    });

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

    // CORREGIDO en Auditoria N.09 (G-N09-06): compensacion si la
    // transaccion de BD falla despues de subir la imagen escaneada.
    let insertRes;
    try {
      insertRes = await withTransaction(async (client) => {
      const resultadoConsulta = await client.query(
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
        entidad: 'consentimiento_firmado',
        entidadId: resultadoConsulta.rows[0].id,
        detalle: { trabajadorId, tipoConsentimientoCodigo: tipo.codigo },
        req,
        client,
      });

        return resultadoConsulta;
      });
    } catch (errTransaccion) {
      await borrarEvidencia(imagen.publicId, 'imagen').catch((errBorrado) =>
        console.error(`ORFANO EN CLOUDINARY: no se pudo compensar (borrar) ${imagen.publicId}.`, errBorrado)
      );
      throw errTransaccion;
    }

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
