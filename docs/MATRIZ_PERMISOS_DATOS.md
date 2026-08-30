# Matriz central de permisos y minimización — SISSO

**CREADO en Auditoría N.11 (hallazgo GRAVE G11-12, P1).**
**ACTUALIZADO en Auditoría N.12 (G12-12):** filas de Audiometría,
Espirometría y Visiometría corregidas (ahora auditadas con
`lecturaSensible:true`, ver G12-05); agregadas las filas de los
módulos nuevos de N.12 (revisión de baseline audiométrica, canal
directo del titular, incidentes de seguridad). Pendiente para el
próximo ciclo (no bloqueante): una prueba automatizada que contraste
esta tabla contra `src/routes/*.js` en vez de mantenimiento manual.

Hasta ahora los permisos vivían repartidos entre `routes/*.js`
(`autorizar(...)`), controladores (funciones `proyectarXPorRol`),
`src/utils/politicaMinimizacion.js` (red de seguridad, ver C11-03) y
comentarios. Este documento es la matriz central que la auditoría
pide: quién puede hacer qué, sobre qué dato, con qué nivel de detalle,
para qué finalidad, y si queda auditado.

**Mantenimiento:** cuando se agregue o cambie un endpoint que toque
datos personales/sensibles, se actualiza esta tabla en el mismo commit.
No sustituye al código (las rutas y controladores siguen siendo la
fuente de verdad en tiempo de ejecución) — es la vista humana que
permite auditar el conjunto de un vistazo, tal como pide G11-12.

Roles: **SA**=superadmin, **AD**=admin, **SSO**, **ME**=médico, **TH**

Nivel de dato: **D0**=sin dato personal (agregado/anonimizado),
**D1**=personal no sensible, **D2**=sensible minimizado (señal
calculada, sin detalle clínico), **D3**=sensible completo (detalle
clínico/diagnóstico)

