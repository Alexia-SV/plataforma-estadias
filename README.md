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
├── index.html              Página informativa (solo estructura y contenido)
├── portal.html             Acceso al portal: inicio de sesión y registro de alumnos
├── alumno.html             Panel del alumno: inicio, tesina, asesor y perfil
├── asesor.html             Panel del asesor: alumnos, versiones por revisar y observaciones
├── offline.html            Página que se muestra sin conexión en rutas no guardadas
├── manifest.webmanifest    Nombre, íconos, colores y atajos de la app instalada
├── sw.js                   Service worker: caché y funcionamiento sin conexión
├── css/
│   ├── variables.css       Paleta, tipografía, espaciado y modo oscuro (página informativa)
│   ├── base.css            Reinicio, jerarquía tipográfica y utilidades
│   ├── layout.css          Encabezado, menú, secciones y pie de página
│   ├── components.css      Botones, tarjetas, módulos, video, línea de tiempo, avisos
│   ├── responsive.css      Ajustes para tableta, laptop y escritorio
│   ├── sigep.css           Diseño común SIGEP UTP del equipo (copiado sin cambios)
│   └── portal.css          Estilos propios del Módulo 4 (solo variables de sigep.css)
├── js/
│   ├── sigep.js            Íconos y menú en celular del diseño SIGEP (copiado sin cambios)
│   ├── toast.js            Avisos emergentes accesibles
│   ├── navigation.js       Menú de la página informativa
│   ├── pwa.js              Registro del service worker, botón «Instalar app», conexión
│   ├── config.js           Datos de conexión con Supabase (URL y clave publicable)
│   ├── cache-api.js        Caché de las respuestas de la API (Cache Storage)
│   ├── auth.js             Cuentas, sesión y rol (alumno o asesor)
│   ├── tesina.js           Subida de versiones, historial, descargas y observaciones
│   ├── panel.js            Menú, vistas y dibujo común de alumno.html y asesor.html
│   ├── portal.js           Pestañas y validación de inicio de sesión y registro
│   ├── alumno.js           Panel del alumno
│   ├── asesor.js           Panel del asesor
│   └── vendor/supabase.js  Librería oficial de Supabase (v2, licencia MIT)
├── supabase/
│   ├── esquema.sql         Tabla alumnos, seguridad (RLS) y registro automático
│   └── tesina.sql          Asesores, asignaciones, versiones, observaciones y archivos
├── icons/                  Íconos de la app (SVG, 192, 512, enmascarables, iOS)
└── media/                  Imagen principal, video del recorrido y capturas de la app
```

## Diseño SIGEP UTP

Las pantallas del portal (`portal.html`, `alumno.html` y `asesor.html`) usan el diseño
común del equipo, del repositorio SIGEUTP: menú lateral azul marino, barra superior y
acento ámbar del **Módulo 4** (`<body data-modulo="4">`). `css/sigep.css` y `js/sigep.js`
se copian **sin modificar**; todo lo propio del módulo está en `css/portal.css` y solo usa
las variables de `sigep.css`. Las opciones que aún no existen (Mis documentos, Mi empresa,
Avisos, Citas de asesoría) aparecen en el menú como **Próximamente**.

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

## Tesina con versiones

- **El alumno** (`alumno.html#tesina`) sube su tesina en **PDF o Word (.pdf, .doc, .docx),
  de hasta 10 MB**, con un comentario opcional. Cada subida es una **versión nueva**
  (v1, v2, v3…) y las anteriores se conservan: puede descargar cualquiera y ver las
  observaciones de su asesor en cada una.
- **El asesor** (`asesor.html`) ve a sus alumnos asignados, las versiones pendientes de
  revisión y todas las versiones de cada alumno. Descarga los archivos, escribe
  observaciones y puede marcar la versión como **Aprobada** o **Requiere corrección**.

Lo que garantiza la base de datos (`supabase/tesina.sql`):

- El número de versión, el tipo y el tamaño los fija la base de datos, no el navegador.
- Las versiones no se pueden modificar ni borrar; solo el asesor cambia su estado.
- Los archivos se guardan en el bucket privado `tesinas` (solo PDF y Word, 10 MB) y se
  descargan con enlaces temporales de 2 minutos.
- Cada alumno solo ve lo suyo; cada asesor, solo a sus alumnos asignados.

### Instalar o actualizar la base de datos

En **SQL Editor**, ejecuta en este orden (los dos se pueden volver a ejecutar):

1. `supabase/esquema.sql`
2. `supabase/tesina.sql`

### Dar de alta a un asesor y asignarle alumnos

1. En **Authentication → Users → Add user**, crea la cuenta del asesor con su correo y
   una contraseña, y marca **Auto Confirm User**.
2. En **SQL Editor**, conviértela en asesor y asígnale alumnos por matrícula:

   ```sql
   select hacer_asesor('asesor@utpuebla.edu.mx', 'Mtra. Nombre Apellido');
   select asignar_asesor('2311081277', 'asesor@utpuebla.edu.mx');
   ```

