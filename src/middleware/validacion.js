// ============================================================
// Validacion de datos de entrada. Esto evita que datos mal
// formados o maliciosos lleguen a la base de datos.
// ============================================================
const { body, validationResult } = require('express-validator');

function manejarErroresValidacion(req, res, next) {
  const errores = validationResult(req);
  if (!errores.isEmpty()) {
    return res.status(400).json({ error: 'Datos invalidos.', detalles: errores.array() });
  }
  next();
}

const validarRegistrarOrganizacion = [
  body('nombreEmpresa').trim().isLength({ min: 2, max: 200 }).withMessage('nombreEmpresa debe tener entre 2 y 200 caracteres.'),
  body('nombreAdmin').trim().isLength({ min: 2, max: 200 }).withMessage('nombreAdmin debe tener entre 2 y 200 caracteres.'),
  body('email').isEmail().withMessage('email invalido.'),
  body('password').isLength({ min: 12 }).withMessage('password debe tener al menos 12 caracteres.'),
  manejarErroresValidacion,
];

const validarRegistrarUsuario = [
  body('codigoOrganizacion').trim().notEmpty().withMessage('codigoOrganizacion es obligatorio.'),
  body('nombreCompleto').trim().isLength({ min: 2, max: 200 }),
  body('email').isEmail().withMessage('email invalido.'),
  body('password').isLength({ min: 12 }).withMessage('password debe tener al menos 12 caracteres.'),
  body('rol').isIn(['admin', 'medico', 'sso', 'th']).withMessage('rol invalido.'),
  manejarErroresValidacion,
];

const validarRegistrarUsuarioInterno = [
  body('nombreCompleto').trim().isLength({ min: 2, max: 200 }).withMessage('nombreCompleto debe tener entre 2 y 200 caracteres.'),
  body('email').isEmail().withMessage('email invalido.'),
  body('password').isLength({ min: 12 }).withMessage('password debe tener al menos 12 caracteres.'),
  body('rol').isIn(['admin', 'medico', 'sso', 'th']).withMessage('rol invalido.'),
  manejarErroresValidacion,
];

const validarLogin = [
  body('email').isEmail().withMessage('email invalido.'),
  body('password').notEmpty().withMessage('password es obligatorio.'),
  manejarErroresValidacion,
];

