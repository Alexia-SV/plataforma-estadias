/* ==========================================================================
   auth.js — Cuentas con Supabase (alumnos y asesores)
   --------------------------------------------------------------------------
   Expone App.auth con:
     configurado               ¿hay datos de conexión en config.js?
     cliente                   cliente de Supabase (lo usa tesina.js)
     registrar(datos)          crea la cuenta del alumno y su renglón en alumnos
     iniciarSesion(c, p)       entra con correo y contraseña; devuelve el rol
     rol()                     'alumno' | 'asesor' | 'sin-rol' | null (sin sesión)
     usuarioId()               id de la cuenta con sesión (o null)
     obtenerPerfil()           datos del alumno desde la API (y los guarda en caché)
     obtenerPerfilAsesor()     datos del asesor desde la API (y los guarda en caché)
     perfilGuardado(clave)     datos guardados en la caché "estadias-api"
     cerrarSesion()            cierra la sesión y borra la caché de la API
     error(e)                  convierte un error de Supabase en un mensaje en español
   Depende de js/vendor/supabase.js, js/config.js y js/cache-api.js.
   ========================================================================== */
window.App = window.App || {};

App.auth = (() => {
  'use strict';

  const { cacheApi } = App;
  const { supabaseUrl = '', supabaseKey = '' } = App.config || {};

  const configurado = Boolean(
    window.supabase &&
    /^https?:\/\//.test(supabaseUrl) &&
    !supabaseUrl.includes('TU-PROYECTO') &&
    supabaseKey && !supabaseKey.includes('TU-CLAVE')
  );

  const cliente = configurado
    ? window.supabase.createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'estadias-sesion' },
    })
    : null;

  /* ---------- Mensajes de error en español ---------- */
  // Mensajes que la base de datos ya envía en español (supabase/tesina.sql)
  const MENSAJE_PROPIO = /^(Solo |No se |No existe|No hay|La versión|El archivo|Estado no)/;

  function traducir(error) {
    const codigo = String(error?.code || error?.error || '');
    const estado = Number(error?.statusCode || error?.status || 0);
    const mensaje = String(error?.message || '');
    const m = mensaje.toLowerCase();

    if (MENSAJE_PROPIO.test(mensaje)) return mensaje;
    if (codigo === 'invalid_credentials' || m.includes('invalid login credentials')) {
      return 'El correo o la contraseña no son correctos.';
    }
    if (codigo === 'email_not_confirmed' || m.includes('email not confirmed')) {
      return 'Primero confirma tu correo: revisa tu bandeja de entrada.';
    }
    if (codigo === 'user_already_exists' || m.includes('already registered')) {
      return 'Ya existe una cuenta con ese correo.';
    }
    if (codigo === 'weak_password' || m.includes('password should')) {
      return 'La contraseña es muy débil. Usa al menos 8 caracteres con letras y números.';
    }
    if (codigo.includes('rate_limit') || m.includes('rate limit')) {
      return 'Demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.';
    }
    if (m.includes('database error saving new user')) {
      return 'No se pudo guardar tu registro. Revisa que la matrícula no esté registrada.';
    }
    if (estado === 413 || m.includes('maximum allowed size') || m.includes('too large')) {
      return 'El archivo pesa más de 10 MB.';
    }
    if (m.includes('mime type') || codigo === 'invalid_mime_type') {
      return 'Solo se aceptan archivos PDF o Word (.pdf, .doc, .docx).';
    }
    if (codigo === '42501' || m.includes('row-level security') || m.includes('permission denied') || estado === 403) {
      return 'No tienes permiso para hacer esto.';
    }
    if (codigo === 'PGRST301' || m.includes('jwt expired')) {
      return 'Tu sesión terminó. Vuelve a iniciar sesión.';
    }
    if (m.includes('failed to fetch') || m.includes('network') || m.includes('load failed')) {
      return 'No hay conexión con el servidor. Revisa tu internet.';
    }
    return 'Ocurrió un error inesperado. Inténtalo de nuevo.';
  }

  function error(e) {
    const nuevo = new Error(traducir(e));
    nuevo.cause = e;
    return nuevo;
  }

  function exigirConexion() {
    if (!configurado) throw new Error('El portal aún no está conectado a la base de datos.');
    if (!navigator.onLine) throw new Error('Necesitas conexión a internet para continuar.');
  }

  /* ---------- Sesión y rol ---------- */
  async function usuarioId() {
    if (!cliente) return null;
    const { data } = await cliente.auth.getSession();
    return data.session?.user.id ?? null;
  }

  async function rol() {
    const id = await usuarioId();
    if (!id) return null;

    const [asesor, alumno] = await Promise.all([
      cliente.from('asesores').select('id').eq('id', id).maybeSingle(),
      cliente.from('alumnos').select('id').eq('id', id).maybeSingle(),
    ]);
    if (asesor.error && alumno.error) throw error(asesor.error);

    const resultado = asesor.data ? 'asesor' : alumno.data ? 'alumno' : 'sin-rol';
    try { await cacheApi.guardar('rol', { rol: resultado }); } catch { /* caché no disponible */ }
    return resultado;
  }

  /* ---------- Copias en la Cache API ---------- */
  async function perfilGuardado(clave = 'perfil') {
    try {
      const guardado = await cacheApi.leer(clave);
      return guardado && { ...guardado.datos, guardadoEn: guardado.guardadoEn };
    } catch {
      return null;
    }
  }

  async function guardar(clave, datos) {
    try { await cacheApi.guardar(clave, datos); } catch { /* caché no disponible */ }
  }

  // Versiones anteriores guardaban el perfil en localStorage: se limpia
  try { localStorage.removeItem('estadias:perfil'); } catch { /* sin almacenamiento */ }

  /* ---------- Operaciones ---------- */
  async function matriculaDisponible(matricula) {
    const { data, error: e } = await cliente.rpc('matricula_disponible', { p_matricula: matricula });
    if (e) throw error(e);
    return data === true;
  }

  async function registrar({ nombre, matricula, correo, nivel, password }) {
    exigirConexion();

    if (!(await matriculaDisponible(matricula))) {
      throw new Error('Esa matrícula ya está registrada.');
    }

    // Los datos académicos viajan como metadatos; el disparador de la base
    // de datos los copia a la tabla alumnos (ver supabase/esquema.sql).
    const { data, error: e } = await cliente.auth.signUp({
      email: correo,
      password,
      options: { data: { nombre, matricula, nivel } },
    });
    if (e) throw error(e);

    // Si el correo ya existía y la confirmación está activa, Supabase no
    // marca error pero devuelve un usuario sin identidades.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error('Ya existe una cuenta con ese correo.');
    }

    return { requiereConfirmacion: !data.session };
  }

  async function iniciarSesion(correo, password) {
    exigirConexion();
    const { error: e } = await cliente.auth.signInWithPassword({ email: correo, password });
    if (e) throw error(e);
    return rol();
  }

  // Consulta la API (red) y guarda la respuesta en la caché "estadias-api".
  async function obtenerPerfil() {
    const id = await usuarioId();
    if (!id) return null;

    const { data, error: e } = await cliente
      .from('alumnos')
      .select('matricula, nombre, correo, nivel, creado_en')
      .eq('id', id)
      .maybeSingle();

    if (e) throw error(e);
    if (data) await guardar('perfil', data);
    return data && { ...data, guardadoEn: new Date().toISOString() };
  }

  async function obtenerPerfilAsesor() {
    const id = await usuarioId();
    if (!id) return null;

    const { data, error: e } = await cliente
      .from('asesores')
      .select('nombre, correo, creado_en')
      .eq('id', id)
      .maybeSingle();

    if (e) throw error(e);
    if (data) await guardar('perfil-asesor', data);
    return data && { ...data, guardadoEn: new Date().toISOString() };
  }

  async function cerrarSesion() {
    // Los datos del usuario no deben quedar en el dispositivo
    try { await cacheApi.borrar(); } catch { /* caché no disponible */ }
    if (!cliente) return;
    try {
      await cliente.auth.signOut({ scope: 'local' });
    } catch {
      // Sin conexión: la sesión local se borra de todos modos
    }
  }

  return {
    configurado, cliente, registrar, iniciarSesion, rol, usuarioId,
    obtenerPerfil, obtenerPerfilAsesor, perfilGuardado, cerrarSesion, error,
  };
})();
