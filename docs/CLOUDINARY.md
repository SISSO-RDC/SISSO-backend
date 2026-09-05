# Dependencia de Cloudinary -- almacenamiento de archivos

CORRIGE hallazgo GRAVE G15-07 de la Auditoria Integral N.15:
"Cloudinary aparece como almacenamiento de evidencias/certificados/
firmas [sin] retencion, cifrado, control de acceso, expiracion de
URLs y plan de contingencia" documentados.

Este documento describe el estado REAL (verificado contra
`src/servicios/cloudinaryService.js`), no un objetivo aspiracional.
Donde algo no esta implementado, se dice explicitamente que no lo
esta, en vez de omitirlo.

## Que se almacena en Cloudinary

Fotos/video de evidencia (accidentes, ergonomia REBA/RULA,
inspecciones, EPP), firmas digitales (consentimientos, evaluaciones,
certificados de capacitacion), certificados medicos escaneados
(ausentismo), y el logo de cada organizacion cliente.

## Control de acceso (implementado)

- Todo archivo se sube como recurso `authenticated` de Cloudinary
  (`type: 'authenticated'`) **excepto** el logo de organizacion, que
  es intencionalmente publico (se muestra en `<img>` sin pasar por el
  backend). Un recurso `authenticated` no es accesible con la URL
  simple que Cloudinary devuelve al subirlo.
- Para ver un archivo privado, el backend genera una URL firmada
  (`generarUrlFirmada`) que expira en **5 minutos**
  (`SEGUNDOS_VALIDEZ_URL_FIRMADA`), y solo despues de que el
  controlador que la solicita ya verifico que la persona tiene
  permiso sobre el registro al que pertenece ese archivo (la funcion
  de Cloudinary no conoce ni verifica permisos por si misma).
- Las carpetas se organizan por `organizacion_id`, pero eso es
  organizacion, NO aislamiento: las credenciales de Cloudinary de
  SISSO tienen acceso a la cuenta completa. El aislamiento real entre
  organizaciones clientes es responsabilidad exclusiva del backend
  (verificar el permiso antes de firmar la URL), no de Cloudinary.

## Cifrado

- **En transito**: si, Cloudinary sirve todo por HTTPS (`secure:
  true` en la configuracion) y las URLs firmadas tambien son HTTPS.
- **En reposo**: Cloudinary declara cifrado en reposo de la
  infraestructura para todos los planes (ver la documentacion de
  seguridad de Cloudinary) -- esto es una garantia del proveedor, NO
  algo que SISSO configura, verifica criptograficamente, o pueda
  auditar de forma independiente. Si un cliente exige evidencia
  contractual de esto (ej. para una empresa que maneja datos
  clinicos y necesita documentarlo ante una auditoria propia), hay
  que solicitar la documentacion de seguridad/cumplimiento
  directamente a Cloudinary -- SISSO no tiene esa evidencia de
  primera mano hoy.

## Retencion -- NO IMPLEMENTADA

No existe ninguna politica de retencion ni borrado automatico por
antiguedad. Un archivo permanece en Cloudinary indefinidamente hasta
que:
- `borrarEvidencia()` lo borra explicitamente (ej. al eliminar o
  reemplazar el registro al que pertenece), o
- alguien lo borra manualmente desde el panel de Cloudinary.

Esto significa que, para efectos de habeas data / derecho al olvido
(ver `solicitudesTitularController.js`), borrar el registro de base
de datos de una persona NO borra automaticamente sus archivos en
Cloudinary si el codigo que maneja esa solicitud no llama
explicitamente a `borrarEvidencia()` para cada archivo asociado.
**Pendiente:** auditar cada flujo de baja/anonimizacion de un titular
de datos y confirmar que efectivamente borra sus archivos de
Cloudinary, no solo sus filas de PostgreSQL.

## Huerfanos y compensacion (implementado parcialmente)

`subirEvidenciaConCompensacion()` sube el archivo y, si el paso
posterior (tipicamente el INSERT en PostgreSQL) falla, intenta
borrar el archivo recien subido para no dejarlo huerfano. Si ese
borrado de compensacion TAMBIEN falla, el error se registra en el
log del servidor (`ORFANO EN CLOUDINARY: ...`) pero no hay ninguna
reconciliacion automatica -- requiere revision manual periodica de
esos logs. **No existe hoy un job programado que compare
periodicamente el contenido de Cloudinary contra las referencias
vivas en PostgreSQL** para detectar huerfanos que ocurrieron por otra
via (ej. un `DELETE` de fila hecho directamente en la consola SQL de
Neon, sin pasar por el controlador).

## Plan de contingencia -- NO DEFINIDO FORMALMENTE

Preguntas sin respuesta documentada hoy, que se listan explicitamente
para que sean una decision consciente de SISSO y no una omision:

- **Si Cloudinary tiene una interrupcion de servicio**, la aplicacion
  seguira funcionando para todo lo que no dependa de archivos (la
  base de datos es independiente), pero cualquier subida o
  visualizacion de evidencia/firmas fallara. No hay una cola de
  reintento ni un almacenamiento local de respaldo temporal.
- **Si Cloudinary cambia su politica de precios o queda inaccesible
  permanentemente**, no existe hoy un procedimiback de exportacion
  masiva de todos los archivos ni un proveedor alternativo
  preconfigurado. Migrar de proveedor requeriria: (1) exportar cada
  archivo por su `public_id` (guardado en PostgreSQL junto a cada
  registro), (2) subirlo al nuevo proveedor, (3) actualizar las
  referencias en PostgreSQL. Esto NO esta automatizado.
- **No se ha probado un ejercicio de recuperacion** (restaurar acceso
  a un archivo especifico a partir de su `public_id` guardado en
  PostgreSQL, en un ambiente distinto). Recomendacion concreta:
  hacerlo al menos una vez como prueba y documentar el procedimiento
  aqui.

## Resumen de pendientes (en orden de impacto)

1. Confirmar que los flujos de habeas data/derecho al olvido borran
   los archivos de Cloudinary asociados, no solo las filas de BD.
2. Definir e implementar una politica de retencion explicita (por
   ejemplo, alineada a cuanto tiempo la normativa ecuatoriana exige
   conservar registros de salud ocupacional).
3. Documentar (o solicitar a Cloudinary) evidencia formal de cifrado
   en reposo si algun cliente la requiere contractualmente.
4. Crear un job periodico de reconciliacion Cloudinary <-> PostgreSQL
   para detectar huerfanos que la compensacion en caliente no
   capturo.
5. Hacer y documentar al menos un ejercicio real de recuperacion de
   un archivo a partir de su `public_id`.
