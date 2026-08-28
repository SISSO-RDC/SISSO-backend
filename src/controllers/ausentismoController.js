// ============================================================
// Controlador de Ausentismo laboral.
//
// Doble via de registro (acordado con el cliente):
//   - Manual: crear() registra una ausencia a la vez, con
//     respaldo opcional (certificado escaneado a Cloudinary).
//   - Masiva: importarMasivo() recibe filas ya extraidas de un
//     Excel/CSV en el frontend (SheetJS), mismo patron que
//     trabajadoresController.importarMasivo. No admite adjuntar
//     certificados por esta via (se pueden agregar despues
//     editando la fila individual si se requiere).
//
// resumen() calcula los indicadores de ausentismo (dias
// perdidos, distribucion por tipo, top trabajadores) para un
// rango de fechas, pensado para alimentar tanto la propia
// pagina de Ausentismo como, mas adelante, el panel de
// Indicadores SSO.
// ============================================================
const { query } = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { subirEvidencia, borrarEvidencia, generarUrlFirmada, subirEvidenciaConCompensacion } = require('../servicios/cloudinaryService');
const { TIPOS_AUSENCIA, CODIGOS_VALIDOS, esSubsidiablePorDefecto } = require('../ausentismo/ausentismo');

const CARPETA_CERTIFICADOS = 'sisso/certificados-ausentismo';

// CORREGIDO tras auditoria de seguridad (N.06) y endurecido en
// Auditoria N.07 (hallazgo GRAVE C4): el diagnostico CIE-10 es un
// dato clinico individual. La version anterior lo liberaba tambien
// a SSO, razonando que SSO "ya maneja informacion clinica en el
// resto del sistema" -- pero la propia arquitectura de SISSO define
// el ausentismo como gestion SST/RRHH, no como modulo clinico, y en
// Historia Clinica/Aptitud/Enfermedad Profesional el diagnostico SI
// esta reservado exclusivamente al medico. Mantener a SSO como
// excepcion aqui era inconsistente y constituia una ruta alterna de
// acceso a un dato de salud individual.
//
// Ahora unicamente 'medico' recibe diagnostico_cie10 y
// numero_certificado. El resto de roles (incluido sso) recibe la
// fila completa MENOS esos dos campos: siguen viendo tipo de
// ausencia, fechas, dias y si hay certificado adjunto, que es lo
// minimo necesario para gestion laboral/preventiva sin conocer el
// diagnostico especifico.
//
// CORREGIDO en Auditoria N.09 (hallazgo GRAVE G-N09-02, P1): el
// servicio de Cloudinary fue migrado a recursos privados/firmados
// (ver cloudinaryService.js y GET /:id/certificado-url), pero esta
// funcion de minimizacion solo quitaba diagnostico_cie10 y
// numero_certificado -- certificado_url seguia viajando intacto en
// listar()/obtener() para CUALQUIER rol. Para registros creados
// antes de la migracion a recursos privados, certificado_url podia
// ser todavia una URL publica de Cloudinary: un rol no medico podia
// abrir directamente el documento medico escaneado sin pasar por el
// endpoint firmado ni por ningun control de acceso adicional. Ahora
// certificado_url se retira de toda respuesta no medica igual que
// diagnostico_cie10 y numero_certificado; el campo que SI se
// conserva para todos (certificado_public_id, cuando exista) no es
// una URL utilizable directamente sin pasar por
// GET /:id/certificado-url, que ya valida el rol.
function minimizarDatosClinicos(fila, rol) {
  if (rol === 'medico') return fila;
  const { diagnostico_cie10, numero_certificado, certificado_url, ...resto } = fila;
  return resto;
}

// ------------------------------------------------------------
// GET /api/ausentismo/catalogos
// ------------------------------------------------------------
async function obtenerCatalogos(req, res) {
  return res.json({ catalogos: { TIPOS_AUSENCIA } });
}

