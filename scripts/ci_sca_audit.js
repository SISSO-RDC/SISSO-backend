#!/usr/bin/env node
// ============================================================
// SCA (analisis de dependencias de PRODUCCION) para el CI.
//
// Reemplaza al comando directo `npm audit --omit=dev --audit-level=high`
// con la MISMA politica (falla ante cualquier vulnerabilidad de
// severidad alta o critica en dependencias de produccion) pero con
// UNA unica salvedad posible: una lista EXPLICITA de excepciones por
// ID de advisory, cada una con su justificacion escrita. `npm audit`
// no ofrece una forma nativa de ignorar un advisory concreto.
//
// REGLAS PARA AGREGAR UNA EXCEPCION (no es un cajon de sastre):
//   1. Solo para un advisory SIN parche publicado (no para evitar
//      actualizar algo que si tiene arreglo).
//   2. Con analisis de alcanzabilidad escrito: por que el codigo
//      vulnerable NO se ejecuta en este sistema.
//   3. Con una condicion de salida: cuando se debe quitar.
//   4. Idealmente respaldada por un test que falle si la premisa
//      deja de ser cierta (ver tests/sca_auditoria_dependencias.test.js).
//
// Si una excepcion ya no hace falta (el advisory desaparecio porque
// salio un parche), este script lo avisa para que se elimine.
// ============================================================
const { spawnSync } = require('child_process');
const fs = require('fs');

const SEVERIDADES_BLOQUEANTES = ['high', 'critical'];

const EXCEPCIONES = {
  // Oct 2026 -- firma electronica criptografica (.p12).
  'GHSA-86w9-cpqp-85rv': {
    paquete: 'node-forge',
    resumen: 'RSA PKCS#1 v1.5: la VERIFICACION de firmas acepta elementos DigestAlgorithm anidados extra (rango afectado <=1.4.0).',
    sinParche: 'La ultima version publicada de node-forge (1.4.0) sigue afectada; no existe version corregida.',
    alcanzabilidad:
      'El defecto esta en la ruta de VERIFICACION de firmas RSA. SISSO solo usa node-forge para (a) abrir el .p12 y leer el '
      + 'certificado y (b) a traves de @signpdf/signer-p12, CREAR firmas con la llave privada. No verifica firmas RSA con node-forge '
      + 'en ningun punto (jwt.verify de jsonwebtoken no usa node-forge).',
    salida:
      'Quitar esta excepcion cuando salga una version de node-forge > 1.4.0 que corrija el advisory, o ANTES si algun codigo del '
      + 'proyecto empieza a verificar firmas con node-forge (el test tests/sca_auditoria_dependencias.test.js lo detecta).',
  },
};

/**
 * Reduce el JSON de `npm audit` a la lista de advisories reales (objetos
 * `via`), deduplicados. Los paquetes que solo aparecen como "afectados por
 * depender de otro" (via = string) NO se cuentan aparte: su causa raiz ya
 * esta en el advisory de origen.
 */
function extraerAdvisories(auditJson) {
  const porId = new Map();
  for (const [nombrePaquete, info] of Object.entries(auditJson.vulnerabilities || {})) {
    for (const via of info.via || []) {
      if (typeof via !== 'object' || !via.url) continue;
      const ghsa = (via.url.match(/GHSA-[a-z0-9-]+/i) || [null])[0];
      const id = ghsa || String(via.source);
      if (!porId.has(id)) {
        porId.set(id, { id, paquete: via.name || nombrePaquete, severidad: via.severity, titulo: via.title, url: via.url, rango: via.range });
      }
    }
  }
  return [...porId.values()];
}

/**
 * @returns {{ ok: boolean, bloqueantes: object[], exceptuados: object[], excepcionesObsoletas: string[] }}
 */
function evaluarAuditoria(auditJson, excepciones = EXCEPCIONES) {
  const advisories = extraerAdvisories(auditJson);
  const bloqueantesBrutos = advisories.filter((a) => SEVERIDADES_BLOQUEANTES.includes(a.severidad));
  const exceptuados = bloqueantesBrutos.filter((a) => excepciones[a.id]);
  const bloqueantes = bloqueantesBrutos.filter((a) => !excepciones[a.id]);
  const idsPresentes = new Set(advisories.map((a) => a.id));
  const excepcionesObsoletas = Object.keys(excepciones).filter((id) => !idsPresentes.has(id));
  return { ok: bloqueantes.length === 0, bloqueantes, exceptuados, excepcionesObsoletas };
}

function main() {
  let auditJson;
  const rutaArchivo = process.argv[2];
  if (rutaArchivo) {
    auditJson = JSON.parse(fs.readFileSync(rutaArchivo, 'utf8'));
  } else {
    // npm audit sale con codigo != 0 cuando hay hallazgos pero igual imprime el JSON.
    const r = spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    try {
      auditJson = JSON.parse(r.stdout);
    } catch (err) {
      console.error('ERROR: no se pudo interpretar la salida de `npm audit --json`. Salida:\n', r.stdout, r.stderr);
      process.exit(2);
    }
    if (auditJson.error) {
      console.error('ERROR: npm audit devolvio un error (¿sin acceso al registro?):', JSON.stringify(auditJson.error));
      process.exit(2);
    }
  }

  const { ok, bloqueantes, exceptuados, excepcionesObsoletas } = evaluarAuditoria(auditJson);

  for (const a of exceptuados) {
    const ex = EXCEPCIONES[a.id];
    console.log(`EXCEPCION VIGENTE: ${a.id} (${a.paquete}, ${a.severidad}) -- ${a.titulo}`);
    console.log(`  Sin parche: ${ex.sinParche}`);
    console.log(`  Alcanzabilidad: ${ex.alcanzabilidad}`);
    console.log(`  Condicion de salida: ${ex.salida}`);
  }
  for (const id of excepcionesObsoletas) {
    console.log(`AVISO: la excepcion ${id} ya no corresponde a ningun hallazgo -- eliminarla de scripts/ci_sca_audit.js.`);
  }

  if (!ok) {
    console.error('\nSCA FALLO: vulnerabilidades de severidad alta/critica en dependencias de produccion SIN excepcion:');
    for (const a of bloqueantes) console.error(`  - [${a.severidad}] ${a.paquete}: ${a.titulo} (${a.url}) rango afectado: ${a.rango}`);
    console.error('\nSolucion habitual: `npm audit fix` (o actualizar la dependencia) y confirmar el package-lock.json.');
    process.exit(1);
  }
  console.log('\nSCA OK: sin vulnerabilidades altas/criticas en produccion (salvo las excepciones justificadas arriba, si las hay).');
}

if (require.main === module) main();

module.exports = { evaluarAuditoria, extraerAdvisories, EXCEPCIONES };
