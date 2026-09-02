// ============================================================
// SISSO - Ausentismo laboral: catalogo de tipos de ausencia y
// helpers de clasificacion.
//
// Clasificacion alineada al criterio de contingencias del IESS
// (enfermedad general, accidente de trabajo, enfermedad
// profesional y maternidad dan derecho a subsidio por incapacidad
// temporal), mas los tipos de ausencia laboral adicionales que
// SSO/RRHH necesita para calcular el ausentismo real de la
// planta (permisos, faltas injustificadas, calamidad domestica).
//
// Este catalogo es la unica fuente de verdad para las etiquetas
// que se muestran en el frontend (se exponen via
// GET /api/ausentismo/catalogos), igual que TIPOS_PELIGRO en
// src/matrizRiesgos/matrizRiesgos.js.
// ============================================================

const TIPOS_AUSENCIA = [
  { codigo: 'enfermedad_general',    etiqueta: 'Enfermedad general',              subsidiablePorDefecto: true },
  { codigo: 'accidente_trabajo',     etiqueta: 'Accidente de trabajo',            subsidiablePorDefecto: true },
  { codigo: 'enfermedad_profesional', etiqueta: 'Enfermedad profesional',         subsidiablePorDefecto: true },
  { codigo: 'maternidad',            etiqueta: 'Licencia de maternidad',          subsidiablePorDefecto: true },
  { codigo: 'paternidad',            etiqueta: 'Licencia de paternidad',          subsidiablePorDefecto: false },
  { codigo: 'accidente_transito',    etiqueta: 'Accidente de tránsito (no laboral)', subsidiablePorDefecto: true },
  { codigo: 'calamidad_domestica',   etiqueta: 'Calamidad doméstica',             subsidiablePorDefecto: false },
  { codigo: 'permiso_con_sueldo',    etiqueta: 'Permiso con sueldo',              subsidiablePorDefecto: false },
  { codigo: 'permiso_sin_sueldo',    etiqueta: 'Permiso sin sueldo',              subsidiablePorDefecto: false },
  { codigo: 'falta_injustificada',   etiqueta: 'Falta injustificada',             subsidiablePorDefecto: false },
  { codigo: 'otro',                  etiqueta: 'Otro',                            subsidiablePorDefecto: false },
];

const CODIGOS_VALIDOS = TIPOS_AUSENCIA.map((t) => t.codigo);

function etiquetaTipo(codigo) {
  const encontrado = TIPOS_AUSENCIA.find((t) => t.codigo === codigo);
  return encontrado ? encontrado.etiqueta : codigo;
}

function esSubsidiablePorDefecto(codigo) {
  const encontrado = TIPOS_AUSENCIA.find((t) => t.codigo === codigo);
  return encontrado ? encontrado.subsidiablePorDefecto : false;
}

module.exports = { TIPOS_AUSENCIA, CODIGOS_VALIDOS, etiquetaTipo, esSubsidiablePorDefecto };
