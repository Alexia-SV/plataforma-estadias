/* ==========================================================================
   portal.js — Acceso al portal (portal.html)
   --------------------------------------------------------------------------
   1. Pestañas «Iniciar sesión» / «Registrarme» (también con #login y #registro).
   2. Validación de los formularios con mensajes en español.
   3. Inicio de sesión: lleva a alumno.html o asesor.html según el rol.
   4. Registro de alumnos.
   5. Recuperación de contraseña: pedir el enlace por correo (#recuperar) y,
      al volver de ese enlace, crear la contraseña nueva (#nueva).
   Depende de toast.js, cache-api.js y auth.js.
   ========================================================================== */
(() => {
  'use strict';

  const { auth, toast } = window.App;
  const DESTINO = { alumno: 'alumno.html', asesor: 'asesor.html' };
  const PREFIJO = { 'panel-login': 'login', 'panel-registro': 'reg', 'panel-recuperar': 'rec', 'panel-nueva': 'nueva' };

  const tabs = { login: document.getElementById('tab-login'), registro: document.getElementById('tab-registro') };
  const paneles = {
    login: document.getElementById('panel-login'),
    registro: document.getElementById('panel-registro'),
    recuperar: document.getElementById('panel-recuperar'),
    nueva: document.getElementById('panel-nueva'),
  };
  const tablist = document.getElementById('tabs');

  /* ---------- 1. Pestañas y vistas ---------- */
  function mostrar(vista, { enfocar = false } = {}) {
    Object.entries(paneles).forEach(([nombre, panel]) => { panel.hidden = nombre !== vista; });
    // Las pestañas solo se ven en «Iniciar sesión» y «Registrarme»
    tablist.hidden = !tabs[vista];
    Object.entries(tabs).forEach(([nombre, tab]) => {
      const activa = nombre === vista;
      tab.setAttribute('aria-selected', String(activa));
      tab.tabIndex = activa ? 0 : -1;
    });
    if (location.hash !== `#${vista}` || location.search) history.replaceState(null, '', `${location.pathname}#${vista}`);
    if (enfocar) paneles[vista].querySelector('input')?.focus();
  }

  Object.entries(tabs).forEach(([nombre, tab]) => tab.addEventListener('click', () => mostrar(nombre, { enfocar: true })));
  tablist.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const siguiente = tabs.login.getAttribute('aria-selected') === 'true' ? 'registro' : 'login';
    mostrar(siguiente);
    tabs[siguiente].focus();
  });
  document.querySelectorAll('[data-ir]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    mostrar(a.dataset.ir, { enfocar: true });
  }));
  window.addEventListener('hashchange', () => {
    if (['#registro', '#login', '#recuperar'].includes(location.hash)) mostrar(location.hash.slice(1));
  });

  // Mostrar u ocultar la contraseña
  document.querySelectorAll('.ver-pass').forEach((boton) => boton.addEventListener('click', (e) => {
    e.preventDefault();
    const input = document.getElementById(boton.getAttribute('aria-controls'));
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    boton.setAttribute('aria-pressed', String(visible));
    boton.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
  }));

  /* ---------- 2. Validación ---------- */
  const REGLAS = {
    nombre: (v) => (/^[\p{L}][\p{L} .'-]{2,119}$/u.test(v) ? '' : 'Escribe tu nombre completo (solo letras).'),
    matricula: (v) => (/^\d{10}$/.test(v) ? '' : 'La matrícula debe tener 10 dígitos.'),
    correo: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : 'Escribe un correo válido, por ejemplo nombre@dominio.edu.mx.'),
    nivel: (v) => (v ? '' : 'Elige tu nivel.'),
    passwordLogin: (v) => (v ? '' : 'Escribe tu contraseña.'),
    password: (v) => (v.length >= 8 && /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(v) && /\d/.test(v)
      ? '' : 'Usa al menos 8 caracteres, con letras y números.'),
  };

  function marcar(form, campo, mensaje) {
    const input = form.elements[campo];
    const error = document.getElementById(`${PREFIJO[form.id]}-${campo}-error`);
    if (error) error.textContent = mensaje;
    const nodos = input instanceof RadioNodeList ? [...input] : [input];
    nodos.forEach((n) => n.setAttribute('aria-invalid', String(Boolean(mensaje))));
    if (error && !(input instanceof RadioNodeList)) {
      const ids = new Set(String(input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
      ids.add(error.id);
      input.setAttribute('aria-describedby', [...ids].join(' '));
    }
    return mensaje ? nodos[0] : null;
  }

  function validar(form, reglas) {
    let primero = null;
    reglas.forEach(([campo, revisar]) => {
      const invalido = marcar(form, campo, revisar((form.elements[campo].value || '').trim()));
      primero = primero || invalido;
    });
    primero?.focus();
    return !primero;
  }

  document.querySelectorAll('.form input').forEach((input) => input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid') === 'true') marcar(input.form, input.name, '');
  }));

  const matricula = document.getElementById('reg-matricula');
  matricula.addEventListener('input', () => { matricula.value = matricula.value.replace(/\D/g, '').slice(0, 10); });

  function enviando(form, activo, texto) {
    const boton = form.querySelector('button[type="submit"]');
    boton.dataset.texto = boton.dataset.texto || boton.textContent;
    boton.disabled = activo;
    boton.innerHTML = activo ? `<span class="cargando" aria-hidden="true"></span>${texto}` : boton.dataset.texto;
  }

  const errorGeneral = (form, mensaje) => { form.querySelector('.form-error').textContent = mensaje; };

  async function irAlPanel(rol) {
    if (DESTINO[rol]) { location.replace(DESTINO[rol]); return; }
    await auth.cerrarSesion();
    throw new Error('Tu cuenta no tiene un perfil de alumno ni de asesor. Contacta a la coordinación de estadías.');
  }

  /* ---------- 3. Inicio de sesión ---------- */
  paneles.login.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    errorGeneral(form, '');
    if (!validar(form, [['correo', REGLAS.correo], ['password', REGLAS.passwordLogin]])) return;

    enviando(form, true, 'Entrando…');
    try {
      const rol = await auth.iniciarSesion(form.elements.correo.value.trim().toLowerCase(), form.elements.password.value);
      await irAlPanel(rol);
    } catch (error) {
      errorGeneral(form, error.message);
      enviando(form, false);
    }
  });

  /* ---------- 4. Registro de alumnos ---------- */
  paneles.registro.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    errorGeneral(form, '');

    const valido = validar(form, [
      ['nombre', REGLAS.nombre], ['matricula', REGLAS.matricula], ['nivel', REGLAS.nivel],
      ['correo', REGLAS.correo], ['password', REGLAS.password],
    ]);
    const coincide = form.elements.password.value === form.elements.confirmar.value;
    const errConfirmar = marcar(form, 'confirmar', coincide ? '' : 'Las contraseñas no coinciden.');
    if (!valido) return;
    if (errConfirmar) { errConfirmar.focus(); return; }

    enviando(form, true, 'Creando cuenta…');
    try {
      const correo = form.elements.correo.value.trim().toLowerCase();
      const { requiereConfirmacion } = await auth.registrar({
        nombre: form.elements.nombre.value.trim().replace(/\s+/g, ' '),
        matricula: form.elements.matricula.value.trim(),
        nivel: form.elements.nivel.value,
        correo,
        password: form.elements.password.value,
      });

      if (requiereConfirmacion) {
        form.reset();
        enviando(form, false);
        mostrar('login');
        paneles.login.elements.correo.value = correo;
        toast.show('¡Cuenta creada! Revisa tu correo para confirmarla y después inicia sesión.', { duration: 9000 });
      } else {
        await irAlPanel(await auth.rol());
      }
    } catch (error) {
      errorGeneral(form, error.message);
      enviando(form, false);
    }
  });

  /* ---------- 5. Recuperación de contraseña ---------- */
  paneles.recuperar.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    errorGeneral(form, '');
    document.getElementById('rec-enviado').hidden = true;
    if (!validar(form, [['correo', REGLAS.correo]])) return;

    enviando(form, true, 'Enviando…');
    try {
      await auth.recuperarContrasena(form.elements.correo.value.trim().toLowerCase());
      document.getElementById('rec-enviado').hidden = false;
      form.querySelector('button[type="submit"]').dataset.texto = 'Volver a enviar el enlace';
    } catch (error) {
      errorGeneral(form, error.message);
    } finally {
      enviando(form, false);
    }
  });

  paneles.nueva.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    errorGeneral(form, '');
    const valido = validar(form, [['password', REGLAS.password]]);
    const errConfirmar = marcar(form, 'confirmar',
      form.elements.password.value === form.elements.confirmar.value ? '' : 'Las contraseñas no coinciden.');
    if (!valido) return;
    if (errConfirmar) { errConfirmar.focus(); return; }

    enviando(form, true, 'Guardando…');
    try {
      const rol = await auth.establecerContrasena(form.elements.password.value);
      toast.show('Contraseña actualizada.');
      await irAlPanel(rol);
    } catch (error) {
      errorGeneral(form, error.message);
      enviando(form, false);
    }
  });

  // ¿Se abrió el portal desde el enlace del correo de recuperación?
  function leerRecuperacion() {
    const consulta = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.slice(1));
    const viene = consulta.has('recuperar') || hash.get('type') === 'recovery';
    if (!viene) return null;
    return { error: hash.get('error_description') || consulta.get('error_description') };
  }

  async function atenderRecuperacion({ error }) {
    // getSession() espera a que Supabase lea los datos del enlace antes de seguir
    const { data } = await auth.cliente.auth.getSession();
    if (error || !data.session) {
      mostrar('recuperar');
      errorGeneral(paneles.recuperar, 'El enlace de recuperación ya venció o ya se usó. Solicita uno nuevo.');
      return;
    }
    mostrar('nueva', { enfocar: true });
  }

  /* ---------- Arranque ---------- */
  async function iniciar() {
    if (!auth.configurado) {
      mostrar(location.hash === '#registro' ? 'registro' : 'login');
      document.getElementById('aviso-config').hidden = false;
      document.querySelectorAll('.form button[type="submit"]').forEach((b) => { b.disabled = true; });
      return;
    }

    // Debe revisarse antes de tocar la dirección: ahí vienen los datos del enlace
    const recuperacion = leerRecuperacion();
    if (recuperacion) { await atenderRecuperacion(recuperacion); return; }
    auth.alRecuperar(() => mostrar('nueva', { enfocar: true }));

    const inicial = location.hash.slice(1);
    mostrar(['registro', 'recuperar'].includes(inicial) ? inicial : 'login');

    // Si ya hay una sesión, se va directo a su panel
    try {
      const rol = await auth.rol();
      if (DESTINO[rol]) location.replace(DESTINO[rol]);
    } catch {
      // Sin conexión o sesión inválida: se queda en el formulario
    }
  }

  iniciar();
})();
