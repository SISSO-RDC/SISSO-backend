# Matriz Rol x Endpoint x Dato x Accion -- SISSO backend

> Generado automaticamente por `scripts/generar_matriz_rbac.js` a partir de las
> rutas reales de la aplicacion (introspeccion de `router.stack` de Express),
> NO escrito ni mantenido a mano. Corrige el hallazgo CRITICO C15-02 de la
> Auditoria Integral N.15. Para regenerar tras agregar o modificar una ruta:
>
> ```
> node scripts/generar_matriz_rbac.js --escribir
> ```
>
> CI ejecuta `node scripts/generar_matriz_rbac.js --verificar` en cada push y
> falla si este archivo no coincide con las rutas reales del repositorio --
> es decir, es estructuralmente imposible que esta matriz quede desactualizada
> sin que el pipeline lo marque en rojo.
>
> Ultima generacion: 2026-09-04.

## `/api/auth`

**Clasificacion del dato:** administrativo (sesion/credenciales)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/auth/registrar-usuario-interno` | admin |
| POST | `/api/auth/bootstrap-superadmin` | PUBLICA (sin autenticacion) -- revisar si es intencional |
| POST | `/api/auth/recuperar-superadmin` | PUBLICA (sin autenticacion) -- revisar si es intencional |
| POST | `/api/auth/login` | PUBLICA (sin autenticacion) -- revisar si es intencional |
| POST | `/api/auth/refrescar` | PUBLICA (sin autenticacion) -- revisar si es intencional |
| POST | `/api/auth/logout` | PUBLICA (sin autenticacion) -- revisar si es intencional |
| GET | `/api/auth/perfil` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/auth/usuarios` | admin |
| PUT | `/api/auth/usuarios/:id/resetear-password` | admin |
| PUT | `/api/auth/cambiar-password` | cualquier rol autenticado (sin restriccion de rol) |
| POST | `/api/auth/mfa/iniciar-configuracion` | cualquier rol autenticado (sin restriccion de rol) |
| POST | `/api/auth/mfa/confirmar` | cualquier rol autenticado (sin restriccion de rol) |
| POST | `/api/auth/mfa/deshabilitar` | cualquier rol autenticado (sin restriccion de rol) |
| POST | `/api/auth/mfa/verificar-login` | PUBLICA (sin autenticacion) -- revisar si es intencional |
| GET | `/api/auth/sesiones` | cualquier rol autenticado (sin restriccion de rol) |
| DELETE | `/api/auth/sesiones/:familiaId` | cualquier rol autenticado (sin restriccion de rol) |
| DELETE | `/api/auth/sesiones` | cualquier rol autenticado (sin restriccion de rol) |

## `/api/ejemplo`

**Clasificacion del dato:** N/A (ruta de ejemplo/diagnostico, no expone datos de negocio)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/ejemplo/saludo` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/ejemplo/historia-clinica-ejemplo` | medico |
| GET | `/api/ejemplo/panel-admin` | admin |

## `/api/trabajadores`

**Clasificacion del dato:** operativo_individual (con campos antropometricos restringidos)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/trabajadores/` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/trabajadores/proximos-examenes` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/trabajadores/:id` | cualquier rol autenticado (sin restriccion de rol) |
| POST | `/api/trabajadores/` | admin, medico, th |
| POST | `/api/trabajadores/importar` | admin, medico, th |
| PUT | `/api/trabajadores/:id/datos-antropometricos` | admin, medico, th |

## `/api/superadmin`

**Clasificacion del dato:** administrativo (plataforma, fuera del modelo de roles de organizacion)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/superadmin/empresas` | superadmin |
| POST | `/api/superadmin/empresas` | superadmin |
| PATCH | `/api/superadmin/empresas/:id/suspension` | superadmin |
| PATCH | `/api/superadmin/empresas/:id/plan` | superadmin |
| PATCH | `/api/superadmin/usuarios/:id/estado` | superadmin |
| POST | `/api/superadmin/usuarios/:id/resetear-password` | superadmin |
| POST | `/api/superadmin/mfa/rotar-legado` | superadmin |
| GET | `/api/superadmin/auditoria-pendiente/backlog` | superadmin |
| POST | `/api/superadmin/auditoria-pendiente/drenar` | superadmin |

## `/api/ergonomia/rula`

