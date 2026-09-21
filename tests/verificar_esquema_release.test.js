// Auditoria N.19 (C19-02): pruebas SIN base de datos del verificador de
// esquema de release. La comprobacion contra una base real se hace con
// `npm run verificar:esquema` apuntando a la base de destino.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { columnasEsperadas, sinComentariosSql, listarMigraciones } = require('../scripts/verificar_esquema_release');

test('C19-02: el verificador exige las columnas que agrega la migracion 093', () => {
  const esperadas = columnasEsperadas(listarMigraciones());
  const cols = esperadas.get('evaluaciones_ocupacionales');
  assert.ok(cols, 'evaluaciones_ocupacionales debe figurar en el manifiesto');
  assert.ok(cols.has('incidentes'));
  assert.ok(cols.has('tiempo_puesto_actual_meses'));
});

test('C19-02: el DDL comentado no genera columnas esperadas', () => {
  const sql = sinComentariosSql('-- ALTER TABLE x ADD COLUMN fantasma INT;\n/* ALTER TABLE y ADD COLUMN otra INT; */\nSELECT 1;');
  assert.ok(!/fantasma|otra/.test(sql));
});

test('C19-02: importar el verificador no abre conexion a la base', () => {
  // Si abriera el pool al importarse, esta prueba dejaria el proceso colgado.
  assert.equal(typeof columnasEsperadas, 'function');
});
