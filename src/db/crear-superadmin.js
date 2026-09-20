// ============================================================
// Script para crear el PRIMER superadmin de la plataforma.
//
// Este script se corre UNA SOLA VEZ, manualmente, por el dueno
// de SISSO. No existe ninguna ruta publica en la API para crear
// un superadmin: si existiera, cualquiera podria usarla.
//
// USO:
//   1. Asegurate de tener el archivo .env configurado con tu
//      DATABASE_URL real (la misma que usa el servidor en Render).
//   2. Corre: node src/db/crear-superadmin.js
//   3. Te va a pedir email y contrasena por la terminal.
// ============================================================
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { pool } = require('./pool');

const SALT_ROUNDS = 12;

function preguntar(texto, ocultar) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!ocultar) {
      rl.question(texto, (respuesta) => { rl.close(); resolve(respuesta); });
      return;
    }
    // Oculta lo que se escribe (para la contrasena), usando un truco
    // sencillo de terminal: no es perfecto pero evita mostrarla en claro.
    process.stdout.write(texto);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let valor = '';
    const onData = (char) => {
      char = char.toString();
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(valor);
      } else if (char === '\u0003') {
        process.exit();
      } else if (char === '\u007f') {
        valor = valor.slice(0, -1);
      } else {
        valor += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  console.log('=== Crear superadmin de SISSO ===\n');

  const nombreCompleto = await preguntar('Nombre completo: ', false);
  const email = await preguntar('Correo electronico: ', false);
  const password = await preguntar('Contrasena (minimo 12 caracteres): ', true);

  if (!nombreCompleto.trim() || !email.trim() || password.length < 12) {
    console.error('\nDatos invalidos. El nombre y el correo no pueden estar vacios, y la contrasena debe tener al menos 12 caracteres.');
    process.exit(1);
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const resultado = await pool.query(
      `INSERT INTO usuarios (organizacion_id, email, password_hash, nombre_completo, rol)
       VALUES (NULL, $1, $2, $3, 'superadmin')
       RETURNING id, email, nombre_completo, rol`,
      [email.toLowerCase().trim(), passwordHash, nombreCompleto.trim()]
    );
    console.log('\nSuperadmin creado con exito:');
    console.log(resultado.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      console.error('\nYa existe un superadmin con ese correo.');
    } else {
      console.error('\nError al crear el superadmin:', err.message);
    }
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