**Clasificacion del dato:** clinico_individual (evaluaciones NIOSH/Nordico por trabajador)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/ergonomia/rula/sesiones` | medico, sso |
| GET | `/api/ergonomia/rula/sesiones/trabajador/:trabajadorId` | medico, sso, th |
| GET | `/api/ergonomia/rula/sesiones/:sesionId` | medico, sso, th |
| GET | `/api/ergonomia/rula/evaluaciones/:evaluacionId/evidencia-url` | medico, sso, th |
| POST | `/api/ergonomia/rula/sesiones/:sesionId/evaluaciones` | medico, sso |

## `/api/ergonomia`

**Clasificacion del dato:** clinico_individual (evaluaciones NIOSH/Nordico por trabajador)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/ergonomia/sesiones` | medico, sso |
| GET | `/api/ergonomia/sesiones/trabajador/:trabajadorId` | medico, sso, th |
| GET | `/api/ergonomia/sesiones/:sesionId` | medico, sso, th |
| GET | `/api/ergonomia/evaluaciones/:evaluacionId/evidencia-url` | medico, sso, th |
| POST | `/api/ergonomia/sesiones/:sesionId/reba` | medico, sso |

## `/api/aptitud`

**Clasificacion del dato:** clinico_individual (aptitud medica, reglas de contraindicacion)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/aptitud/reglas` | admin, medico |
| POST | `/api/aptitud/reglas` | admin, medico |
| PATCH | `/api/aptitud/reglas/:id/aprobar` | medico |
| PATCH | `/api/aptitud/reglas/:id/retirar` | admin, medico |
| GET | `/api/aptitud/cie10/buscar` | admin, medico |
| GET | `/api/aptitud/exposiciones` | admin, medico |
| POST | `/api/aptitud/trabajadores/:trabajadorId/evaluar` | medico |
| POST | `/api/aptitud/trabajadores/:trabajadorId/registrar` | medico |
| GET | `/api/aptitud/trabajadores/:trabajadorId/historial` | medico |

## `/api/consentimientos`

**Clasificacion del dato:** operativo_individual (consentimientos informados)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/consentimientos/tipos` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/consentimientos/tipos/:codigo/pdf-blanco` | medico, sso, th |
| POST | `/api/consentimientos/trabajadores/:trabajadorId/firmar` | medico, sso, th |
| POST | `/api/consentimientos/trabajadores/:trabajadorId/firmar-fisico` | medico, sso, th |
| GET | `/api/consentimientos/trabajadores/:trabajadorId` | medico, sso, th |
| POST | `/api/consentimientos/:id/revocar` | medico, sso, th |
| GET | `/api/consentimientos/:id/firma-url` | medico, sso, th |
| GET | `/api/consentimientos/:id/pdf` | medico, sso, th |

## `/api/dashboard`

**Clasificacion del dato:** agregado + fragmentos individuales proyectados por rol

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/dashboard/resumen` | cualquier rol autenticado (sin restriccion de rol) |

## `/api/audiometria`

**Clasificacion del dato:** clinico_individual

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/audiometria/trabajadores/:trabajadorId` | medico |
| GET | `/api/audiometria/trabajadores/:trabajadorId` | medico, sso |
| GET | `/api/audiometria/:examenId` | medico |
| PUT | `/api/audiometria/:examenId/revisar-baseline` | medico |
| PATCH | `/api/audiometria/:examenId/decision-retest-sts` | medico |

## `/api/espirometria`

**Clasificacion del dato:** clinico_individual

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/espirometria/trabajadores/:trabajadorId` | medico |
| GET | `/api/espirometria/trabajadores/:trabajadorId` | medico, sso |
| GET | `/api/espirometria/:examenId` | medico |

## `/api/historia-clinica`

**Clasificacion del dato:** clinico_individual (exclusivo medico)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/historia-clinica/catalogos` | medico |
| POST | `/api/historia-clinica/trabajadores/:trabajadorId/preocupacional` | medico |
| POST | `/api/historia-clinica/trabajadores/:trabajadorId/retiro` | medico |
| POST | `/api/historia-clinica/trabajadores/:trabajadorId/periodica` | medico |
| POST | `/api/historia-clinica/trabajadores/:trabajadorId/reintegro` | medico |
| POST | `/api/historia-clinica/trabajadores/:trabajadorId/inmunizaciones` | medico |
| GET | `/api/historia-clinica/trabajadores/:trabajadorId/inmunizaciones` | medico |
| GET | `/api/historia-clinica/trabajadores/:trabajadorId` | medico |
| GET | `/api/historia-clinica/:id` | medico |
| GET | `/api/historia-clinica/:id/pdf` | medico |
| GET | `/api/historia-clinica/:id/certificado` | medico |

## `/api/visiometria`

**Clasificacion del dato:** clinico_individual

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/visiometria/trabajadores/:trabajadorId` | medico |
| GET | `/api/visiometria/trabajadores/:trabajadorId` | medico, sso |
| GET | `/api/visiometria/:examenId` | medico |

