// ============================================================
// Logica compartida de carga del catalogo CIE-10, usada tanto
// por el script de terminal (scripts/cargar_cie10.js) como por
// el endpoint HTTP temporal (src/routes/mantenimientoRoutes.js),
// para que el plan Free de Render (sin acceso a Shell) tambien
// pueda ejecutar la carga.
//
// Ver scripts/cargar_cie10.js para la explicacion completa de
// por que se usa este CSV de terceros en vez de transcribir el
// catalogo a mano.
// ============================================================
const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '..', 'db', 'seed_data', 'cie-10.csv');

function parsearLineaCSV(linea) {
  const campos = [];
  let actual = '';
  let dentroDeComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      dentroDeComillas = !dentroDeComillas;
    } else if (c === ',' && !dentroDeComillas) {
      campos.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos;
}

/**
 * Carga el catalogo CIE-10 completo en la tabla catalogo_cie10.
 * Es idempotente: usa ON CONFLICT DO NOTHING, por lo que correrlo
 * dos veces no duplica filas ni falla si ya existen.
 *
 * @param {import('pg').Pool} pool
 * @param {(mensaje: string) => void} [onProgreso] callback opcional para reportar avance
 * @returns {Promise<{ filasLeidas: number, totalEnTabla: number }>}
 */
async function cargarCatalogoCie10(pool, onProgreso = () => {}) {
  onProgreso('Leyendo archivo CSV...');
  const contenido = fs.readFileSync(CSV_PATH, 'utf8');
  const lineas = contenido.split(/\r?\n/).filter((l) => l.length > 0);

  const filas = lineas.slice(1).map(parsearLineaCSV);
  onProgreso(`Filas a cargar: ${filas.length}`);

  const TAMANO_LOTE = 500;
  let insertados = 0;

  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const lote = filas.slice(i, i + TAMANO_LOTE);

    const valores = [];
    const placeholders = lote.map((fila, idx) => {
      const base = idx * 9;
      const [code, code_0, code_1, code_2, code_3, code_4, description, level, source] = fila;

      valores.push(
        code.trim(),
        code_0.trim() || null,
        code_1.trim() || null,
        code_2.trim() || null,
        code_3.trim() || null,
        code_4.trim() || null,
        description.trim(),
        parseInt(level.trim(), 10),
        source.trim()
      );

      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
    });

    const sql = `
      INSERT INTO catalogo_cie10
        (codigo, codigo_padre_1, codigo_padre_2, codigo_padre_3, codigo_padre_4, codigo_padre_5, descripcion, nivel, fuente)
      VALUES ${placeholders.join(',')}
      ON CONFLICT (codigo) DO NOTHING;
    `;

    await pool.query(sql, valores);

    insertados += lote.length;
    if (insertados % 2000 === 0 || insertados === filas.length) {
      onProgreso(`  ${insertados} / ${filas.length} filas procesadas...`);
    }
  }

  const conteo = await pool.query('SELECT COUNT(*) FROM catalogo_cie10');
  const totalEnTabla = parseInt(conteo.rows[0].count, 10);
  onProgreso(`Carga completada. Total de filas en catalogo_cie10: ${totalEnTabla}`);

  return { filasLeidas: filas.length, totalEnTabla };
}

module.exports = { cargarCatalogoCie10, parsearLineaCSV };
