/* ==========================================================================
   sw.js — Service worker de Gestión de Estadías
   --------------------------------------------------------------------------
   Permite que el sitio se instale y funcione sin conexión.

   Estrategias de caché
   · Instalación: guarda de antemano la página, estilos, scripts, íconos,
     imágenes, video y tipografías.
   · Páginas, estilos, scripts e imágenes: primero la red (siempre lo más
     reciente); si no hay conexión, la copia guardada.
   · Video: primero la caché, respondiendo las peticiones parciales (Range)
     que usan los reproductores.
   · Tipografías de Google Fonts: se guardan la primera vez y se reutilizan.
   · Respuestas de la API (Supabase): las guarda la página en "estadias-api"
     (js/cache-api.js); aquí solo se protege esa caché para no borrarla.

   Envío en segundo plano (Background Sync)
   · Si el alumno sube su tesina sin conexión, la página la guarda en
     IndexedDB (js/cola.js) y registra la etiqueta "enviar-tesina". Cuando
     vuelve la red, el navegador despierta a este service worker, aunque la
     app esté cerrada, y él envía la entrega y avisa con una notificación.

   Al agregar, quitar o renombrar archivos, actualiza PRECACHE y sube
   VERSION: el navegador instalará el service worker nuevo y borrará la
   caché anterior.
   ========================================================================== */

importScripts('js/cola.js'); // define ColaTesina

const VERSION = 'v6';
const STATIC_CACHE = `estadias-${VERSION}`;
const FONT_CACHE = 'estadias-fuentes';
const API_CACHE = 'estadias-api'; // la llena js/cache-api.js

// Rutas relativas a este archivo (funciona también en una subcarpeta)
const PRECACHE = [
  './',
  'portal.html',
  'alumno.html',
  'asesor.html',
  'offline.html',
  'manifest.webmanifest',
  'css/variables.css',
  'css/base.css',
  'css/layout.css',
  'css/components.css',
  'css/responsive.css',
  'css/sigep.css',
  'css/portal.css',
  'js/sigep.js',
  'js/toast.js',
  'js/navigation.js',
  'js/pwa.js',
  'js/config.js',
  'js/cache-api.js',
  'js/cola.js',
  'js/auth.js',
  'js/tesina.js',
  'js/panel.js',
  'js/documento.js',
  'js/prerevision.js',
  'js/comparar.js',
  'js/visor.js',
  'js/voz.js',
  'js/portal.js',
  'js/alumno.js',
  'js/asesor.js',
  'js/vendor/supabase.js',
  'js/vendor/pdfjs/pdf.min.mjs',
  'js/vendor/pdfjs/pdf.worker.min.mjs',
  'icons/icon.svg',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'media/hero-plataforma.png',
  'media/poster-recorrido.png',
  'media/recorrido-estadias.mp4',
];

// Deben ser idénticas a las URL de <link rel="stylesheet"> de las páginas:
// la primera la usan index.html y offline.html; la segunda, el diseño SIGEP
// (portal.html, alumno.html y asesor.html).
const FONT_CSS = [
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,300;1,6..72,400&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap',
];
const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

/* ==========================================================================
   Ciclo de vida
   ========================================================================== */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(PRECACHE);
    // Las tipografías son opcionales: si fallan, la instalación continúa
    await precacheFonts().catch(() => {});
    // Activa la versión nueva sin esperar a que se cierren las pestañas
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [STATIC_CACHE, FONT_CACHE, API_CACHE];
    const names = await caches.keys();
    await Promise.all(names.filter((name) => !keep.includes(name)).map((name) => caches.delete(name)));
    // Toma el control de las pestañas abiertas desde ya
    await self.clients.claim();
  })());
});

/* ==========================================================================
   Peticiones
   ========================================================================== */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (FONT_ORIGINS.includes(url.origin)) {
    event.respondWith(fromFontCache(event));
    return;
  }

  // Cualquier otro sitio externo se deja pasar sin intervenir
  if (url.origin !== self.location.origin) return;

  if (request.destination === 'video' || url.pathname.endsWith('.mp4')) {
    event.respondWith(fromMediaCache(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(event).catch(() => offlinePage(url)));
    return;
  }

  event.respondWith(networkFirst(event));
});

/* ==========================================================================
   Envío en segundo plano de la tesina (Background Sync)
   ========================================================================== */

