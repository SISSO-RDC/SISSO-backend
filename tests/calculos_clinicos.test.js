// ============================================================
// Pruebas unitarias PURAS (sin base de datos) de los modulos de
// calculo clinico src/audiometria/audiometria.js y
// src/espirometria/espirometria.js.
//
// CREADO en Auditoria N.12 para cerrar dos rubros de la calificacion
// detallada que estaban por debajo de 7/10:
//   - "Calculos clinicos" (6.2/10): los bugs G12-01, G12-02, G12-04
//     y C12-02 se originaron en parte porque estas funciones puras
//     no tenian ninguna prueba automatizada que fijara su
//     comportamiento esperado con casos de referencia conocidos.
//   - "QA automatizado" (6.3/10): el suite existente cubre muy bien
//     RBAC/RLS/atomicidad pero no tenia NINGUNA prueba de las
//     formulas clinicas en si.
//
// Estas pruebas no requieren Postgres: importan los modulos
// directamente y verifican casos de referencia con valores
// conocidos (no solo "no explota", sino "el resultado clinico es
// el correcto para este caso de libro").
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');

const audiometria = require('../src/audiometria/audiometria');
const espirometria = require('../src/espirometria/espirometria');

// ------------------------------------------------------------
// AUDIOMETRIA
// ------------------------------------------------------------

test('G12-01: calcularPromedioAgudos exige las 3 frecuencias (2000/3000/4000 Hz), no acepta 2 de 3', () => {
  assert.equal(audiometria.calcularPromedioAgudos(10, 15, 20), 15);
  assert.equal(audiometria.calcularPromedioAgudos(10, 15, null), null);
  assert.equal(audiometria.calcularPromedioAgudos(undefined, 15, 20), null);
});

test('G12-02 (regresion de negocio, no solo del bug ||null): un umbral de 0 dB HL es un dato valido y debe participar en el promedio', () => {
  // 0 dB HL en 2000/3000/4000 es audicion excelente; el promedio
  // real es 0, no "sin datos". Esto fija el comportamiento correcto
  // de calcularPromedioAgudos para el caso que goxponia el bug
  // ||null en audiometriaController.js (ya corregido con numOrNull/??).
  assert.equal(audiometria.calcularPromedioAgudos(0, 0, 0), 0);
  assert.equal(audiometria.calcularPromedioAgudos(0, 5, 10), 5);
});

test('calcularSTS: cambio >=10 dB en el promedio de agudos es positivo (criterio OSHA), y datosInsuficientes es explicito', () => {
  const stsPositivo = audiometria.calcularSTS(
    { hz2000: 20, hz3000: 25, hz4000: 30 }, // promedio 25
    { hz2000: 10, hz3000: 15, hz4000: 20 }  // promedio 15 -> cambio 10
  );
  assert.equal(stsPositivo.esPositivo, true);
  assert.equal(stsPositivo.cambio, 10);
  assert.equal(stsPositivo.datosInsuficientes, false);

  const stsNegativo = audiometria.calcularSTS(
    { hz2000: 12, hz3000: 15, hz4000: 18 },
    { hz2000: 10, hz3000: 15, hz4000: 20 }
  );
  assert.equal(stsNegativo.esPositivo, false);

  const stsSinDatos = audiometria.calcularSTS(
    { hz2000: 12, hz3000: null, hz4000: 18 },
    { hz2000: 10, hz3000: 15, hz4000: 20 }
  );
  assert.equal(stsSinDatos.datosInsuficientes, true);
  assert.equal(stsSinDatos.cambio, null);
});

test('G12-04: el patron de notch se etiqueta como tamizaje ("notch_ocupacional_tamizaje"), nunca como diagnostico confirmado', () => {
  // Curva compatible con notch: caida marcada en 4000 Hz respecto
  // de 1000 Hz, con recuperacion parcial en 8000 Hz.
  const patron = audiometria.clasificarPatron({
    hz500: 10, hz1000: 10, hz2000: 15, hz3000: 30, hz4000: 45, hz6000: 35, hz8000: 15,
  });
  assert.equal(patron, 'notch_ocupacional_tamizaje');
});

test('clasificarPatron: audiometria normal (todo <=25 dB) se clasifica como normal', () => {
  const patron = audiometria.clasificarPatron({
    hz500: 10, hz1000: 10, hz2000: 10, hz3000: 15, hz4000: 15, hz6000: 15, hz8000: 15,
  });
  assert.equal(patron, 'normal');
});

