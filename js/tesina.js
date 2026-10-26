/* ==========================================================================
   tesina.js — Tesina con versiones (Supabase Storage + tablas de tesina)
   --------------------------------------------------------------------------
   Expone App.tesina con:
     MAX_BYTES, ACEPTA          límites: 10 MB · .pdf, .doc, .docx
     validar(archivo)           '' si es válido, o el mensaje de error
     subir(archivo, comentario) sube el archivo y lo registra como versión nueva
     misVersiones()             historial del alumno con sesión (caché "tesina")
     miAsesor()                 asesor asignado al alumno (caché "asesor")
     misAlumnos()               alumnos del asesor con sus versiones (caché "asesor-alumnos")
     enlaceDescarga(version)    enlace temporal (2 min) para descargar el archivo
     observar(id, texto, estado)  observación del asesor (y cambio de estado)
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
    comentario, estado, subida_en,
    observaciones:tesina_observaciones (id, texto, estado_asignado, creado_en, asesor:asesores (nombre))
  `;

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
    versiones.forEach((v) => (v.observaciones || []).sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en)));
    return versiones;
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
    const { data, error } = await cliente().from('tesina_versiones').select(SELECT_VERSION).eq('alumno_id', id);
    if (error) throw auth.error(error);
    ordenar(data);
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

  async function subir(archivo, comentario) {
    const problema = validar(archivo);
    if (problema) throw new Error(problema);
    if (!navigator.onLine) throw new Error('Necesitas conexión a internet para subir tu tesina.');

    const id = await exigirUsuario();
    const ext = extension(archivo.name);
    const tipo = TIPOS[ext];
    // Nombre interno único: el original se conserva en la base de datos
    const ruta = `${id}/${crypto.randomUUID()}.${ext}`;

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
      })
      .select(SELECT_VERSION)
      .single();

    if (error) {
      // No se registró: se borra el archivo para no dejarlo huérfano
      await cliente().storage.from(BUCKET).remove([ruta]).catch(() => {});
      throw auth.error(error);
    }
    return data;
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
      const { data: versiones, error: e } = await cliente()
        .from('tesina_versiones')
        .select(SELECT_VERSION)
        .in('alumno_id', alumnos.map((a) => a.id));
      if (e) throw auth.error(e);
      ordenar(versiones);
      alumnos.forEach((a) => { a.versiones = versiones.filter((v) => v.alumno_id === a.id); });
    }
    alumnos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    await guardar('asesor-alumnos', alumnos);
    return alumnos;
  }

  async function observar(versionId, texto, estado) {
    if (!navigator.onLine) throw new Error('Necesitas conexión a internet para guardar la observación.');
    const { data, error } = await cliente().rpc('observar_version', {
      p_version: versionId,
      p_texto: texto,
      p_estado: estado || null,
    });
    if (error) throw auth.error(error);
    return data;
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
    MAX_BYTES, ACEPTA, validar, subir, misVersiones, miAsesor, misAlumnos,
    enlaceDescarga, observar, guardado, tamano, tipoCorto,
  };
})();
