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

   Al agregar, quitar o renombrar archivos, actualiza PRECACHE y sube
   VERSION: el navegador instalará el service worker nuevo y borrará la
   caché anterior.
   ========================================================================== */

const VERSION = 'v2';
const STATIC_CACHE = `estadias-${VERSION}`;
const FONT_CACHE = 'estadias-fuentes';

// Rutas relativas a este archivo (funciona también en una subcarpeta)
const PRECACHE = [
  './',
  'portal.html',
  'offline.html',
  'manifest.webmanifest',
  'css/variables.css',
  'css/base.css',
  'css/layout.css',
  'css/components.css',
  'css/responsive.css',
  'css/portal.css',
  'js/toast.js',
  'js/navigation.js',
  'js/pwa.js',
  'js/config.js',
  'js/auth.js',
  'js/portal.js',
  'js/vendor/supabase.js',
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

// Debe ser idéntica a la URL de <link rel="stylesheet"> en index.html
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,300;1,6..72,400&display=swap';
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
    const keep = [STATIC_CACHE, FONT_CACHE];
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
  const response = await fetch(FONT_CSS, { mode: 'cors' });
  if (!response.ok) return;

  await cache.put(FONT_CSS, response.clone());

  // Cada bloque @font-face va precedido de un comentario con su subconjunto,
  // p. ej. /* latin */. El español solo necesita "latin".
  const css = await response.text();
  const files = [...css.matchAll(/\/\*\s*latin\s*\*\/[^}]*?url\((https:[^)]+)\)/g)].map((m) => m[1]);
  await cache.addAll([...new Set(files)]);
}
