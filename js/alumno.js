/* ==========================================================================
   alumno.js — Panel del alumno (alumno.html)
   --------------------------------------------------------------------------
   Vistas: #inicio · #tesina · #asesor · #perfil
   Datos: primero se muestran los guardados en la caché "estadias-api" y
   enseguida se actualizan desde Supabase (stale-while-revalidate).
   Depende de toast.js, cache-api.js, auth.js, tesina.js y panel.js.
   ========================================================================== */
(async () => {
  'use strict';

  const { auth, tesina, panel, toast, cacheApi, ui } = window.App;
  const $ = (id) => document.getElementById(id);

  if (!(await panel.exigirSesion('alumno'))) return;

  const estado = { perfil: null, versiones: [], asesor: null, origen: 'cache', guardadoEn: null };

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
      ? versiones.map((v, i) => ui.version(v, { actual: i === 0 })).join('')
      : '<li class="empty">Aún no has subido tu tesina. Usa el formulario de arriba para subir la primera versión.</li>');
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

  // Al perder la conexión se avisa de inmediato; al recuperarla se actualiza
  window.addEventListener('offline', () => { estado.origen = 'sin-conexion'; pintarAvisoCache(); });
  window.addEventListener('online', () => actualizar());

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
    } catch (error) {
      estado.origen = 'sin-conexion';
      if (!estado.perfil) {
        $('inicio-sub').textContent = error.message;
      } else if (avisar) {
        toast.show(error.message);
      }
    }
    pintarTodo();
  }

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

  function archivoElegido() {
    const archivo = input.files[0];
    $('subir-error').hidden = true;
    if (!archivo) {
      $('archivo-elegido').hidden = true;
      zona.hidden = false;
      mostrarErrorArchivo('');
      return;
    }
    const problema = tesina.validar(archivo);
    mostrarErrorArchivo(problema);
    $('archivo-nombre').textContent = archivo.name;
    $('archivo-detalle').textContent = `${tesina.tamano(archivo.size)} · ${archivo.name.split('.').pop().toUpperCase()}`;
    $('archivo-elegido').hidden = false;
    zona.hidden = true;
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

  function pintarConexionSubida() {
    const sinRed = !navigator.onLine;
    $('aviso-subir').hidden = !sinRed;
    $('btn-subir').disabled = sinRed;
  }
  window.addEventListener('online', pintarConexionSubida);
  window.addEventListener('offline', pintarConexionSubida);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const archivo = input.files[0];
    const problema = tesina.validar(archivo);
    mostrarErrorArchivo(problema);
    if (problema) { (archivo ? $('archivo-quitar') : input).focus(); return; }

    const boton = $('btn-subir');
    const textoOriginal = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = '<span class="cargando" aria-hidden="true"></span>Subiendo versión…';
    $('subir-error').hidden = true;

    try {
      const nueva = await tesina.subir(archivo, comentario.value);
      form.reset();
      $('comentario-contador').textContent = '0 / 500';
      archivoElegido();
      toast.show(`¡Listo! Tu archivo se guardó como la versión ${nueva.numero}.`);
      estado.versiones = [nueva, ...estado.versiones.filter((v) => v.id !== nueva.id)];
      pintarTodo();
      await actualizar();
      document.getElementById(`version-${nueva.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      $('subir-error').textContent = error.message;
      $('subir-error').hidden = false;
    } finally {
      boton.innerHTML = textoOriginal;
      pintarConexionSubida();
      if (navigator.onLine) boton.disabled = false;
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
  pintarTodo();
  panel.iniciar({ alCambiarVista: (vista) => { if (vista === 'perfil') ui.panelCache($('panel-cache')); } });
  await actualizar();
})();
