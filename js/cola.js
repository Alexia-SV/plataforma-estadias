/* ==========================================================================
   cola.js — Entregas de tesina pendientes de envío (IndexedDB)
   --------------------------------------------------------------------------
   Si el alumno sube una versión sin internet, el archivo se guarda en este
   dispositivo y se envía solo cuando vuelve la conexión: desde la página
   (evento online) o desde el service worker (Background Sync), aunque la
   app esté cerrada.

   Este archivo lo cargan la página (alumno.html) y el service worker
   (importScripts en sw.js), por eso no usa nada de la ventana.

   Expone ColaTesina (y App.cola en la página) con:
     ETIQUETA                    nombre del registro de Background Sync
     agregar(entrada)            guarda una entrega pendiente
     listar() · contar()         entregas guardadas, de la más antigua a la más nueva
     quitar(id) · reintentar(id) cancela una entrega / la vuelve a poner en cola
     guardarSesion(datos)        token con el que el service worker puede enviar
     enviarPendientes(sesion?)   envía todo lo pendiente; devuelve { enviadas, motivo }
     borrarTodo()                borra la base de datos (al cerrar sesión)

   Base de datos "estadias-cola"
     subidas  { id, archivo (Blob), nombre, tipo, tamano, comentario, ruta,
                alumnoId, prerevision, creadaEn, fallida, ultimoError }
     sesion   { clave: 'actual', token, expira, usuarioId, url, key }
   ========================================================================== */
