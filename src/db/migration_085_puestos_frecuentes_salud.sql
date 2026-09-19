-- ============================================================
-- Migracion 085: segundo tipo materializado del motor sectorial
-- (Auditoria N.17, C-17-03) -- 'puesto'.
--
-- HALLAZGO ENCONTRADO AL IMPLEMENTAR ESTE LOTE (no pedido, pero
-- bloqueaba probar 'puesto' de cualquier forma): la columna
-- catalogo_sectores.puestos_frecuentes (creada en migration_077,
-- motor base) esta VACIA ('[]') en los 14 sectores, sin ninguna
-- excepcion. Esto significa que /propuestas/generar jamas genero
-- una sola propuesta de tipo 'puesto' en ninguna organizacion real
-- hasta ahora -- el tipo estaba muerto en la practica, no solo sin
-- materializador. Esta migracion llena el catalogo SOLO para
-- 'salud' (mismo sector que usan las pruebas de N.17 Lote 1 y de
-- C-17-03/area) para poder probarlo de verdad. Los otros 13
-- sectores quedan con el mismo vacio que ya tenian -- llenarlos a
-- todos es un trabajo de contenido aparte, no de esta correccion.
--
-- Cada elemento es {nombre, area} -- 'area' es solo una SUGERENCIA
-- de texto libre (coincide con una de las areas de
-- catalogo_sectores.areas para 'salud'), no una referencia dura:
-- puestos_trabajo.area sigue siendo texto libre sin FK (ver
-- migration_022 y el comentario junto a MATERIALIZADORES.puesto en
-- configuracionSectorialController.js) -- aceptar la propuesta de
-- puesto NO exige que la propuesta de esa area ya haya sido
-- aceptada.
-- ============================================================

UPDATE catalogo_sectores
SET puestos_frecuentes = '[
  {"nombre": "Medico general",            "area": "Consultorios"},
  {"nombre": "Medico especialista",       "area": "Consultorios"},
  {"nombre": "Enfermero/a",               "area": "Emergencias"},
  {"nombre": "Auxiliar de enfermeria",    "area": "UCI / Cuidados intensivos"},
  {"nombre": "Instrumentista quirurgico", "area": "Quirofano"},
  {"nombre": "Anestesiologo",             "area": "Quirofano"},
  {"nombre": "Tecnologo de laboratorio",  "area": "Laboratorio clinico"},
  {"nombre": "Tecnologo en radiologia",   "area": "Rayos X / Imagenes"},
  {"nombre": "Quimico farmaceutico",      "area": "Farmacia"},
  {"nombre": "Camillero",                 "area": "Emergencias"},
  {"nombre": "Personal de lavanderia",    "area": "Lavanderia"},
  {"nombre": "Personal de cocina",        "area": "Cocina y nutricion"},
  {"nombre": "Auxiliar administrativo",   "area": "Administracion"}
]'::jsonb
WHERE clave = 'salud';

INSERT INTO schema_migrations (version) VALUES ('085_puestos_frecuentes_salud')
ON CONFLICT (version) DO NOTHING;
