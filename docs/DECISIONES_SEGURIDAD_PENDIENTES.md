# Decisiones de seguridad pendientes (endurecimiento futuro)

Este documento registra explicitamente hallazgos GRAVES de la
Auditoria Integral N.15 que se mitigaron parcialmente en esta entrega
pero cuya resolucion completa es un cambio de arquitectura mayor, no
un ajuste puntual. El objetivo es que la decision de posponerlos sea
consciente y quede escrita -- no un olvido silencioso.

## G15-10 -- Token de acceso en sessionStorage

**Estado actual:** el access token (JWT de corta duracion, 15 min)
vive en `sessionStorage` del navegador (ver `shared/api.js`). El
refresh token, desde una correccion de auditoria anterior, ya NO pasa
por JavaScript: vive exclusivamente en una cookie HttpOnly que el
backend administra.

**Riesgo real:** un XSS que logre ejecutar codigo en cualquier pagina
de SISSO podria leer `sessionStorage` y robar el access token
mientras dure la sesion (hasta 15 minutos, o menos si el usuario
cierra la pestaña). No podria robar el refresh token (ya mitigado).

**Por que no se resuelve en esta entrega:** la solucion completa
(patron BFF -- Backend For Frontend, donde ni siquiera el access
token toca el navegador, y cada peticion pasa por un proxy que
adjunta el token del lado del servidor) requiere una capa de
infraestructura nueva que hoy no existe (SISSO es un frontend
estatico en GitHub Pages sin servidor propio intermedio). Es un
cambio de arquitectura, no una correccion de codigo.

**Mitigaciones ya vigentes que reducen el riesgo mientras tanto:**
- Duracion del access token limitada a 15 minutos.
- El refresh token (la credencial de mayor duracion) ya no es
  accesible por JavaScript bajo ninguna circunstancia.
- CSP (`Content-Security-Policy`) restringe `default-src` a `'self'`
  en todas las paginas, reduciendo el impacto de un intento de
  inyectar un script externo.

**Pendiente real (no cosmetico):** todas las paginas mantienen
`'unsafe-inline'` en `script-src` (necesario hoy porque usan
atributos `onclick`/`oninput` inline extensivamente -- ver M15-03).
Mientras `'unsafe-inline'` siga presente, la CSP NO bloquea la
ejecucion de un script inyectado via XSS, asi que la mitigacion de
CSP contra el riesgo de G15-10 es mas debil de lo que su sola
presencia sugiere. Migrar los `onclick` a `addEventListener()` (M15-03)
y luego retirar `'unsafe-inline'` es un prerrequisito real para que
la CSP aporte una defensa efectiva aqui -- no son dos tareas
independientes.

## G15-02 -- Autorizacion distribuida (autorizar() por ruta + logica en controladores)

**Estado actual:** cada ruta declara su propio `autorizar(...roles)`,
y algunos controladores aplican logica adicional de proyeccion de
datos por rol (ej. `proyectarIndicadoresSegunRol`). Esta entrega
avanzo dos piezas concretas de mitigacion:
1. `docs/MATRIZ_RBAC.md`, generada automaticamente por introspeccion
   real del arbol de rutas (no un documento aparte que se desactualiza).
2. `tests/inventario_rutas_seguras.test.js`, que falla si una ruta
   queda sin autenticacion fuera de la lista de excepciones aprobadas.
3. La migracion 075 de esta misma entrega es un ejemplo real de
   exactamente el riesgo que describe este hallazgo (una regla de
   negocio en el controlador -- medico puede retirar una regla global
   -- que la politica RLS no reflejaba), ya corregido.

**Por que no se "centraliza" del todo en esta entrega:** una
centralizacion completa (por ejemplo, una tabla de permisos unica que
tanto las rutas como las politicas RLS como la proyeccion de datos
consulten) es un rediseño de la capa de autorizacion, no un fix
puntual, y el riesgo de introducir una regresion de seguridad
_durante_ ese rediseño (en un sistema que maneja datos clinicos) es en
si mismo significativo. La mitigacion elegida -- pruebas de contrato
por rol para cada modulo (ya existen ampliamente) mas la matriz
autogenerada mas el test de inventario -- reduce la probabilidad de
que una divergencia pase desapercibida, sin asumir el riesgo de
reescribir el mecanismo completo.

## G15-05 -- Auditoria dependiente de disciplina de los controladores

**Estado actual:** `tests/auditoria_completitud_controladores.test.js`
(nuevo en esta entrega) verifica, a nivel de archivo, que todo
controlador con rutas de escritura sobre un recurso clinico llame a
`registrarAuditoria` en algun punto. Es una red de seguridad real,
pero deliberadamente gruesa: confirma que el archivo "sabe auditar",
no que la funcion especifica que atiende cada ruta lo haga.

**Pendiente real:** un middleware/interceptor automatico (o una
politica de CI que exija, por analisis estatico de AST, que cada
funcion controladora de una ruta de escritura sensible llame a
`registrarAuditoria` en su propio cuerpo) daria una garantia mas
fuerte que la verificacion a nivel de archivo. Queda como mejora de
arquitectura para una proxima entrega.