(function (raiz) {
  'use strict';

  const DB = 'estadias-cola';
  const ETIQUETA = 'enviar-tesina';
  const BUCKET = 'tesinas';

  /* ---------- IndexedDB ---------- */
  function abrir() {
    return new Promise((resolver, rechazar) => {
      const peticion = indexedDB.open(DB, 1);
      peticion.onupgradeneeded = () => {
        const db = peticion.result;
        if (!db.objectStoreNames.contains('subidas')) db.createObjectStore('subidas', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('sesion')) db.createObjectStore('sesion', { keyPath: 'clave' });
      };
      peticion.onsuccess = () => resolver(peticion.result);
      peticion.onerror = () => rechazar(peticion.error);
    });
  }

  // Abre, hace una operación y cierra (así borrarTodo() nunca queda bloqueado)
  async function operar(almacen, modo, accion) {
    const db = await abrir();
    try {
      return await new Promise((resolver, rechazar) => {
        const tx = db.transaction(almacen, modo);
        const peticion = accion(tx.objectStore(almacen));
        let resultado;
        if (peticion) peticion.onsuccess = () => { resultado = peticion.result; };
        tx.oncomplete = () => resolver(resultado);
        tx.onerror = () => rechazar(tx.error);
        tx.onabort = () => rechazar(tx.error);
      });
    } finally {
      db.close();
    }
  }

  const listar = async () => ((await operar('subidas', 'readonly', (s) => s.getAll())) || [])
    .sort((a, b) => a.creadaEn.localeCompare(b.creadaEn));
  const contar = async () => (await operar('subidas', 'readonly', (s) => s.count())) || 0;
  const guardar = (entrada) => operar('subidas', 'readwrite', (s) => s.put(entrada));
  const quitar = (id) => operar('subidas', 'readwrite', (s) => s.delete(id));
  const leerSesion = () => operar('sesion', 'readonly', (s) => s.get('actual'));
  const guardarSesion = (datos) => operar('sesion', 'readwrite', (s) => s.put({ ...datos, clave: 'actual' }));

  async function agregar(entrada) {
    const completa = {
      id: crypto.randomUUID(),
      creadaEn: new Date().toISOString(),
      fallida: false,
      ultimoError: '',
      ...entrada,
    };
    await guardar(completa);
    return completa;
  }

  async function reintentar(id) {
    const entrada = (await listar()).find((e) => e.id === id);
    if (entrada) await guardar({ ...entrada, fallida: false, ultimoError: '' });
  }

  function borrarTodo() {
    return new Promise((resolver) => {
      const peticion = indexedDB.deleteDatabase(DB);
      peticion.onsuccess = peticion.onerror = peticion.onblocked = () => resolver();
    });
  }

  /* ---------- Envío (API REST de Supabase) ---------- */
  // permanente: el servidor rechazó la entrega y reintentar no la arreglará
  function falla(estado, cuerpo = {}) {
    const texto = `${cuerpo.code || ''} ${cuerpo.error || ''} ${cuerpo.message || ''}`.toLowerCase();
    const sesion = estado === 401 || texto.includes('jwt') || texto.includes('pgrst301');
    let mensaje = cuerpo.message || `El servidor respondió ${estado}.`;
    if (sesion) mensaje = 'Tu sesión terminó. Abre la app con conexión para enviarla.';
    else if (estado === 413 || texto.includes('too large') || texto.includes('maximum allowed size')) mensaje = 'El archivo pesa más de 10 MB.';
    else if (texto.includes('mime')) mensaje = 'Solo se aceptan archivos PDF o Word (.pdf, .doc, .docx).';
    else if (estado === 403 || texto.includes('42501') || texto.includes('row-level security')) mensaje = 'No tienes permiso para subir esta versión.';
    const error = new Error(mensaje);
    error.permanente = !sesion && estado >= 400 && estado < 500;
    error.sesion = sesion;
    return error;
  }

  async function pedir(url, opciones) {
    try {
      return await fetch(url, opciones);
    } catch {
      const error = new Error('Sin conexión con el servidor.');
      error.red = true;
      throw error;
    }
  }

  async function enviarUna(entrada, sesion) {
    const base = sesion.url.replace(/\/$/, '');
    const cabeceras = { apikey: sesion.key, Authorization: `Bearer ${sesion.token}` };

    // 1. El archivo. Si ya se subió en un intento anterior, Storage avisa
    //    que está duplicado y se sigue con el registro.
    let r = await pedir(`${base}/storage/v1/object/${BUCKET}/${entrada.ruta}`, {
      method: 'POST',
      headers: { ...cabeceras, 'Content-Type': entrada.tipo, 'x-upsert': 'false' },
      body: entrada.archivo,
    });
    if (!r.ok) {
      const cuerpo = await r.json().catch(() => ({}));
      if (!/duplicate|already exists/i.test(`${cuerpo.error} ${cuerpo.message}`)) throw falla(r.status, cuerpo);
    }

    // 2. El registro de la versión (la base de datos asigna el número)
    const fila = {
      alumno_id: entrada.alumnoId,
      numero: 1,
      archivo_path: entrada.ruta,
      nombre_archivo: entrada.nombre,
      tipo: entrada.tipo,
      tamano_bytes: entrada.tamano,
      comentario: entrada.comentario || null,
    };
    const registrar = (datos) => pedir(`${base}/rest/v1/tesina_versiones?select=id,numero`, {
      method: 'POST',
      headers: { ...cabeceras, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(datos),
    });

    r = await registrar(entrada.prerevision ? { ...fila, prerevision: entrada.prerevision } : fila);
    let cuerpo = r.ok ? null : await r.json().catch(() => ({}));
    // Base de datos sin la columna de la pre-revisión: se registra sin ella
    if (cuerpo?.code === 'PGRST204' && entrada.prerevision) {
      r = await registrar(fila);
      cuerpo = r.ok ? null : await r.json().catch(() => ({}));
    }
    if (r.ok) return (await r.json())[0];

    // Ya se había registrado en un intento anterior que se cortó
    if (cuerpo.code === '23505') {
      const ya = await pedir(`${base}/rest/v1/tesina_versiones?select=id,numero&archivo_path=eq.${encodeURIComponent(entrada.ruta)}`, { headers: cabeceras });
      const existente = ya.ok ? (await ya.json())[0] : null;
      if (existente) return existente;
    }

    const error = falla(r.status, cuerpo);
    if (error.permanente) {
      // No se registró: se borra el archivo para no dejarlo huérfano
      await pedir(`${base}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE',
        headers: { ...cabeceras, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [entrada.ruta] }),
      }).catch(() => {});
    }
    throw error;
  }

  async function enviarPendientes(sesionActual) {
    const sesion = sesionActual || await leerSesion();
    if (!sesion?.token) return { enviadas: [], motivo: 'sin-sesion' };
    if (sesion.expira && sesion.expira * 1000 < Date.now() + 30000) return { enviadas: [], motivo: 'sesion-vencida' };

    const trabajo = async () => {
      const enviadas = [];
      for (const entrada of await listar()) {
        if (entrada.fallida || entrada.alumnoId !== sesion.usuarioId) continue;
        try {
          const version = await enviarUna(entrada, sesion);
          await quitar(entrada.id);
          enviadas.push({ ...version, nombre: entrada.nombre });
        } catch (error) {
          if (error.permanente) {
            await guardar({ ...entrada, fallida: true, ultimoError: error.message });
            continue;
          }
          return { enviadas, motivo: error.sesion ? 'sesion-vencida' : 'red' };
        }
      }
      return { enviadas, motivo: '' };
    };

    // La página y el service worker nunca envían la misma entrega a la vez
    const candados = raiz.navigator?.locks;
    return candados ? candados.request('estadias-cola', trabajo) : trabajo();
  }

  const api = {
    ETIQUETA, agregar, listar, contar, quitar, reintentar,
    guardarSesion, enviarPendientes, borrarTodo,
  };
  raiz.ColaTesina = api;
  if (typeof window !== 'undefined') {
    window.App = window.App || {};
    window.App.cola = api;
  }
})(typeof window !== 'undefined' ? window : self);