// ------------------------------------------------------------
// ESPIROMETRIA
// ------------------------------------------------------------

test('C12-02: el patron ya NO usa el cociente fijo 0.70 como criterio principal -- un joven con ratio bajo el LLN especifico se marca obstructivo aunque el ratio este por encima de 0.70', () => {
  // Persona joven: predicho de ratio alto (~84-85%). Un ratio medido
  // de 78% esta POR ENCIMA de 0.70 (el corte fijo antiguo lo habria
  // llamado "normal"), pero por debajo del LLN especifico para su
  // edad -- debe clasificarse como obstructivo con el nuevo criterio.
  const predichos = espirometria.calcularValoresPredichos('M', 22, 178);
  assert.ok(predichos.fev1FvcLln > 70, `Este caso solo tiene sentido si el LLN calculado (${predichos.fev1FvcLln}) supera 70, para poder diferenciarse del corte fijo.`);

  const fvcPre = predichos.fvcPredicho; // FVC normal
  const fev1Pre = Math.round((fvcPre * 0.745) * 100) / 100; // ratio medido ~74.5%: por debajo del LLN (~76.8) pero por encima de 0.70

  const resultado = espirometria.calcularEspirometria(
    {
      fvcPre, fev1Pre,
      calidad: { numeroManiobras: 3, mejorFvcL: fvcPre, segundaMejorFvcL: fvcPre - 0.05, mejorFev1L: fev1Pre, segundaMejorFev1L: fev1Pre - 0.05 },
    },
    'M', 22, 178
  );

  assert.ok(resultado.fev1FvcMedido > 70, 'El ratio medido debe seguir por encima de 0.70 para que el caso sea representativo.');
  assert.notEqual(resultado.patron, 'normal');
  assert.match(resultado.patron, /^obstructivo_/);
});

test('C12-02: reversibilidad post-broncodilatador usa >10% del predicho, no >=12%+200mL del valor pre-BD', () => {
  const predichos = espirometria.calcularValoresPredichos('M', 40, 175);
  // Cambio de 350 mL sobre un predicho de FEV1 ~3.87L es ~9% del
  // predicho -> NO positivo con el criterio nuevo (>10%), aunque
  // cumpliria el viejo criterio 2005 (200 mL y podria superar 12%
  // del valor PRE si el valor pre era bajo).
  const rev = espirometria.calcularReversibilidad(2.0, 2.35, predichos.fev1Predicho);
  assert.equal(rev.esPositiva, false);

  const rev2 = espirometria.calcularReversibilidad(2.0, 2.40, predichos.fev1Predicho);
  assert.equal(rev2.esPositiva, true);
});

test('C12-02: una espirometria sin datos de calidad de maniobra queda marcada interpretable=false (no se asume buena calidad por defecto)', () => {
  const resultado = espirometria.calcularEspirometria({ fvcPre: 4.0, fev1Pre: 3.2 }, 'M', 30, 175);
  assert.equal(resultado.interpretable, false);
  assert.equal(resultado.calidad.grado, 'U');
});

test('C12-02: una espirometria con maniobras suficientes y buena repetibilidad (<=150 mL) queda interpretable=true, grado A', () => {
  const resultado = espirometria.calcularEspirometria({
    fvcPre: 4.0, fev1Pre: 3.2,
    calidad: { numeroManiobras: 3, mejorFvcL: 4.0, segundaMejorFvcL: 3.92, mejorFev1L: 3.2, segundaMejorFev1L: 3.10 },
  }, 'M', 30, 175);
  assert.equal(resultado.calidad.grado, 'A');
  assert.equal(resultado.interpretable, true);
});

test('C12-02: patron restrictivo sugerido cuando FVC < LLN y el cociente esta dentro de rango normal', () => {
  const predichos = espirometria.calcularValoresPredichos('F', 35, 162);
  const fvcPre = predichos.fvcLln - 0.1; // debajo del LLN de FVC
  const fev1Pre = Math.round((fvcPre * (predichos.fev1FvcPredicho / 100)) * 100) / 100; // ratio ~predicho, normal

  const resultado = espirometria.calcularEspirometria({
    fvcPre, fev1Pre,
    calidad: { numeroManiobras: 3, mejorFvcL: fvcPre, segundaMejorFvcL: fvcPre - 0.05, mejorFev1L: fev1Pre, segundaMejorFev1L: fev1Pre - 0.05 },
  }, 'F', 35, 162);

  assert.equal(resultado.patron, 'restrictivo_sugerido');
});
