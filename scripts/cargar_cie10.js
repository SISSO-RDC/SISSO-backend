// ============================================================
// Script de carga: catalogo CIE-10 completo (uso desde terminal).
//
// Uso: node scripts/cargar_cie10.js  (o: npm run cargar-cie10)
// Requiere DATABASE_URL configurada.
//
// Si no tienes acceso a una terminal con Node (ej. plan Free de
// Render sin Shell), usa en su lugar el endpoint HTTP temporal
// descrito en src/routes/mantenimientoRoutes.js.
//
// La logica real de parseo y carga vive en
// src/utils/cargadorCie10.js, compartida con ese endpoint, para
// no mantener dos implementaciones del mismo proceso.
// ============================================================
require('dotenv').config();
const { pool } = require('../src/db/pool');
const { cargarCatalogoCie10 } = require('../src/utils/cargadorCie10');

cargarCatalogoCie10(pool, (mensaje) => console.log(mensaje))
  .catch((err) => {
    console.error('Error durante la carga del catalogo CIE-10:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
