/* ==========================================================================
   auth.js — Cuentas de alumno con Supabase
   --------------------------------------------------------------------------
   Expone App.auth con:
     configurado            ¿hay datos de conexión en config.js?
     registrar(datos)       crea la cuenta y su renglón en la tabla alumnos
     iniciarSesion(c, p)    entra con correo y contraseña
     obtenerPerfil()        datos del alumno con sesión iniciada (o null)
     cerrarSesion()
   Los errores se lanzan con mensajes en español listos para mostrarse.
   Depende de js/vendor/supabase.js y js/config.js.
   ========================================================================== */
window.App = window.App || {};

App.auth = (() => {
  'use strict';

  const PERFIL_GUARDADO = 'estadias:perfil';
  const { supabaseUrl = '', supabaseKey = '' } = App.config || {};

  const configurado = Boolean(
    window.supabase &&
    supabaseUrl.startsWith('https://') &&
    !supabaseUrl.includes('TU-PROYECTO') &&
    supabaseKey && !supabaseKey.includes('TU-CLAVE')
  );

  const cliente = configurado
    ? window.supabase.createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'estadias-sesion' },
    })
    : null;

  /* ---------- Mensajes de error en español ---------- */
  function traducir(error) {
    const codigo = error?.code || '';
    const mensaje = (error?.message || '').toLowerCase();

    if (codigo === 'invalid_credentials' || mensaje.includes('invalid login credentials')) {
      return 'El correo o la contraseña no son correctos.';
    }
    if (codigo === 'email_not_confirmed' || mensaje.includes('email not confirmed')) {
      return 'Primero confirma tu correo: revisa tu bandeja de entrada.';
    }
    if (codigo === 'user_already_exists' || mensaje.includes('already registered')) {
      return 'Ya existe una cuenta con ese correo.';
    }
    if (codigo === 'weak_password' || mensaje.includes('password should')) {
      return 'La contraseña es muy débil. Usa al menos 8 caracteres con letras y números.';
    }
    if (codigo.includes('rate_limit') || mensaje.includes('rate limit')) {
      return 'Demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.';
    }
    if (mensaje.includes('database error saving new user')) {
      return 'No se pudo guardar tu registro. Revisa que la matrícula no esté registrada.';
    }
    if (mensaje.includes('failed to fetch') || mensaje.includes('network')) {
      return 'No hay conexión con el servidor. Revisa tu internet.';
    }
    return 'Ocurrió un error inesperado. Inténtalo de nuevo.';
  }

  function fallar(error) {
    const e = new Error(traducir(error));
    e.cause = error;
    throw e;
  }

  function exigirConexion() {
    if (!configurado) throw new Error('El portal aún no está conectado a la base de datos.');
    if (!navigator.onLine) throw new Error('Necesitas conexión a internet para continuar.');
  }

  /* ---------- Copia local del perfil (para verlo sin conexión) ---------- */
  function guardarPerfil(perfil) {
    try { localStorage.setItem(PERFIL_GUARDADO, JSON.stringify(perfil)); } catch { /* sin almacenamiento */ }
  }

  function leerPerfilGuardado() {
    try { return JSON.parse(localStorage.getItem(PERFIL_GUARDADO)); } catch { return null; }
  }

  function borrarPerfilGuardado() {
    try { localStorage.removeItem(PERFIL_GUARDADO); } catch { /* sin almacenamiento */ }
  }

  /* ---------- Operaciones ---------- */
  async function matriculaDisponible(matricula) {
    const { data, error } = await cliente.rpc('matricula_disponible', { p_matricula: matricula });
    if (error) fallar(error);
    return data === true;
  }

  async function registrar({ nombre, matricula, correo, nivel, password }) {
    exigirConexion();

    if (!(await matriculaDisponible(matricula))) {
      throw new Error('Esa matrícula ya está registrada.');
    }

    // Los datos académicos viajan como metadatos; el disparador de la base
    // de datos los copia a la tabla alumnos (ver supabase/esquema.sql).
    const { data, error } = await cliente.auth.signUp({
      email: correo,
      password,
      options: { data: { nombre, matricula, nivel } },
    });
    if (error) fallar(error);

    // Si el correo ya existía y la confirmación está activa, Supabase no
    // marca error pero devuelve un usuario sin identidades.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error('Ya existe una cuenta con ese correo.');
    }

    return { requiereConfirmacion: !data.session };
  }

  async function iniciarSesion(correo, password) {
    exigirConexion();
    const { error } = await cliente.auth.signInWithPassword({ email: correo, password });
    if (error) fallar(error);
    return obtenerPerfil();
  }

  async function obtenerPerfil() {
    if (!configurado) return null;

    const { data: { session } } = await cliente.auth.getSession();
    if (!session) return null;

    const { data, error } = await cliente
      .from('alumnos')
      .select('matricula, nombre, correo, nivel, creado_en')
      .eq('id', session.user.id)
      .maybeSingle();

    if (error) {
      const guardado = leerPerfilGuardado();
      if (guardado) return { ...guardado, sinConexion: true };
      fallar(error);
    }
    if (data) guardarPerfil(data);
    return data;
  }

  async function cerrarSesion() {
    borrarPerfilGuardado();
    if (!cliente) return;
    try {
      await cliente.auth.signOut({ scope: 'local' });
    } catch {
      // Sin conexión: la sesión local se borra de todos modos
    }
  }

  return { configurado, registrar, iniciarSesion, obtenerPerfil, cerrarSesion };
})();
