# Correcciones — Auditoría N.18 (`Auditoria_SISSO_N18_SISSO4.docx`)

Entregables: `SISSO-backend-N18-corregido.zip` + `SISSO-frontend-N18-corregido.zip`
(contenido en la raíz, listo para reemplazar el repositorio; el backend NO incluye
`node_modules`).

## Resumen honesto del estado

| Hallazgo | Prioridad | Estado |
|---|---|---|
| C18-01 Suite no ejecutable sin infraestructura | P0 | **Cerrado** (evidencia + verificador + guía + CI) |
| C18-02 Token en `sessionStorage` + CSP `unsafe-inline` | P0 | **Parcial**: CSP estricta hecha; retirar el token de `sessionStorage` queda como plan documentado (ver abajo) |
| P0-2 Pentest XSS/CSRF/IDOR/RLS/RBAC | P0 | **No abordable en código** (requiere ejecución externa) |
| G18-01 / G18-07 Autorización distribuida | P1 | **No abordado** (cambio de arquitectura; ver `docs/DECISIONES_SEGURIDAD_PENDIENTES.md`, G15-02) |
| G18-02 Auditoría por función | P1 | **Cerrado** (prueba AST + 10 funciones corregidas) |
| G18-03 RLS/RBAC clínico sin cobertura | P1 | **Cerrado** por C18-01: las pruebas RLS/RBAC corrieron contra Postgres real |
| G18-04 Contenido sectorial incompleto | P1 | **Cerrado por la vía "estado explícito"** (no se inventó contenido) |
| G18-05 Norma/frecuencia de exámenes en texto libre | P1 | **Cerrado en backend**; falta la pantalla |
| G18-06 KPI sin comparación con valor real | P1 | **Cerrado en backend**; falta la pantalla |
| G18-08 CSP inconsistente | P1 | **Cerrado** (misma CSP en 37 páginas, verificada en CI) |
| G18-09 Caché de invalidación local | P1 | **Mitigado** (TTL configurable; `0` para multi-instancia) |
| G18-10 / M18-09 SCA y SBOM | P1/P2 | **Cerrado** (0 vulnerabilidades; CI con `npm audit` + SBOM) |
| M18-01 / M18-02 `SELECT *` | P2 | **Cerrado** (+ prueba que impide reintroducirlos) |
| M18-03 Importación ignora aptitud en silencio | P2 | **Cerrado** |
| M18-06 Sincronía RBAC × permisos de datos | P2 | **Cerrado** (prueba automática; halló 2 filas desactualizadas) |
| M18-10 Norma verificada vs informativa | P2 | **Parcial**: la API lo entrega; falta el distintivo visual |
| M18-04 DTO/serializadores · M18-05 campos textuales · M18-07 pruebas visuales · M18-08 retención | P2 | **No abordado** |

## Hallazgo nuevo, no listado en el informe (el más importante)

`verificarLimitePlan()` (`src/utils/planes.js`) e `importarMasivo()` ejecutaban
`SELECT ... FROM organizaciones o LEFT JOIN planes p ... FOR UPDATE`. PostgreSQL rechaza
`FOR UPDATE` sobre el lado nulable de un `LEFT JOIN` **siempre**, incluso con 0 filas
(reproducido en `psql`). Por eso **`POST /api/trabajadores`, `POST /api/auth/registrar-usuario-interno`
y `POST /api/trabajadores/importar` devolvían 500**. Corregido con `FOR UPDATE OF o`.
Ninguna prueba previa cubría esas rutas; ahora hay pruebas (alta, alta de usuario, límite de
plan individual y masivo). **No lo comprobé en tu producción**, pero es comportamiento
determinista de PostgreSQL: prueba esas tres rutas tras desplegar.

## Evidencia de pruebas

Ejecutadas en PostgreSQL 16 real, rol de aplicación sin `SUPERUSER` ni `BYPASSRLS`, migraciones
001→092 desde cero, en serie (por archivo, con el mismo entorno que `ci.yml`):

* Línea base del código original: **193/193**.
* Con todas las correcciones: **224/224** (193 + 31 nuevas), 0 fallos.
  Nota: una prueba existente (`k_anonimato_centralizado`) falló una vez porque un comentario
  nuevo mencionaba "k-anonimato" sin importar el módulo; se reformuló y quedó en verde.
* Frontend: **9/9** pruebas estáticas (`node --test tests/*.test.js`) + verificación adicional
  en jsdom (no incluida en el repo).
* `npm audit --omit=dev`: **0 vulnerabilidades**. `node --check` de `src/`, `tests/` y `scripts/`: OK.
  `generar_matriz_rbac.js --verificar`, `ci_verificar_env.js` y `ci_verificar_migraciones.js`: OK.

**No se ejecutó** la suite con `npm test` de un tirón (se corrió archivo por archivo por el límite de
tiempo de mi entorno), ni en un navegador real con la CSP aplicada.

