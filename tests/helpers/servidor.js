// ============================================================
// Arranca el servidor real (src/index.js) como proceso hijo en un
// puerto dedicado a pruebas, exactamente como lo hace Render --
// no se importa/mockea nada del codigo de la aplicacion. Esto es
// deliberado: una prueba que solo llama funciones internas puede
// pasar aunque el ruteo, los middlewares o la serializacion JSON
// esten rotos; arrancar el proceso completo y pegarle por HTTP es
// lo unico que prueba el sistema tal como corre en produccion.
// ============================================================
const { spawn } = require('child_process');
const path = require('path');

const PUERTO_PRUEBAS = 10099;
const URL_BASE = `http://localhost:${PUERTO_PRUEBAS}/api`;

let procesoServidor = null;

async function iniciarServidor() {
  return new Promise((resolve, reject) => {
    procesoServidor = spawn('node', [path.join(__dirname, '..', '..', 'src', 'index.js')], {
      env: { ...process.env, PORT: String(PUERTO_PRUEBAS) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let listo = false;
    const timeout = setTimeout(() => {
      if (!listo) reject(new Error('El servidor de pruebas no arranco a tiempo (10s).'));
    }, 10000);

    procesoServidor.stdout.on('data', (datos) => {
      if (!listo && datos.toString().includes('escuchando')) {
        listo = true;
        clearTimeout(timeout);
        resolve();
      }
    });
    procesoServidor.stderr.on('data', (datos) => {
      process.stderr.write(`[servidor-pruebas] ${datos}`);
    });
    procesoServidor.on('error', reject);
  });
}

function detenerServidor() {
  if (procesoServidor) {
    procesoServidor.kill();
    procesoServidor = null;
  }
}

module.exports = { iniciarServidor, detenerServidor, URL_BASE };