self.addEventListener('sync', (event) => {
  if (event.tag === ColaTesina.ETIQUETA) event.waitUntil(enviarCola());
});

async function enviarCola() {
  const { enviadas, motivo } = await ColaTesina.enviarPendientes();
  // Si la red volvió a fallar, el error hace que el navegador lo reintente después
  if (motivo === 'red') throw new Error('Sin conexión: se reintentará.');
  if (!enviadas.length) return;

  const ventanas = await self.clients.matchAll({ type: 'window' });
  ventanas.forEach((v) => v.postMessage({ tipo: 'cola-enviada', enviadas }));

  if (self.Notification?.permission === 'granted') {
    await Promise.all(enviadas.map((v) => self.registration.showNotification('Tu tesina se envió', {
      body: `«${v.nombre}» quedó registrada como la versión ${v.numero}. Tu asesor ya puede revisarla.`,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-maskable-192.png',
      tag: `tesina-${v.id}`,
      lang: 'es-MX',
      data: { url: 'alumno.html#tesina' },
    })));
  }
}

// Al tocar la notificación se abre (o se enfoca) «Mi tesina»
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const abierta = ventanas.find((v) => v.url.split('#')[0] === destino.split('#')[0]);
    if (abierta) {
      await abierta.focus();
      return abierta.navigate(destino);
    }
    return self.clients.openWindow(destino);
  })());
});

/* ==========================================================================
   Estrategias
   ========================================================================== */

/** Primero la red; si falla, la copia guardada. */
async function networkFirst(event) {
  const { request } = event;
  const cache = await caches.open(STATIC_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok && response.status === 200) {
      event.waitUntil(cache.put(request, response.clone()));
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

/** Sin conexión: la portada guardada o, para otras rutas, offline.html. */
async function offlinePage(url) {
  const cache = await caches.open(STATIC_CACHE);
  const { scope } = self.registration;
  const scopePath = new URL(scope).pathname;
  const isHome = url.pathname === scopePath || url.pathname === `${scopePath}index.html`;

  if (isHome) {
    const home = await cache.match('./');
    if (home) return home;
  }

  // offline.html puede mostrarse en cualquier ruta (p. ej. /alumnos/expediente);
  // <base> hace que sus estilos y enlaces relativos apunten a la raíz del sitio.
  const page = await cache.match('offline.html');
  const html = (await page.text()).replace('<head>', `<head>\n  <base href="${scope}">`);
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/** Video: caché primero y respuesta parcial (206) si el reproductor la pide. */
async function fromMediaCache(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (!cached) return fetch(request);

  const range = request.headers.get('range');
  if (!range) return cached;

  const body = await cached.arrayBuffer();
  const size = body.byteLength;
  const match = /bytes=(\d*)-(\d*)/.exec(range);

  let start = match && match[1] ? Number(match[1]) : 0;
  let end = match && match[2] ? Number(match[2]) : size - 1;
  if (match && !match[1] && match[2]) {
    // Formato "bytes=-500": los últimos 500 bytes
    start = Math.max(size - Number(match[2]), 0);
    end = size - 1;
  }
  end = Math.min(end, size - 1);

  if (start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }

  return new Response(body.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

/**
 * Tipografías: se sirven de la caché. Los archivos de fuente nunca cambian;
 * la hoja de estilos de Google sí, así que se actualiza en segundo plano.
 */
async function fromFontCache(event) {
  const { request } = event;
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  const isFontFile = new URL(request.url).origin === 'https://fonts.gstatic.com';

  if (cached && isFontFile) return cached;

  const refresh = fetch(request).then((response) => {
    if (response.ok) event.waitUntil(cache.put(request, response.clone()));
    return response;
  });

  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  return refresh;
}

/** Descarga la hoja de Google Fonts y sus archivos del subconjunto latino. */
async function precacheFonts() {
  const cache = await caches.open(FONT_CACHE);

  // Cada hoja se descarga por separado: si una falla, la otra se guarda igual
  await Promise.allSettled(FONT_CSS.map(async (url) => {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return;
    await cache.put(url, response.clone());

    // Cada bloque @font-face va precedido de un comentario con su subconjunto,
    // p. ej. /* latin */. El español solo necesita "latin".
    const css = await response.text();
    const files = [...css.matchAll(/\/\*\s*latin\s*\*\/[^}]*?url\((https:[^)]+)\)/g)].map((m) => m[1]);
    await cache.addAll([...new Set(files)]);
  }));
}