## `/api/nordico`

**Clasificacion del dato:** clinico_individual (cuestionario ergonomico)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/nordico/catalogos` | medico, sso |
| POST | `/api/nordico/trabajadores/:trabajadorId` | medico, sso |
| GET | `/api/nordico/trabajadores/:trabajadorId` | medico, sso |
| GET | `/api/nordico/:cuestionarioId` | medico, sso |

## `/api/niosh`

**Clasificacion del dato:** clinico_individual (evaluacion ergonomica)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/niosh/trabajadores/:trabajadorId` | medico, sso |
| GET | `/api/niosh/trabajadores/:trabajadorId` | medico, sso |
| GET | `/api/niosh/:evaluacionId` | medico, sso |

## `/api/puestos-trabajo`

**Clasificacion del dato:** catalogo

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/puestos-trabajo/catalogos` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/puestos-trabajo/` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/puestos-trabajo/:id` | cualquier rol autenticado (sin restriccion de rol) |
| POST | `/api/puestos-trabajo/` | admin, sso, th |
| PUT | `/api/puestos-trabajo/:id` | admin, sso, th |
| DELETE | `/api/puestos-trabajo/:id` | admin, sso, th |
| PATCH | `/api/puestos-trabajo/:id/confirmar-sin-exposiciones` | admin, sso, medico |

## `/api/organizacion`

**Clasificacion del dato:** administrativo

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/organizacion/` | admin |
| PUT | `/api/organizacion/` | admin |
| PUT | `/api/organizacion/logo` | admin |
| GET | `/api/organizacion/suscripcion` | admin |

## `/api/alertas`

**Clasificacion del dato:** operativo_individual (con fragmento clinico condicional)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/alertas/` | cualquier rol autenticado (sin restriccion de rol) |
| PUT | `/api/alertas/:id/estado` | cualquier rol autenticado (sin restriccion de rol) |

## `/api/matriz-riesgos`

**Clasificacion del dato:** catalogo (IPER)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/matriz-riesgos/catalogos` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/matriz-riesgos/` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/matriz-riesgos/:id` | cualquier rol autenticado (sin restriccion de rol) |
| POST | `/api/matriz-riesgos/` | admin, sso, th |
| PUT | `/api/matriz-riesgos/:id` | admin, sso, th |
| DELETE | `/api/matriz-riesgos/:id` | admin, sso, th |

## `/api/indicadores`

**Clasificacion del dato:** agregado

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/indicadores/` | cualquier rol autenticado (sin restriccion de rol) |

## `/api/ausentismo`

**Clasificacion del dato:** operativo_individual (con diagnostico CIE-10 restringido a medico)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/ausentismo/catalogos` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/ausentismo/resumen` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/ausentismo/` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/ausentismo/:id` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/ausentismo/:id/certificado-url` | cualquier rol autenticado (sin restriccion de rol) |
| POST | `/api/ausentismo/importar` | admin, sso, th |
| POST | `/api/ausentismo/` | admin, sso, th |
| PUT | `/api/ausentismo/:id` | admin, sso, th |
| DELETE | `/api/ausentismo/:id` | admin, sso, th |

## `/api/reportes`

**Clasificacion del dato:** agregado

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/reportes/areas` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/reportes/resumen` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/reportes/pdf` | cualquier rol autenticado (sin restriccion de rol) |

## `/api/capacitaciones`

**Clasificacion del dato:** operativo_individual

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/capacitaciones/` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/capacitaciones/:id` | cualquier rol autenticado (sin restriccion de rol) |
| POST | `/api/capacitaciones/` | cualquier rol autenticado (sin restriccion de rol) |
| DELETE | `/api/capacitaciones/:id` | admin, sso, th |

## `/api/certificados`

**Clasificacion del dato:** clinico_individual (certificado de aptitud) / operativo (otros)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/certificados/capacitacion/:capacitacionId/trabajador/:trabajadorId` | admin, sso, th |
| GET | `/api/certificados/aptitud/:trabajadorId` | medico |