| Módulo | Endpoint | Rol | Dato que recibe | Nivel | Finalidad (código) | Auditado | Aislado por tenant |
|---|---|---|---|---|---|---|---|
| Historia clínica | `GET /api/historia-clinica/:id` | ME | Registro completo (sin orientación sexual/identidad de género) | D3 | `vigilancia_salud_ocupacional` | Sí (`lecturaSensible`) | Sí (RLS + filtro explícito) |
| Historia clínica | `GET /api/historia-clinica/trabajadores/:id` (listado) | ME | Listado completo | D3 | `vigilancia_salud_ocupacional` | Sí (`lecturaSensible`) | Sí |
| Historia clínica | `GET /api/historia-clinica/:id/pdf`, `/certificado` | ME | PDF con datos clínicos | D3 | `vigilancia_salud_ocupacional` | Sí, antes de generar (`lecturaSensible`) | Sí |
| Aptitud médica | `GET /api/aptitud/trabajadores/:id/historial` | ME, AD, SSO, TH | Historial de aptitud | D1/D3 según rol (ver `historiaClinicaController`) | `vigilancia_salud_ocupacional` | Sí para lectura clínica | Sí |
| Nordico | `GET /api/nordico/trabajadores/:id` | ME | Detalle completo (regiones, observaciones) | D3 | `evaluaciones_ergonomicas` | No (best-effort) | Sí |
| Nordico | `GET /api/nordico/trabajadores/:id` | SSO | `prioridad_preventiva`, `accion_requerida` (sin conteos ni zonas) | D2 | `evaluaciones_ergonomicas` | No | Sí |
| Visiometría | `GET /api/visiometria/trabajadores/:id` | ME | Detalle completo | D3 | `gestion_vigilancia_salud` | Sí (`lecturaSensible`, G12-05) | Sí |
| Visiometría | `GET /api/visiometria/trabajadores/:id` | SSO | `estado_preventivo` (sin clasificación ni aptitud) | D2 | `gestion_vigilancia_salud` | No | Sí |
| Audiometría | `GET /api/audiometria/trabajadores/:id` | ME | Detalle completo (STS por oído) | D3 | `gestion_vigilancia_salud` | Sí (`lecturaSensible`, G12-05) | Sí |
| Audiometría | `GET /api/audiometria/trabajadores/:id` | SSO | `requiere_seguimiento_auditivo` (sin lateralidad) | D2 | `gestion_vigilancia_salud` | No | Sí |
| Audiometría | `PUT /api/audiometria/:id/revisar-baseline` | ME | Revisión de basal vigente (motivo, fecha) | D3 | `gestion_vigilancia_salud` | Sí (G12-03) | Sí |
| Espirometría | `GET /api/espirometria/trabajadores/:id` | ME | Detalle completo (patrón, calidad de maniobra) | D3 | `gestion_vigilancia_salud` | Sí (`lecturaSensible`, G12-05) | Sí |
| Espirometría | `GET /api/espirometria/trabajadores/:id` | SSO | `estado_preventivo` (incluye `calidad_insuficiente`; sin patrón nominal) | D2 | `gestion_vigilancia_salud` | No | Sí |
| Ausentismo | `GET /api/ausentismo` | ME | Incluye diagnóstico CIE-10, certificado | D3 | `gestion_ausentismo` | No | Sí |
| Ausentismo | `GET /api/ausentismo` | AD, SSO, TH | Sin diagnóstico ni certificado | D1 | `gestion_ausentismo` | No | Sí |
| Ausentismo | `GET /api/ausentismo/:id/certificado-url` | ME | URL firmada del certificado escaneado | D3 | `gestion_ausentismo` | Sí (`lecturaSensible`, G12-05) | Sí |
| Ausentismo | `POST/PUT /api/ausentismo` | SSO, TH | 403 si intentan escribir diagnóstico/certificado | — | `gestion_ausentismo` | Sí (evento de escritura) | Sí |
| Consentimientos | `GET /api/consentimientos/trabajadores/:id` | ME | Nombre real del tipo + estado | D2 | ligado al tipo (`tipos_consentimiento.categoria`) | No | Sí |
| Consentimientos | `GET /api/consentimientos/trabajadores/:id` | SSO, TH | Tipo genérico "clínico reservado" si `categoria='clinico'`; estado sí visible | D1 | ídem | No | Sí |
| Consentimientos | `GET /api/consentimientos/:id/firma-url`, `/pdf` | ME | Contenido firmado completo | D3 | ídem | Sí (`lecturaSensible`) | Sí |
| Consentimientos | `GET /api/consentimientos/:id/firma-url`, `/pdf` | SSO, TH | 403 si `categoria='clinico'` | — | ídem | — | Sí |
| Enfermedad profesional | `GET /api/enfermedad-profesional/*` | ME | Detalle completo | D3 | `vigilancia_salud_ocupacional` | Sí (`lecturaSensible`) | Sí |
| Enfermedad profesional | `GET .../vista-preventiva` | SSO | Cifras agregadas, sin nombres | D0 | `vigilancia_salud_ocupacional` | No (agregado, no nominal) | Sí |
| Restricciones médicas | `GET /api/restricciones-medicas/trabajadores/:id` | ME | Detalle completo | D3 | `vigilancia_salud_ocupacional` | Sí (`lecturaSensible`) | Sí |
| Restricciones médicas | ídem | AD, SSO, TH | Restricción operativa sin motivo clínico | D1 | `vigilancia_salud_ocupacional` | No | Sí |
| Indicadores SSO / Reportes BI | `GET /api/indicadores`, `/api/reportes/resumen` | Todos (proyección por rol) | Cifras agregadas, con k-anonimato en grupos pequeños | D0 | `indicadores_reportes_agregados` | No | Sí |
| Accidentes/CAPA | CRUD | AD, SSO | Datos operativos + trabajador involucrado | D1 | `gestion_accidentes_incidentes` / `gestion_capa` | Sí (todas las escrituras) | Sí |
| Accidentes: evidencia | `GET .../evidencia/:id/url` | AD, SSO | URL firmada de foto/video | D1-D2 | `gestion_accidentes_incidentes` | Sí (`lecturaSensible`) | Sí |
| EPP, Capacitaciones, Inspecciones, Higiene, Riesgo psicosocial | CRUD | AD, SSO | Datos operativos | D0-D1 | ver `finalidades_tratamiento` | Sí en escrituras | Sí |
| Solicitudes del titular | `POST/GET /api/solicitudes-titular` | AD, SSO | Identidad del solicitante + descripción | D1-D2 | — (proceso de gobierno, no un tratamiento operativo) | Sí (`lecturaSensible` en detalle) | Sí |
| Solicitudes del titular | `PATCH .../responder` | AD únicamente | — | — | — | Sí | Sí |
| Solicitudes del titular | `POST /api/solicitudes-titular/publico` | Sin autenticar (canal directo del titular, C12-03) | Identidad + tipo de solicitud (sin verificar) | D1 | — | Sí | Sí (por `codigoOrganizacion`, respuesta genérica si no existe) |
| Incidentes de seguridad | `POST/GET/PATCH /api/incidentes-seguridad/*` (C12-03) | AD, SSO (PATCH solo AD) | Descripción, categorías de datos afectados, notificaciones | D1-D2 | — | Sí | Sí |
| Gestión de usuarios/organizaciones | `superadmin/*` | SA | Todo (fuera del tenant, por diseño) | — | — | Sí | N/A (es superadmin) |

## Cómo se aplica el aislamiento por tenant (columna "Aislado por tenant")

Dos capas independientes, no una sola:
1. **Filtro explícito** en cada consulta (`WHERE organizacion_id = $1`), en el propio controlador.
2. **RLS a nivel de PostgreSQL** (`migration_045`/`046`/`048` en adelante):
   incluso si un controlador olvidara el filtro explícito, la política
   `aislamiento_tenant` de cada tabla lo bloquea a nivel de base de datos.

## Alcance de esta entrega

Esta matriz cubre los módulos con datos personales/sensibles más
relevantes. **No es exhaustiva** — por ejemplo no detalla cada
endpoint de solo-lectura de catálogos (sin dato personal, D0 por
definición) ni cada variante de filtro de un listado. Se irá
extendiendo en próximas rondas conforme se toquen más módulos.
