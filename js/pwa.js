/* ==========================================================================
   pwa.js — Funciones de aplicación web progresiva
   --------------------------------------------------------------------------
   1. Registra el service worker (sw.js) para que el sitio funcione sin
      conexión.
   2. Muestra el botón «Instalar app» cuando el navegador lo permite.
   3. Avisa cuando se pierde o se recupera la conexión.
   Depende de toast.js (se carga antes en index.html).
   ========================================================================== */
(() => {
  'use strict';

  const { toast } = window.App;

  /* ---------- 1. Service worker ---------- */
  function registerServiceWorker() {
    // Los service workers solo funcionan en HTTPS o en localhost
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

    // Si la página aún no tiene service worker, esta es la primera visita
    const firstVisit = !navigator.serviceWorker.controller;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (firstVisit) toast.show('Listo: el sitio quedó guardado para usarse sin conexión.');
    }, { once: true });

    // Se registra al terminar de cargar para no competir con la página
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((error) => {
        console.warn('No se pudo registrar el service worker:', error);
      });
    });
  }

  /* ---------- 2. Instalación ---------- */
  function setupInstallButton() {
    const button = document.getElementById('install-btn');
    if (!button) return;

    let installPrompt = null;

    // El navegador avisa que la app se puede instalar: guardamos el aviso
    // y mostramos nuestro propio botón en el encabezado.
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      installPrompt = event;
      button.hidden = false;
    });

    button.addEventListener('click', async () => {
      if (!installPrompt) return;
      button.hidden = true;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null; // cada aviso solo se puede usar una vez
    });

    window.addEventListener('appinstalled', () => {
      installPrompt = null;
      button.hidden = true;
      toast.show('App instalada. Ábrela desde tu pantalla de inicio o tu escritorio.');
    });
  }

  /* ---------- 3. Estado de la conexión ---------- */
  function watchConnection() {
    window.addEventListener('offline', () => {
      toast.show('Sin conexión. Sigues viendo la copia guardada del sitio.');
    });
    window.addEventListener('online', () => {
      toast.show('Conexión restablecida.');
    });
  }

  registerServiceWorker();
  setupInstallButton();
  watchConnection();
})();