const validarCrearTrabajador = [
  body('nombreCompleto').trim().isLength({ min: 2, max: 200 }).withMessage('nombreCompleto debe tener entre 2 y 200 caracteres.'),
  body('documento').trim().isLength({ min: 3, max: 30 }).withMessage('documento debe tener entre 3 y 30 caracteres.'),
  body('area').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
  body('puesto').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
  body('fechaEmo').optional({ values: 'falsy' }).isISO8601().withMessage('fechaEmo debe ser una fecha valida (YYYY-MM-DD).'),
  body('fechaVencimiento').optional({ values: 'falsy' }).isISO8601().withMessage('fechaVencimiento debe ser una fecha valida (YYYY-MM-DD).'),
  // Datos antropometricos (necesarios para audiometria/espirometria).
  // Opcionales al crear: pueden completarse despues via
  // PUT /api/trabajadores/:id/datos-antropometricos.
  body('sexo').optional({ values: 'falsy' }).isIn(['M', 'F']).withMessage('sexo debe ser M o F.'),
  body('fechaNacimiento').optional({ values: 'falsy' }).isISO8601().withMessage('fechaNacimiento debe ser una fecha valida (YYYY-MM-DD).'),
  body('tallaCm').optional({ values: 'falsy' }).isInt({ min: 100, max: 250 }).withMessage('tallaCm debe estar entre 100 y 250.'),
  body('pesoKg').optional({ values: 'falsy' }).isFloat({ min: 20, max: 300 }).withMessage('pesoKg debe estar entre 20 y 300.'),
  // Nota: NO se valida ni acepta "aptitud" aqui deliberadamente.
  // La aptitud solo puede registrarse via POST
  // /api/aptitud/trabajadores/:id/registrar (modulo medico), que
  // exige justificacion clinica obligatoria. Ver comentario en
  // trabajadoresController.js para el detalle completo.
  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para actualizar SOLO los datos antropometricos de un
// trabajador (sexo, fecha de nacimiento, talla, peso). Estos son
// obligatorios aqui porque este endpoint existe justamente para
// completarlos cuando faltan (audiometria/espirometria los
// necesitan para calcular presbiacusia/valores predichos).
// ------------------------------------------------------------
const validarActualizarDatosAntropometricos = [
  body('sexo').isIn(['M', 'F']).withMessage('sexo debe ser M o F.'),
  body('fechaNacimiento').isISO8601().withMessage('fechaNacimiento debe ser una fecha valida (YYYY-MM-DD).'),
  body('tallaCm').isInt({ min: 100, max: 250 }).withMessage('tallaCm debe estar entre 100 y 250.'),
  body('pesoKg').optional({ values: 'falsy' }).isFloat({ min: 20, max: 300 }).withMessage('pesoKg debe estar entre 20 y 300.'),
  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para ergonomia (REBA).
//
// Nota: aqui solo se valida que los valores sean uno de los
// permitidos (mismos que el CHECK de la base de datos). El
// CALCULO en si (tablas A/B/C) vive en src/ergonomia/reba.js,
// nunca en este archivo.
// ------------------------------------------------------------
const validarCrearSesionErgonomica = [
  body('trabajadorId').isUUID().withMessage('trabajadorId debe ser un UUID valido.'),
  body('puestoEvaluado').trim().isLength({ min: 2, max: 150 }).withMessage('puestoEvaluado debe tener entre 2 y 150 caracteres.'),
  body('tareaObservada').optional({ values: 'falsy' }).trim().isLength({ max: 300 }),
  body('fechaEvaluacion').optional({ values: 'falsy' }).isISO8601().withMessage('fechaEvaluacion debe ser una fecha valida (YYYY-MM-DD).'),
  body('notasGenerales').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  manejarErroresValidacion,
];

const validarCrearEvaluacionReba = [
  body('nombrePostura').trim().isLength({ min: 2, max: 150 }).withMessage('nombrePostura debe tener entre 2 y 150 caracteres.'),
  body('orden').optional().isInt({ min: 1 }).withMessage('orden debe ser un entero positivo.'),

  body('tronco').isIn(['erguido', 'flexion_0_20', 'extension_mayor_20', 'flexion_20_60', 'flexion_mayor_60']).withMessage('tronco invalido.'),
  body('troncoTorsionLateral').optional().isBoolean(),
  body('cuello').isIn(['flexion_0_20', 'flexion_mayor_20_o_extension']).withMessage('cuello invalido.'),
  body('cuelloTorsionLateral').optional().isBoolean(),
  body('piernas').isIn(['soporte_bilateral_estable', 'soporte_unilateral_inestable']).withMessage('piernas invalido.'),
  body('piernasFlexionRodilla').optional().isIn(['ninguna', 'flexion_30_60', 'flexion_mayor_60']),

  body('cargaFuerza').isIn(['menor_5kg', 'entre_5_10kg', 'mayor_10kg']).withMessage('cargaFuerza invalido.'),
  body('cargaBruscaORapida').optional().isBoolean(),

  body('brazoDerecho').isIn(['extension_20_o_flexion_0_20', 'extension_mayor_20_o_flexion_20_45', 'flexion_45_90', 'flexion_mayor_90']).withMessage('brazoDerecho invalido.'),
  body('brazoDerechoAbduccionORotacion').optional().isBoolean(),
  body('brazoDerechoApoyado').optional().isBoolean(),
  body('antebrazoDerecho').isIn(['flexion_60_100', 'flexion_menor_60_o_mayor_100']).withMessage('antebrazoDerecho invalido.'),
  body('munecaDerecha').isIn(['flexion_0_15', 'flexion_mayor_15']).withMessage('munecaDerecha invalido.'),
  body('munecaDerechaTorsionODesviacion').optional().isBoolean(),

  body('brazoIzquierdo').isIn(['extension_20_o_flexion_0_20', 'extension_mayor_20_o_flexion_20_45', 'flexion_45_90', 'flexion_mayor_90']).withMessage('brazoIzquierdo invalido.'),
  body('brazoIzquierdoAbduccionORotacion').optional().isBoolean(),
  body('brazoIzquierdoApoyado').optional().isBoolean(),
  body('antebrazoIzquierdo').isIn(['flexion_60_100', 'flexion_menor_60_o_mayor_100']).withMessage('antebrazoIzquierdo invalido.'),
  body('munecaIzquierda').isIn(['flexion_0_15', 'flexion_mayor_15']).withMessage('munecaIzquierda invalido.'),
  body('munecaIzquierdaTorsionODesviacion').optional().isBoolean(),

  body('agarre').isIn(['bueno', 'regular', 'malo', 'inaceptable']).withMessage('agarre invalido.'),

  body('actividadPosturasEstaticas').optional().isBoolean(),
  body('actividadMovimientosRepetidos').optional().isBoolean(),
  body('actividadCambiosPosturalesRapidos').optional().isBoolean(),

  body('evidenciaBase64').optional({ values: 'falsy' }).isString()
    .withMessage('evidenciaBase64 debe ser una cadena (data URI).'),

  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para ergonomia (RULA). Misma logica que REBA: solo
// se valida que los valores sean uno de los permitidos (mismos
// que el CHECK de la base de datos). El CALCULO vive en
// src/ergonomia/rula.js.
// ------------------------------------------------------------
const validarCrearSesionRula = [
  body('trabajadorId').isUUID().withMessage('trabajadorId debe ser un UUID valido.'),
  body('puestoEvaluado').trim().isLength({ min: 2, max: 150 }).withMessage('puestoEvaluado debe tener entre 2 y 150 caracteres.'),
  body('tareaObservada').optional({ values: 'falsy' }).trim().isLength({ max: 300 }),
  body('fechaEvaluacion').optional({ values: 'falsy' }).isISO8601().withMessage('fechaEvaluacion debe ser una fecha valida (YYYY-MM-DD).'),
  body('notasGenerales').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  manejarErroresValidacion,
];

const validarCrearEvaluacionRula = [
  body('nombrePostura').trim().isLength({ min: 2, max: 150 }).withMessage('nombrePostura debe tener entre 2 y 150 caracteres.'),
  body('orden').optional().isInt({ min: 1 }).withMessage('orden debe ser un entero positivo.'),

  body('brazoDerecho').isIn(['extension_20_a_flexion_20', 'extension_mayor_20_o_flexion_20_45', 'flexion_45_90', 'flexion_mayor_90']).withMessage('brazoDerecho invalido.'),
  body('brazoDerechoHombroElevado').optional().isBoolean(),
  body('brazoDerechoAbducido').optional().isBoolean(),
  body('brazoDerechoApoyado').optional().isBoolean(),
  body('antebrazoDerecho').isIn(['flexion_60_100', 'flexion_menor_60_o_mayor_100']).withMessage('antebrazoDerecho invalido.'),
  body('antebrazoDerechoCruzaLineaMedia').optional().isBoolean(),
  body('munecaDerecha').isIn(['posicion_neutra', 'flexion_o_extension_0_15', 'flexion_o_extension_mayor_15']).withMessage('munecaDerecha invalido.'),
  body('munecaDerechaDesviacionRadialCubital').optional().isBoolean(),
  body('munecaDerechaRotacion').isIn(['rango_medio', 'rango_extremo']).withMessage('munecaDerechaRotacion invalido.'),

  body('brazoIzquierdo').isIn(['extension_20_a_flexion_20', 'extension_mayor_20_o_flexion_20_45', 'flexion_45_90', 'flexion_mayor_90']).withMessage('brazoIzquierdo invalido.'),
  body('brazoIzquierdoHombroElevado').optional().isBoolean(),
  body('brazoIzquierdoAbducido').optional().isBoolean(),
  body('brazoIzquierdoApoyado').optional().isBoolean(),
  body('antebrazoIzquierdo').isIn(['flexion_60_100', 'flexion_menor_60_o_mayor_100']).withMessage('antebrazoIzquierdo invalido.'),
  body('antebrazoIzquierdoCruzaLineaMedia').optional().isBoolean(),
  body('munecaIzquierda').isIn(['posicion_neutra', 'flexion_o_extension_0_15', 'flexion_o_extension_mayor_15']).withMessage('munecaIzquierda invalido.'),
  body('munecaIzquierdaDesviacionRadialCubital').optional().isBoolean(),
  body('munecaIzquierdaRotacion').isIn(['rango_medio', 'rango_extremo']).withMessage('munecaIzquierdaRotacion invalido.'),

  body('grupoAMusculoEstaticoORepetido').optional().isBoolean(),
  body('grupoAFuerzaCarga').isIn(['menor_2kg_intermitente', 'entre_2_10kg_intermitente', 'entre_2_10kg_estatico_o_repetido', 'mayor_10kg_o_repetido_o_brusco']).withMessage('grupoAFuerzaCarga invalido.'),

  body('cuello').isIn(['flexion_0_10', 'flexion_10_20', 'flexion_mayor_20', 'extension']).withMessage('cuello invalido.'),
  body('cuelloTorsion').optional().isBoolean(),
  body('cuelloInclinacionLateral').optional().isBoolean(),
  body('tronco').isIn(['erguido_o_sentado_apoyado', 'flexion_0_20', 'flexion_20_60', 'flexion_mayor_60']).withMessage('tronco invalido.'),
  body('troncoSentado').optional().isBoolean(),
  body('troncoTorsion').optional().isBoolean(),
  body('troncoInclinacionLateral').optional().isBoolean(),
  body('piernasBienApoyadas').optional().isBoolean(),

  body('grupoBMusculoEstaticoORepetido').optional().isBoolean(),
  body('grupoBFuerzaCarga').isIn(['menor_2kg_intermitente', 'entre_2_10kg_intermitente', 'entre_2_10kg_estatico_o_repetido', 'mayor_10kg_o_repetido_o_brusco']).withMessage('grupoBFuerzaCarga invalido.'),

  body('evidenciaBase64').optional({ values: 'falsy' }).isString()
    .withMessage('evidenciaBase64 debe ser una cadena (data URI).'),

  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para el motor de aptitud medica.
// ------------------------------------------------------------
const validarCrearRegla = [
  body('nombre').trim().isLength({ min: 5, max: 200 }).withMessage('nombre debe tener entre 5 y 200 caracteres.'),
  body('codigoCie10Patron').trim().isLength({ min: 1, max: 10 }).withMessage('codigoCie10Patron es requerido.'),
  body('tipoCoincidencia').optional().isIn(['exacto', 'prefijo']).withMessage('tipoCoincidencia invalido.'),
  body('exposicionCodigo').trim().isLength({ min: 1, max: 50 }).withMessage('exposicionCodigo es requerido.'),
  body('severidad').isIn(['absoluta', 'relativa']).withMessage('severidad debe ser absoluta o relativa.'),
  body('descripcionRiesgo').trim().isLength({ min: 10 }).withMessage('descripcionRiesgo debe tener al menos 10 caracteres.'),
  body('sugerenciaAccion').optional({ values: 'falsy' }).trim(),
  body('fuenteReferencia').optional({ values: 'falsy' }).trim().isLength({ max: 300 }),
  manejarErroresValidacion,
];

const validarRegistrarAptitud = [
  body('aptitud').isIn(['apto', 'con_restricciones', 'no_apto', 'pendiente']).withMessage('aptitud invalida.'),
  body('puestoEvaluado').trim().isLength({ min: 2, max: 150 }).withMessage('puestoEvaluado debe tener entre 2 y 150 caracteres.'),
  body('diagnosticosCie10').isArray().withMessage('diagnosticosCie10 debe ser un arreglo.'),
  body('diagnosticosCie10.*').isString().trim().isLength({ min: 1, max: 10 }),
  body('exposicionesPuesto').isArray().withMessage('exposicionesPuesto debe ser un arreglo.'),
  body('exposicionesPuesto.*').isString().trim().isLength({ min: 1, max: 50 }),
  // Justificacion clinica obligatoria: minimo 20 caracteres, igual
  // que el CHECK de la base de datos (defensa en profundidad: se
  // valida aqui Y en el CHECK de la tabla, para dar un mensaje de
  // error claro sin depender solo del error crudo de Postgres).
  body('justificacionClinica').trim().isLength({ min: 20 }).withMessage('La justificacion clinica es obligatoria y debe tener al menos 20 caracteres.'),
  body('restricciones').optional({ values: 'falsy' }).trim(),
  body('vigenciaHasta').optional({ values: 'falsy' }).isISO8601().withMessage('vigenciaHasta debe ser una fecha valida (YYYY-MM-DD).'),
  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para consentimientos informados firmados.
// ------------------------------------------------------------
const validarFirmarConsentimiento = [
  body('tipoConsentimientoCodigo').trim().isLength({ min: 2, max: 50 }).withMessage('tipoConsentimientoCodigo es obligatorio.'),
  body('firmaBase64').isString().custom((value) => value.startsWith('data:image')).withMessage('firmaBase64 debe ser una imagen en formato data URI.'),
  manejarErroresValidacion,
];

const validarRevocarConsentimiento = [
  body('motivoRevocacion').trim().isLength({ min: 5, max: 1000 }).withMessage('motivoRevocacion es obligatorio (minimo 5 caracteres).'),
  manejarErroresValidacion,
];

const validarFirmarFisico = [
  body('tipoConsentimientoCodigo').trim().isLength({ min: 2, max: 50 }).withMessage('tipoConsentimientoCodigo es obligatorio.'),
  body('imagenBase64').isString().custom((value) => value.startsWith('data:image')).withMessage('imagenBase64 debe ser una foto/escaneo en formato data URI.'),
  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para registrar un examen de espirometria.
// El calculo (predichos, LLN, patron, reversibilidad) vive en
// src/espirometria/espirometria.js, nunca aqui.
// ------------------------------------------------------------
const validarRegistrarEspirometria = [
  body('fechaExamen').optional({ values: 'falsy' }).isISO8601().withMessage('fechaExamen debe ser una fecha valida (YYYY-MM-DD).'),
  body('fvcPre').isFloat({ min: 0.1, max: 10 }).withMessage('fvcPre es obligatorio y debe estar entre 0.1 y 10 litros.'),
  body('fev1Pre').isFloat({ min: 0.1, max: 10 }).withMessage('fev1Pre es obligatorio y debe estar entre 0.1 y 10 litros.'),
  body('pefPre').optional({ values: 'falsy' }).isFloat({ min: 0, max: 20 }).withMessage('pefPre debe estar entre 0 y 20 L/s.'),
  body('fef2575Pre').optional({ values: 'falsy' }).isFloat({ min: 0, max: 15 }).withMessage('fef2575Pre debe estar entre 0 y 15 L/s.'),
  body('fvcPost').optional({ values: 'falsy' }).isFloat({ min: 0.1, max: 10 }).withMessage('fvcPost debe estar entre 0.1 y 10 litros.'),
  body('fev1Post').optional({ values: 'falsy' }).isFloat({ min: 0.1, max: 10 }).withMessage('fev1Post debe estar entre 0.1 y 10 litros.'),
  body('pefPost').optional({ values: 'falsy' }).isFloat({ min: 0, max: 20 }).withMessage('pefPost debe estar entre 0 y 20 L/s.'),
  body('fef2575Post').optional({ values: 'falsy' }).isFloat({ min: 0, max: 15 }).withMessage('fef2575Post debe estar entre 0 y 15 L/s.'),
  body('minutosPostBroncodilatador').optional({ values: 'falsy' }).isInt({ min: 1, max: 120 }).withMessage('minutosPostBroncodilatador debe estar entre 1 y 120.'),
  body('observaciones').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para que un admin resetee la contrasena de otro
// usuario. Solo pide la contrasena temporal nueva; el destinatario
// (:id) se valida por pertenencia a la organizacion en el
// controlador, no aqui.
// ------------------------------------------------------------
const validarResetearPassword = [
  body('passwordTemporal').isLength({ min: 12 }).withMessage('La contrasena temporal debe tener al menos 12 caracteres.'),
  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para que un usuario cambie su propia contrasena.
// Exige tambien la actual (se verifica en el controlador contra
// el hash real) y que la nueva sea distinta de la actual en texto
// (verificacion superficial; la comprobacion fuerte de que
// realmente cambio el hash ocurre al guardar).
// ------------------------------------------------------------
const validarCambiarPassword = [
  body('passwordActual').notEmpty().withMessage('Debes ingresar tu contrasena actual.'),
  body('passwordNueva').isLength({ min: 12 }).withMessage('La contrasena nueva debe tener al menos 12 caracteres.')
    .custom((valor, { req }) => valor !== req.body.passwordActual).withMessage('La contrasena nueva debe ser diferente de la actual.'),
  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para el formulario preocupacional (HCU 077).
// Solo se validan formato/tipo de los campos con significado
// clinico critico y los que tienen columna real en la tabla; el
// contenido de los bloques JSONB (antecedentes, examen fisico,
// etc.) se deja pasar tal cual llegue -son objetos anidados
// grandes y opcionales- salvo la matriz de riesgos (Bloque F), que
// se valida aparte en el controlador contra la taxonomia oficial
// del MSP (ver validarFactoresRiesgo en historiaClinica.js).
// ------------------------------------------------------------
const validarRegistrarPreocupacional = [
  body('fechaAtencion').optional({ values: 'falsy' }).isISO8601().withMessage('fechaAtencion debe ser una fecha valida (YYYY-MM-DD).'),
  body('motivoConsulta').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),

  body('grupoSanguineo').optional({ values: 'falsy' }).trim().isLength({ max: 5 }),
  body('discapacidadTiene').optional().isBoolean().withMessage('discapacidadTiene debe ser verdadero o falso.'),
  body('discapacidadPorcentaje').optional({ values: 'falsy' }).isFloat({ min: 0, max: 100 }).withMessage('discapacidadPorcentaje debe estar entre 0 y 100.'),
  body('fechaIngresoTrabajo').optional({ values: 'falsy' }).isISO8601().withMessage('fechaIngresoTrabajo debe ser una fecha valida (YYYY-MM-DD).'),

  body('presionArterialSistolica').optional({ values: 'falsy' }).isInt({ min: 40, max: 300 }).withMessage('presionArterialSistolica fuera de rango.'),
  body('presionArterialDiastolica').optional({ values: 'falsy' }).isInt({ min: 20, max: 200 }).withMessage('presionArterialDiastolica fuera de rango.'),
  body('temperaturaC').optional({ values: 'falsy' }).isFloat({ min: 30, max: 44 }).withMessage('temperaturaC fuera de rango.'),
  body('frecuenciaCardiaca').optional({ values: 'falsy' }).isInt({ min: 20, max: 250 }).withMessage('frecuenciaCardiaca fuera de rango.'),
  body('saturacionOxigeno').optional({ values: 'falsy' }).isInt({ min: 50, max: 100 }).withMessage('saturacionOxigeno fuera de rango.'),
  body('frecuenciaRespiratoria').optional({ values: 'falsy' }).isInt({ min: 5, max: 80 }).withMessage('frecuenciaRespiratoria fuera de rango.'),
  body('pesoKg').optional({ values: 'falsy' }).isFloat({ min: 20, max: 300 }).withMessage('pesoKg debe estar entre 20 y 300.'),
  body('tallaCm').optional({ values: 'falsy' }).isInt({ min: 100, max: 250 }).withMessage('tallaCm debe estar entre 100 y 250.'),
  body('perimetroAbdominalCm').optional({ values: 'falsy' }).isFloat({ min: 30, max: 250 }).withMessage('perimetroAbdominalCm fuera de rango.'),

  body('aptitudMsp').optional({ values: 'falsy' }).isIn(['apto', 'apto_en_observacion', 'apto_con_limitaciones', 'no_apto']).withMessage('aptitudMsp invalida.'),
  body('codigoProfesionalSalud').optional({ values: 'falsy' }).trim().isLength({ max: 50 }),
  body('firmaBase64').optional({ values: 'falsy' }).isString().custom((value) => value.startsWith('data:image')).withMessage('firmaBase64 debe ser una imagen en formato data URI.'),

  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para el formulario de retiro (HCU 080). Mismo
// criterio que el preocupacional: solo se valida formato/tipo de
// los campos con columna real.
// ------------------------------------------------------------
const validarRegistrarRetiro = [
  body('fechaAtencion').optional({ values: 'falsy' }).isISO8601().withMessage('fechaAtencion debe ser una fecha valida (YYYY-MM-DD).'),
  body('fechaInicioLabores').optional({ values: 'falsy' }).isISO8601().withMessage('fechaInicioLabores debe ser una fecha valida (YYYY-MM-DD).'),
  body('fechaSalida').optional({ values: 'falsy' }).isISO8601().withMessage('fechaSalida debe ser una fecha valida (YYYY-MM-DD).'),
  body('tiempoPermanenciaMeses').optional({ values: 'falsy' }).isInt({ min: 0, max: 900 }).withMessage('tiempoPermanenciaMeses fuera de rango.'),

  body('presionArterialSistolica').optional({ values: 'falsy' }).isInt({ min: 40, max: 300 }).withMessage('presionArterialSistolica fuera de rango.'),
  body('presionArterialDiastolica').optional({ values: 'falsy' }).isInt({ min: 20, max: 200 }).withMessage('presionArterialDiastolica fuera de rango.'),
  body('temperaturaC').optional({ values: 'falsy' }).isFloat({ min: 30, max: 44 }).withMessage('temperaturaC fuera de rango.'),
  body('frecuenciaCardiaca').optional({ values: 'falsy' }).isInt({ min: 20, max: 250 }).withMessage('frecuenciaCardiaca fuera de rango.'),
  body('saturacionOxigeno').optional({ values: 'falsy' }).isInt({ min: 50, max: 100 }).withMessage('saturacionOxigeno fuera de rango.'),
  body('frecuenciaRespiratoria').optional({ values: 'falsy' }).isInt({ min: 5, max: 80 }).withMessage('frecuenciaRespiratoria fuera de rango.'),
  body('pesoKg').optional({ values: 'falsy' }).isFloat({ min: 20, max: 300 }).withMessage('pesoKg debe estar entre 20 y 300.'),
  body('tallaCm').optional({ values: 'falsy' }).isInt({ min: 100, max: 250 }).withMessage('tallaCm debe estar entre 100 y 250.'),
  body('perimetroAbdominalCm').optional({ values: 'falsy' }).isFloat({ min: 30, max: 250 }).withMessage('perimetroAbdominalCm fuera de rango.'),

  body('retiroSeRealizoEvaluacion').optional().isBoolean().withMessage('retiroSeRealizoEvaluacion debe ser verdadero o falso.'),
  body('codigoProfesionalSalud').optional({ values: 'falsy' }).trim().isLength({ max: 50 }),
  body('firmaBase64').optional({ values: 'falsy' }).isString().custom((value) => value.startsWith('data:image')).withMessage('firmaBase64 debe ser una imagen en formato data URI.'),

  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para el formulario de evaluacion periodica (HCU 078).
// ------------------------------------------------------------
const validarRegistrarPeriodica = [
  body('fechaAtencion').optional({ values: 'falsy' }).isISO8601().withMessage('fechaAtencion debe ser una fecha valida (YYYY-MM-DD).'),
  body('tiempoPuestoActualMeses').optional({ values: 'falsy' }).isInt({ min: 0, max: 900 }).withMessage('tiempoPuestoActualMeses fuera de rango.'),

  body('presionArterialSistolica').optional({ values: 'falsy' }).isInt({ min: 40, max: 300 }).withMessage('presionArterialSistolica fuera de rango.'),
  body('presionArterialDiastolica').optional({ values: 'falsy' }).isInt({ min: 20, max: 200 }).withMessage('presionArterialDiastolica fuera de rango.'),
  body('temperaturaC').optional({ values: 'falsy' }).isFloat({ min: 30, max: 44 }).withMessage('temperaturaC fuera de rango.'),
  body('frecuenciaCardiaca').optional({ values: 'falsy' }).isInt({ min: 20, max: 250 }).withMessage('frecuenciaCardiaca fuera de rango.'),
  body('saturacionOxigeno').optional({ values: 'falsy' }).isInt({ min: 50, max: 100 }).withMessage('saturacionOxigeno fuera de rango.'),
  body('frecuenciaRespiratoria').optional({ values: 'falsy' }).isInt({ min: 5, max: 80 }).withMessage('frecuenciaRespiratoria fuera de rango.'),
  body('pesoKg').optional({ values: 'falsy' }).isFloat({ min: 20, max: 300 }).withMessage('pesoKg debe estar entre 20 y 300.'),
  body('tallaCm').optional({ values: 'falsy' }).isInt({ min: 100, max: 250 }).withMessage('tallaCm debe estar entre 100 y 250.'),
  body('perimetroAbdominalCm').optional({ values: 'falsy' }).isFloat({ min: 30, max: 250 }).withMessage('perimetroAbdominalCm fuera de rango.'),

  body('aptitudMsp').optional({ values: 'falsy' }).isIn(['apto', 'apto_en_observacion', 'apto_con_limitaciones', 'no_apto']).withMessage('aptitudMsp invalida.'),
  body('codigoProfesionalSalud').optional({ values: 'falsy' }).trim().isLength({ max: 50 }),
  body('firmaBase64').optional({ values: 'falsy' }).isString().custom((value) => value.startsWith('data:image')).withMessage('firmaBase64 debe ser una imagen en formato data URI.'),

  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para el formulario de evaluacion de reintegro (HCU 079).
// ------------------------------------------------------------
const validarRegistrarReintegro = [
  body('fechaAtencion').optional({ values: 'falsy' }).isISO8601().withMessage('fechaAtencion debe ser una fecha valida (YYYY-MM-DD).'),
  body('fechaUltimoDiaLaboral').optional({ values: 'falsy' }).isISO8601().withMessage('fechaUltimoDiaLaboral debe ser una fecha valida (YYYY-MM-DD).'),
  body('fechaReingreso').optional({ values: 'falsy' }).isISO8601().withMessage('fechaReingreso debe ser una fecha valida (YYYY-MM-DD).'),
  body('totalDiasAusencia').optional({ values: 'falsy' }).isInt({ min: 0, max: 3650 }).withMessage('totalDiasAusencia fuera de rango.'),

  body('presionArterialSistolica').optional({ values: 'falsy' }).isInt({ min: 40, max: 300 }).withMessage('presionArterialSistolica fuera de rango.'),
  body('presionArterialDiastolica').optional({ values: 'falsy' }).isInt({ min: 20, max: 200 }).withMessage('presionArterialDiastolica fuera de rango.'),
  body('temperaturaC').optional({ values: 'falsy' }).isFloat({ min: 30, max: 44 }).withMessage('temperaturaC fuera de rango.'),
  body('frecuenciaCardiaca').optional({ values: 'falsy' }).isInt({ min: 20, max: 250 }).withMessage('frecuenciaCardiaca fuera de rango.'),
  body('saturacionOxigeno').optional({ values: 'falsy' }).isInt({ min: 50, max: 100 }).withMessage('saturacionOxigeno fuera de rango.'),
  body('frecuenciaRespiratoria').optional({ values: 'falsy' }).isInt({ min: 5, max: 80 }).withMessage('frecuenciaRespiratoria fuera de rango.'),
  body('pesoKg').optional({ values: 'falsy' }).isFloat({ min: 20, max: 300 }).withMessage('pesoKg debe estar entre 20 y 300.'),
  body('tallaCm').optional({ values: 'falsy' }).isInt({ min: 100, max: 250 }).withMessage('tallaCm debe estar entre 100 y 250.'),
  body('perimetroAbdominalCm').optional({ values: 'falsy' }).isFloat({ min: 30, max: 250 }).withMessage('perimetroAbdominalCm fuera de rango.'),

  body('aptitudMsp').optional({ values: 'falsy' }).isIn(['apto', 'apto_en_observacion', 'apto_con_limitaciones', 'no_apto']).withMessage('aptitudMsp invalida.'),
  body('codigoProfesionalSalud').optional({ values: 'falsy' }).trim().isLength({ max: 50 }),
  body('firmaBase64').optional({ values: 'falsy' }).isString().custom((value) => value.startsWith('data:image')).withMessage('firmaBase64 debe ser una imagen en formato data URI.'),

  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para registrar una dosis de inmunizacion (HCU 083).
// ------------------------------------------------------------
const validarRegistrarInmunizacion = [
  body('vacunaNombre').trim().isLength({ min: 2, max: 100 }).withMessage('vacunaNombre es obligatorio.'),
  body('numeroDosis').trim().isLength({ min: 1, max: 20 }).withMessage('numeroDosis es obligatorio.'),
  body('fechaAplicacion').isISO8601().withMessage('fechaAplicacion debe ser una fecha valida (YYYY-MM-DD).'),
  body('lote').optional({ values: 'falsy' }).trim().isLength({ max: 50 }),
  body('esquemaCompleto').optional().isBoolean().withMessage('esquemaCompleto debe ser verdadero o falso.'),
  body('establecimientoSalud').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
  body('responsableNombre').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
  body('observaciones').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para registrar un examen de visiometria.
// ------------------------------------------------------------
const validarRegistrarVisiometria = [
  body('fechaExamen').optional({ values: 'falsy' }).isISO8601().withMessage('fechaExamen debe ser una fecha valida (YYYY-MM-DD).'),
  body('odLejanaSinCorreccion').optional({ values: 'falsy' }).isFloat({ min: 0.01, max: 2.0 }).withMessage('odLejanaSinCorreccion fuera de rango.'),
  body('odLejanaConCorreccion').optional({ values: 'falsy' }).isFloat({ min: 0.01, max: 2.0 }).withMessage('odLejanaConCorreccion fuera de rango.'),
  body('oiLejanaSinCorreccion').optional({ values: 'falsy' }).isFloat({ min: 0.01, max: 2.0 }).withMessage('oiLejanaSinCorreccion fuera de rango.'),
  body('oiLejanaConCorreccion').optional({ values: 'falsy' }).isFloat({ min: 0.01, max: 2.0 }).withMessage('oiLejanaConCorreccion fuera de rango.'),
  body('aoLejanaSinCorreccion').optional({ values: 'falsy' }).isFloat({ min: 0.01, max: 2.0 }).withMessage('aoLejanaSinCorreccion fuera de rango.'),
  body('aoLejanaConCorreccion').optional({ values: 'falsy' }).isFloat({ min: 0.01, max: 2.0 }).withMessage('aoLejanaConCorreccion fuera de rango.'),
  body('odCercanaSinCorreccion').optional({ values: 'falsy' }).isFloat({ min: 0.01, max: 2.0 }).withMessage('odCercanaSinCorreccion fuera de rango.'),
  body('odCercanaConCorreccion').optional({ values: 'falsy' }).isFloat({ min: 0.01, max: 2.0 }).withMessage('odCercanaConCorreccion fuera de rango.'),
  body('oiCercanaSinCorreccion').optional({ values: 'falsy' }).isFloat({ min: 0.01, max: 2.0 }).withMessage('oiCercanaSinCorreccion fuera de rango.'),
  body('oiCercanaConCorreccion').optional({ values: 'falsy' }).isFloat({ min: 0.01, max: 2.0 }).withMessage('oiCercanaConCorreccion fuera de rango.'),
  body('aoCercanaSinCorreccion').optional({ values: 'falsy' }).isFloat({ min: 0.01, max: 2.0 }).withMessage('aoCercanaSinCorreccion fuera de rango.'),
  body('aoCercanaConCorreccion').optional({ values: 'falsy' }).isFloat({ min: 0.01, max: 2.0 }).withMessage('aoCercanaConCorreccion fuera de rango.'),
  body('usaCorreccionOptica').optional().isBoolean().withMessage('usaCorreccionOptica debe ser verdadero o falso.'),
  body('tipoCorreccion').optional({ values: 'falsy' }).isIn(['lentes', 'lentes_de_contacto', 'ambos']).withMessage('tipoCorreccion invalido.'),
  body('ishiharaLaminasCorrectas').optional({ values: 'falsy' }).isInt({ min: 0, max: 30 }).withMessage('ishiharaLaminasCorrectas fuera de rango.'),
  body('ishiharaLaminasTotales').optional({ values: 'falsy' }).isInt({ min: 1, max: 30 }).withMessage('ishiharaLaminasTotales fuera de rango.'),
  body('percepcionProfundidad').optional({ values: 'falsy' }).isIn(['normal', 'alterada', 'no_evaluado']).withMessage('percepcionProfundidad invalida.'),
  body('balanceMuscular').optional({ values: 'falsy' }).isIn(['ortoforia', 'exoforia', 'esoforia', 'no_evaluado']).withMessage('balanceMuscular invalido.'),
  body('aptitudDefinida').optional({ values: 'falsy' }).isIn(['apto', 'apto_con_correccion_obligatoria', 'apto_con_restricciones', 'requiere_evaluacion_oftalmologica', 'no_apto']).withMessage('aptitudDefinida invalida.'),
  body('observaciones').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para registrar un cuestionario nordico. El contenido
// detallado de cada zona (objeto anidado) se valida en el
// controlador contra el catalogo de zonas reconocidas; aqui solo
// se valida la forma general del payload.
// ------------------------------------------------------------
const validarRegistrarNordico = [
  body('fechaAplicacion').optional({ values: 'falsy' }).isISO8601().withMessage('fechaAplicacion debe ser una fecha valida (YYYY-MM-DD).'),
  body('regiones').isObject().withMessage('regiones es obligatorio y debe ser un objeto.'),
  body('observacionesGenerales').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para registrar una evaluacion de la Ecuacion NIOSH.
// ------------------------------------------------------------
const validarRegistrarNiosh = [
  body('nombreTarea').trim().isLength({ min: 2, max: 200 }).withMessage('nombreTarea es obligatorio.'),
  body('fechaEvaluacion').optional({ values: 'falsy' }).isISO8601().withMessage('fechaEvaluacion debe ser una fecha valida (YYYY-MM-DD).'),
  body('horizontalCm').isFloat({ min: 1, max: 200 }).withMessage('horizontalCm es obligatorio (1 a 200 cm).'),
  body('verticalCm').isFloat({ min: 0, max: 200 }).withMessage('verticalCm es obligatorio (0 a 200 cm).'),
  body('distanciaVerticalCm').isFloat({ min: 0, max: 300 }).withMessage('distanciaVerticalCm es obligatorio (0 a 300 cm).'),
  body('anguloAsimetria').isFloat({ min: 0, max: 180 }).withMessage('anguloAsimetria es obligatorio (0 a 180 grados).'),
  body('frecuenciaPorMin').isFloat({ min: 0.1, max: 15 }).withMessage('frecuenciaPorMin es obligatorio (0.1 a 15 levantamientos/min; la Tabla 5 del NIOSH Applications Manual no cubre frecuencias mayores para tarea simple).'),
  body('duracion').isIn(['corta', 'media', 'larga']).withMessage('duracion debe ser corta, media o larga.'),
  body('calidadAgarre').isIn(['bueno', 'regular', 'malo']).withMessage('calidadAgarre debe ser bueno, regular o malo.'),
  body('pesoCargaKg').isFloat({ min: 0.1, max: 200 }).withMessage('pesoCargaKg es obligatorio (0.1 a 200 kg).'),
  // CREADO en Auditoria N.13 (hallazgo GRAVE G-10, P1): niosh.js solo
  // implementa la variante de tarea simple (single-task); no existe
  // implementacion de tarea multiple/compuesta. En vez de dejar que
  // alguien evalue una tarea compuesta con la formula de tarea
  // simple sin darse cuenta, se exige declarar el tipo de tarea y se
  // rechaza explicitamente 'compuesta' hasta que exista esa
  // implementacion (ver niosh.js y nioshController.js).
  body('tipoTarea').optional({ values: 'falsy' }).isIn(['simple', 'compuesta']).withMessage("tipoTarea debe ser 'simple' o 'compuesta'."),
  body('observaciones').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para crear/actualizar un puesto de trabajo. El
// contenido de factoresRiesgo se valida en el controlador contra
// el catalogo fijo de riesgos (mismo validador de Historia Clinica).
// ------------------------------------------------------------
const validarCrearPuestoTrabajo = [
  body('nombrePuesto').trim().isLength({ min: 2, max: 150 }).withMessage('nombrePuesto es obligatorio.'),
  body('area').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
  body('codigoCiuo').optional({ values: 'falsy' }).trim().isLength({ max: 20 }),
  body('descripcionActividades').optional({ values: 'falsy' }).trim().isLength({ max: 3000 }),
  body('numeroTrabajadoresEstimado').optional({ values: 'falsy' }).isInt({ min: 0, max: 10000 }).withMessage('numeroTrabajadoresEstimado fuera de rango.'),
  body('eppRequerido').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  body('medidasPreventivas').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para actualizar el perfil de "Mi Empresa".
// ------------------------------------------------------------
const validarActualizarOrganizacion = [
  body('direccion').optional({ values: 'falsy' }).trim().isLength({ max: 300 }),
  body('telefono').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('emailContacto').optional({ values: 'falsy' }).trim().isEmail().withMessage('emailContacto debe ser un correo valido.'),
  body('actividadEconomicaCiiu').optional({ values: 'falsy' }).trim().isLength({ max: 20 }),
  body('actividadEconomicaDesc').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
  body('representanteLegal').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
  body('responsableSstNombre').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
  body('responsableSstCargo').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
  manejarErroresValidacion,
];

const validarActualizarLogoOrganizacion = [
  body('logoBase64').isString().custom((value) => value.startsWith('data:image')).withMessage('logoBase64 debe ser una imagen en formato data URI.'),
  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para crear/actualizar un item de la Matriz de Riesgos.
// ------------------------------------------------------------
const validarCrearItemMatrizRiesgos = [
  body('tipoPeligro').isIn(['fisico', 'mecanico', 'quimico', 'biologico', 'ergonomico', 'psicosocial']).withMessage('tipoPeligro invalido.'),
  body('peligroEspecifico').trim().isLength({ min: 3, max: 500 }).withMessage('peligroEspecifico es obligatorio.'),
  body('probabilidad').isInt({ min: 1, max: 5 }).withMessage('probabilidad es obligatoria (1 a 5).'),
  body('consecuencia').isInt({ min: 1, max: 5 }).withMessage('consecuencia es obligatoria (1 a 5).'),
  body('puestoTrabajoId').optional({ values: 'falsy' }).isUUID().withMessage('puestoTrabajoId invalido.'),
  body('puestoTextoLibre').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
  body('proceso').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
  body('actividad').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
  body('riesgoPotencial').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
  body('trabajadoresExpuestos').optional({ values: 'falsy' }).isInt({ min: 0, max: 10000 }),
  body('controlesExistentes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  body('controlesAdicionales').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  body('responsableControl').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
  body('plazoControl').optional({ values: 'falsy' }).isISO8601().withMessage('plazoControl debe ser una fecha valida (YYYY-MM-DD).'),
  manejarErroresValidacion,
];

// ------------------------------------------------------------
// Validacion para crear/actualizar una ausencia. El detalle de
// que codigos de "tipo" son validos vive en
// src/ausentismo/ausentismo.js (CODIGOS_VALIDOS), no duplicado
// aqui, para que agregar un tipo nuevo solo requiera tocar un
// archivo.
// ------------------------------------------------------------
const { CODIGOS_VALIDOS: TIPOS_AUSENCIA_VALIDOS } = require('../ausentismo/ausentismo');

const validarCrearAusencia = [
  body('trabajadorId').isUUID().withMessage('trabajadorId es obligatorio y debe ser valido.'),
  body('tipo').isIn(TIPOS_AUSENCIA_VALIDOS).withMessage('tipo de ausencia invalido.'),
  body('fechaInicio').isISO8601().withMessage('fechaInicio debe ser una fecha valida (YYYY-MM-DD).'),
  body('fechaFin').isISO8601().withMessage('fechaFin debe ser una fecha valida (YYYY-MM-DD).'),
  body('subsidiadoIess').optional().isBoolean().withMessage('subsidiadoIess debe ser verdadero o falso.'),
  body('diagnosticoCie10').optional({ values: 'falsy' }).trim().isLength({ max: 10 }),
  body('numeroCertificado').optional({ values: 'falsy' }).trim().isLength({ max: 60 }),
  body('certificadoBase64').optional({ values: 'falsy' }).isString()
    .custom((value) => value.startsWith('data:image') || value.startsWith('data:application/pdf'))
    .withMessage('certificadoBase64 debe ser una imagen o PDF en formato data URI.'),
  body('observaciones').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  manejarErroresValidacion,
];

module.exports = {
  validarRegistrarOrganizacion,
  validarRegistrarUsuario,
  validarRegistrarUsuarioInterno,
  validarLogin,
  validarCrearTrabajador,
  validarActualizarDatosAntropometricos,
  validarCrearSesionErgonomica,
  validarCrearEvaluacionReba,
  validarCrearSesionRula,
  validarCrearEvaluacionRula,
  validarCrearRegla,
  validarRegistrarAptitud,
  validarFirmarConsentimiento,
  validarRevocarConsentimiento,
  validarFirmarFisico,
  validarRegistrarEspirometria,
  validarResetearPassword,
  validarCambiarPassword,
  validarRegistrarPreocupacional,
  validarRegistrarRetiro,
  validarRegistrarPeriodica,
  validarRegistrarReintegro,
  validarRegistrarInmunizacion,
  validarRegistrarVisiometria,
  validarRegistrarNordico,
  validarRegistrarNiosh,
  validarCrearPuestoTrabajo,
  validarActualizarOrganizacion,
  validarActualizarLogoOrganizacion,
  validarCrearItemMatrizRiesgos,
  validarCrearAusencia,
};
