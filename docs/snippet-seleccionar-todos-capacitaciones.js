/* ============================================================
   SISSO — "Seleccionar todos / Deseleccionar todos" para la lista
   de Asistentes en Capacitaciones.

   CREADO a pedido de la persona usuaria (02/09/2026).

   No tengo el archivo real de esta pagina en esta sesion, asi que
   este script es GENERICO: busca por su cuenta el bloque que tiene
   el titulo "Asistentes" y la lista de checkboxes que sigue
   despues, sin depender de nombres exactos de clases o ids. Deberia
   funcionar tal cual, pegado al final del archivo capacitaciones/index.html
   (justo antes de </body>) o al final de tu script de esa pagina.

   Si prefieres que lo integre directamente en tu archivo real (con
   el mismo estilo visual del resto del formulario), compárteme
   capacitaciones/index.html y te lo dejo integrado en vez de este
   script aparte.
   ============================================================ */
(function () {
  function encontrarListaAsistentes() {
    // Busca cualquier elemento de texto que diga "Asistentes" (el
    // <label> o encabezado de esa seccion) y toma el contenedor de
    // checkboxes que viene inmediatamente despues en el DOM.
    const candidatos = Array.from(document.querySelectorAll('label, h2, h3, span, div'));
    const etiqueta = candidatos.find((el) => el.children.length === 0 && el.textContent.trim() === 'Asistentes');
    if (!etiqueta) return null;

    // El contenedor de checkboxes suele ser el siguiente hermano en
    // el DOM (el <div> con scroll que lista a los trabajadores).
    let contenedor = etiqueta.nextElementSibling;
    // Si el siguiente hermano no tiene checkboxes adentro, busca un
    // poco mas lejos (por si hay algun wrapper intermedio).
    let intentos = 0;
    while (contenedor && contenedor.querySelectorAll('input[type="checkbox"]').length === 0 && intentos < 3) {
      contenedor = contenedor.nextElementSibling;
      intentos += 1;
    }
    if (!contenedor || contenedor.querySelectorAll('input[type="checkbox"]').length === 0) return null;
    return { etiqueta, contenedor };
  }

  function inicializar() {
    const encontrado = encontrarListaAsistentes();
    if (!encontrado) return; // no estamos en la pagina de Capacitaciones, o el DOM aun no cargo
    const { etiqueta, contenedor } = encontrado;

    // Evita duplicar el control si el script corre mas de una vez.
    if (document.getElementById('sisso-seleccionar-todos-asistentes')) return;

    const barra = document.createElement('div');
    barra.style.cssText = 'display:flex;gap:16px;align-items:center;margin:6px 0 10px 0;font-size:13px;';
    barra.innerHTML = `
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
        <input type="checkbox" id="sisso-seleccionar-todos-asistentes" />
        Seleccionar todos
      </label>
      <button type="button" id="sisso-deseleccionar-todos-asistentes"
        style="border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:3px 10px;cursor:pointer;">
        Deseleccionar todos
      </button>
    `;
    etiqueta.insertAdjacentElement('afterend', barra);

    const checkboxMaestro = document.getElementById('sisso-seleccionar-todos-asistentes');
    const botonDeseleccionar = document.getElementById('sisso-deseleccionar-todos-asistentes');

    function checkboxesAsistentes() {
      return Array.from(contenedor.querySelectorAll('input[type="checkbox"]'));
    }

    checkboxMaestro.addEventListener('change', () => {
      checkboxesAsistentes().forEach((cb) => {
        cb.checked = checkboxMaestro.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true })); // por si el resto del código escucha 'change' de cada checkbox individual
      });
    });

    botonDeseleccionar.addEventListener('click', () => {
      checkboxMaestro.checked = false;
      checkboxesAsistentes().forEach((cb) => {
        cb.checked = false;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    // Si el usuario destilda uno manualmente, el checkbox maestro
    // deja de mostrarse marcado (evita el estado engañoso de "todos
    // seleccionados" cuando en realidad falta uno).
    contenedor.addEventListener('change', (e) => {
      if (e.target.matches('input[type="checkbox"]') && e.target !== checkboxMaestro) {
        const todos = checkboxesAsistentes();
        checkboxMaestro.checked = todos.length > 0 && todos.every((cb) => cb.checked);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
  } else {
    inicializar();
  }
  // La lista de asistentes normalmente se carga por fetch DESPUES
  // de que el HTML ya esta listo -- se reintenta un par de veces
  // por si el script corre antes de que la lista exista todavia.
  setTimeout(inicializar, 500);
  setTimeout(inicializar, 1500);
})();
