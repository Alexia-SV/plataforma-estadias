# Gestión de Estadías · Aplicación web progresiva

Sitio informativo de la plataforma para centralizar el proceso de estadías de la
universidad. Es una **aplicación web progresiva (PWA)**: se puede instalar en el
teléfono o en la computadora y sigue funcionando sin conexión.

## Cómo verlo

Las funciones de PWA (instalación y modo sin conexión) solo funcionan en `https://`
o en `localhost`, así que hay que abrir el sitio con un servidor local:

```bash
python -m http.server 5500
```

Después se abre <http://localhost:5500>. También sirve la extensión *Live Server* de
VS Code. Si se abre `index.html` con doble clic, la página se ve completa, pero sin
instalación ni modo sin conexión.

## Estructura

```
plataforma-estadias/
├── index.html              Página principal (solo estructura y contenido)
├── portal.html             Portal del alumno: inicio de sesión, registro y bienvenida
├── offline.html            Página que se muestra sin conexión en rutas no guardadas
├── manifest.webmanifest    Nombre, íconos, colores y atajos de la app instalada
├── sw.js                   Service worker: caché y funcionamiento sin conexión
├── css/
│   ├── variables.css       Paleta, tipografía, espaciado y modo oscuro (tokens)
│   ├── base.css            Reinicio, jerarquía tipográfica y utilidades
│   ├── layout.css          Encabezado, menú, secciones y pie de página
│   ├── components.css      Botones, tarjetas, módulos, video, línea de tiempo, avisos
│   ├── responsive.css      Ajustes para tableta, laptop y escritorio
│   └── portal.css          Diseño vibrante del Portal del alumno
├── js/
│   ├── toast.js            Avisos emergentes accesibles
│   ├── navigation.js       Menú desplegable y sección activa
│   ├── pwa.js              Registro del service worker, botón «Instalar app», conexión
│   ├── config.js           Datos de conexión con Supabase (URL y clave publicable)
│   ├── auth.js             Registro, inicio y cierre de sesión con Supabase
│   ├── portal.js           Pestañas, validación de formularios y bienvenida
│   └── vendor/supabase.js  Librería oficial de Supabase (v2, licencia MIT)
├── supabase/esquema.sql    Tabla alumnos, seguridad (RLS) y funciones de la base de datos
├── icons/                  Íconos de la app (SVG, 192, 512, enmascarables, iOS)
└── media/                  Imagen principal, video del recorrido y capturas de la app
```

## Portal del alumno (inicio de sesión y registro)

El portal guarda las cuentas en **Supabase**, una base de datos PostgreSQL en la nube.
Funciona tanto en `localhost` como en la página publicada.

| Dato | Dónde se guarda |
| --- | --- |
| Correo y contraseña (cifrada) | Supabase Auth (`auth.users`) |
| Nombre, matrícula, nivel y fecha de registro | Tabla `public.alumnos` |

Cada alumno solo puede leer su propio registro: lo garantizan las políticas RLS de
`supabase/esquema.sql`. Al registrarse, un disparador de la base de datos crea su
renglón en `alumnos` con los datos del formulario.

### Configuración (una sola vez)

1. Crea una cuenta en [supabase.com](https://supabase.com) y un proyecto nuevo.
2. En **SQL Editor**, pega el contenido de `supabase/esquema.sql` y pulsa **Run**.
3. En **Authentication → Sign In / Providers → Email**, desactiva **Confirm email**
   para que el alumno entre en cuanto se registra (recomendado para la demostración).
   Si la dejas activa, el alumno debe confirmar desde su correo antes de iniciar sesión.
4. En **Authentication → URL Configuration**, pon como *Site URL*
   `https://alexia-sv.github.io/plataforma-estadias/portal.html`.
5. Copia en `js/config.js` la **Project URL** y la **Publishable key** (o *anon key*).
   Nunca uses ahí la *secret key* ni la *service_role key*.

Las contraseñas deben tener al menos 8 caracteres, con letras y números; la matrícula,
10 dígitos.

## Requisitos cubiertos

| Requisito | Dónde se cumple |
| --- | --- |
| **Encabezado** con nombre, logotipo e identidad | `<header class="site-head">`: logotipo «E», nombre y lema |
| **Menú de navegación** | `<nav id="nav">`: en línea en laptop y escritorio; desplegable en tableta y teléfono |
| **Cuerpo con secciones** | Inicio, El proceso, Roles, Módulos, Flujo, Recorrido, Plataforma y Alcance |
| **Pie de página** | `<footer class="site-foot">`: identidad, enlaces, redes sociales y créditos |
| **Diseño responsivo** | `css/responsive.css`, *mobile first*: teléfono (< 768 px), tableta (≥ 768 px), laptop (≥ 1024 px) y escritorio (≥ 1280 px) |
| **Colores consistentes** | Todos los colores salen de `css/variables.css`; incluye modo oscuro automático |
| **Multimedia** | Texto, imagen principal (`media/hero-plataforma.png`) y video con portada (`media/recorrido-estadias.mp4`) |
| **Tipografía y legibilidad** | Newsreader (títulos), IBM Plex Sans (texto) e IBM Plex Mono (rótulos); contraste AA |
| **Código organizado** | HTML sin estilos ni scripts en línea; CSS dividido por responsabilidad; JS en módulos pequeños y comentados |

## Funciones de PWA

- **Instalable**: el manifiesto define nombre, íconos (incluidos los enmascarables de
  Android), colores, capturas para el cuadro de instalación y atajos a *Recorrido*,
  *Módulos* y *Alcance*. Cuando el navegador lo permite, aparece el botón
  **Instalar app** en el encabezado.
- **Sin conexión**: al abrir el sitio por primera vez, el service worker guarda la
  página, estilos, scripts, íconos, imágenes, video y tipografías. Sin internet, todo
  se sirve desde esa copia; el video se puede adelantar porque se atienden las
  peticiones parciales (*Range*).
- **Siempre actualizado**: con conexión se pide primero la versión nueva a la red y
  se actualiza la copia guardada.
- **Avisos**: se informa cuando el sitio quedó listo sin conexión, cuando se instala
  la app y cuando se pierde o recupera la conexión.

Para probarlo: DevTools → *Application* → *Service workers* / *Manifest*; en
*Network* se puede marcar *Offline* y recargar.

## Mantenimiento

- **Cambiar colores o fuentes**: solo en `css/variables.css`.
- **Agregar una sección**: crear el `<section id="...">` en `index.html` y su enlace
  en el menú (`#nav`) y, si aplica, en el pie de página.
- **Agregar, quitar o renombrar archivos**: actualizar la lista `PRECACHE` en `sw.js`
  y subir `VERSION` (por ejemplo, de `v1` a `v2`). También hay que subirla al editar
  `offline.html`, porque esa página solo se lee desde la caché.
- **Cambiar las tipografías de Google Fonts**: la URL aparece en `index.html`,
  `portal.html`, `offline.html` y `sw.js` (`FONT_CSS`); todas deben ser idénticas.

## Publicación

Cualquier hosting con HTTPS sirve (GitHub Pages, Netlify, Vercel). Todas las rutas son
relativas, así que el sitio funciona también dentro de una subcarpeta.
