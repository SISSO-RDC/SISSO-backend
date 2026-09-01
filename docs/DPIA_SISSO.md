# Evaluación de Impacto en la Protección de Datos Personales (DPIA) — SISSO

**CREADO en Auditoría Integral N.12 (hallazgo CRITICO C12-05, P0).**

Este documento es el punto de partida formal de la DPIA que la
LOPDP de Ecuador exige cuando el tratamiento involucra datos
sensibles a gran escala (categoría de dato explícita en
`finalidades_tratamiento.categoria_datos = 'sensible'`, ver
`migration_051`/`056`/`063`) — que es exactamente el caso de SISSO:
diagnósticos CIE-10, resultados de audiometría/espirometría/
visiometría, historia clínica ocupacional, evaluaciones psicosociales
e inmunizaciones de los trabajadores de cada organización cliente.

**Estado:** primer borrador estructural, escrito desde el
conocimiento técnico del sistema (arquitectura, controles ya
implementados, hallazgos de auditorías previas). **No sustituye la
revisión y aprobación formal de un Delegado de Protección de Datos
(DPO) o asesoría jurídica especializada** — eso es, explícitamente,
una decisión organizacional que corresponde a personas, no a código.
Este documento deja la base tecnica lista para que esa revisión sea
rápida y bien informada, no para saltarla.

## 1. Descripción del tratamiento

- **Responsable del tratamiento:** cada organización cliente de SISSO
  (multi-tenant: SISSO es el encargado del tratamiento/proveedor de
  la plataforma, no el responsable legal de los datos de los
  trabajadores de sus clientes).
- **Encargado del tratamiento:** SISSO (desarrollador y operador de
  la plataforma), sobre infraestructura de Render (aplicación) y Neon
  (PostgreSQL), con almacenamiento de archivos en Cloudinary.
- **Finalidad:** gestión de seguridad y salud ocupacional conforme a
  la normativa ecuatoriana aplicable (Decreto Ejecutivo 255/2024,
  IESS). **Aclaración exigida por Auditoría N.13 (hallazgo GRAVE
  G-07):** el Acuerdo Ministerial MSP 0341-2019 fue la base histórica
  del formulario HCU 077/081, pero desde la Sentencia 59-19-IN/24 de
  la Corte Constitucional (11/07/2024) esa base quedó parcialmente
  invalidada respecto a los campos que la propia sentencia identificó
  (orientación sexual, identidad de género, religión, antecedentes
  ginecobstétricos/reproductivos, hábitos tóxicos — ver `migration_050`
  y `migration_064`, secciones 3 y 4). SISSO NO cita el Acuerdo
  0341-2019 como base jurídica vigente para esos campos específicos;
  para el resto del formulario (datos no afectados por la sentencia)
  sigue siendo la referencia histórica mientras el MSP no emita
  normativa sustitutiva. Esta distinción se mantenía implícita en
  versiones anteriores de este documento y ahora queda explícita para
  evitar la impresión de un cumplimiento normativo cerrado que no
  existe — ver sección 4 para los riesgos residuales derivados de
  esto.
  Cada módulo tiene su finalidad codificada en `finalidades_tratamiento`
  (ver `migration_051`, `056`, `063`).
- **Categorías de datos:** identificativos (nombre, documento),
  laborales (puesto, jornada), y de **salud** (diagnósticos,
  resultados de exámenes ocupacionales, restricciones médicas,
  inmunizaciones) — estos últimos son datos sensibles bajo la LOPDP.
- **Categorías de titulares:** trabajadores de las organizaciones
  clientes (incluye ex-trabajadores para fines de historial legal).
- **Escala:** multi-tenant; el volumen depende de cada organización
  cliente, potencialmente cientos de trabajadores por organización.

## 2. Necesidad y proporcionalidad

- La recolección de datos de salud está justificada por obligación
  legal de vigilancia de la salud ocupacional (no por consentimiento
  únicamente, aunque también se gestionan consentimientos específicos
  vía `tipos_consentimiento`/`consentimientos_firmados` para los
  tratamientos que sí lo requieren).
- **Minimización por rol**, ya implementada y auditada en ciclos
  previos (ver `docs/MATRIZ_PERMISOS_DATOS.md`): SSO/TH reciben
  señales agregadas o binarias (ej. `estado_preventivo`,
  `requiere_seguimiento`) en vez del detalle clínico completo, que
  queda reservado a `medico`.
