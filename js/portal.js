/* ==========================================================================
   portal.js — Interfaz del Portal del alumno
   --------------------------------------------------------------------------
   1. Pestañas «Iniciar sesión» / «Registrarse» (también con #login y #registro).
   2. Validación de los formularios con mensajes en español.
   3. Registro e inicio de sesión (usa App.auth).
   4. Pantalla de bienvenida y cierre de sesión.
   Depende de toast.js y auth.js.
   ========================================================================== */
(() => {
  'use strict';

  const { auth, toast } = window.App;

  const tabs = {
    login: document.getElementById('tab-login'),
    registro: document.getElementById('tab-registro'),
  };
  const paneles = {
    login: document.getElementById('panel-login'),
    registro: document.getElementById('panel-registro'),
    bienvenida: document.getElementById('panel-bienvenida'),
  };
  const tablist = document.getElementById('tabs');

  /* ==========================================================================
     1. Vistas y pestañas
     ========================================================================== */
  function mostrar(vista, { enfocar = false } = {}) {
    const conSesion = vista === 'bienvenida';
    tablist.hidden = conSesion;

    Object.entries(paneles).forEach(([nombre, panel]) => { panel.hidden = nombre !== vista; });
    Object.entries(tabs).forEach(([nombre, tab]) => {
      const activa = nombre === vista;
      tab.setAttribute('aria-selected', String(activa));
      tab.tabIndex = activa ? 0 : -1;
    });

    if (!conSesion && location.hash !== `#${vista}`) history.replaceState(null, '', `#${vista}`);
    if (conSesion && location.hash) history.replaceState(null, '', location.pathname);
    if (enfocar) paneles[vista].querySelector('input')?.focus();
  }

  Object.entries(tabs).forEach(([nombre, tab]) => {
    tab.addEventListener('click', () => mostrar(nombre, { enfocar: true }));
  });

  // Flechas izquierda/derecha para cambiar de pestaña con el teclado
  tablist.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const siguiente = tabs.login.getAttribute('aria-selected') === 'true' ? 'registro' : 'login';
    mostrar(siguiente);
    tabs[siguiente].focus();
  });

  // Enlaces «Regístrate aquí» / «Inicia sesión»
  document.querySelectorAll('[data-ir]').forEach((enlace) => {
    enlace.addEventListener('click', (e) => {
      e.preventDefault();
      mostrar(enlace.dataset.ir, { enfocar: true });
    });
  });

  // Botones para mostrar u ocultar la contraseña
  document.querySelectorAll('.ver-pass').forEach((boton) => {
    boton.addEventListener('click', () => {
      const input = document.getElementById(boton.getAttribute('aria-controls'));
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      boton.setAttribute('aria-pressed', String(visible));
      boton.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });
  });

  /* ==========================================================================
     2. Validación
     ========================================================================== */
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
    const nodo = input instanceof RadioNodeList ? input[0] : input;
    const error = form.querySelector(`#${form.id === 'panel-login' ? 'login' : 'reg'}-${campo}-error`);
    if (error) error.textContent = mensaje;
    if (input instanceof RadioNodeList) {
      input.forEach((r) => r.setAttribute('aria-invalid', String(Boolean(mensaje))));
    } else if (nodo) {
      nodo.setAttribute('aria-invalid', String(Boolean(mensaje)));
      if (error) nodo.setAttribute('aria-describedby', [nodo.getAttribute('aria-describedby'), error.id]
        .filter((v, i, a) => v && a.indexOf(v) === i).join(' '));
    }
    return mensaje ? nodo : null;
  }

  function validar(form, reglas) {
    let primero = null;
    reglas.forEach(([campo, revisar]) => {
      const valor = (form.elements[campo].value || '').trim();
      const invalido = marcar(form, campo, revisar(valor));
      primero = primero || invalido;
    });
    primero?.focus();
    return !primero;
  }

  // Al corregir un campo se quita su mensaje de error
  document.querySelectorAll('.vista input').forEach((input) => {
    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') !== 'true') return;
      marcar(input.form, input.name, '');
    });
  });

  // La matrícula solo acepta dígitos
  const matricula = document.getElementById('reg-matricula');
  matricula.addEventListener('input', () => { matricula.value = matricula.value.replace(/\D/g, '').slice(0, 10); });

  /* ---------- Estado de envío ---------- */
  function enviando(form, activo, texto) {
    const boton = form.querySelector('button[type="submit"]');
    boton.dataset.texto = boton.dataset.texto || boton.textContent;
    boton.disabled = activo;
    boton.classList.toggle('is-loading', activo);
    boton.textContent = activo ? texto : boton.dataset.texto;
  }

  function errorGeneral(form, mensaje) {
    form.querySelector('.form-error').textContent = mensaje;
  }

  /* ==========================================================================
     3. Registro e inicio de sesión
     ========================================================================== */
  paneles.registro.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    errorGeneral(form, '');

    const valido = validar(form, [
      ['nombre', REGLAS.nombre],
      ['matricula', REGLAS.matricula],
      ['nivel', REGLAS.nivel],
      ['correo', REGLAS.correo],
      ['password', REGLAS.password],
    ]);
    const coincide = form.elements.password.value === form.elements.confirmar.value;
    const errConfirmar = marcar(form, 'confirmar', coincide ? '' : 'Las contraseñas no coinciden.');
    if (!valido) return;
    if (errConfirmar) { errConfirmar.focus(); return; }

    enviando(form, true, 'Creando cuenta…');
    try {
      const { requiereConfirmacion } = await auth.registrar({
        nombre: form.elements.nombre.value.trim().replace(/\s+/g, ' '),
        matricula: form.elements.matricula.value.trim(),
        nivel: form.elements.nivel.value,
        correo: form.elements.correo.value.trim().toLowerCase(),
        password: form.elements.password.value,
      });

      if (requiereConfirmacion) {
        const correo = form.elements.correo.value.trim();
        form.reset();
        mostrar('login');
        paneles.login.elements.correo.value = correo;
        toast.show('¡Cuenta creada! Revisa tu correo para confirmarla y después inicia sesión.', { duration: 9000 });
      } else {
        form.reset();
        await entrar('¡Cuenta creada! Bienvenido al portal.');
      }
    } catch (error) {
      errorGeneral(form, error.message);
    } finally {
      enviando(form, false);
    }
  });

  paneles.login.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    errorGeneral(form, '');

    const valido = validar(form, [
      ['correo', REGLAS.correo],
      ['password', REGLAS.passwordLogin],
    ]);
    if (!valido) return;

    enviando(form, true, 'Entrando…');
    try {
      await auth.iniciarSesion(form.elements.correo.value.trim().toLowerCase(), form.elements.password.value);
      form.reset();
      await entrar();
    } catch (error) {
      errorGeneral(form, error.message);
    } finally {
      enviando(form, false);
    }
  });

  /* ==========================================================================
     4. Bienvenida
     ========================================================================== */
  function iniciales(nombre) {
    return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  }

  function pintarBienvenida(perfil) {
    const primerNombre = perfil.nombre.split(/\s+/)[0];
    document.getElementById('bv-avatar').textContent = iniciales(perfil.nombre);
    document.getElementById('bv-nombre').textContent = primerNombre;
    document.getElementById('bv-matricula').textContent = perfil.matricula;
    document.getElementById('bv-nivel').textContent = perfil.nivel;
    document.getElementById('bv-correo').textContent = perfil.correo;
    document.getElementById('bv-fecha').textContent = new Date(perfil.creado_en)
      .toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('bv-offline').hidden = !perfil.sinConexion;
  }

  async function entrar(mensaje) {
    const perfil = await auth.obtenerPerfil();
    if (!perfil) throw new Error('No se encontraron tus datos de alumno.');
    pintarBienvenida(perfil);
    mostrar('bienvenida');
    paneles.bienvenida.querySelector('h2').focus({ preventScroll: true });
    if (mensaje) toast.show(mensaje);
  }

  document.getElementById('btn-salir').addEventListener('click', async () => {
    await auth.cerrarSesion();
    mostrar('login', { enfocar: true });
    toast.show('Cerraste sesión.');
  });

  /* ==========================================================================
     Arranque
     ========================================================================== */
  paneles.bienvenida.querySelector('h2').tabIndex = -1;

  async function iniciar() {
    if (!auth.configurado) {
      document.getElementById('aviso-config').hidden = false;
      document.querySelectorAll('.vista button[type="submit"]').forEach((b) => { b.disabled = true; });
    }

    mostrar(location.hash === '#registro' ? 'registro' : 'login');

    try {
      const perfil = await auth.obtenerPerfil();
      if (perfil) {
        pintarBienvenida(perfil);
        mostrar('bienvenida');
      }
    } catch {
      // Sin sesión válida: se queda en el formulario
    }
  }

  window.addEventListener('hashchange', () => {
    if (!paneles.bienvenida.hidden) return;
    if (location.hash === '#registro' || location.hash === '#login') mostrar(location.hash.slice(1));
  });

  iniciar();
})();
