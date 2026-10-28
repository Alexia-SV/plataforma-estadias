/* ==========================================================================
   voz.js — Notas de voz del asesor
   --------------------------------------------------------------------------
   · Grabar (asesor): usa el micrófono con MediaRecorder, máximo 3 minutos.
     El audio se sube al bucket privado "voz" junto con la observación.
   · Escuchar (alumno y asesor): cada nota se descarga una vez y se guarda
     en la caché "estadias-api", así se puede escuchar sin conexión (en el
     trayecto o en la empresa). Se borra al cerrar sesión.

   Expone App.voz con:
     disponible                    ¿el navegador puede grabar audio?
     grabadora()                   { montar(contenedor), audio(), grabando(), limpiar() }
     subir(alumnoId, audio)        sube la grabación al bucket "voz" (lo usa tesina.js)
     preparar(nodo)                pone el audio en cada <div data-voz> que encuentre
     duracion(segundos)            «1:05»
   Depende de auth.js, cache-api.js y panel.js (App.ui).
   ========================================================================== */
window.App = window.App || {};

App.voz = (() => {
  'use strict';

  const { auth, cacheApi, ui } = App;
  const BUCKET = 'voz';
  const MAXIMO = 180; // segundos
  const disponible = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

  const duracion = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  // El primer formato que el navegador sepa grabar (Chrome y Firefox: webm; Safari: mp4)
  const FORMATOS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  const formato = () => FORMATOS.find((f) => MediaRecorder.isTypeSupported?.(f)) || '';

  /* ---------- Grabadora (asesor) ---------- */
  // La grabación vive fuera del HTML: si el panel se vuelve a dibujar, se
  // monta en el contenedor nuevo con montar() y no se pierde.
  function grabadora() {
    let contenedor = null;
    let estado = 'listo';
    let grabado = null; // { blob, segundos }
    let grabador = null;
    let flujo = null;
    let reloj = null;
    let inicio = 0;
    let urlPrevia = null;

    function pintar(nuevo = estado) {
      estado = nuevo;
      if (!contenedor) return;
      const html = {
        listo: `<button class="btn out sm" type="button" data-voz-grabar><i data-ic="mic" data-s="16"></i>Grabar nota de voz</button>`,
        grabando: `<span class="voz-rec" aria-hidden="true"></span><span class="mono voz-tiempo" role="timer">${duracion((Date.now() - inicio) / 1000)}</span>
          <span class="small muted">de ${duracion(MAXIMO)}</span>
          <button class="btn danger sm" type="button" data-voz-parar><i data-ic="stop" data-s="16"></i>Detener</button>`,
        grabado: `<audio controls src="${urlPrevia}"></audio><span class="small muted">${duracion(grabado?.segundos || 0)}</span>
          <button class="btn out xs" type="button" data-voz-borrar><i data-ic="trash" data-s="14"></i>Descartar</button>`,
      }[estado];
      ui.pintar(contenedor, html);
      contenedor.dataset.estado = estado;
    }

    function montar(nuevo) {
      contenedor = nuevo;
      contenedor.onclick = (e) => {
        if (e.target.closest('[data-voz-grabar]')) empezar();
        else if (e.target.closest('[data-voz-parar]')) parar();
        else if (e.target.closest('[data-voz-borrar]')) limpiar();
      };
      pintar();
    }

    function liberar() {
      clearInterval(reloj);
      flujo?.getTracks().forEach((t) => t.stop());
      flujo = null;
    }

    async function empezar() {
      try {
        flujo = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        App.toast.show('No se pudo usar el micrófono. Revisa el permiso del navegador.');
        return;
      }
      const tipo = formato();
      grabador = new MediaRecorder(flujo, tipo ? { mimeType: tipo } : undefined);
      const partes = [];
      grabador.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
      grabador.onstop = () => {
        liberar();
        const segundos = Math.max(1, Math.round((Date.now() - inicio) / 1000));
        const blob = new Blob(partes, { type: (grabador.mimeType || tipo || 'audio/webm').split(';')[0] });
        grabado = { blob, segundos };
        if (urlPrevia) URL.revokeObjectURL(urlPrevia);
        urlPrevia = URL.createObjectURL(blob);
        pintar('grabado');
      };
      inicio = Date.now();
      grabador.start(1000);
      pintar('grabando');
      reloj = setInterval(() => {
        const s = (Date.now() - inicio) / 1000;
        const tiempo = contenedor?.querySelector('.voz-tiempo');
        if (tiempo) tiempo.textContent = duracion(s);
        if (s >= MAXIMO) parar();
      }, 250);
    }

    function parar() {
      if (grabador?.state === 'recording') grabador.stop();
    }

    function limpiar() {
      parar();
      liberar();
      grabado = null;
      if (urlPrevia) URL.revokeObjectURL(urlPrevia);
      urlPrevia = null;
      pintar('listo');
    }

    return {
      montar,
      audio: () => grabado,
      grabando: () => grabador?.state === 'recording',
      limpiar,
    };
  }

  /* ---------- Subir (lo usa tesina.js) ---------- */
  async function subir(alumnoId, { blob }) {
    const extension = { 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' }[blob.type] || 'webm';
    const ruta = `${alumnoId}/${crypto.randomUUID()}.${extension}`;
    const { error } = await auth.cliente.storage.from(BUCKET).upload(ruta, blob, { contentType: blob.type || 'audio/webm', upsert: false });
    if (error) throw auth.error(error);
    // Recién grabada: se guarda de una vez para escucharla sin conexión
    await cacheApi.guardarArchivo(`voz/${ruta}`, blob).catch(() => {});
    return ruta;
  }

  async function quitar(ruta) {
    await auth.cliente.storage.from(BUCKET).remove([ruta]).catch(() => {});
  }

  /* ---------- Escuchar ---------- */
  const urls = new Map(); // ruta → URL del audio ya cargado (para no volver a pedirlo)

  async function url(ruta) {
    if (urls.has(ruta)) return urls.get(ruta);
    let blob = await cacheApi.leerArchivo(`voz/${ruta}`).catch(() => null);
    if (!blob) {
      if (!navigator.onLine) return null;
      const { data, error } = await auth.cliente.storage.from(BUCKET).download(ruta);
      if (error) throw auth.error(error);
      blob = data;
      await cacheApi.guardarArchivo(`voz/${ruta}`, blob).catch(() => {});
    }
    const enlace = URL.createObjectURL(blob);
    urls.set(ruta, enlace);
    return enlace;
  }

  function preparar(nodo) {
    nodo.querySelectorAll('[data-voz]').forEach(async (caja) => {
      const audio = caja.querySelector('audio');
      const aviso = caja.querySelector('.voz-aviso');
      try {
        const enlace = await url(caja.dataset.voz);
        if (enlace) { audio.src = enlace; audio.hidden = false; aviso.hidden = true; }
        else { audio.hidden = true; aviso.hidden = false; aviso.textContent = 'Se podrá escuchar al volver la conexión.'; }
      } catch (error) {
        audio.hidden = true;
        aviso.hidden = false;
        aviso.textContent = error.message;
      }
    });
  }

  return { disponible, grabadora, subir, quitar, preparar, duracion };
})();
