/* ==========================================================================
   tesina.js — Tesina con versiones (Supabase Storage + tablas de tesina)
   --------------------------------------------------------------------------
   Expone App.tesina con:
     MAX_BYTES, ACEPTA          límites: 10 MB · .pdf, .doc, .docx
     validar(archivo)           '' si es válido, o el mensaje de error
     subir(archivo, comentario, prerevision)  sube el archivo y lo registra como versión nueva
     pendiente(archivo, comentario, prerevision)  datos para la cola sin conexión (cola.js)
     sesionParaCola()           token para que el service worker envíe la cola
     misVersiones()             historial del alumno con sesión (caché "tesina")
     miAsesor()                 asesor asignado al alumno (caché "asesor")
     misAlumnos()               alumnos del asesor con sus versiones (caché "asesor-alumnos")
     enlaceDescarga(version)    enlace temporal (2 min) para descargar el archivo
     observar(version, { texto, estado, audio })  observación del asesor (texto o voz)
     anotar(version, nota) · borrarNota(nota)  notas ancladas en el documento
     escuchar(fn)               cambios al instante (Supabase Realtime)
     completo                   false si la base de datos aún no tiene las tablas
                                nuevas de supabase/tesina.sql (notas, voz, pre-revisión)
     guardado(clave)            copia guardada en la caché "estadias-api"
     tamano(bytes), tipoCorto(mime)
   El número de versión, el tipo y el tamaño definitivos los fija la base de
   datos (supabase/tesina.sql), así que no se pueden falsear desde aquí.
   Depende de auth.js y cache-api.js.
   ========================================================================== */
window.App = window.App || {};

