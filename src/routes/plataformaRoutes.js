// ============================================================
// Rutas de /api/plataforma/*: pestana "Acerca de" dentro de la
// plataforma (visible para cualquier usuario autenticado, de
// cualquier rol) y el boton de sugerencias/correcciones.
// ============================================================
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const controller = require('../controllers/plataformaController');
const { autenticar } = require('../middleware/auth');

// Mismo patron que limitadorLogin/limitadorCanalDirectoTitular:
// evita que alguien use este formulario para bombardear el correo
// de la plataforma. 8 envios por hora por IP es generoso para uso
// legitimo (una persona no manda 8 sugerencias distintas en una
// hora) y corta un abuso automatizado.
const limitadorSugerencias = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  message: { error: 'Demasiados envios desde esta red. Intenta de nuevo mas tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/acerca-de', autenticar, controller.obtenerAcercaDe);
router.post('/sugerencias', autenticar, limitadorSugerencias, controller.enviarSugerencia);

module.exports = router;
