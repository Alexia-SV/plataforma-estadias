/* ==========================================================================
   alumno.js — Panel del alumno (alumno.html)
   --------------------------------------------------------------------------
   Vistas: #inicio · #tesina · #asesor · #perfil
   Datos: primero se muestran los guardados en la caché "estadias-api" y
   enseguida se actualizan desde Supabase (stale-while-revalidate).
   Además:
   · Sin conexión, la versión se guarda en el dispositivo y se envía sola al
     volver internet (cola.js + Background Sync en sw.js).
   · Al elegir el archivo se revisa su formato (prerevision.js).
   · Compara versiones (comparar.js), ve las notas del asesor sobre el
     documento (visor.js) y escucha sus notas de voz (voz.js).
   Depende de toast.js, cache-api.js, cola.js, auth.js, tesina.js, panel.js,
   documento.js, prerevision.js, comparar.js, visor.js y voz.js.
   ========================================================================== */
(async () => {
  'use strict';

  const { auth, tesina, panel, toast, cacheApi, ui, cola, documento, prerevision, comparar, visor, voz } = window.App;
  const $ = (id) => document.getElementById(id);

  if (!(await panel.exigirSesion('alumno'))) return;

  const estado = { perfil: null, versiones: [], asesor: null, origen: 'cache', guardadoEn: null, pendientes: [] };

  /* ==========================================================================
     Dibujo de cada vista
     ========================================================================== */
  function pintarInicio() {
    const { perfil, versiones, asesor } = estado;
    if (!perfil) return;

    const primerNombre = perfil.nombre.split(/\s+/)[0];
    $('t-inicio').textContent = `¡Hola, ${primerNombre}!`;
    $('inicio-sub').textContent = `Matrícula ${perfil.matricula} · ${perfil.nivel}`;

    const ultima = versiones[0];
    const totalObs = versiones.reduce((n, v) => n + (v.observaciones?.length || 0), 0);
    ui.pintar($('inicio-stats'), `
      <div class="stat"><span class="ic-box"><i data-ic="file"></i></span><b class="num">${versiones.length}</b><span>Versiones de tesina</span></div>
      <div class="stat"><span class="ic-box"><i data-ic="checkCircle"></i></span><b class="texto">${ultima ? ui.esc(ultima.estado) : 'Sin entregas'}</b><span>Estado de la última versión</span></div>
      <div class="stat"><span class="ic-box"><i data-ic="message"></i></span><b class="num">${totalObs}</b><span>Observaciones recibidas</span></div>
      <div class="stat"><span class="ic-box"><i data-ic="userCheck"></i></span><b class="texto">${asesor ? ui.esc(asesor.nombre) : 'Sin asignar'}</b><span>Asesor</span></div>`);

    // Acciones pendientes según el estado de la tesina
    const pendientes = [];
    const enCola = estado.pendientes.length;
    if (enCola) {
      pendientes.push(['cloud', `${enCola === 1 ? 'Una entrega espera' : `${enCola} entregas esperan`} para enviarse`,
        navigator.onLine ? 'Se está enviando a tu asesor' : 'Se enviará sola en cuanto vuelva la conexión', '#tesina', 'Ver']);
    }
    if (!ultima) {
      pendientes.push(['upload', 'Sube la primera versión de tu tesina', 'Formato PDF o Word, máximo 10 MB', '#tesina', 'Subir']);
    } else if (ultima.estado === 'Requiere corrección') {
      const obs = ultima.observaciones?.at(-1);
      pendientes.push(['edit', `Corrige la versión ${ultima.numero} y sube una nueva`, obs ? `Tu asesor: «${obs.texto.slice(0, 90)}${obs.texto.length > 90 ? '…' : ''}»` : 'Tu asesor pidió correcciones', '#tesina', 'Ver']);
    } else if (ultima.estado === 'En revisión') {
      pendientes.push(['clock', `Tu versión ${ultima.numero} está en revisión`, 'Te avisaremos aquí cuando tu asesor deje observaciones', '#tesina', 'Ver']);
    }
    if (!asesor) {
      pendientes.push(['userCheck', 'Aún no tienes asesor asignado', 'La coordinación de estadías te asignará uno', '#asesor', 'Ver']);
    }
    $('cuenta-pendientes').textContent = String(pendientes.length);
    ui.pintar($('inicio-pendientes'), pendientes.length
      ? pendientes.map(([icono, titulo, detalle, href, accion]) => `
          <div class="r"><span class="ic-box" style="margin:0"><i data-ic="${icono}"></i></span>
            <div class="grow"><b>${ui.esc(titulo)}</b><small>${ui.esc(detalle)}</small></div>
            <a class="btn out sm" href="${href}">${accion}</a></div>`).join('')
      : `<div class="r"><span class="ic-box" style="margin:0"><i data-ic="checkCircle"></i></span>
           <div class="grow"><b>¡Todo al día!</b><small>Tu última versión fue aprobada.</small></div></div>`);

    ui.pintar($('inicio-ultima'), ultima
      ? `<div class="rows"><div class="r envuelve"><span class="ver-num" aria-hidden="true">v${ultima.numero}</span>
           <div class="grow"><b>${ui.esc(ultima.nombre_archivo)}</b><small>Subida el ${ui.esc(ui.fechaHora(ultima.subida_en))} · ${ultima.observaciones?.length || 0} observaciones</small></div>
           ${ui.chipEstado(ultima.estado)}</div></div>`
      : '<p class="empty">Todavía no has subido ninguna versión.</p>');
  }

  function pintarTesina() {
    const { versiones } = estado;
    const cuenta = $('cuenta-versiones');
    cuenta.hidden = versiones.length === 0;
    cuenta.textContent = String(versiones.length);
    $('tesina-resumen').textContent = versiones.length
      ? `${versiones.length} ${versiones.length === 1 ? 'versión' : 'versiones'}` : '';
    ui.pintar($('lista-versiones'), versiones.length
      ? versiones.map((v, i) => ui.version(v, { actual: i === 0, anterior: i < versiones.length - 1 })).join('')
      : '<li class="empty">Aún no has subido tu tesina. Usa el formulario de arriba para subir la primera versión.</li>');
    voz.preparar($('lista-versiones'));
    pintarPendientes();
  }

  // Entregas guardadas en el dispositivo que esperan conexión
  function pintarPendientes() {
    const { pendientes } = estado;
    $('card-pendientes').hidden = pendientes.length === 0;
    ui.pintar($('lista-pendientes'), pendientes.map((p) => `
      <div class="r envuelve">
        <span class="ic-box" style="margin:0"><i data-ic="cloud"></i></span>
        <div class="grow"><b>${ui.esc(p.nombre)}</b>
          <small>${ui.esc(tesina.tamano(p.tamano))} · guardada el ${ui.esc(ui.fechaHora(p.creadaEn))}${p.comentario ? ` · «${ui.esc(p.comentario.slice(0, 60))}»` : ''}</small>
          ${p.fallida ? `<small class="bad-text">No se pudo enviar: ${ui.esc(p.ultimoError)}</small>` : ''}</div>
        ${p.fallida ? '<span class="chip bad">No enviada</span>' : `<span class="chip warn">${navigator.onLine ? 'Enviando…' : 'Esperando conexión'}</span>`}
        <div class="ver-acciones">
          ${p.fallida ? `<button class="btn out xs" type="button" data-reintentar="${ui.esc(p.id)}">Reintentar</button>` : ''}
          <button class="btn out xs" type="button" data-cancelar-envio="${ui.esc(p.id)}">Cancelar</button>
        </div>
      </div>`).join(''));
  }

  async function cargarPendientes() {
    estado.pendientes = await cola.listar().catch(() => []);
  }

  function pintarAsesor() {
    const { asesor } = estado;
    ui.pintar($('asesor-detalle'), asesor
      ? `<div class="perfil"><span class="avatar lg solid" aria-hidden="true">${ui.esc(ui.iniciales(asesor.nombre))}</span>
           <div><b>${ui.esc(asesor.nombre)}</b><span class="chip mod">Asesor interno</span></div></div>
         <dl class="datos">
           <div><dt>Correo</dt><dd><a href="mailto:${ui.esc(asesor.correo)}">${ui.esc(asesor.correo)}</a></dd></div>
           <div><dt>Asignado desde</dt><dd>${ui.esc(ui.fecha(asesor.asignado_en))}</dd></div>
         </dl>`
      : `<div class="empty"><span class="ic-box" style="margin:0 auto 8px"><i data-ic="userCheck"></i></span>
           Aún no tienes asesor asignado. La coordinación de estadías te asignará uno.</div>`);
  }

  function pintarPerfil() {
    const { perfil } = estado;
    if (!perfil) return;
    ui.pintar($('perfil-detalle'), `
      <div class="perfil"><span class="avatar lg" aria-hidden="true">${ui.esc(ui.iniciales(perfil.nombre))}</span>
        <div><b>${ui.esc(perfil.nombre)}</b><span class="chip mod">Alumno · ${ui.esc(perfil.nivel)}</span></div></div>
      <dl class="datos">
        <div><dt>Matrícula</dt><dd class="num">${ui.esc(perfil.matricula)}</dd></div>
        <div><dt>Correo</dt><dd>${ui.esc(perfil.correo)}</dd></div>
        <div><dt>Nivel</dt><dd>${ui.esc(perfil.nivel)}</dd></div>
        <div><dt>Registrado el</dt><dd>${ui.esc(ui.fecha(perfil.creado_en))}</dd></div>
      </dl>`);
    ui.panelCache($('panel-cache'));
  }

  function pintarAvisoCache() {
    const aviso = $('aviso-cache');
    const sinConexion = estado.origen === 'sin-conexion';
    aviso.hidden = !sinConexion;
    if (sinConexion) {
      ui.pintar(aviso, `<i data-ic="alert"></i><span>Sin conexión: se muestran tus datos guardados en la caché${estado.guardadoEn ? ` (${ui.esc(ui.fechaHora(estado.guardadoEn))})` : ''}.</span>`);
    }
  }

  function pintarTodo() {
    if (estado.perfil) panel.usuario(estado.perfil.nombre);
    pintarInicio();
    pintarTesina();
    pintarAsesor();
    pintarPerfil();
    pintarAvisoCache();
    pintarConexionSubida();
  }

  /* ==========================================================================
     Carga de datos (stale-while-revalidate)
     ========================================================================== */
  async function cargarDeCache() {
    const [perfil, versiones, asesor] = await Promise.all([
      auth.perfilGuardado('perfil'), tesina.guardado('tesina'), tesina.guardado('asesor'),
    ]);
    if (perfil) { estado.perfil = perfil; estado.guardadoEn = perfil.guardadoEn; }
    if (versiones) estado.versiones = versiones.datos || [];
    if (asesor) estado.asesor = asesor.datos;
    if (!navigator.onLine) estado.origen = 'sin-conexion';
  }

  // Al perder la conexión se avisa de inmediato; al recuperarla se envía lo
  // pendiente y se actualiza
  window.addEventListener('offline', () => { estado.origen = 'sin-conexion'; pintarAvisoCache(); pintarPendientes(); });
  window.addEventListener('online', async () => { pintarPendientes(); await enviarCola(); await actualizar(); });

  async function actualizar({ avisar = false } = {}) {
    try {
      const [perfil, versiones, asesor] = await Promise.all([auth.obtenerPerfil(), tesina.misVersiones(), tesina.miAsesor()]);
      if (!perfil) {
        await auth.cerrarSesion();
        location.replace('portal.html');
        return;
      }
      Object.assign(estado, { perfil, versiones, asesor, origen: 'red', guardadoEn: perfil.guardadoEn });
      if (avisar) toast.show('Datos actualizados y guardados en la caché.');
      guardarArchivosSinConexion();
    } catch (error) {
      estado.origen = 'sin-conexion';
      if (!estado.perfil) {
        $('inicio-sub').textContent = error.message;
      } else if (avisar) {
        toast.show(error.message);
      }
    }
    await cargarPendientes();
    pintarTodo();
  }

  // Con conexión, se guardan en el dispositivo los archivos que el alumno
  // querrá abrir sin internet: las versiones con notas y las dos últimas
  // (para compararlas).
  function guardarArchivosSinConexion() {
    const elegidas = estado.versiones.filter((v, i) => documento.clase(v.tipo) !== 'doc' && (i < 2 || v.notas.length));
    const correr = () => documento.guardarSinConexion(elegidas);
    if ('requestIdleCallback' in window) requestIdleCallback(correr, { timeout: 5000 }); else setTimeout(correr, 1500);
  }

  /* ==========================================================================
     Entregas sin conexión (cola.js)
     ========================================================================== */
  // Envía lo pendiente desde la página (si la app está abierta)
  async function enviarCola() {
    if (!navigator.onLine) return;
    await cargarPendientes();
    if (!estado.pendientes.some((p) => !p.fallida)) { pintarPendientes(); return; }
    const sesion = await tesina.sesionParaCola().catch(() => null);
    const { enviadas } = await cola.enviarPendientes(sesion).catch(() => ({ enviadas: [] }));
    await cargarPendientes();
    avisarEnviadas(enviadas);
    pintarTodo();
  }

  function avisarEnviadas(enviadas) {
    if (!enviadas?.length) return;
    toast.show(enviadas.length === 1
      ? `Se envió tu entrega pendiente: «${enviadas[0].nombre}» es la versión ${enviadas[0].numero}.`
      : `Se enviaron tus ${enviadas.length} entregas pendientes.`);
  }

  // El service worker la envió en segundo plano (Background Sync)
  navigator.serviceWorker?.addEventListener('message', async (e) => {
    if (e.data?.tipo !== 'cola-enviada') return;
    avisarEnviadas(e.data.enviadas);
    await actualizar();
  });

  // Que el service worker siempre tenga un token vigente mientras haya pendientes
  auth.cliente?.auth.onAuthStateChange(async (evento) => {
    if (evento === 'TOKEN_REFRESHED' && estado.pendientes.length) {
      const sesion = await tesina.sesionParaCola().catch(() => null);
      if (sesion) await cola.guardarSesion(sesion).catch(() => {});
    }
  });

  async function guardarEnCola(archivo, comentarioTexto, revision) {
    const entrada = await cola.agregar(await tesina.pendiente(archivo, comentarioTexto, revision));
    const sesion = await tesina.sesionParaCola().catch(() => null);
    if (sesion) await cola.guardarSesion(sesion);
    // Background Sync: el navegador avisa al service worker cuando vuelva la red
    try {
      const registro = await navigator.serviceWorker?.getRegistration();
      await registro?.sync?.register(cola.ETIQUETA);
    } catch { /* sin Background Sync: se envía al abrir la app con conexión */ }
    return entrada;
  }

  document.addEventListener('click', async (e) => {
    const cancelar = e.target.closest('[data-cancelar-envio]');
    const reintentar = e.target.closest('[data-reintentar]');
    if (cancelar) {
      if (!confirm('¿Cancelar esta entrega? El archivo guardado en el dispositivo se borrará.')) return;
      await cola.quitar(cancelar.dataset.cancelarEnvio);
      await cargarPendientes();
      pintarTodo();
      toast.show('Entrega cancelada.');
    } else if (reintentar) {
      await cola.reintentar(reintentar.dataset.reintentar);
      await enviarCola();
    }
  });

  /* ==========================================================================
     Subida de versiones
     ========================================================================== */
  const form = $('form-subir');
  const input = $('archivo');
  const zona = $('zona-archivo');
  const comentario = $('comentario');
  input.accept = tesina.ACEPTA;

  function mostrarErrorArchivo(mensaje) {
    $('archivo-error').textContent = mensaje;
    zona.setAttribute('aria-invalid', String(Boolean(mensaje)));
  }

  // Resultado de la pre-revisión del archivo elegido (se guarda con la versión)
  let revision = null;
  let turnoRevision = 0;

  async function revisarFormato(archivo) {
    const caja = $('prerevision');
    const turno = ++turnoRevision;
    revision = null;
    caja.hidden = false;
    ui.pintar(caja, '<p class="cmp-cargando"><span class="cargando" aria-hidden="true"></span>Revisando el formato de tu archivo…</p>');
    try {
      const resultado = await prerevision.revisar(archivo, { nombre: estado.perfil?.nombre, archivo: archivo.name });
      if (turno !== turnoRevision) return;
      revision = resultado;
      ui.pintar(caja, `<div class="card-h"><h3>Pre-revisión del formato</h3><span class="chip info">Automática</span></div>
        ${prerevision.html(resultado)}
        <p class="small muted">Es una ayuda: puedes subir la versión aunque falte algún punto. Tu asesor verá este resultado.</p>`);
    } catch (error) {
      if (turno !== turnoRevision) return;
      ui.pintar(caja, `<p class="help warn"><i data-ic="alert"></i><span>No se pudo revisar el formato: ${ui.esc(error.message)}</span></p>`);
    }
  }

  function archivoElegido() {
    const archivo = input.files[0];
    $('subir-error').hidden = true;
    if (!archivo) {
      $('archivo-elegido').hidden = true;
      zona.hidden = false;
      mostrarErrorArchivo('');
      turnoRevision++;
      revision = null;
      $('prerevision').hidden = true;
      return;
    }
    const problema = tesina.validar(archivo);
    mostrarErrorArchivo(problema);
    $('archivo-nombre').textContent = archivo.name;
    $('archivo-detalle').textContent = `${tesina.tamano(archivo.size)} · ${archivo.name.split('.').pop().toUpperCase()}`;
    $('archivo-elegido').hidden = false;
    zona.hidden = true;
    if (problema) { $('prerevision').hidden = true; revision = null; } else revisarFormato(archivo);
  }

  input.addEventListener('change', archivoElegido);
  $('archivo-quitar').addEventListener('click', () => { input.value = ''; archivoElegido(); input.focus(); });

  // Arrastrar y soltar
  ['dragenter', 'dragover'].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.add('sobre'); }));
  ['dragleave', 'drop'].forEach((t) => zona.addEventListener(t, () => zona.classList.remove('sobre')));
  zona.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!e.dataTransfer?.files?.length) return;
    input.files = e.dataTransfer.files;
    archivoElegido();
  });

  comentario.addEventListener('input', () => {
    $('comentario-contador').textContent = `${comentario.value.length} / 500`;
  });

  // Sin conexión el botón no se desactiva: guarda la versión para enviarla después
  const BOTON_SUBIR = '<i data-ic="upload"></i>Subir versión';
  const BOTON_GUARDAR = '<i data-ic="cloud"></i>Guardar y enviar al volver la conexión';
  function pintarConexionSubida() {
    const sinRed = !navigator.onLine;
    $('aviso-subir').hidden = !sinRed;
    const boton = $('btn-subir');
    if (!boton.dataset.ocupado) ui.pintar(boton, sinRed ? BOTON_GUARDAR : BOTON_SUBIR);
  }
  window.addEventListener('online', pintarConexionSubida);
  window.addEventListener('offline', pintarConexionSubida);

  function limpiarFormulario() {
    form.reset();
    $('comentario-contador').textContent = '0 / 500';
    archivoElegido();
  }

  async function guardarSinRed(archivo) {
    // Para avisarle con una notificación cuando su entrega llegue al asesor
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    await guardarEnCola(archivo, comentario.value, revision);
    limpiarFormulario();
    await cargarPendientes();
    pintarTodo();
    toast.show('Sin conexión: tu versión quedó guardada en este dispositivo y se enviará sola cuando vuelva internet.', { duration: 8000 });
    $('card-pendientes').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const archivo = input.files[0];
    const problema = tesina.validar(archivo);
    mostrarErrorArchivo(problema);
    if (problema) { (archivo ? $('archivo-quitar') : input).focus(); return; }

    const boton = $('btn-subir');
    boton.disabled = true;
    boton.dataset.ocupado = '1';
    $('subir-error').hidden = true;

    try {
      if (!navigator.onLine) {
        await guardarSinRed(archivo);
        return;
      }
      boton.innerHTML = '<span class="cargando" aria-hidden="true"></span>Subiendo versión…';
      let nueva;
      try {
        nueva = await tesina.subir(archivo, comentario.value, revision);
      } catch (error) {
        // Se cortó la conexión durante la subida: se guarda para enviarla después
        if (!navigator.onLine || error.message.startsWith('No hay conexión')) { await guardarSinRed(archivo); return; }
        throw error;
      }
      limpiarFormulario();
      toast.show(`¡Listo! Tu archivo se guardó como la versión ${nueva.numero}.`);
      estado.versiones = [nueva, ...estado.versiones.filter((v) => v.id !== nueva.id)];
      pintarTodo();
      await actualizar();
      document.getElementById(`version-${nueva.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      $('subir-error').textContent = error.message;
      $('subir-error').hidden = false;
    } finally {
      delete boton.dataset.ocupado;
      boton.disabled = false;
      pintarConexionSubida();
    }
  });

  /* ==========================================================================
     Comparar versiones y notas del asesor sobre el documento
     ========================================================================== */
  document.addEventListener('click', (e) => {
    const botonComparar = e.target.closest('[data-comparar]');
    const botonVisor = e.target.closest('[data-visor]');
    if (botonComparar) comparar.abrir(estado.versiones, { b: botonComparar.dataset.comparar });
    if (botonVisor) {
      const version = estado.versiones.find((v) => v.id === botonVisor.dataset.visor);
      if (version) visor.abrir(version, { notas: version.notas });
    }
  });

  /* ==========================================================================
     Descargas, caché y arranque
     ========================================================================== */
  document.addEventListener('click', async (e) => {
    const boton = e.target.closest('[data-descargar]');
    if (!boton) return;
    const version = estado.versiones.find((v) => v.id === boton.dataset.descargar);
    if (!version) return;
    boton.disabled = true;
    try {
      window.location.href = await tesina.enlaceDescarga(version);
    } catch (error) {
      toast.show(error.message);
    } finally {
      boton.disabled = false;
    }
  });

  $('btn-actualizar').addEventListener('click', () => actualizar({ avisar: true }));
  $('btn-borrar-cache').addEventListener('click', async () => {
    await cacheApi.borrar();
    ui.panelCache($('panel-cache'));
    toast.show('Se borró la caché de la API. Tus datos se volverán a pedir al servidor.');
  });

  await cargarDeCache();
  await cargarPendientes();
  pintarTodo();
  panel.iniciar({ alCambiarVista: (vista) => { if (vista === 'perfil') ui.panelCache($('panel-cache')); } });
  await enviarCola();
  await actualizar();
})();