App.tesina = (() => {
  'use strict';

  const { auth, cacheApi } = App;
  const BUCKET = 'tesinas';
  const MAX_BYTES = 10 * 1024 * 1024;
  const TIPOS = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  const ACEPTA = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  const SELECT_VERSION = `
    id, alumno_id, numero, archivo_path, nombre_archivo, tipo, tamano_bytes,
    comentario, estado, subida_en, prerevision,
    observaciones:tesina_observaciones (id, texto, estado_asignado, creado_en, audio_path, audio_segundos, asesor:asesores (nombre)),
    notas:tesina_notas (id, pagina, x, y, parrafo, extracto, texto, creado_en, asesor_id, asesor:asesores (nombre))
  `;
  // La misma consulta para una base de datos que aún no tiene las tablas nuevas
  const SELECT_BASICO = `
    id, alumno_id, numero, archivo_path, nombre_archivo, tipo, tamano_bytes,
    comentario, estado, subida_en,
    observaciones:tesina_observaciones (id, texto, estado_asignado, creado_en, asesor:asesores (nombre))
  `;
  const FALTA_ESQUEMA = ['PGRST200', 'PGRST204', '42703', '42P01'];
  let completo = true;

  /* ---------- Utilidades ---------- */
  const extension = (nombre) => (String(nombre).split('.').pop() || '').toLowerCase();

  function tamano(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const tipoCorto = (mime) => (mime === TIPOS.pdf ? 'PDF' : 'Word');

  function validar(archivo) {
    if (!archivo) return 'Elige el archivo de tu tesina.';
    if (!TIPOS[extension(archivo.name)]) return 'Solo se aceptan archivos PDF o Word (.pdf, .doc, .docx).';
    if (archivo.size === 0) return 'El archivo está vacío.';
    if (archivo.size > MAX_BYTES) return `El archivo pesa ${tamano(archivo.size)}; el máximo es 10 MB.`;
    return '';
  }

  // Versiones de la más reciente a la más antigua; observaciones en orden cronológico
  function ordenar(versiones) {
    versiones.sort((a, b) => b.numero - a.numero);
    versiones.forEach((v) => {
      (v.observaciones || []).sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en));
      v.notas = v.notas || [];
    });
    return versiones;
  }

  // Consulta las versiones; si la base de datos no se ha actualizado, usa la consulta básica
  async function versiones(filtrar) {
    let { data, error } = await filtrar(cliente().from('tesina_versiones').select(completo ? SELECT_VERSION : SELECT_BASICO));
    if (error && completo && FALTA_ESQUEMA.includes(error.code)) {
      completo = false;
      ({ data, error } = await filtrar(cliente().from('tesina_versiones').select(SELECT_BASICO)));
    }
    if (error) throw auth.error(error);
    return ordenar(data);
  }

  function cliente() {
    if (!auth.configurado) throw new Error('El portal aún no está conectado a la base de datos.');
    return auth.cliente;
  }

  async function exigirUsuario() {
    const id = await auth.usuarioId();
    if (!id) throw new Error('Tu sesión terminó. Vuelve a iniciar sesión.');
    return id;
  }

  async function guardar(clave, datos) {
    try { await cacheApi.guardar(clave, datos); } catch { /* caché no disponible */ }
  }

  async function guardado(clave) {
    try { return await cacheApi.leer(clave); } catch { return null; }
  }

  /* ---------- Alumno ---------- */
  async function misVersiones() {
    const id = await exigirUsuario();
    const data = await versiones((q) => q.eq('alumno_id', id));
    await guardar('tesina', data);
    return data;
  }

  async function miAsesor() {
    const id = await exigirUsuario();
    const { data, error } = await cliente()
      .from('asignaciones_asesor')
      .select('asignado_en, asesor:asesores (nombre, correo)')
      .eq('alumno_id', id)
      .maybeSingle();
    if (error) throw auth.error(error);
    const asesor = data?.asesor ? { ...data.asesor, asignado_en: data.asignado_en } : null;
    await guardar('asesor', asesor);
    return asesor;
  }

  // Nombre interno único: el original se conserva en la base de datos
  const rutaNueva = (id, ext) => `${id}/${crypto.randomUUID()}.${ext}`;

  async function subir(archivo, comentario, prerevision = null) {
    const problema = validar(archivo);
    if (problema) throw new Error(problema);
    if (!navigator.onLine) throw new Error('Necesitas conexión a internet para subir tu tesina.');

    const id = await exigirUsuario();
    const ext = extension(archivo.name);
    const tipo = TIPOS[ext];
    const ruta = rutaNueva(id, ext);

    const subida = await cliente().storage.from(BUCKET).upload(ruta, archivo, { contentType: tipo, upsert: false });
    if (subida.error) throw auth.error(subida.error);

    const { data, error } = await cliente()
      .from('tesina_versiones')
      .insert({
        alumno_id: id,
        numero: 1, // la base de datos asigna el número real
        archivo_path: ruta,
        nombre_archivo: archivo.name.slice(0, 200),
        tipo,
        tamano_bytes: archivo.size,
        comentario: comentario?.trim() || null,
        ...(prerevision && completo ? { prerevision } : {}),
      })
      .select(completo ? SELECT_VERSION : SELECT_BASICO)
      .single();

    if (error) {
      // No se registró: se borra el archivo para no dejarlo huérfano
      await cliente().storage.from(BUCKET).remove([ruta]).catch(() => {});
      throw auth.error(error);
    }
    return ordenar([data])[0];
  }

  /* ---------- Entregas sin conexión (las envía cola.js) ---------- */
  async function pendiente(archivo, comentario, prerevision = null) {
    const problema = validar(archivo);
    if (problema) throw new Error(problema);
    const id = await exigirUsuario();
    const ext = extension(archivo.name);
    return {
      archivo,
      nombre: archivo.name.slice(0, 200),
      tipo: TIPOS[ext],
      tamano: archivo.size,
      comentario: comentario?.trim() || '',
      ruta: rutaNueva(id, ext),
      alumnoId: id,
      prerevision: completo ? prerevision : null,
    };
  }

  // Lo que el service worker necesita para enviar la cola sin la página abierta
  async function sesionParaCola() {
    const { data } = await cliente().auth.getSession();
    const sesion = data.session;
    if (!sesion) return null;
    return {
      token: sesion.access_token,
      expira: sesion.expires_at,
      usuarioId: sesion.user.id,
      url: App.config.supabaseUrl,
      key: App.config.supabaseKey,
    };
  }

  /* ---------- Asesor ---------- */
  async function misAlumnos() {
    const id = await exigirUsuario();
    const { data: asignaciones, error } = await cliente()
      .from('asignaciones_asesor')
      .select('asignado_en, alumno:alumnos (id, matricula, nombre, correo, nivel)')
      .eq('asesor_id', id);
    if (error) throw auth.error(error);

    const alumnos = asignaciones.filter((a) => a.alumno).map((a) => ({ ...a.alumno, asignado_en: a.asignado_en, versiones: [] }));
    if (alumnos.length) {
      const todas = await versiones((q) => q.in('alumno_id', alumnos.map((a) => a.id)));
      alumnos.forEach((a) => { a.versiones = todas.filter((v) => v.alumno_id === a.id); });
    }
    alumnos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    await guardar('asesor-alumnos', alumnos);
    return alumnos;
  }

  async function observar(version, { texto = '', estado = '', audio = null } = {}) {
    if (!navigator.onLine) throw new Error('Necesitas conexión a internet para guardar la observación.');
    const parametros = { p_version: version.id, p_texto: texto, p_estado: estado || null };
    let ruta = null;
    if (audio) {
      if (!completo) throw new Error('Para guardar notas de voz, primero actualiza la base de datos con supabase/tesina.sql.');
      ruta = await App.voz.subir(version.alumno_id, audio);
      Object.assign(parametros, { p_audio_path: ruta, p_audio_segundos: audio.segundos });
    }
    const { data, error } = await cliente().rpc('observar_version', parametros);
    if (error) {
      if (ruta) await App.voz.quitar(ruta);
      throw auth.error(error);
    }
    return data;
  }

  /* ---------- Notas ancladas en el documento (asesor) ---------- */
  async function anotar(version, { pagina = null, x = null, y = null, parrafo = null, extracto = '', texto }) {
    if (!navigator.onLine) throw new Error('Necesitas conexión a internet para guardar la nota.');
    if (!completo) throw new Error('Para guardar notas en el documento, primero actualiza la base de datos con supabase/tesina.sql.');
    const id = await exigirUsuario();
    const { data, error } = await cliente()
      .from('tesina_notas')
      .insert({ version_id: version.id, asesor_id: id, pagina, x, y, parrafo, extracto: extracto || null, texto })
      .select('id, pagina, x, y, parrafo, extracto, texto, creado_en, asesor_id, asesor:asesores (nombre)')
      .single();
    if (error) throw auth.error(error);
    return data;
  }

  async function borrarNota(nota) {
    if (!navigator.onLine) throw new Error('Necesitas conexión a internet para borrar la nota.');
    const { error } = await cliente().from('tesina_notas').delete().eq('id', nota.id);
    if (error) throw auth.error(error);
  }

  /* ---------- Tiempo real (Supabase Realtime) ---------- */
  // Avisa en cuanto cambia una versión, una observación o una nota que el
  // usuario puede ver (Realtime aplica las mismas reglas RLS). Devuelve una
  // función para dejar de escuchar.
  function escuchar(alCambiar) {
    if (!auth.configurado || !completo) return () => {};
    const canal = cliente().channel(`tesina-${crypto.randomUUID()}`);
    ['tesina_versiones', 'tesina_observaciones', 'tesina_notas'].forEach((tabla) => {
      canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla },
        (cambio) => alCambiar({ tabla, evento: cambio.eventType, fila: cambio.new }));
    });
    canal.subscribe();
    return () => cliente().removeChannel(canal);
  }

  /* ---------- Ambos ---------- */
  async function enlaceDescarga(version) {
    if (!navigator.onLine) throw new Error('Necesitas conexión a internet para descargar el archivo.');
    const { data, error } = await cliente()
      .storage.from(BUCKET)
      .createSignedUrl(version.archivo_path, 120, { download: version.nombre_archivo });
    if (error) throw auth.error(error);
    return data.signedUrl;
  }

  return {
    MAX_BYTES, ACEPTA, validar, subir, pendiente, sesionParaCola, misVersiones, miAsesor, misAlumnos,
    enlaceDescarga, observar, anotar, borrarNota, escuchar, guardado, tamano, tipoCorto,
    get completo() { return completo; },
  };
})();
