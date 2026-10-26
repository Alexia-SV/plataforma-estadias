/* ==========================================================================
   asesor.js — Panel del asesor (asesor.html)
   --------------------------------------------------------------------------
   Vistas: #alumnos · #revisar · #alumno/<id> · #perfil
   El asesor ve todas las versiones de la tesina de sus alumnos asignados,
   las descarga y deja observaciones (y puede cambiar el estado).
   Depende de toast.js, cache-api.js, auth.js, tesina.js y panel.js.
   ========================================================================== */
(async () => {
  'use strict';

  const { auth, tesina, panel, toast, cacheApi, ui } = window.App;
  const $ = (id) => document.getElementById(id);

  if (!(await panel.exigirSesion('asesor'))) return;

  const estado = { perfil: null, alumnos: [], origen: 'cache', guardadoEn: null, vista: 'alumnos', param: '' };

  const ultima = (alumno) => alumno.versiones[0];
  const porRevisar = () => estado.alumnos.flatMap((a) => a.versiones
    .filter((v) => v.estado === 'En revisión')
    .map((v) => ({ alumno: a, version: v })))
    .sort((x, y) => new Date(x.version.subida_en) - new Date(y.version.subida_en));

  /* ==========================================================================
     Dibujo
     ========================================================================== */
  function pintarAlumnos() {
    const { perfil, alumnos } = estado;
    const pendientes = porRevisar();
    const aprobadas = alumnos.filter((a) => ultima(a)?.estado === 'Aprobada').length;
    const correcciones = alumnos.filter((a) => ultima(a)?.estado === 'Requiere corrección').length;

    $('alumnos-sub').textContent = perfil
      ? `${perfil.nombre} · ${alumnos.length} ${alumnos.length === 1 ? 'alumno asignado' : 'alumnos asignados'}` : '';
    $('cuenta-alumnos').textContent = String(alumnos.length);
    $('cuenta-revisar').hidden = pendientes.length === 0;
    $('cuenta-revisar').textContent = String(pendientes.length);
    $('dot-revisar').hidden = pendientes.length === 0;
    $('dot-revisar').textContent = String(pendientes.length);

    ui.pintar($('alumnos-stats'), `
      <div class="stat"><span class="ic-box"><i data-ic="users"></i></span><b class="num">${alumnos.length}</b><span>Alumnos asignados</span></div>
      <div class="stat"><span class="ic-box"><i data-ic="clock"></i></span><b class="num">${pendientes.length}</b><span>Versiones por revisar</span></div>
      <div class="stat"><span class="ic-box"><i data-ic="checkCircle"></i></span><b class="num">${aprobadas}</b><span>Tesinas aprobadas</span></div>
      <div class="stat"><span class="ic-box"><i data-ic="alert"></i></span><b class="num">${correcciones}</b><span>Requieren corrección</span></div>`);

    ui.pintar($('tabla-alumnos'), alumnos.length
      ? alumnos.map((a) => {
        const u = ultima(a);
        return `<tr>
          <td><div class="who"><span class="avatar" aria-hidden="true">${ui.esc(ui.iniciales(a.nombre))}</span>
            <div><b>${ui.esc(a.nombre)}</b><small class="num">${ui.esc(a.matricula)} · ${ui.esc(a.correo)}</small></div></div></td>
          <td>${ui.esc(a.nivel)}</td>
          <td class="num">${a.versiones.length}</td>
          <td>${u ? `<span class="mono">v${u.numero}</span> ${ui.chipEstado(u.estado)}<br><small class="muted">${ui.esc(ui.fecha(u.subida_en))}</small>` : '<span class="chip">Sin entregas</span>'}</td>
          <td><a class="btn soft sm" href="#alumno/${encodeURIComponent(a.id)}">Revisar</a></td>
        </tr>`;
      }).join('')
      : '<tr><td colspan="5"><p class="empty">Aún no tienes alumnos asignados. La coordinación de estadías te los asignará.</p></td></tr>');
  }

  function pintarRevisar() {
    const pendientes = porRevisar();
    ui.pintar($('lista-revisar'), pendientes.length
      ? pendientes.map(({ alumno, version }) => `
          <div class="r"><span class="ver-num" aria-hidden="true">v${version.numero}</span>
            <div class="grow"><b>${ui.esc(alumno.nombre)} · versión ${version.numero}</b>
              <small>${ui.esc(version.nombre_archivo)} · subida el ${ui.esc(ui.fechaHora(version.subida_en))}</small></div>
            <a class="btn soft sm" href="#alumno/${encodeURIComponent(alumno.id)}">Revisar</a></div>`).join('')
      : '<p class="empty">No hay versiones pendientes de revisión. ¡Todo al día!</p>');
  }

  function pintarDetalle() {
    if (estado.vista !== 'alumno') return;
    const alumno = estado.alumnos.find((a) => a.id === estado.param);
    if (!alumno) {
      $('t-alumno').textContent = 'Alumno no encontrado';
      $('alumno-sub').textContent = 'Este alumno no está asignado a tu cuenta.';
      ui.pintar($('alumno-versiones'), '');
      return;
    }
    $('t-alumno').textContent = alumno.nombre;
    $('alumno-sub').textContent = `Matrícula ${alumno.matricula} · ${alumno.nivel} · ${alumno.correo}`;
    document.title = `${alumno.nombre} · Revisión de tesinas · SIGEP UTP`;
    ui.pintar($('alumno-versiones'), alumno.versiones.length
      ? alumno.versiones.map((v, i) => ui.version(v, { actual: i === 0, formulario: true })).join('')
      : '<li class="empty">Este alumno todavía no ha subido ninguna versión de su tesina.</li>');
  }

  function pintarPerfil() {
    const { perfil } = estado;
    if (!perfil) return;
    ui.pintar($('perfil-detalle'), `
      <div class="perfil"><span class="avatar lg solid" aria-hidden="true">${ui.esc(ui.iniciales(perfil.nombre))}</span>
        <div><b>${ui.esc(perfil.nombre)}</b><span class="chip mod">Asesor interno</span></div></div>
      <dl class="datos">
        <div><dt>Correo</dt><dd>${ui.esc(perfil.correo)}</dd></div>
        <div><dt>Alumnos asignados</dt><dd class="num">${estado.alumnos.length}</dd></div>
      </dl>`);
    ui.panelCache($('panel-cache'));
  }

  function pintarAvisoCache() {
    const aviso = $('aviso-cache');
    aviso.hidden = estado.origen !== 'sin-conexion';
    if (!aviso.hidden) {
      ui.pintar(aviso, `<i data-ic="alert"></i><span>Sin conexión: se muestran los datos guardados en la caché${estado.guardadoEn ? ` (${ui.esc(ui.fechaHora(estado.guardadoEn))})` : ''}.</span>`);
    }
  }

  function pintarTodo() {
    if (estado.perfil) panel.usuario(estado.perfil.nombre);
    pintarAlumnos();
    pintarRevisar();
    pintarDetalle();
    pintarPerfil();
    pintarAvisoCache();
  }

  /* ==========================================================================
     Datos (stale-while-revalidate)
     ========================================================================== */
  async function cargarDeCache() {
    const [perfil, alumnos] = await Promise.all([auth.perfilGuardado('perfil-asesor'), tesina.guardado('asesor-alumnos')]);
    if (perfil) { estado.perfil = perfil; estado.guardadoEn = perfil.guardadoEn; }
    if (alumnos) estado.alumnos = alumnos.datos || [];
    if (!navigator.onLine) estado.origen = 'sin-conexion';
  }

  // Al perder la conexión se avisa de inmediato; al recuperarla se actualiza
  window.addEventListener('offline', () => { estado.origen = 'sin-conexion'; pintarAvisoCache(); });
  window.addEventListener('online', () => actualizar());

  async function actualizar({ avisar = false } = {}) {
    try {
      const [perfil, alumnos] = await Promise.all([auth.obtenerPerfilAsesor(), tesina.misAlumnos()]);
      if (!perfil) { await auth.cerrarSesion(); location.replace('portal.html'); return; }
      Object.assign(estado, { perfil, alumnos, origen: 'red', guardadoEn: perfil.guardadoEn });
      if (avisar) toast.show('Datos actualizados y guardados en la caché.');
    } catch (error) {
      estado.origen = 'sin-conexion';
      if (!estado.perfil) $('alumnos-sub').textContent = error.message;
      else if (avisar) toast.show(error.message);
    }
    pintarTodo();
  }

  /* ==========================================================================
     Observaciones y descargas
     ========================================================================== */
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-observar]');
    if (!form) return;
    e.preventDefault();

    const texto = form.elements.texto.value.trim();
    const error = form.querySelector('.field-error');
    error.textContent = texto ? '' : 'Escribe la observación para el alumno.';
    form.elements.texto.setAttribute('aria-invalid', String(!texto));
    if (!texto) { form.elements.texto.focus(); return; }

    const boton = form.querySelector('button[type="submit"]');
    const original = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = '<span class="cargando" aria-hidden="true"></span>Guardando…';
    try {
      await tesina.observar(form.dataset.observar, texto, form.elements.estado.value);
      toast.show('Observación guardada. El alumno ya puede verla en su portal.');
      await actualizar();
      document.getElementById(`version-${form.dataset.observar}`)?.scrollIntoView({ block: 'center' });
    } catch (err) {
      error.textContent = err.message;
      boton.disabled = false;
      boton.innerHTML = original;
    }
  });

  document.addEventListener('click', async (e) => {
    const boton = e.target.closest('[data-descargar]');
    if (!boton) return;
    const version = estado.alumnos.flatMap((a) => a.versiones).find((v) => v.id === boton.dataset.descargar);
    if (!version) return;
    boton.disabled = true;
    try {
      window.location.href = await tesina.enlaceDescarga(version);
    } catch (err) {
      toast.show(err.message);
    } finally {
      boton.disabled = false;
    }
  });

  $('btn-actualizar').addEventListener('click', () => actualizar({ avisar: true }));
  $('btn-borrar-cache').addEventListener('click', async () => {
    await cacheApi.borrar();
    ui.panelCache($('panel-cache'));
    toast.show('Se borró la caché de la API. Los datos se volverán a pedir al servidor.');
  });

  /* ==========================================================================
     Arranque
     ========================================================================== */
  await cargarDeCache();
  pintarTodo();
  panel.iniciar({
    alCambiarVista: (vista, param) => {
      estado.vista = vista;
      estado.param = param;
      pintarDetalle();
      if (vista === 'perfil') ui.panelCache($('panel-cache'));
    },
  });
  await actualizar();
})();
