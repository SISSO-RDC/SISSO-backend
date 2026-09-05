#!/usr/bin/env node
'use strict';

// ============================================================
// CREADO en Auditoria N.15 (cierra el hallazgo CRITICO C15-01, P0,
// y previene que vuelva a ocurrir).
//
// C15-01 encontro que .env.example simplemente no existia. La causa
// raiz no es solo "falta el archivo": es que nada impedia que, una
// vez creado, se desactualizara en silencio la primera vez que
// alguien agregue un "process.env.NUEVA_VARIABLE" en el codigo sin
// acordarse de documentarla. Este script cierra ese circulo:
// escanea src/ y scripts/ en busca de todo "process.env.X" y falla
// el pipeline de CI si aparece una variable que .env.example no
// menciona.
//
// Deliberadamente NO exige lo inverso (que toda variable de
// .env.example aparezca en el codigo): .env.example puede legitima-
// mente documentar variables opcionales que ya no se usan mientras
// se retiran, o adelantar una variable para una funcionalidad en
// desarrollo, sin que eso deba romper el pipeline.
// ============================================================

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const DIRS_A_ESCANEAR = ['src', 'scripts'];
const ARCHIVO_ENV_EXAMPLE = path.join(RAIZ, '.env.example');

function listarArchivosJs(dir) {
  const resultado = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const rutaCompleta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === 'node_modules') continue;
      resultado.push(...listarArchivosJs(rutaCompleta));
    } else if (entrada.name.endsWith('.js')) {
      resultado.push(rutaCompleta);
    }
  }
  return resultado;
}

function extraerVariablesUsadas() {
  const variables = new Set();
  const regex = /process\.env\.([A-Z][A-Z0-9_]*)/g;
  // Se excluye este mismo script del escaneo: sus comentarios usan
  // "process.env.X" como ejemplo generico y "process.env.NUEVA_VARIABLE"
  // a modo ilustrativo, lo que el regex de arriba detectaria como
  // variables reales por error.
  const rutaPropia = path.resolve(__filename);
  for (const dirRelativo of DIRS_A_ESCANEAR) {
    const dirAbsoluto = path.join(RAIZ, dirRelativo);
    if (!fs.existsSync(dirAbsoluto)) continue;
    for (const archivo of listarArchivosJs(dirAbsoluto)) {
      if (path.resolve(archivo) === rutaPropia) continue;
      const contenido = fs.readFileSync(archivo, 'utf8');
      let coincidencia;
      while ((coincidencia = regex.exec(contenido)) !== null) {
        variables.add(coincidencia[1]);
      }
    }
  }
  return variables;
}

function extraerVariablesDocumentadas() {
  if (!fs.existsSync(ARCHIVO_ENV_EXAMPLE)) {
    console.error(`ERROR: no existe ${ARCHIVO_ENV_EXAMPLE}.`);
    process.exit(1);
  }
  const contenido = fs.readFileSync(ARCHIVO_ENV_EXAMPLE, 'utf8');
  const variables = new Set();
  for (const linea of contenido.split('\n')) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;
    const igual = limpia.indexOf('=');
    if (igual === -1) continue;
    variables.add(limpia.slice(0, igual).trim());
  }
  return variables;
}

function main() {
  const usadas = extraerVariablesUsadas();
  const documentadas = extraerVariablesDocumentadas();

  const faltantes = [...usadas].filter((v) => !documentadas.has(v)).sort();

  if (faltantes.length > 0) {
    console.error('ERROR: las siguientes variables de entorno se usan en el codigo pero NO estan documentadas en .env.example:');
    for (const v of faltantes) console.error(`  - ${v}`);
    console.error('\nAgregalas a .env.example (con un comentario explicando su proposito) antes de continuar.');
    process.exit(1);
  }

  console.log(`OK: las ${usadas.size} variables de entorno usadas en el codigo estan todas documentadas en .env.example.`);
}

main();