- **Retención**: `finalidades_tratamiento.plazo_conservacion_meses`
  declara el plazo por finalidad, pero (ver sección 5) la aplicación
  automatizada de ese plazo (bloqueo/eliminación) sigue pendiente —
  es hoy un dato de referencia, no un control técnico activo.

## 3. Riesgos identificados y controles existentes

| Riesgo | Control técnico existente | Referencia |
|---|---|---|
| Acceso cruzado entre organizaciones (multi-tenant) | RLS + `FORCE ROW LEVEL SECURITY` en todas las tablas con `organizacion_id`, mas filtro explícito en cada consulta | `migration_045`/`046`/`048`, `docs/MATRIZ_PERMISOS_DATOS.md` |
| Acceso a catálogos globales bloqueado o filtrado incorrectamente | Políticas específicas para filas `organizacion_id IS NULL` con significado de "compartido" | `migration_058` (C12-01) |
| Exceso de exposición de datos clínicos a roles no clínicos | Proyección por rol en controladores + `politicaMinimizacion.js` como red de seguridad | Auditorías N.09-N.11 |
| Acceso indebido sin dejar rastro | `registrarAuditoria()` con `lecturaSensible:true` en accesos a datos clínicos; tabla `auditoria` append-only | `migration_047`, G12-05 |
| Pérdida de eventos de auditoría por fallo transitorio | Cola de respaldo `auditoria_pendiente` con RLS y drenaje idempotente | `migration_059`, G12-07/G12-08 |
| Filtración por reportes agregados con grupos pequeños | Supresión k-anonimato (`< 5` trabajadores) en Reportes BI | Auditoría N.09/N.10 |
| Credenciales/secretos comprometidos | Contraseñas con `bcryptjs`, secretos TOTP cifrados AES-256-GCM, tokens de refresco rotados con `HttpOnly/Secure/SameSite=None` | Auditorías N.08-N.09 |
| El titular no puede ejercer sus derechos fácilmente | Canal directo público + gestión interna con plazo de 15 días | `migration_062`, C12-03 |
| Incidente de seguridad sin proceso de gestión | Registro estructurado de incidentes con notificación documentada | `migration_057`, C12-03 |

## 4. Riesgos residuales (no resueltos por controles técnicos actuales)

Estos son riesgos que **siguen abiertos** tras esta ronda de
corrección y requieren decisión organizacional, no solo código:

1. **Retención y eliminación automatizada**: existe el plazo
   declarado por finalidad, pero no un job que bloquee/elimine datos
   vencidos. Requiere definir, por finalidad, si aplica eliminación,
   anonimización o archivo, y quién lo autoriza.
2. **Transferencias a terceros**: Cloudinary (almacenamiento de
   archivos) y el proveedor de hosting (Render/Neon) implican
   transferencia de datos a infraestructura de terceros. No existe
   aún un registro formal de estas transferencias ni verificación de
   las garantías contractuales/DPA de esos proveedores.
3. **Ecuaciones clínicas de referencia**: el módulo de espirometría
   usa una aproximación documentada del límite inferior de la
   normalidad (LLN) mientras no se incorpora la tabla oficial
   GLI-2012 validada por un profesional biomédico (ver comentarios en
   `src/espirometria/espirometria.js` y `migration_061`). Esto es un
   riesgo de calidad del dato clínico, no de confidencialidad, pero
   afecta decisiones sobre la salud de los titulares y debe quedar en
   el radar de la DPIA.
4. **Aprobación formal**: este documento no ha sido revisado por un
   DPO ni por asesoría jurídica. Se recomienda esa revisión antes de
   asumir que la evaluación de impacto está "cerrada".
5. **Base jurídica mixta (G-07, Auditoría N.13)**: aunque la sección 1
   ya distingue qué partes del Acuerdo 0341-2019 siguen citándose y
   cuáles no (por la Sentencia 59-19-IN/24), la plataforma en su
   conjunto opera todavía bajo un marco normativo en transición: el
   MSP no ha emitido el formulario sustitutivo. Mientras eso no
   ocurra, cualquier afirmación de "cumplimiento normativo completo"
   sería prematura — este documento evita hacerla intencionalmente.

## 5. Próximos pasos recomendados

1. Designar (o confirmar) un responsable de protección de datos por
   organización cliente, o un DPO compartido si aplica.
2. Revisar y aprobar formalmente este documento, con especial
   atención a la sección 4.
3. Definir el mecanismo de aplicación de plazos de retención (punto
   4.1) y priorizarlo para el próximo ciclo de auditoría (N.13).
4. Formalizar el registro de transferencias a terceros (punto 4.2).
