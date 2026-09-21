# Correcciones Auditoría N.19

Auditoría: `Auditoria_SISSO_N19_SISSO5.docx` (2 críticos, 12 graves).
Este documento cubre backend y frontend (los dos ZIP se despliegan juntos).

## Orden de despliegue (importante)

1. **Base de datos (Neon):** `npm run verificar:esquema` con `DATABASE_URL` de producción. Si informa
   migraciones pendientes o columnas ausentes, aplicar las `migration_XXX` indicadas (son idempotentes) y repetir hasta ver `OK`.
2. **Frontend** (GitHub Pages). Debe ir **antes** que el backend: el backend ya no envía el catálogo `RELIGIONES`
   y un JS viejo en caché fallaría al poblar catálogos (mismo patrón que N.15).
3. **Backend** (Render). Variables nuevas en `.env.example`: `TRUST_PROXY` (por defecto 1 en producción) e
   `INSTANCIAS_MULTIPLES` (por defecto false).
4. **Verificación posterior:** hacer un login y comprobar que `auditoria.ip_origen` es la IP pública real
   (confirma el número de saltos de proxy de Render). Hacer un POST de evaluación periódica real (smoke test de C19-02).

## Críticos

### C19-01 — Frontend pedía campos bloqueados por la Sentencia 59-19-IN/24
- Frontend `historia-clinica/`: retirados religión, antecedentes gineco-obstétricos, examenes ginecológicos, reproductivos
  masculinos y hábitos tóxicos (HTML, lecturas y propiedades enviadas al guardar). Se conserva «Estilo de vida».
- Backend: eliminado el código muerto que imprimía esos campos en `pdfPreocupacional.js` y el catálogo `RELIGIONES`.
  (El bloqueo de lectura de `politicaMinimizacion` ya impedía que salieran; la rama viva reabría la exposición si esa política cambiara.)
- Pruebas: `tests/historia_clinica_campos_prohibidos.test.js` (frontend, 5) y
  `tests/n19_campos_bloqueados_sin_ramas_vivas.test.js` (backend, 2).

### C19-02 — Migración 093 y desfase de esquema en la base de destino
- `scripts/verificar_esquema_release.js` (`npm run verificar:esquema`): solo lectura; compara `schema_migrations` con los
  archivos **y** comprueba que las columnas agregadas por las migraciones existan realmente
  (en N.18 la 016 figuraba aplicada pero faltaban columnas). Sale con código 1 si hay diferencia.
- **Acción tuya:** ejecutarlo contra Neon antes de declarar el release completado. No se puede hacer desde CI.
- Pruebas sin BD: `tests/verificar_esquema_release.test.js`. La detección se probó contra una base con la 093 revertida.

## Graves

| Hallazgo | Estado | Qué se hizo |
|---|---|---|
| G19-01 espirometría | Parcial | Aviso «INTERINO» fijo en resultado e historial; prueba que prohíbe «definitivo»/«cumplimiento ERS/ATS». **No** se incorporaron ecuaciones GLI (requieren fuente oficial y validación biomédica). |
| G19-02 access token en sessionStorage | No cambiado | Ver «Decisiones» abajo. |
| G19-03 autorización/minimización distribuida | Parcial | Allowlist explícita de columnas por tabla + prueba que obliga a clasificar cada columna nueva. **Falta** la capa DTO por rol (requiere clasificación D0-D4). |
| G19-04 `SELECT *` / `tabla.*` | Hecho | 23 usos reemplazados por `columnas('tabla','alias')` (`src/db/columnasExplicitas.js`). `tests/allowlist_columnas.test.js` prohíbe `SELECT *`, `alias.*` y `RETURNING *` en todo `src/` y compara la allowlist con el esquema real. Las columnas bloqueadas por política ya ni se leen. |
| G19-05 retención | No abordado | Requiere asesoría jurídica; no se inventan plazos. |
| G19-06 E2E con navegador | No abordado | Requiere Playwright/Cypress con navegadores y BD de pruebas en CI. |
| G19-07 verificación normativa | Hecho | Pantalla `normas-examenes/`: estado no verificada / verificada vigente / vencida con distintivo, fuente, jurisdicción, artículo, fecha de validación, vigencia y verificador; edición solo para el médico. |
| G19-08 comparativo KPI | Hecho | Pantalla `kpis/`: sin_vinculo, sin_datos, no_disponible_para_su_rol, cumple/no_cumple; la meta en texto se rotula como declarada y no evaluada; el admin vincula/retira; admin/SSO/médico registran la medición del día. |
| G19-09 validación sectorial | No abordado | Proceso profesional/organizativo; no es un cambio de código. |
| G19-10 X-Forwarded-For | Hecho | `trust proxy` explícito (`TRUST_PROXY`), IP desde `req.ip` (`src/utils/ipCliente.js`) en auditoría y refresh tokens. Una cabecera larga ya no rompe el login (`ip_origen` es VARCHAR(64)). `tests/ip_cliente.test.js` y `tests/n19_ip_y_archivos_integracion.test.js` (servidor real). |
| G19-11 uploads | Hecho | `src/utils/validarArchivo.js`: data URI base64 estricto, tipo permitido por uso (firma, logo, evidencia, certificado), tamaño máximo y magic bytes. Aplicado en `subirEvidencia` y en los validadores/controladores. Evidencia de accidentes y REBA/RULA antes no validaba nada. |
| G19-12 caché de auth | Hecho | `src/utils/configCacheAuth.js`: con `INSTANCIAS_MULTIPLES=true` y `AUTH_CACHE_TTL_MS>0` el servidor se niega a arrancar; advertencia si el TTL supera el default en producción; el TTL efectivo se registra en cada arranque. |

## Cambios de comportamiento a tener en cuenta
- Ya **no se aceptan** GIF, BMP ni SVG como firma/logo/evidencia (se permiten PNG, JPEG, WebP y HEIC/HEIF, salvo el logo: PNG/JPEG/WebP; video MP4/WebM/QuickTime solo en evidencia; PDF solo en certificados).
- Una firma inválida en EPP ahora responde 400 (antes se ignoraba en silencio).
- El backend ya no lee de la base las columnas bloqueadas de `evaluaciones_ocupacionales`.
- `req.ip` (y por tanto el limitador de login) refleja al cliente real cuando `TRUST_PROXY` es correcto.

## Decisiones pendientes
- **G19-02:** mover el access token a memoria obligaría a un `refresh` por cada página (app multipágina) y expone a la
  rotación de refresh tokens con reutilización; sin pruebas E2E en navegador puede reintroducir el cierre de sesión en móvil.
  La solución de fondo es una sesión BFF/cookie para el access token. Requiere decisión y pruebas E2E (G19-06).
- **G19-03:** definir la clasificación de datos D0-D4 para construir los serializadores por rol.

## Verificación
- Backend: 37 archivos de prueba, todos en verde contra PostgreSQL 16 (usuario sin BYPASSRLS), más
  `ci_verificar_env` y `ci_verificar_migraciones`.
- Frontend: 32 pruebas en verde (`node --test tests/*.test.js`).
- Las pruebas de C19-01 (frontend) y de G19-10/G19-11 (servidor real) **fallan contra el código original**, es decir, detectan el defecto.
- No verificado en este entorno: comportamiento real en Render (número de saltos de proxy), Cloudinary con archivos reales
  y las nuevas pantallas en un navegador real.
