/* ==========================================================================
   toast.js — Avisos emergentes breves
   --------------------------------------------------------------------------
   Uso:
     App.toast.show('Mensaje');
     App.toast.show('Mensaje', { actionLabel: 'Actualizar', onAction: fn, duration: 0 });
   duration en milisegundos (0 = no se cierra solo). Por defecto: 5 s.

   El contenedor #toast-region siempre está en la página con
   aria-live="polite", así los lectores de pantalla anuncian cada aviso.
   ========================================================================== */
window.App = window.App || {};

App.toast = (() => {
  'use strict';

  const DEFAULT_DURATION = 5000;
  const region = document.getElementById('toast-region');
  let current = null;
  let timer = null;

  function hide() {
    clearTimeout(timer);
    if (!current) return;

    const leaving = current;
    current = null;
    leaving.classList.add('is-leaving');
    setTimeout(() => leaving.remove(), 200);
  }

  function show(message, options = {}) {
    if (!region) return;
    const { actionLabel, onAction, duration = DEFAULT_DURATION } = options;

    // Solo un aviso a la vez: el nuevo reemplaza al anterior
    clearTimeout(timer);
    if (current) current.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';

    const text = document.createElement('p');
    text.className = 'toast-msg';
    text.textContent = message;
    toast.append(text);

    if (actionLabel && typeof onAction === 'function') {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'toast-action';
      action.textContent = actionLabel;
      action.addEventListener('click', () => {
        hide();
        onAction();
      });
      toast.append(action);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Cerrar aviso');
    close.textContent = '×';
    close.addEventListener('click', hide);
    toast.append(close);

    region.append(toast);
    current = toast;

    if (duration > 0) timer = setTimeout(hide, duration);
  }

  return { show, hide };
})();
