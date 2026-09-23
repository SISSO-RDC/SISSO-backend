// ============================================================
// CREADO en Auditoria N.19 (hallazgo GRAVE G19-11).
//
// Antes, los archivos que el frontend envia como data URI
// (firmas, logos, evidencia, certificados) se validaban solo con
// `startsWith('data:image')`. Eso dejaba pasar:
//   - cualquier subtipo (p. ej. image/svg+xml, que puede llevar
//     scripts) o un contenido que NO era una imagen aunque el
//     encabezado lo dijera;
//   - datos sin limite de tamano por tipo de archivo;
//   - en varios flujos (evidencia REBA/RULA y de accidentes) NO
//     habia validacion alguna: cualquier cadena llegaba al SDK de
//     Cloudinary, que tambien acepta URLs remotas y rutas de archivo
//     locales como "archivo".
//
// Este modulo valida, ANTES de subir:
//   1. Que el valor sea EXACTAMENTE un data URI base64 bien formado.
//   2. Que el tipo MIME declarado este permitido para ese uso.
//   3. Que el tamano decodificado no supere el limite de ese uso.
//   4. Que los primeros bytes del contenido (firma o "magic bytes")
//      correspondan al tipo declarado: un .exe renombrado o un HTML
//      con cabecera "image/png" se rechaza.
// ============================================================

const MB = 1024 * 1024;

const IMAGENES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];

// Politicas por uso. `maxBytes` es el tamano DECODIFICADO maximo.
const POLITICAS = {
  // Firma dibujada en canvas (PNG) o foto de firma/documento firmado.
  firma: { tipos: IMAGENES, maxBytes: 6 * MB },
  // Logo publico de la organizacion: sin HEIC (no se muestra en navegadores).
  logo: { tipos: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 3 * MB },
  // Evidencia fotografica o en video (ergonomia, accidentes).
  evidencia: { tipos: [...IMAGENES, 'video/mp4', 'video/webm', 'video/quicktime'], maxBytes: 12 * MB },
  // Certificado medico: imagen o PDF.
  certificado: { tipos: [...IMAGENES, 'application/pdf'], maxBytes: 10 * MB },
  // CREADO Lote 2 (control documental, Sep 2026): politicas,
  // procedimientos e instructivos. Solo PDF -- un documento
  // controlado versionado no deberia entrar como foto de una
  // pantalla o de una hoja impresa.
  documento_control: { tipos: ['application/pdf'], maxBytes: 20 * MB },
};

class ArchivoInvalidoError extends Error {
  constructor(motivo) {
    super(motivo);
    this.name = 'ArchivoInvalidoError';
    this.status = 400;
  }
}

// data:<mime>[;param=valor]*;base64,<datos>  -- solo base64, sin URLs ni rutas.
const RE_DATA_URI = /^data:([a-z]+\/[a-z0-9.+-]+)((?:;[a-z0-9-]+=[^;,]+)*);base64,([A-Za-z0-9+/]+={0,2})$/;

function empiezaCon(buf, bytes, offset = 0) {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

// ¿Los primeros bytes coinciden con el tipo declarado?
function coincideConTipo(buf, mime) {
  switch (mime) {
    case 'image/png':
      return empiezaCon(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return empiezaCon(buf, [0xff, 0xd8, 0xff]);
    case 'image/webp':
      return empiezaCon(buf, [0x52, 0x49, 0x46, 0x46]) && empiezaCon(buf, [0x57, 0x45, 0x42, 0x50], 8);
    case 'application/pdf':
      return empiezaCon(buf, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case 'video/webm':
      return empiezaCon(buf, [0x1a, 0x45, 0xdf, 0xa3]); // EBML
    case 'image/heic':
    case 'image/heif':
    case 'video/mp4':
    case 'video/quicktime':
      // Contenedor ISO-BMFF: "ftyp" en el offset 4.
      return empiezaCon(buf, [0x66, 0x74, 0x79, 0x70], 4);
    default:
      return false;
  }
}

/**
 * Analiza un data URI segun la politica indicada.
 * @returns {{ok: true, mime: string, bytes: number, esVideo: boolean} | {ok: false, motivo: string}}
 */
function analizarDataUri(valor, politica = 'evidencia') {
  const reglas = POLITICAS[politica];
  if (!reglas) throw new Error(`Politica de archivo desconocida: ${politica}`);
  if (typeof valor !== 'string' || valor.length === 0) {
    return { ok: false, motivo: 'El archivo debe enviarse como una cadena data URI.' };
  }
  // Tope barato ANTES de decodificar: un base64 de N bytes ocupa ~4N/3 caracteres.
  if (valor.length > Math.ceil((reglas.maxBytes * 4) / 3) + 512) {
    return { ok: false, motivo: `El archivo supera el maximo permitido de ${Math.round(reglas.maxBytes / MB)} MB.` };
  }
  const m = RE_DATA_URI.exec(valor);
  if (!m) {
    return { ok: false, motivo: 'El archivo debe ser un data URI base64 valido (data:<tipo>;base64,<datos>).' };
  }
  const mime = m[1];
  if (!reglas.tipos.includes(mime)) {
    return { ok: false, motivo: `Tipo de archivo no permitido (${mime}). Permitidos: ${reglas.tipos.join(', ')}.` };
  }
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length === 0) return { ok: false, motivo: 'El archivo esta vacio.' };
  if (buf.length > reglas.maxBytes) {
    return { ok: false, motivo: `El archivo supera el maximo permitido de ${Math.round(reglas.maxBytes / MB)} MB.` };
  }
  if (!coincideConTipo(buf, mime)) {
    return { ok: false, motivo: `El contenido del archivo no corresponde al tipo declarado (${mime}).` };
  }
  return { ok: true, mime, bytes: buf.length, esVideo: mime.startsWith('video/') };
}

const esDataUriValida = (valor, politica) => analizarDataUri(valor, politica).ok;

// Para express-validator: .custom(validarDataUri('firma'))
function validarDataUri(politica) {
  return (valor) => {
    const r = analizarDataUri(valor, politica);
    if (!r.ok) throw new Error(r.motivo);
    return true;
  };
}

module.exports = { analizarDataUri, esDataUriValida, validarDataUri, ArchivoInvalidoError, POLITICAS };