// ------------------------------------------------------------
// GET /api/ausentismo
// Filtros opcionales por query string: trabajadorId, tipo,
// desde, hasta. Paginado simple (pagina/porPagina).
// ------------------------------------------------------------
async function listar(req, res) {
  const orgId = req.usuario.organizacionId;
  const { trabajadorId, tipo, desde, hasta } = req.query;
  const pagina = Math.max(parseInt(req.query.pagina, 10) || 1, 1);
  const porPagina = Math.min(Math.max(parseInt(req.query.porPagina, 10) || 25, 1), 200);
  const offset = (pagina - 1) * porPagina;

  const condiciones = ['a.organizacion_id = $1'];
  const valores = [orgId];

  if (trabajadorId) { valores.push(trabajadorId); condiciones.push(`a.trabajador_id = $${valores.length}`); }
  if (tipo) { valores.push(tipo); condiciones.push(`a.tipo = $${valores.length}`); }
  if (desde) { valores.push(desde); condiciones.push(`a.fecha_fin >= $${valores.length}`); }
  if (hasta) { valores.push(hasta); condiciones.push(`a.fecha_inicio <= $${valores.length}`); }

  const whereSql = condiciones.join(' AND ');

  try {
    const [filas, total] = await Promise.all([
      query(
        `SELECT a.id, a.trabajador_id, t.nombre_completo, t.area, t.documento,
                a.tipo, a.subsidiado_iess, a.fecha_inicio, a.fecha_fin, a.dias_calendario,
                a.diagnostico_cie10, a.numero_certificado, a.certificado_url,
                a.observaciones, a.origen, a.creado_en
         FROM ausencias a
         JOIN trabajadores t ON t.id = a.trabajador_id
         WHERE ${whereSql}
         ORDER BY a.fecha_inicio DESC
         LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
        [...valores, porPagina, offset]
      ),
      query(`SELECT COUNT(*) AS total FROM ausencias a WHERE ${whereSql}`, valores),
    ]);

    return res.json({
      ausencias: filas.rows.map((f) => minimizarDatosClinicos(f, req.usuario.rol)),
      paginacion: { pagina, porPagina, total: parseInt(total.rows[0].total, 10) },
    });
  } catch (err) {
    console.error('Error en listar (ausentismo):', err);
    return res.status(500).json({ error: 'Error interno al listar las ausencias.' });
  }
}

// ------------------------------------------------------------
// GET /api/ausentismo/:id
// ------------------------------------------------------------
async function obtener(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const resultado = await query(
      `SELECT a.*, t.nombre_completo, t.area, t.documento
       FROM ausencias a
       JOIN trabajadores t ON t.id = a.trabajador_id
       WHERE a.id = $1 AND a.organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Ausencia no encontrada.' });
    }
    return res.json({ ausencia: minimizarDatosClinicos(resultado.rows[0], req.usuario.rol) });
  } catch (err) {
    console.error('Error en obtener (ausentismo):', err);
    return res.status(500).json({ error: 'Error interno al obtener la ausencia.' });
  }
}

// ------------------------------------------------------------
// GET /api/ausentismo/:id/certificado-url
//
// CORREGIDO tras auditoria de seguridad (hallazgo G12): el
// certificado ya no es accesible con una URL publica permanente
// (ver cloudinaryService.js). Este endpoint genera una URL firmada
// de corta duracion, DESPUES de comprobar que el usuario tiene
// permiso para ver el certificado de ESTA ausencia especifica.
//
// CORREGIDO en Auditoria N.07 (C4): se restringe ahora unicamente a
// medico (igual umbral que minimizarDatosClinicos arriba, tras
// retirar la excepcion de sso). El certificado medico escaneado es
// un documento clinico igual que el diagnostico CIE-10 que
// acompaña; no tiene sentido ocultar el texto del diagnostico pero
// dejar accesible la imagen del certificado que lo contiene.
// ------------------------------------------------------------
async function obtenerUrlCertificado(req, res) {
  const orgId = req.usuario.organizacionId;
  if (req.usuario.rol !== 'medico') {
    return res.status(403).json({ error: 'No tiene permiso para ver el certificado medico.' });
  }
  try {
    const resultado = await query(
      'SELECT certificado_public_id FROM ausencias WHERE id = $1 AND organizacion_id = $2',
      [req.params.id, orgId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Ausencia no encontrada.' });
    }
    const publicId = resultado.rows[0].certificado_public_id;
    if (!publicId) {
      return res.status(404).json({ error: 'Esta ausencia no tiene un certificado adjunto.' });
    }

    await registrarAuditoria({
      organizacionId: orgId,
      usuarioId: req.usuario.id,
      accion: 'ver_certificado_ausentismo',
      entidad: 'ausencia',
      entidadId: req.params.id,
      req,
    });

    return res.json({ url: generarUrlFirmada(publicId, 'imagen') });
  } catch (err) {
    console.error('Error en obtenerUrlCertificado (ausentismo):', err);
    return res.status(500).json({ error: 'Error interno al generar el enlace del certificado.' });
  }
}

// ------------------------------------------------------------
// POST /api/ausentismo
// ------------------------------------------------------------
async function crear(req, res) {
  const orgId = req.usuario.organizacionId;
  const b = req.body;

  const subsidiadoIess = typeof b.subsidiadoIess === 'boolean' ? b.subsidiadoIess : esSubsidiablePorDefecto(b.tipo);

  // CORREGIDO en Auditoria N.10 (hallazgo CRITICO C10-03, P0): esta
  // ruta esta autorizada para admin/sso/th (es correcto: registrar
  // una ausencia es gestion de RRHH/SST, no un acto clinico), pero
  // el diagnostico CIE-10 y el numero de certificado SI son datos
  // clinicos reservados al medico -- el propio
  // minimizarDatosClinicos() de este archivo ya lo trata asi en
  // LECTURA. En escritura, sin embargo, crear() aceptaba
  // diagnosticoCie10/numeroCertificado del body sin ninguna
  // restriccion de rol: un sso o th podia registrar (o inventar) el
  // diagnostico de un trabajador. La auditoria es explicita en que
  // esto debe rechazarse con 403, no ignorarse en silencio (ignorar
  // en silencio esconde el error al usuario y puede dar la falsa
  // impresion de que el diagnostico se guardo).
  if ((b.diagnosticoCie10 || b.numeroCertificado) && req.usuario.rol !== 'medico') {
    return res.status(403).json({
      error: 'Solo un usuario con rol medico puede registrar diagnostico CIE-10 o numero de certificado.',
    });
  }

  try {
    const trabajador = await query(
      `SELECT id FROM trabajadores WHERE id = $1 AND organizacion_id = $2`,
      [b.trabajadorId, orgId]
    );
    if (trabajador.rows.length === 0) {
      return res.status(404).json({ error: 'El trabajador indicado no existe en esta organizacion.' });
    }

    // CORREGIDO en Auditoria N.09 (G-N09-06): subida + INSERT ahora
    // usan el patron compensatorio -- si el INSERT falla, el
    // certificado recien subido se borra de Cloudinary en vez de
    // quedar huerfano. Ver subirEvidenciaConCompensacion().
    let resultado;
    if (b.certificadoBase64) {
      const { resultado: filaInsertada } = await subirEvidenciaConCompensacion(
        b.certificadoBase64, orgId, CARPETA_CERTIFICADOS, {},
        (subida) => query(
          `INSERT INTO ausencias (
            organizacion_id, trabajador_id, tipo, subsidiado_iess, fecha_inicio, fecha_fin,
            diagnostico_cie10, numero_certificado, certificado_url, certificado_public_id,
            observaciones, origen, registrado_por
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'manual',$12)
          RETURNING id, tipo, fecha_inicio, fecha_fin, dias_calendario, creado_en`,
          [
            orgId, b.trabajadorId, b.tipo, subsidiadoIess, b.fechaInicio, b.fechaFin,
            b.diagnosticoCie10 || null, b.numeroCertificado || null, subida.url, subida.publicId,
            b.observaciones || null, req.usuario.id,
          ]
        )
      );
      resultado = filaInsertada;
    } else {
      resultado = await query(
        `INSERT INTO ausencias (
          organizacion_id, trabajador_id, tipo, subsidiado_iess, fecha_inicio, fecha_fin,
          diagnostico_cie10, numero_certificado, certificado_url, certificado_public_id,
          observaciones, origen, registrado_por
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'manual',$12)
        RETURNING id, tipo, fecha_inicio, fecha_fin, dias_calendario, creado_en`,
        [
          orgId, b.trabajadorId, b.tipo, subsidiadoIess, b.fechaInicio, b.fechaFin,
          b.diagnosticoCie10 || null, b.numeroCertificado || null, null, null,
          b.observaciones || null, req.usuario.id,
        ]
      );
    }

    await registrarAuditoria({
      organizacionId: orgId,
      usuarioId: req.usuario.id,
      accion: 'crear_ausencia',
      entidad: 'ausencia',
      entidadId: resultado.rows[0].id,
      detalle: { tipo: b.tipo, dias: resultado.rows[0].dias_calendario },
      req,
    });

    return res.status(201).json({ ausencia: resultado.rows[0] });
  } catch (err) {
    console.error('Error en crear (ausentismo):', err);
    return res.status(500).json({ error: 'Error interno al registrar la ausencia.' });
  }
}

// ------------------------------------------------------------
// PUT /api/ausentismo/:id
// No permite cambiar el trabajador (si se registro mal el
// trabajador, se elimina la fila y se crea una nueva).
// ------------------------------------------------------------
async function actualizar(req, res) {
  const orgId = req.usuario.organizacionId;
  const b = req.body;

  try {
    const existente = await query(
      `SELECT certificado_public_id, diagnostico_cie10, numero_certificado
       FROM ausencias WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, orgId]
    );
    if (existente.rows.length === 0) {
      return res.status(404).json({ error: 'Ausencia no encontrada.' });
    }

    // CORREGIDO tras auditoria de seguridad: como listar()/obtener() ya
    // no envian diagnostico_cie10/numero_certificado a roles no
    // clinicos (ver minimizarDatosClinicos), el formulario de edicion
    // de TH/admin llega SIN esos valores. Si aqui simplemente
    // guardabamos b.diagnosticoCie10 tal cual, un TH que solo queria
    // corregir una fecha habria borrado sin darse cuenta el
    // diagnostico ya registrado. Por eso: si el rol no puede ver
    // estos campos, se preservan intactos sin importar lo que venga
    // en el body.
    //
    // CORREGIDO en Auditoria N.10 (hallazgo CRITICO C10-03, P0): la
    // linea original incluia 'sso' en puedeEditarDatosClinicos,
    // contradiciendo la propia politica documentada un par de lineas
    // mas abajo (que dice "reservados al medico"). Ahora solo
    // 'medico' puede escribir estos campos. Ademas, la auditoria pide
    // explicitamente que un rol no autorizado que SI intenta cambiar
    // el valor reciba 403 (no que se ignore en silencio) -- se
    // distingue de "el campo simplemente no vino en el body" (eso
    // sigue preservando el valor existente, para no romper el caso ya
    // corregido de TH editando solo la fecha).
    const esMedico = req.usuario.rol === 'medico';
    const intentaCambiarDatosClinicos =
      !esMedico
      && ((b.diagnosticoCie10 !== undefined && (b.diagnosticoCie10 || null) !== existente.rows[0].diagnostico_cie10)
        || (b.numeroCertificado !== undefined && (b.numeroCertificado || null) !== existente.rows[0].numero_certificado));
    if (intentaCambiarDatosClinicos) {
      return res.status(403).json({
        error: 'Solo un usuario con rol medico puede modificar el diagnostico CIE-10 o el numero de certificado.',
      });
    }
    const diagnosticoCie10Final = esMedico ? (b.diagnosticoCie10 || null) : existente.rows[0].diagnostico_cie10;
    const numeroCertificadoFinal = esMedico ? (b.numeroCertificado || null) : existente.rows[0].numero_certificado;

    let certificadoUrl;
    let certificadoPublicId = existente.rows[0].certificado_public_id;
    let actualizarCertificado = false;

    if (b.certificadoBase64) {
      if (certificadoPublicId) {
        await borrarEvidencia(certificadoPublicId, 'imagen').catch((err) =>
          console.error('No se pudo borrar el certificado anterior en Cloudinary:', err.message)
        );
      }
      const subida = await subirEvidencia(b.certificadoBase64, orgId, CARPETA_CERTIFICADOS);
      certificadoUrl = subida.url;
      certificadoPublicId = subida.publicId;
      actualizarCertificado = true;
    }

    const subsidiadoIess = typeof b.subsidiadoIess === 'boolean' ? b.subsidiadoIess : esSubsidiablePorDefecto(b.tipo);

    const resultado = actualizarCertificado
      ? await query(
          `UPDATE ausencias SET
             tipo = $1, subsidiado_iess = $2, fecha_inicio = $3, fecha_fin = $4,
             diagnostico_cie10 = $5, numero_certificado = $6, observaciones = $7,
             certificado_url = $8, certificado_public_id = $9
           WHERE id = $10 AND organizacion_id = $11
           RETURNING id, tipo, fecha_inicio, fecha_fin, dias_calendario, actualizado_en`,
          [b.tipo, subsidiadoIess, b.fechaInicio, b.fechaFin, diagnosticoCie10Final, numeroCertificadoFinal, b.observaciones || null, certificadoUrl, certificadoPublicId, req.params.id, orgId]
        )
      : await query(
          `UPDATE ausencias SET
             tipo = $1, subsidiado_iess = $2, fecha_inicio = $3, fecha_fin = $4,
             diagnostico_cie10 = $5, numero_certificado = $6, observaciones = $7
           WHERE id = $8 AND organizacion_id = $9
           RETURNING id, tipo, fecha_inicio, fecha_fin, dias_calendario, actualizado_en`,
          [b.tipo, subsidiadoIess, b.fechaInicio, b.fechaFin, diagnosticoCie10Final, numeroCertificadoFinal, b.observaciones || null, req.params.id, orgId]
        );

    await registrarAuditoria({
      organizacionId: orgId,
      usuarioId: req.usuario.id,
      accion: 'actualizar_ausencia',
      entidad: 'ausencia',
      entidadId: req.params.id,
      req,
    });

    return res.json({ ausencia: resultado.rows[0] });
  } catch (err) {
    console.error('Error en actualizar (ausentismo):', err);
    return res.status(500).json({ error: 'Error interno al actualizar la ausencia.' });
  }
}

// ------------------------------------------------------------
// DELETE /api/ausentismo/:id
// Eliminacion real: una ausencia mal registrada simplemente se
// borra (no hay implicancia medico-legal de historial
// append-only aqui, a diferencia de aptitud/consentimientos). Si
// tenia certificado adjunto, tambien se borra de Cloudinary.
// ------------------------------------------------------------
async function eliminar(req, res) {
  const orgId = req.usuario.organizacionId;
  try {
    const resultado = await query(
      `DELETE FROM ausencias WHERE id = $1 AND organizacion_id = $2 RETURNING certificado_public_id`,
      [req.params.id, orgId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Ausencia no encontrada.' });
    }

    const publicId = resultado.rows[0].certificado_public_id;
    if (publicId) {
      await borrarEvidencia(publicId, 'imagen').catch((err) =>
        console.error('No se pudo borrar el certificado en Cloudinary:', err.message)
      );
    }

    await registrarAuditoria({
      organizacionId: orgId,
      usuarioId: req.usuario.id,
      accion: 'eliminar_ausencia',
      entidad: 'ausencia',
      entidadId: req.params.id,
      req,
    });

    return res.json({ eliminado: true });
  } catch (err) {
    console.error('Error en eliminar (ausentismo):', err);
    return res.status(500).json({ error: 'Error interno al eliminar la ausencia.' });
  }
}

// ------------------------------------------------------------
// POST /api/ausentismo/importar
// Mismo patron que trabajadoresController.importarMasivo: recibe
// filas ya parseadas por SheetJS en el frontend, procesa una por
// una y devuelve un detalle fila por fila. No admite certificados
// adjuntos por esta via.
//
// Columnas esperadas por fila: documento (del trabajador, para
// ubicarlo), tipo, fechaInicio, fechaFin, numeroCertificado
// (opcional), observaciones (opcional).
// ------------------------------------------------------------
async function importarMasivo(req, res) {
  const orgId = req.usuario.organizacionId;
  const filas = req.body.ausencias;

  if (!Array.isArray(filas) || filas.length === 0) {
    return res.status(400).json({ error: 'Debe enviar un arreglo "ausencias" con al menos una fila.' });
  }
  if (filas.length > 1000) {
    return res.status(400).json({ error: 'Maximo 1000 filas por importacion. Divida el archivo en partes mas pequenas.' });
  }

  const resultados = [];
  let creados = 0;
  let fallidos = 0;

  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i];
    const numeroFila = i + 2;

    const documento = (fila.documento || '').toString().trim();
    const tipo = (fila.tipo || '').toString().trim();
    const fechaInicio = (fila.fechaInicio || '').toString().trim();
    const fechaFin = (fila.fechaFin || '').toString().trim();

    if (!documento || !tipo || !fechaInicio || !fechaFin) {
      resultados.push({ fila: numeroFila, documento: documento || '(vacio)', estado: 'error', mensaje: 'Faltan columnas obligatorias (documento, tipo, fechaInicio, fechaFin).' });
      fallidos++;
      continue;
    }
    if (!CODIGOS_VALIDOS.includes(tipo)) {
      resultados.push({ fila: numeroFila, documento, estado: 'error', mensaje: `Tipo de ausencia "${tipo}" no reconocido.` });
      fallidos++;
      continue;
    }

    try {
      const trabajador = await query(
        `SELECT id FROM trabajadores WHERE organizacion_id = $1 AND documento = $2`,
        [orgId, documento]
      );
      if (trabajador.rows.length === 0) {
        resultados.push({ fila: numeroFila, documento, estado: 'error', mensaje: 'No existe ningun trabajador con ese documento en esta organizacion.' });
        fallidos++;
        continue;
      }

      const subsidiadoIess = esSubsidiablePorDefecto(tipo);

      const insertado = await query(
        `INSERT INTO ausencias (
          organizacion_id, trabajador_id, tipo, subsidiado_iess, fecha_inicio, fecha_fin,
          numero_certificado, observaciones, origen, registrado_por
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'importacion_masiva',$9)
        RETURNING id, dias_calendario`,
        [
          orgId, trabajador.rows[0].id, tipo, subsidiadoIess, fechaInicio, fechaFin,
          (fila.numeroCertificado || '').toString().trim() || null,
          (fila.observaciones || '').toString().trim() || null,
          req.usuario.id,
        ]
      );

      creados++;
      resultados.push({ fila: numeroFila, documento, estado: 'creado', id: insertado.rows[0].id, dias: insertado.rows[0].dias_calendario });
    } catch (err) {
      console.error(`Error importando fila ${numeroFila} (documento ${documento}):`, err.message);
      resultados.push({ fila: numeroFila, documento, estado: 'error', mensaje: 'Error interno al guardar esta fila (revise que las fechas sean validas y fechaFin >= fechaInicio).' });
      fallidos++;
    }
  }

  await registrarAuditoria({
    organizacionId: orgId,
    usuarioId: req.usuario.id,
    accion: 'importar_ausencias_masivo',
    entidad: 'ausencia',
    detalle: { total: filas.length, creados, fallidos },
    req,
  });

  return res.status(200).json({
    resumen: { total: filas.length, creados, fallidos },
    detalle: resultados,
  });
}

// ------------------------------------------------------------
// GET /api/ausentismo/resumen
// KPIs de ausentismo para un rango de fechas (por defecto,
// ultimos 12 meses): dias perdidos totales, ausencias y dias por
// tipo, y el top 10 de trabajadores con mas dias de ausencia.
// ------------------------------------------------------------
async function resumen(req, res) {
  const orgId = req.usuario.organizacionId;
  const desde = req.query.desde || null;
  const hasta = req.query.hasta || null;

  const condiciones = ['a.organizacion_id = $1'];
  const valores = [orgId];
  if (desde) { valores.push(desde); condiciones.push(`a.fecha_fin >= $${valores.length}`); }
  if (hasta) { valores.push(hasta); condiciones.push(`a.fecha_inicio <= $${valores.length}`); }
  if (!desde && !hasta) { condiciones.push(`a.fecha_inicio >= CURRENT_DATE - INTERVAL '12 months'`); }
  const whereSql = condiciones.join(' AND ');

  try {
    const [totales, porTipo, topTrabajadores, totalTrabajadoresRes] = await Promise.all([
      query(
        `SELECT COUNT(*) AS total_ausencias, COALESCE(SUM(dias_calendario), 0) AS total_dias
         FROM ausencias a WHERE ${whereSql}`,
        valores
      ),
      query(
        `SELECT tipo, COUNT(*) AS ausencias, COALESCE(SUM(dias_calendario), 0) AS dias
         FROM ausencias a WHERE ${whereSql}
         GROUP BY tipo ORDER BY dias DESC`,
        valores
      ),
      query(
        `SELECT t.id AS trabajador_id, t.nombre_completo, t.area,
                COUNT(*) AS ausencias, SUM(a.dias_calendario) AS dias
         FROM ausencias a
         JOIN trabajadores t ON t.id = a.trabajador_id
         WHERE ${whereSql}
         GROUP BY t.id, t.nombre_completo, t.area
         ORDER BY dias DESC
         LIMIT 10`,
        valores
      ),
      query(`SELECT COUNT(*) AS total FROM trabajadores WHERE organizacion_id = $1 AND activo = true`, [orgId]),
    ]);

    const totalDias = parseInt(totales.rows[0].total_dias, 10);
    const totalTrabajadores = parseInt(totalTrabajadoresRes.rows[0].total, 10);

    return res.json({
      rango: { desde, hasta: hasta || null, porDefectoUltimos12Meses: !desde && !hasta },
      totalAusencias: parseInt(totales.rows[0].total_ausencias, 10),
      totalDias,
      diasPromedioPorTrabajador: totalTrabajadores > 0 ? Math.round((totalDias / totalTrabajadores) * 10) / 10 : 0,
      porTipo: porTipo.rows.map((f) => ({ tipo: f.tipo, ausencias: parseInt(f.ausencias, 10), dias: parseInt(f.dias, 10) })),
      topTrabajadores: topTrabajadores.rows.map((f) => ({
        trabajadorId: f.trabajador_id,
        nombreCompleto: f.nombre_completo,
        area: f.area,
        ausencias: parseInt(f.ausencias, 10),
        dias: parseInt(f.dias, 10),
      })),
    });
  } catch (err) {
    console.error('Error en resumen (ausentismo):', err);
    return res.status(500).json({ error: 'Error interno al calcular el resumen de ausentismo.' });
  }
}

module.exports = { obtenerCatalogos, listar, obtener, obtenerUrlCertificado, crear, actualizar, eliminar, importarMasivo, resumen };