## `/api/enfermedad-profesional`

**Clasificacion del dato:** clinico_individual

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/enfermedad-profesional/vista-preventiva-sso` | sso |
| POST | `/api/enfermedad-profesional/trabajadores/:trabajadorId` | medico |
| GET | `/api/enfermedad-profesional/trabajadores/:trabajadorId` | medico |
| GET | `/api/enfermedad-profesional/casos/:casoId` | medico |
| PUT | `/api/enfermedad-profesional/casos/:casoId` | medico |
| POST | `/api/enfermedad-profesional/casos/:casoId/seguimientos` | medico |

## `/api/restricciones-medicas`

**Clasificacion del dato:** clinico_individual

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/restricciones-medicas/trabajadores/:trabajadorId` | medico |
| PUT | `/api/restricciones-medicas/:restriccionId/prorrogar` | medico |
| PUT | `/api/restricciones-medicas/:restriccionId/modificar` | medico |
| PUT | `/api/restricciones-medicas/:restriccionId/levantar` | medico |
| GET | `/api/restricciones-medicas/trabajadores/:trabajadorId` | medico, sso, th |
| GET | `/api/restricciones-medicas/:restriccionId/historial` | medico, sso, th |

## `/api/matriz-medico-puesto`

**Clasificacion del dato:** catalogo

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/matriz-medico-puesto/` | medico |
| GET | `/api/matriz-medico-puesto/puestos/:puestoId` | medico |
| GET | `/api/matriz-medico-puesto/puestos/:puestoId/cobertura` | medico |
| PUT | `/api/matriz-medico-puesto/:requisitoId` | medico |

## `/api/vigilancia-salud`

**Clasificacion del dato:** clinico_individual

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/vigilancia-salud/programas` | medico |
| GET | `/api/vigilancia-salud/programas` | medico, sso |
| PUT | `/api/vigilancia-salud/programas/:programaId` | medico |
| POST | `/api/vigilancia-salud/programas/:programaId/observaciones` | medico |
| GET | `/api/vigilancia-salud/programas/:programaId/observaciones` | medico, sso |

## `/api/accidentes`

**Clasificacion del dato:** operativo_individual (con fragmento clinico restringido)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/accidentes/` | admin, sso |
| GET | `/api/accidentes/` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/accidentes/:id` | cualquier rol autenticado (sin restriccion de rol) |
| PUT | `/api/accidentes/:id` | admin, sso |
| POST | `/api/accidentes/:id/investigacion` | admin, sso |
| POST | `/api/accidentes/:id/acciones` | admin, sso |
| PUT | `/api/accidentes/acciones/:accionId/completar` | admin, sso |
| PUT | `/api/accidentes/acciones/:accionId/verificar` | admin, sso |
| POST | `/api/accidentes/:id/evidencias` | admin, sso |
| GET | `/api/accidentes/evidencias/:evidenciaId/url` | admin, sso, medico |
| DELETE | `/api/accidentes/evidencias/:evidenciaId` | admin, sso |

## `/api/usuarios`

**Clasificacion del dato:** administrativo (cuentas de la organizacion)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/usuarios/` | admin, sso |
| GET | `/api/usuarios/mi-firma-digital` | cualquier rol autenticado (sin restriccion de rol) |
| PUT | `/api/usuarios/mi-firma-digital` | cualquier rol autenticado (sin restriccion de rol) |
| DELETE | `/api/usuarios/mi-firma-digital` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/usuarios/:usuarioId/firma-digital` | admin, sso, th, medico |

## `/api/capa`

**Clasificacion del dato:** operativo_individual

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/capa/` | admin, sso, medico |
| GET | `/api/capa/` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/capa/:id` | cualquier rol autenticado (sin restriccion de rol) |
| PUT | `/api/capa/:id` | admin, sso, medico |
| PUT | `/api/capa/:id/implementar` | admin, sso, medico |
| PUT | `/api/capa/:id/verificar` | admin, sso, medico |
| PUT | `/api/capa/:id/evaluar-eficacia` | admin, sso, medico |
| PUT | `/api/capa/:id/cerrar` | admin, sso, medico |