## Backend

### C18-01 — entorno de pruebas reproducible
* `scripts/verificar_entorno_pruebas.js` (script `pretest`, también `npm run test:entorno`): falla en segundos
  con mensaje accionable si faltan variables, la base no responde, el rol es superusuario/`BYPASSRLS`
  (invalidaría las pruebas de RLS; caso real de Neon "Add role") o hay migraciones sin aplicar.
  Verificado en los 4 escenarios.
* `docs/ENTORNO_PRUEBAS.md`: procedimiento (Docker / Postgres local) con las variables de `ci.yml`.

### G18-02 — auditoría por función
`tests/auditoria_n18_por_funcion.test.js` analiza el AST (`acorn`, devDependency) de todos los
controladores: toda función con escritura SQL debe llamar a `registrarAuditoria`, y toda escritura
con `client` dentro de `withTransaction` debe tener la auditoría **en la misma transacción**.
Encontró y se corrigió:
* Auditoría fuera de la transacción (si fallaba, quedaba la escritura sin rastro): `capacitaciones.crear`,
  `generarCapaDesdeMedicion`, `generarCapaDesdeHallazgo`, `riesgoPsicosocial.crearEvaluacion`,
  `generarCapaDesdeEvaluacion`, `authController.registrarOrganizacion`, `superadmin.crearEmpresa`,
  `superadmin.cambiarSuspensionOrganizacion`.
  **Cambio de comportamiento:** si el registro de auditoría falla, la operación se revierte.
* Sin auditoría: `inspecciones.agregarItem`, `pagos.iniciarPago`.
* 4 excepciones justificadas y con motivo (dos sincronizaciones de alertas derivadas, inicio de MFA
  pendiente, `listarEntregas` que marca vencidas); la prueba falla si una excepción deja de ser necesaria.

### G18-04 — estado explícito del contenido sectorial (migración 090)
No se inventó contenido ocupacional. `catalogo_sectores` gana `estado_contenido`
(`borrador_sin_validar` por defecto en los 14 sectores; `validado` exige quién y cuándo, con CHECK),
y la API calcula la cobertura por dimensión en cada consulta. `POST /configuracion-sectorial/propuestas/generar`
devuelve `cobertura` y `advertencias` (`SECTOR_SIN_CONTENIDO_PARA_TIPOS`, `CONTENIDO_SECTORIAL_SIN_VALIDAR`)
en lugar de "0 propuestas" sin explicación. Solo superadmin valida; editar el contenido de un sector
revoca su validación.

### G18-05 / M18-10 — gobierno de la norma de exámenes (migración 091)
`PUT /api/examenes-organizacion/:id/verificacion` (**solo médico**): verificar exige fuente, jurisdicción,
artículo y fecha de validación (validador + CHECK en base de datos); `vigenteHasta` opcional.
Todas las filas existentes quedan `no_verificada` (no se verificó ninguna norma). El listado devuelve
`estado_verificacion`, los campos de la referencia y `vigencia_norma`
(`no_verificada` | `verificada_vigente` | `verificada_vencida`, calculada al leer). Auditado en transacción.

### G18-06 — KPI: meta vs valor real (migración 092)
* `PUT /api/kpis-organizacion/:id/vinculo` (**admin**): vincula el KPI a UNO de 8 indicadores que
  `/api/indicadores` ya calcula (lista cerrada), con operador (`< <= > >= =`) y meta numérica.
  **La meta en texto libre no se interpreta**: sin vínculo el KPI figura `sin_vinculo`, nunca "cumplido".
* `GET /api/kpis-organizacion/comparativo`: meta, valor, desviación, cumplimiento y tendencia.
  El valor se obtiene ejecutando el propio `obtenerIndicadores` (misma proyección por rol y mismas
  reglas de supresión de cifras): quien no ve un indicador tampoco ve su valor ni su historial
  (`no_disponible_para_su_rol`). Sin denominador → `sin_datos`.
* `POST /api/kpis-organizacion/mediciones` (admin/sso/médico): foto diaria (una por KPI y día) que
  alimenta la tendencia (`mejora`/`empeora`/`estable`/`sin_historial`, según el operador).

### G18-09 — caché de invalidación
`AUTH_CACHE_TTL_MS` (default 20000, máx. 300000, validado al arrancar) controla las dos cachés de
`auth.js`. **Poner `0` antes de escalar a más de una instancia.** Documentado en `.env.example`.

### G18-10 / M18-09 — SCA y SBOM
`npm audit --omit=dev` tenía 6 vulnerabilidades (1 alta): se eliminó `nodemailer` (sin uso en `src/`),
`uuid` se reemplazó por `crypto.randomUUID()` y `npm audit fix` sin cambios mayores actualizó
express/qs/body-parser/morgan. Resultado: 0. `ci.yml` ahora ejecuta `npm audit --omit=dev --audit-level=high`
(falla con alta/crítica) y genera un SBOM CycloneDX; ambos se archivan como artefactos.
**Riesgo:** Express 4.22.3/qs 6.16 no se han probado contra tu producción más allá de la suite.

