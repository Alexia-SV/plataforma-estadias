/* ==========================================================================
   panel.js — Estructura común de los paneles (alumno.html y asesor.html)
   --------------------------------------------------------------------------
   App.panel
     exigirSesion(rol)     comprueba la sesión y el rol; si no coincide, redirige
     iniciar({ alCambiar }) activa el menú y las vistas (#inicio, #tesina, …)
     usuario(nombre)       pone las iniciales en la barra superior
   App.ui (dibujo seguro: todo texto del usuario se escapa)
     esc, fecha, fechaHora, iniciales, chipEstado, version, panelCache
   Depende de sigep.js (íconos), toast.js, cache-api.js y auth.js.
   ========================================================================== */
window.App = window.App || {};

/* ==========================================================================
   App.ui — utilidades para dibujar
   ========================================================================== */
App.ui = (() => {
  'use strict';

  const esc = (texto) => String(texto ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const fecha = (iso) => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  const fechaHora = (iso) => new Date(iso).toLocaleString('es-MX', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const iniciales = (nombre) => String(nombre || '?')
    .split(/\s+/).filter((p) => p && !/^(dr|dra|mtro|mtra|ing|lic)\.?$/i.test(p))
    .slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';

  // Colores fijos de estado del diseño SIGEP
  const CLASE_ESTADO = { 'En revisión': 'warn', 'Aprobada': 'ok', 'Requiere corrección': 'bad' };
  const chipEstado = (estado) => `<span class="chip ${CLASE_ESTADO[estado] || ''}">${esc(estado)}</span>`;

  // Pone HTML y dibuja los íconos de sigep.js que contenga
  function pintar(nodo, html) {
    nodo.innerHTML = html;
    if (typeof window.pintarIconos === 'function') window.pintarIconos(nodo);
  }

  /** Tarjeta de una versión de la tesina (para alumno y asesor). */
  function version(v, { actual = false, formulario = false } = {}) {
    const obs = v.observaciones || [];
    const lista = obs.length
      ? obs.map((o) => `
          <div class="obs">
            <span class="avatar solid" aria-hidden="true">${esc(iniciales(o.asesor?.nombre || 'Asesor'))}</span>
            <div class="grow">
              <div class="meta"><b>${esc(o.asesor?.nombre || 'Asesor')}</b><span>${esc(fechaHora(o.creado_en))}</span>
                ${o.estado_asignado ? chipEstado(o.estado_asignado) : ''}</div>
              <div class="burbuja">${esc(o.texto)}</div>
            </div>
          </div>`).join('')
      : '<p class="obs-vacia">Aún no hay observaciones del asesor para esta versión.</p>';

    const form = formulario ? `
      <form class="obs-form" data-observar="${esc(v.id)}" novalidate>
        <label class="field">Nueva observación para la versión ${v.numero}
          <textarea name="texto" maxlength="2000" required placeholder="Escribe tus comentarios para el alumno"></textarea>
        </label>
        <p class="field-error" role="alert"></p>
        <div class="fila">
          <select name="estado" aria-label="Estado de la versión">
            <option value="">Mantener estado: ${esc(v.estado)}</option>
            <option value="Aprobada">Marcar como Aprobada</option>
            <option value="Requiere corrección">Marcar como Requiere corrección</option>
          </select>
          <button class="btn ${actual ? '' : 'soft '}sm" type="submit"><i data-ic="message" data-s="16"></i>Guardar observación</button>
        </div>
      </form>` : '';

    return `
      <li class="ver${actual ? ' actual' : ''}" id="version-${esc(v.id)}">
        <div class="ver-h">
          <span class="ver-num" aria-hidden="true">v${v.numero}</span>
          <div class="grow">
            <b>Versión ${v.numero}${actual ? ' · la más reciente' : ''}</b>
            <small>${esc(v.nombre_archivo)} · ${esc(App.tesina.tipoCorto(v.tipo))} · ${esc(App.tesina.tamano(v.tamano_bytes))} · subida el ${esc(fechaHora(v.subida_en))}</small>
          </div>
          <div class="ver-acciones">
            ${chipEstado(v.estado)}
            <button class="btn out sm" type="button" data-descargar="${esc(v.id)}"><i data-ic="download" data-s="16"></i>Descargar</button>
          </div>
        </div>
        ${v.comentario ? `<p class="ver-comentario"><small>Comentario del alumno</small>${esc(v.comentario)}</p>` : ''}
        <div class="obs-lista">
          <span class="obs-titulo">Observaciones del asesor (${obs.length})</span>
          ${lista}
        </div>
        ${form}
      </li>`;
  }

  /** Panel «Datos guardados en este dispositivo» (Cache Storage). */
  async function panelCache(nodo) {
    const formato = (b) => (b == null ? '—'
      : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB`
        : b < 1024 ** 3 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(1)} GB`);
    const { lista, usado, cuota } = await App.cacheApi.resumen();
    const filas = lista.length
      ? lista.map((c) => `
          <div class="r"><span class="ic-box" style="margin:0"><i data-ic="database"></i></span>
            <div class="grow"><b class="mono">${esc(c.nombre)}</b><small>${esc(c.descripcion)}</small></div>
            <span class="chip">${c.entradas} ${c.entradas === 1 ? 'archivo' : 'archivos'}</span></div>`).join('')
      : '<p class="empty">No hay datos guardados.</p>';
    pintar(nodo, `
      <div class="rows">${filas}</div>
      <p class="small muted" style="margin-top:10px">${usado == null ? '' : `Espacio usado: ${formato(usado)} de ${formato(cuota)} disponibles.`}</p>`);
  }

  return { esc, fecha, fechaHora, iniciales, chipEstado, pintar, version, panelCache };
})();

/* ==========================================================================
   App.panel — menú, vistas, sesión y rol
   ========================================================================== */
App.panel = (() => {
  'use strict';

  const { auth, toast, cacheApi } = App;
  const shell = document.querySelector('.shell');
  const nav = document.querySelector('.side-nav');
  const crumb = document.getElementById('crumb-actual');
  const vistas = [...document.querySelectorAll('[data-vista]')];
  const tituloBase = document.title;
  let alCambiar = () => {};

  const DESTINO = { alumno: 'alumno.html', asesor: 'asesor.html' };

  /* ---------- Sesión y rol ---------- */
  async function exigirSesion(rolEsperado) {
    if (!auth.configurado) { location.replace('portal.html'); return false; }

    let rol = null;
    try {
      rol = await auth.rol();
    } catch {
      // Sin conexión: se usa el último rol guardado en la caché
      rol = (await cacheApi.leer('rol').catch(() => null))?.datos?.rol || null;
    }
    if (!rol && !navigator.onLine) rol = (await cacheApi.leer('rol').catch(() => null))?.datos?.rol || null;

    if (rol === rolEsperado) return true;
    location.replace(DESTINO[rol] || 'portal.html');
    return false;
  }

  /* ---------- Vistas (según el #hash) ---------- */
  function leerHash() {
    const [nombre, ...resto] = location.hash.slice(1).split('/');
    return { nombre, param: decodeURIComponent(resto.join('/')) };
  }

  function mostrar() {
    let { nombre, param } = leerHash();
    let vista = vistas.find((v) => v.dataset.vista === nombre);
    if (!vista) { vista = vistas[0]; nombre = vista.dataset.vista; param = ''; }

    vistas.forEach((v) => { v.hidden = v !== vista; });
    const menu = vista.dataset.menu || nombre;
    nav.querySelectorAll('a[href^="#"]').forEach((a) => {
      if (a.getAttribute('href') === `#${menu}`) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    const titulo = vista.dataset.titulo || '';
    if (crumb) crumb.textContent = titulo;
    document.title = `${titulo} · ${tituloBase}`;
    shell?.classList.remove('menu-abierto');
    window.scrollTo(0, 0);
    alCambiar(nombre, param);
  }

  function iniciar({ alCambiarVista } = {}) {
    if (alCambiarVista) alCambiar = alCambiarVista;
    window.addEventListener('hashchange', mostrar);
    mostrar();
  }

  /* ---------- Opciones «Próximamente» ---------- */
  nav?.querySelectorAll('a.pronto').forEach((a) => {
    a.setAttribute('aria-disabled', 'true');
    a.addEventListener('click', (e) => {
      e.preventDefault();
      toast.show(`«${a.dataset.nombre}» estará disponible próximamente.`);
    });
  });

  /* ---------- Cerrar sesión ---------- */
  document.querySelector('.side-out')?.addEventListener('click', async () => {
    await auth.cerrarSesion();
    location.replace('portal.html');
  });

  /* ---------- Estado de la conexión ---------- */
  const chipRed = document.getElementById('estado-red');
  function pintarRed() { chipRed?.classList.toggle('sin-red', !navigator.onLine); }
  window.addEventListener('online', pintarRed);
  window.addEventListener('offline', pintarRed);
  pintarRed();

  /* ---------- Cambiar contraseña (Mi perfil) ---------- */
  const PASS_VALIDA = (v) => v.length >= 8 && /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(v) && /\d/.test(v);

  function campoPass(nombre, etiqueta, autocompletar, ayuda = '') {
    return `
      <label class="field">${etiqueta}
        <span class="pass">
          <input name="${nombre}" type="password" autocomplete="${autocompletar}" required>
          <button type="button" class="ver-pass" aria-pressed="false" aria-label="Mostrar contraseña"><i data-ic="eye"></i></button>
        </span>
        ${ayuda ? `<small>${ayuda}</small>` : ''}
        <span class="field-error" data-error="${nombre}"></span>
      </label>`;
  }

  function montarCambioContrasena(contenedor) {
    App.ui.pintar(contenedor, `
      <form class="form" novalidate>
        ${campoPass('actual', 'Contraseña actual', 'current-password')}
        <div class="form-fila">
          ${campoPass('nueva', 'Contraseña nueva', 'new-password', 'Mínimo 8 caracteres, con letras y números.')}
          ${campoPass('confirmar', 'Confirma la contraseña nueva', 'new-password')}
        </div>
        <p class="help bad form-error" role="alert"></p>
        <div><button class="btn sm" type="submit"><i data-ic="key" data-s="16"></i>Cambiar contraseña</button></div>
      </form>`);

    const form = contenedor.querySelector('form');
    const error = (campo, mensaje) => {
      form.querySelector(`[data-error="${campo}"]`).textContent = mensaje;
      form.elements[campo].setAttribute('aria-invalid', String(Boolean(mensaje)));
      return mensaje ? form.elements[campo] : null;
    };

    form.querySelectorAll('.ver-pass').forEach((boton) => boton.addEventListener('click', (e) => {
      e.preventDefault();
      const input = boton.previousElementSibling;
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      boton.setAttribute('aria-pressed', String(visible));
      boton.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
    }));
    form.querySelectorAll('input').forEach((i) => i.addEventListener('input', () => error(i.name, '')));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { actual, nueva, confirmar } = form.elements;
      form.querySelector('.form-error').textContent = '';
      const primero = [
        error('actual', actual.value ? '' : 'Escribe tu contraseña actual.'),
        error('nueva', !PASS_VALIDA(nueva.value) ? 'Usa al menos 8 caracteres, con letras y números.'
          : nueva.value === actual.value ? 'La contraseña nueva debe ser distinta a la actual.' : ''),
        error('confirmar', nueva.value === confirmar.value ? '' : 'Las contraseñas no coinciden.'),
      ].find(Boolean);
      if (primero) { primero.focus(); return; }

      const boton = form.querySelector('button[type="submit"]');
      const original = boton.innerHTML;
      boton.disabled = true;
      boton.innerHTML = '<span class="cargando" aria-hidden="true"></span>Guardando…';
      try {
        await auth.cambiarContrasena(actual.value, nueva.value);
        form.reset();
        toast.show('Tu contraseña se cambió correctamente.');
      } catch (err) {
        if (err.message.startsWith('La contraseña actual')) { error('actual', err.message); actual.focus(); }
        else form.querySelector('.form-error').textContent = err.message;
      } finally {
        boton.disabled = false;
        boton.innerHTML = original;
      }
    });
  }

  document.querySelectorAll('[data-cambiar-contrasena]').forEach(montarCambioContrasena);

  /* ---------- Usuario en la barra superior ---------- */
  function usuario(nombre) {
    const avatar = document.getElementById('avatar');
    if (!avatar) return;
    avatar.textContent = App.ui.iniciales(nombre);
    avatar.title = nombre;
  }

  return { exigirSesion, iniciar, usuario, vistaActual: () => leerHash() };
})();