El asesor entra por `portal.html` con su correo y contraseña, y el portal lo lleva a su
panel. Estas dos funciones solo se pueden ejecutar desde el SQL Editor.

## Datos de prueba

Para que el portal tenga contenido de demostración: **10 cuentas** (8 alumnos y 2 asesores),
**12 versiones** de tesina en PDF y **10 observaciones**, en todos los estados.
Las tesinas son PDF reales de 3 o 4 páginas (portada, índice, capítulos, tablas y
referencias) guardados en `supabase/datos-prueba/`, con datos ficticios.

1. En **SQL Editor**, ejecuta `supabase/datos-prueba.sql` (crea las cuentas y las asigna).
2. En una terminal, desde la carpeta del proyecto: `node supabase/sembrar-datos-prueba.mjs`
   (sube las versiones y las observaciones; no necesita instalar nada).
3. En **SQL Editor**, ejecuta `supabase/fechas-datos-prueba.sql`: reparte las entregas y
   observaciones entre el 14 de septiembre y el 19 de octubre de 2026, las mismas fechas
   que trae la portada de cada PDF.

| Cuenta | Rol | Situación |
| --- | --- | --- |
| `prueba.asesor1@sigep-pruebas.mx` | Asesora (Dra. Mariana Torres) | Alumnos 01 a 04 |
| `prueba.asesor2@sigep-pruebas.mx` | Asesor (Mtro. Ricardo Vega) | Alumnos 05 a 07 |
| `prueba.alumno01@…` a `prueba.alumno07@…` | Alumnos | Versiones aprobadas, en revisión y con correcciones (el 04, sin entregas) |
| `prueba.alumno08@sigep-pruebas.mx` | Alumno | Sin asesor y sin entregas |

Todas usan la contraseña **Prueba2026**. Se pueden volver a ejecutar sin duplicar nada.
Para quitarlas, ejecuta `supabase/borrar-datos-prueba.sql` y borra en **Storage → tesinas**
las carpetas que lista.

## Contraseñas

- **Cambiar la contraseña:** en **Mi perfil** (alumno o asesor), con la contraseña actual.
- **¿Olvidaste tu contraseña?:** en `portal.html` se pide un enlace por correo; al abrirlo,
  el portal pide la contraseña nueva y entra directo al panel. Requisitos en Supabase:
  - En **Authentication → URL Configuration → Redirect URLs**, agrega
    `https://alexia-sv.github.io/plataforma-estadias/portal.html`.
  - El servicio de correo incluido en Supabase **solo envía a los integrantes del equipo del
    proyecto** y unos pocos correos por hora. Para que les llegue a los alumnos, configura un
    servicio propio en **Authentication → Emails → SMTP Settings** (por ejemplo, Resend o Brevo).
- **Restablecer desde el SQL Editor** (cuando no llega el correo):

  ```sql
  select restablecer_contrasena('correo@utpuebla.edu.mx', 'NuevaClave2026');
  ```

## Caché (Cache API)

El sitio usa tres cachés de Cache Storage:

| Caché | Quién la llena | Contenido | Estrategia |
| --- | --- | --- | --- |
| `estadias-v4` | `sw.js` | Páginas, CSS, JS, íconos, imágenes y video | Precarga + primero la red (el video, primero la caché) |
| `estadias-fuentes` | `sw.js` | Tipografías de Google Fonts | Primero la caché |
| `estadias-api` | `js/cache-api.js` | Respuestas de la API: perfil, rol, versiones de la tesina, asesor y alumnos del asesor | Stale-while-revalidate |

- Al abrir el portal, los datos del alumno se muestran al instante desde `estadias-api`
  y en paralelo se piden a Supabase; al llegar, se actualizan la pantalla y la caché.
- Sin conexión, el portal muestra la copia guardada e indica la fecha en que se guardó.
- Al cerrar sesión (o si la sesión ya no es válida) se borra `estadias-api`.
- Solo se guardan consultas: nunca contraseñas, tokens ni el registro o inicio de sesión.
- En **Mi perfil**, el panel **Datos guardados en este dispositivo** muestra las cachés,
  cuántos archivos tiene cada una y el espacio usado, con botones para actualizar o borrar.
- Los archivos de la tesina **no** se guardan en la caché: siempre se descargan del
  servidor con un enlace temporal. Subir una versión requiere conexión.

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
- **Cambiar las tipografías de Google Fonts**: hay dos URL y deben coincidir con la lista
  `FONT_CSS` de `sw.js`. La de la página informativa está en `index.html` y `offline.html`;
  la del diseño SIGEP (Inter y JetBrains Mono), en `portal.html`, `alumno.html` y `asesor.html`.

## Publicación

Cualquier hosting con HTTPS sirve (GitHub Pages, Netlify, Vercel). Todas las rutas son
relativas, así que el sitio funciona también dentro de una subcarpeta.
