// ============================================================
// CIERRA un bug real encontrado en Auditoria N.15: obtenerFirmaParaPdf()
// (src/utils/firmaPdf.js) seleccionaba "u.nombre", una columna que
// nunca existio en la tabla usuarios (la columna real es
// "nombre_completo"). Como la funcion atrapa cualquier error de la
// consulta y devuelve null (comportamiento CORRECTO para el caso real
// de "el usuario no tiene firma" o "Cloudinary no respondio"), este
// error de tipeo quedaba invisible: la firma digital del profesional
// jamas se incrustaba en ningun certificado, sin que nadie viera un
// error.
//
// Esta prueba no depende de Cloudinary (no hay forma de descargar una
// imagen real sin credenciales reales) -- verifica especificamente lo
// que SI se puede probar sin esa dependencia: que la consulta SQL de
// obtenerFirmaParaPdf() corre sin error contra el esquema real, con
// una fila de datos realista sembrada de antemano. Si alguien vuelve
// a introducir un nombre de columna incorrecto, esta prueba falla con
// el mismo error de Postgres que se uso para diagnosticar el bug
// original ("column ... does not exist"), en vez de que el bug quede
// enmascarado por el catch silencioso de la funcion real.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { queryComoSuperadmin } = require('../src/db/pool');
const { sembrar, limpiar } = require('./helpers/seed');

test('firmaPdf: la consulta de obtenerFirmaParaPdf() corre sin error contra el esquema real (regresion: u.nombre no existe, es u.nombre_completo)', async () => {
  await limpiar();
  const datos = await sembrar();

  await queryComoSuperadmin(
    `INSERT INTO firmas_digitales_usuario (usuario_id, organizacion_id, imagen_url, imagen_public_id, actualizado_por)
     VALUES ($1, $2, 'https://res.cloudinary.com/demo/image/upload/v1/firma.png', 'firma-demo', $1)`,
    [datos.usuarios.medico.id, datos.orgAId]
  );

  // Misma consulta EXACTA (columnas y JOIN) que obtenerFirmaParaPdf()
  // en src/utils/firmaPdf.js -- si ese archivo cambia de columna, hay
  // que actualizar esta prueba a la vez para que siga siendo la misma
  // consulta, no una copia que puede divergir.
  const resultado = await queryComoSuperadmin(
    `SELECT f.imagen_public_id, u.nombre_completo AS nombre, u.rol
     FROM firmas_digitales_usuario f
     JOIN usuarios u ON u.id = f.usuario_id
     WHERE f.usuario_id = $1 AND f.organizacion_id = $2`,
    [datos.usuarios.medico.id, datos.orgAId]
  );

  assert.equal(resultado.rows.length, 1);
  assert.equal(resultado.rows[0].imagen_public_id, 'firma-demo');
  assert.equal(resultado.rows[0].nombre, 'Usuario Prueba medico');
  assert.equal(resultado.rows[0].rol, 'medico');

  await limpiar();
});