## `/api/inspecciones`

**Clasificacion del dato:** operativo_individual

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/inspecciones/` | admin, sso |
| GET | `/api/inspecciones/` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/inspecciones/:id` | cualquier rol autenticado (sin restriccion de rol) |
| PUT | `/api/inspecciones/:id` | admin, sso |
| POST | `/api/inspecciones/:id/items` | admin, sso |
| POST | `/api/inspecciones/:id/hallazgos` | admin, sso |
| POST | `/api/inspecciones/hallazgos/:hallazgoId/generar-capa` | admin, sso |

## `/api/riesgo-psicosocial`

**Clasificacion del dato:** clinico_individual (evaluacion individual) / agregado (resumen)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/riesgo-psicosocial/evaluaciones` | admin, sso |
| GET | `/api/riesgo-psicosocial/evaluaciones/resumen-agregado` | admin, sso, medico |
| GET | `/api/riesgo-psicosocial/evaluaciones` | sso, medico |
| GET | `/api/riesgo-psicosocial/evaluaciones/:id` | sso, medico |
| PUT | `/api/riesgo-psicosocial/evaluaciones/:id` | admin, sso |
| POST | `/api/riesgo-psicosocial/evaluaciones/:id/generar-capa` | admin, sso |

## `/api/higiene-industrial`

**Clasificacion del dato:** catalogo + mediciones operativas

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/higiene-industrial/mediciones` | admin, sso |
| GET | `/api/higiene-industrial/mediciones` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/higiene-industrial/mediciones/:id` | cualquier rol autenticado (sin restriccion de rol) |
| POST | `/api/higiene-industrial/mediciones/:id/generar-capa` | admin, sso |
| GET | `/api/higiene-industrial/catalogo-limites` | cualquier rol autenticado (sin restriccion de rol) |

## `/api/epp`

**Clasificacion del dato:** operativo_individual

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/epp/catalogo` | admin, sso |
| GET | `/api/epp/catalogo` | cualquier rol autenticado (sin restriccion de rol) |
| POST | `/api/epp/entregas` | admin, sso |
| GET | `/api/epp/entregas` | cualquier rol autenticado (sin restriccion de rol) |
| GET | `/api/epp/entregas/:id/firma` | cualquier rol autenticado (sin restriccion de rol) |
| PUT | `/api/epp/entregas/:id/marcar-repuesto` | admin, sso |

## `/api/pagos`

**Clasificacion del dato:** administrativo (facturacion, PayPhone)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/pagos/payphone/iniciar` | admin |
| POST | `/api/pagos/payphone/confirmar` | admin |

## `/api/finalidades-tratamiento`

**Clasificacion del dato:** catalogo (gobierno de datos)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/finalidades-tratamiento/` | cualquier rol autenticado (sin restriccion de rol) |

## `/api/solicitudes-titular`

**Clasificacion del dato:** operativo_individual (derechos ARCO/habeas data)

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/solicitudes-titular/publico` | PUBLICA (sin autenticacion) -- revisar si es intencional |
| POST | `/api/solicitudes-titular/` | admin, sso |
| GET | `/api/solicitudes-titular/` | admin, sso |
| GET | `/api/solicitudes-titular/:id` | admin, sso |
| PATCH | `/api/solicitudes-titular/:id/asignar` | admin, sso |
| PATCH | `/api/solicitudes-titular/:id/verificar-identidad` | admin, sso |
| PATCH | `/api/solicitudes-titular/:id/responder` | admin |

## `/api/incidentes-seguridad`

**Clasificacion del dato:** operativo_individual

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| POST | `/api/incidentes-seguridad/` | admin, sso |
| GET | `/api/incidentes-seguridad/` | admin, sso |
| GET | `/api/incidentes-seguridad/:id` | admin, sso |
| PATCH | `/api/incidentes-seguridad/:id` | admin |

## `/api/puesto-exposiciones`

**Clasificacion del dato:** catalogo

| Metodo | Ruta | Rol(es) permitido(s) |
|---|---|---|
| GET | `/api/puesto-exposiciones/:puestoTrabajoId` | sso, medico |
| PUT | `/api/puesto-exposiciones/:puestoTrabajoId` | sso, medico |


---

**Resumen:** 215 endpoints documentados. 7 sin autenticacion (revisar cada una individualmente mas arriba). 50 requieren sesion valida pero no restringen por rol especifico.
