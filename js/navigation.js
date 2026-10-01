/* ==========================================================================
   navigation.js — Menú de navegación
   --------------------------------------------------------------------------
   1. Abre y cierra el menú desplegable en teléfonos y tabletas.
   2. Resalta en el menú la sección que se está leyendo.
   ========================================================================== */
(() => {
  'use strict';

  const header = document.querySelector('.site-head');
  const button = document.getElementById('menu-btn');
  const nav = document.getElementById('nav');
  if (!header || !button || !nav) return;

  const links = [...nav.querySelectorAll('a[href^="#"]')];

  // Debe coincidir con el punto de corte "Laptops" de responsive.css
  const inlineMenu = window.matchMedia('(min-width: 1024px)');

  /* ---------- 1. Menú desplegable ---------- */
  const isOpen = () => nav.classList.contains('is-open');

  function setOpen(open) {
    nav.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
  }

  button.addEventListener('click', () => setOpen(!isOpen()));

  // Al elegir una sección, el menú se cierra
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });

  // Escape cierra el menú y devuelve el foco al botón
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      setOpen(false);
      button.focus();
    }
  });

  // Un toque fuera del encabezado también lo cierra
  document.addEventListener('click', (event) => {
    if (isOpen() && !header.contains(event.target)) setOpen(false);
  });

  // Si la pantalla crece hasta mostrar el menú en línea, se reinicia el estado
  inlineMenu.addEventListener('change', () => setOpen(false));

  /* ---------- 2. Sección actual ---------- */
  if (!('IntersectionObserver' in window)) return;

  const linkById = new Map(links.map((link) => [link.hash.slice(1), link]));

  function markCurrent(id) {
    links.forEach((link) => {
      const active = link === linkById.get(id);
      link.classList.toggle('is-current', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }

  // Una sección cuenta como "actual" cuando cruza la franja central de la pantalla
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) markCurrent(entry.target.id);
    });
  }, { rootMargin: '-45% 0px -50% 0px' });

  linkById.forEach((_, id) => {
    const section = document.getElementById(id);
    if (section) observer.observe(section);
  });
})();