### M18-01 / M18-02 / M18-03 / M18-06
* `SELECT *` de capacitaciones y certificados → columnas explícitas; prueba que impide `SELECT * FROM`.
* Importación masiva: la respuesta incluye `advertencias[]` (`COLUMNA_APTITUD_IGNORADA` con el conteo de
  filas, nunca el valor); el conteo queda en la auditoría.
* `tests/matriz_permisos_datos_sincronizada.test.js` contrasta `docs/MATRIZ_PERMISOS_DATOS.md` con las rutas
  reales. Halló: la fila "Aptitud médica / historial" afirmaba que AD, SSO y TH accedían (la ruta es solo
  de médico) y `PUT /api/ausentismo` no existe (es `/:id`). Corregidas.

## Frontend

### C18-02 / G18-08 — CSP estricta y uniforme
* Los **358** atributos `onclick`/`onchange`/`oninput` (264/55/39) pasaron a `data-on-click|change|input`,
  ejecutados por `shared/csp-eventos.js`: un intérprete mínimo **sin `eval`** (gramática cerrada; solo funciones
  de la propia aplicación; rechaza `alert`, `eval`, `document.cookie`, etc.; respeta `this`, `event`,
  `stopPropagation` y `return false`).
* Los **24** bloques `<script>` en línea se movieron **sin cambios de lógica** a `pagina.js`.
* Las **37** páginas llevan la misma CSP con `script-src 'self'`. `tests/csp.test.js` + `.github/workflows/ci.yml`
  (frontend) lo verifican (incluye que toda función usada desde `data-on-*` esté definida).
* Correcciones halladas en el camino: `SissoPropuestasSectoriales` (un `const` que el delegador no veía) se expone en
  `window`; tres lugares con `JSON.stringify` dentro de un atributo de comilla simple (se rompían con un apóstrofe en una
  descripción CIE-10 o un tipo de consentimiento) ahora usan `escaparAtributoHtml`; expresiones DOM en línea → funciones.
* Importación de trabajadores: avisa en la vista previa y al terminar que la columna "aptitud" se ignora.

### Riesgo residual (honesto)
`style-src` conserva `'unsafe-inline'` (~636 `style=`); la CSP va en `<meta>` (GitHub Pages no permite cabeceras:
`frame-ancestors` no se aplica); un XSS podría reutilizar funciones existentes. El access token **sigue en
`sessionStorage`**: moverlo a memoria no es trivial (multi-página + rotación de refresh con detección de reutilización
cerraría la sesión con dos pestañas); el análisis y el plan (BFF, o coordinación entre pestañas con ventana de gracia)
están en `docs/DECISIONES_SEGURIDAD_PENDIENTES.md`.

## Despliegue

1. **Backend:** reemplaza el repo con `SISSO-backend-N18-corregido.zip` (Codespace: `npm ci`).
2. **Migraciones, en este orden, en el Neon SQL Editor de producción** (o `npm run migrate` en la rama de desarrollo):
   `migration_090_estado_contenido_sectorial.sql`, `migration_091_gobierno_norma_examenes.sql`,
   `migration_092_kpis_meta_vs_valor.sql`. Hazlo **antes** de redesplegar: el código nuevo consulta esas columnas.
3. Render: redeploy; `GET /api/salud` debe mostrar el commit nuevo.
4. **Frontend:** reemplaza el repo con `SISSO-frontend-N18-corregido.zip` (sube también `.github/` y `tests/`).
5. **Pruebas de humo tras desplegar** (consola del navegador abierta; un bloqueo de CSP aparece como error rojo):
   login (con MFA); Mi Empresa → Propuestas Sectoriales (aceptar/rechazar/modificar); historia clínica (guardar,
   agregar diagnóstico CIE-10, inmunización con "Otra"); consentimientos (elegir tipo, firma, imprimir en blanco);
   EPP; importar un Excel de trabajadores; **crear un trabajador y un usuario interno** (corrección del `FOR UPDATE`).
6. Opcional: define `AUTH_CACHE_TTL_MS=0` en Render si vas a escalar a más de una instancia.
7. Sugerencia: elimina `test_results.txt` del repo (es una salida vieja de 162 pruebas con 1 fallo y confunde).

## Pendiente / no cubierto

Pentest (P0-2) · BFF o retiro del token de `sessionStorage` · autorización distribuida (G18-01/07) · DTO por rol (M18-04) ·
campos sectoriales textuales restantes (M18-05) · pruebas visuales/E2E automatizadas (M18-07) · política de retención
(M18-08: requiere plazos legales que no debo inventar) · pantallas de frontend para el comparativo de KPI, el distintivo de
norma verificada y el estado del contenido sectorial · contenido validado de los 13 sectores sin puestos frecuentes.
