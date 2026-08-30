// ============================================================
// SISSO - Validador ligero tipo JSON Schema, sin dependencias
// externas, para campos JSONB clinicos.
//
// CREADO en Auditoria N.12 (hallazgo GRAVE G12-10, P1): varios
// campos JSONB clinicos (ej. `regiones` del Cuestionario Nordico)
// solo validaban que las CLAVES de primer nivel fueran conocidas,
// pero no la FORMA de cada valor -- un campo `intensidad` podia
// llegar como texto libre en vez de un numero 0-5, o `lado` con
// cualquier string en vez de uno de los 3 valores validos. Como esos
// campos alimentan directamente calcularResumenNordico() (senal de
// "atencion prioritaria"), un valor mal formado no lanzaba error:
// simplemente se evaluaba como falsy/ignorado, produciendo un
// resumen clinico silenciosamente incompleto.
//
// ALCANCE DE ESTA CORRECCION: se implementa el validador generico
// mas el esquema completo de `regiones` (Cuestionario Nordico) como
// caso de referencia. Extender el mismo patron a otros campos JSONB
// clinicos (ej. antecedentes de Historia Clinica Ocupacional) queda
// como trabajo pendiente para el siguiente ciclo -- no se
// reescribieron esos modulos en esta ronda para no introducir
// regresiones sin poder revisarlas con el mismo detalle.
//
// Por que no usar una libreria (ajv, etc.): SISSO despliega
// subiendo un ZIP a GitHub sin `npm install` local (ver contexto
// operativo); agregar una dependencia nueva implica un riesgo de
// despliegue adicional (paquete faltante en node_modules) para un
// caso de uso que un validador de ~120 lineas cubre sin ambigüedad.
// Si en el futuro se necesita validacion de esquemas mas compleja
// (referencias, composicion oneOf/anyOf), sí conviene reevaluar ajv.
// ============================================================

/**
 * Valida un valor contra un esquema minimo tipo JSON Schema.
 * Soporta: type ('object'|'string'|'number'|'boolean'|'integer'),
 * required (array de claves), properties (mapa clave->esquema),
 * enum (array de valores permitidos), minimum/maximum (numeros),
 * additionalProperties (boolean, default false para 'object').
 *
 * @param {*} valor
 * @param {object} esquema
 * @param {string} ruta - para mensajes de error legibles (uso interno, recursivo)
 * @returns {string[]} lista de errores (vacia si es valido)
 */
function validarContraEsquema(valor, esquema, ruta = '') {
  const errores = [];
  const etiqueta = ruta || '(raiz)';

  if (esquema.type === 'object') {
    if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
      errores.push(`${etiqueta}: se esperaba un objeto.`);
      return errores;
    }
    const propiedades = esquema.properties || {};
    (esquema.required || []).forEach((clave) => {
      if (!(clave in valor)) {
        errores.push(`${etiqueta}.${clave}: es obligatorio.`);
      }
    });
    Object.keys(valor).forEach((clave) => {
      if (propiedades[clave]) {
        errores.push(...validarContraEsquema(valor[clave], propiedades[clave], `${etiqueta}.${clave}`));
      } else if (esquema.additionalProperties === false) {
        errores.push(`${etiqueta}.${clave}: propiedad no reconocida.`);
      }
    });
    return errores;
  }

  if (esquema.type === 'string') {
    if (typeof valor !== 'string') {
      errores.push(`${etiqueta}: se esperaba texto.`);
      return errores;
    }
    if (esquema.enum && !esquema.enum.includes(valor)) {
      errores.push(`${etiqueta}: valor "${valor}" no es uno de los permitidos (${esquema.enum.join(', ')}).`);
    }
    return errores;
  }

  if (esquema.type === 'number' || esquema.type === 'integer') {
    if (typeof valor !== 'number' || Number.isNaN(valor)) {
      errores.push(`${etiqueta}: se esperaba un numero.`);
      return errores;
    }
    if (esquema.type === 'integer' && !Number.isInteger(valor)) {
      errores.push(`${etiqueta}: se esperaba un numero entero.`);
    }
    if (typeof esquema.minimum === 'number' && valor < esquema.minimum) {
      errores.push(`${etiqueta}: debe ser >= ${esquema.minimum}.`);
    }
    if (typeof esquema.maximum === 'number' && valor > esquema.maximum) {
      errores.push(`${etiqueta}: debe ser <= ${esquema.maximum}.`);
    }
    return errores;
  }

  if (esquema.type === 'boolean') {
    if (typeof valor !== 'boolean') {
      errores.push(`${etiqueta}: se esperaba verdadero/falso.`);
    }
    return errores;
  }

  // Tipo de esquema no soportado: no bloquea (fail-open deliberado
  // para no romper por un esquema mal escrito), pero se reporta.
  errores.push(`${etiqueta}: esquema con "type" no soportado (${esquema.type}).`);
  return errores;
}

module.exports = { validarContraEsquema };
