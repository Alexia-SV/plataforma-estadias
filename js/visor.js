/* ==========================================================================
   visor.js — Visor de la tesina con notas ancladas
   --------------------------------------------------------------------------
   Abre una versión dentro de la app y muestra las notas del asesor en el
   lugar exacto del documento, como notas adhesivas numeradas.
   · PDF: se dibuja cada página (PDF.js) y la nota queda en su página y
     posición. El asesor toca la página donde quiere dejarla.
   · Word (.docx): se muestra el texto por párrafos y la nota queda en el
     párrafo que el asesor toca.
   · Sin conexión: funciona si el archivo ya se abrió antes (queda en la
     caché); las notas se ven, pero guardar una nueva necesita internet.

   Expone App.visor.abrir(version, opciones)
     opciones.notas        notas de esa versión
     opciones.puedeAnotar  true para el asesor
     opciones.miId         id del asesor (solo borra sus propias notas)
     opciones.guardar(n)   guarda una nota nueva y la devuelve
     opciones.borrar(n)    borra una nota
     opciones.nota         id de la nota que se quiere mostrar al abrir
   Depende de documento.js y panel.js (App.ui).
   ========================================================================== */
window.App = window.App || {};

App.visor = (() => {
  'use strict';

  const { documento, ui, toast } = App;

  // Orden de lectura: por página (o párrafo) y de arriba hacia abajo
  const ordenar = (notas) => [...notas].sort((a, b) =>
    (a.pagina ?? 0) - (b.pagina ?? 0) || (a.parrafo ?? 0) - (b.parrafo ?? 0) || (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0)
    || new Date(a.creado_en) - new Date(b.creado_en));
  const lugar = (n) => (n.pagina ? `Página ${n.pagina}` : `Párrafo ${n.parrafo + 1}`);

  async function abrir(version, opciones = {}) {
    const { puedeAnotar = false, miId = null, guardar, borrar } = opciones;
    let notas = ordenar(opciones.notas || []);
    const clase = documento.clase(version.tipo);

    const { dlg, barra, cuerpo, abrir: mostrar } = ui.dialogo('dlg-visor', {
      titulo: `Versión ${version.numero} · ${version.nombre_archivo}`, clase: 'pantalla',
    });
    ui.pintar(barra, `
      <p class="visor-ayuda"><i data-ic="pin" data-s="16"></i><span>${puedeAnotar
        ? (clase === 'pdf' ? 'Toca la página donde quieras dejar una nota.' : 'Toca el párrafo donde quieras dejar una nota.')
        : 'Toca un número para leer la nota de tu asesor.'}</span></p>
      <button class="btn out sm visor-ver-notas" type="button" aria-expanded="false"><i data-ic="message" data-s="16"></i>Notas <span class="cuenta-notas">${notas.length}</span></button>`);
    ui.pintar(cuerpo, `
      <div class="visor${puedeAnotar ? ' anotar' : ''}">
        <div class="visor-doc" tabindex="0" aria-label="Documento"><p class="cmp-cargando"><span class="cargando" aria-hidden="true"></span>Abriendo el documento…</p></div>
        <aside class="visor-notas" aria-label="Notas en el documento"></aside>
      </div>`);
    mostrar();

    const doc = cuerpo.querySelector('.visor-doc');
    const panel = cuerpo.querySelector('.visor-notas');
    const botonNotas = barra.querySelector('.visor-ver-notas');
    botonNotas.onclick = () => {
      const abierto = panel.classList.toggle('abierto');
      botonNotas.setAttribute('aria-expanded', String(abierto));
    };

    let pdf = null;
    let observador = null;
    const textoPagina = new Map(); // número → renglones (para el extracto)
    let parrafos = [];

    dlg.addEventListener('close', () => {
      observador?.disconnect();
      pdf?.destroy();
      pdf = null;
    }, { once: true });

    /* ---------- Lista de notas ---------- */
    function pintarLista(activa) {
      barra.querySelector('.cuenta-notas').textContent = String(notas.length);
      ui.pintar(panel, notas.length
        ? `<ol class="nota-lista">${notas.map((n, i) => `
            <li class="${n.id === activa ? 'activa' : ''}" data-nota="${ui.esc(n.id)}">
              <button class="nota-ir" type="button" data-ir="${ui.esc(n.id)}"><span class="pin-num">${i + 1}</span>${ui.esc(lugar(n))}</button>
              ${n.extracto ? `<q>${ui.esc(n.extracto)}</q>` : ''}
              <p>${ui.esc(n.texto)}</p>
              <small>${ui.esc(n.asesor?.nombre || 'Asesor')} · ${ui.esc(ui.fechaHora(n.creado_en))}</small>
              ${puedeAnotar && borrar && n.asesor_id === miId ? `<button class="btn danger xs" type="button" data-borrar-nota="${ui.esc(n.id)}"><i data-ic="trash" data-s="14"></i>Borrar</button>` : ''}
            </li>`).join('')}</ol>`
        : `<p class="empty">${puedeAnotar ? 'Aún no hay notas en esta versión.' : 'Tu asesor no ha dejado notas en esta versión.'}</p>`);
    }

    /* ---------- Marcas en el documento ---------- */
    function pintarMarcas() {
      doc.querySelectorAll('.pin').forEach((p) => p.remove());
      notas.forEach((n, i) => {
        const contenedor = n.pagina
          ? doc.querySelector(`.pag[data-pagina="${n.pagina}"] .pag-capa`)
          : doc.querySelector(`.parrafo[data-parrafo="${n.parrafo}"] .parrafo-marcas`);
        if (!contenedor) return;
        const pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'pin';
        pin.dataset.nota = n.id;
        pin.textContent = String(i + 1);
        pin.setAttribute('aria-label', `Nota ${i + 1}: ${n.texto}`);
        if (n.pagina) { pin.style.left = `${n.x * 100}%`; pin.style.top = `${n.y * 100}%`; }
        contenedor.append(pin);
      });
    }

    function cerrarBurbuja() { doc.querySelectorAll('.nota-burbuja, .nota-form').forEach((b) => b.remove()); }

    function mostrarNota(id, { desplazar = true } = {}) {
      const nota = notas.find((n) => n.id === id);
      if (!nota) return;
      cerrarBurbuja();
      const pin = doc.querySelector(`.pin[data-nota="${CSS.escape(id)}"]`);
      if (!pin) return;
      const burbuja = document.createElement('div');
      burbuja.className = 'nota-burbuja';
      burbuja.setAttribute('role', 'note');
      ui.pintar(burbuja, `<b>${ui.esc(nota.asesor?.nombre || 'Asesor')}</b><p>${ui.esc(nota.texto)}</p><small>${ui.esc(ui.fechaHora(nota.creado_en))}</small>`);
      colocar(burbuja, pin);
      if (desplazar) pin.scrollIntoView({ block: 'center', behavior: 'smooth' });
      doc.querySelectorAll('.pin').forEach((p) => p.classList.toggle('activo', p === pin));
      pintarLista(id);
      panel.querySelector('.activa')?.scrollIntoView({ block: 'nearest' });
    }

    // PDF: la burbuja o el formulario flota junto a la marca, sin salirse de
    // la página. Word: va debajo del párrafo, para no tapar su texto.
    function colocar(elemento, ancla) {
      const capa = ancla.closest('.pag-capa');
      if (!capa) { ancla.closest('.parrafo').append(elemento); return; }
      capa.append(elemento);
      const x = parseFloat(ancla.style.left);
      const y = parseFloat(ancla.style.top);
      elemento.style.top = `${y}%`;
      if (x > 55) { elemento.style.right = `${100 - x}%`; elemento.classList.add('izq'); } else elemento.style.left = `${x}%`;
    }

    /* ---------- Nueva nota (asesor) ---------- */
    function pedirNota(ancla, datos) {
      cerrarBurbuja();
      const form = document.createElement('form');
      form.className = 'nota-form';
      form.noValidate = true;
      ui.pintar(form, `
        <label class="field">Nota para el alumno${datos.pagina ? ` · página ${datos.pagina}` : ` · párrafo ${datos.parrafo + 1}`}
          <textarea name="texto" maxlength="1000" required placeholder="Por ejemplo: «Falta la fuente de esta tabla»"></textarea></label>
        <p class="field-error" role="alert"></p>
        <div class="fila"><button class="btn sm" type="submit"><i data-ic="pin" data-s="16"></i>Guardar nota</button>
          <button class="btn out sm" type="button" data-cancelar>Cancelar</button></div>`);
      colocar(form, ancla);
      form.querySelector('textarea').focus();
      form.querySelector('[data-cancelar]').onclick = () => { ancla.classList.contains('pin-nuevo') && ancla.remove(); form.remove(); };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const texto = form.elements.texto.value.trim();
        const error = form.querySelector('.field-error');
        if (!texto) { error.textContent = 'Escribe la nota.'; form.elements.texto.focus(); return; }
        const boton = form.querySelector('[type=submit]');
        boton.disabled = true;
        try {
          const nueva = await guardar({ ...datos, texto });
          notas = ordenar([...notas, nueva]);
          ancla.classList.contains('pin-nuevo') && ancla.remove();
          form.remove();
          pintarMarcas();
          mostrarNota(nueva.id, { desplazar: false });
          toast.show('Nota guardada. El alumno la verá en este punto del documento.');
        } catch (err) {
          error.textContent = err.message;
          boton.disabled = false;
        }
      };
    }

    function extractoPdf(numero, fx, fy) {
      const info = textoPagina.get(numero);
      if (!info) return '';
      const y = info.alto * (1 - fy);
      const cercana = info.lineas.reduce((mejor, l) => {
        const d = Math.abs(l.y + l.alto / 2 - y);
        return !mejor || d < mejor.d ? { l, d } : mejor;
      }, null);
      return cercana && cercana.d < 40 ? cercana.l.texto.slice(0, 200) : '';
    }

    /* ---------- Clics dentro del documento ---------- */
    doc.addEventListener('click', (e) => {
      const pin = e.target.closest('.pin:not(.pin-nuevo)');
      if (pin) { mostrarNota(pin.dataset.nota, { desplazar: false }); return; }
      if (e.target.closest('.nota-form, .nota-burbuja')) return;
      cerrarBurbuja();
      doc.querySelectorAll('.pin-nuevo').forEach((p) => p.remove());
      if (!puedeAnotar || !guardar) return;

      const capa = e.target.closest('.pag-capa');
      if (capa) {
        const r = capa.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
        const numero = Number(capa.parentElement.dataset.pagina);
        const marca = document.createElement('span');
        marca.className = 'pin pin-nuevo';
        marca.textContent = '+';
        marca.style.left = `${x * 100}%`;
        marca.style.top = `${y * 100}%`;
        capa.append(marca);
        pedirNota(marca, { pagina: numero, x, y, extracto: extractoPdf(numero, x, y) });
        return;
      }
      const parrafo = e.target.closest('.parrafo');
      if (parrafo) {
        const i = Number(parrafo.dataset.parrafo);
        const marcas = parrafo.querySelector('.parrafo-marcas');
        const marca = document.createElement('span');
        marca.className = 'pin pin-nuevo';
        marca.textContent = '+';
        marcas.append(marca);
        pedirNota(marca, { parrafo: i, extracto: parrafos[i].texto.slice(0, 200) });
      }
    });

    panel.addEventListener('click', async (e) => {
      const ir = e.target.closest('[data-ir]');
      if (ir) {
        const nota = notas.find((n) => n.id === ir.dataset.ir);
        const destino = nota?.pagina ? doc.querySelector(`.pag[data-pagina="${nota.pagina}"]`) : doc.querySelector(`.parrafo[data-parrafo="${nota?.parrafo}"]`);
        destino?.scrollIntoView({ block: 'start' });
        // La página puede tardar en dibujarse; la marca ya existe en la capa
        setTimeout(() => mostrarNota(ir.dataset.ir), 60);
        if (matchMedia('(max-width: 860px)').matches) { panel.classList.remove('abierto'); botonNotas.setAttribute('aria-expanded', 'false'); }
        return;
      }
      const quitar = e.target.closest('[data-borrar-nota]');
      if (quitar && borrar) {
        const nota = notas.find((n) => n.id === quitar.dataset.borrarNota);
        if (!nota || !confirm('¿Borrar esta nota? El alumno ya no la verá.')) return;
        quitar.disabled = true;
        try {
          await borrar(nota);
          notas = notas.filter((n) => n.id !== nota.id);
          cerrarBurbuja();
          pintarMarcas();
          pintarLista();
          toast.show('Nota borrada.');
        } catch (err) {
          toast.show(err.message);
          quitar.disabled = false;
        }
      }
    });

    /* ---------- Contenido del documento ---------- */
    pintarLista(opciones.nota);
    try {
      if (clase === 'doc') throw new Error('Los archivos .doc (Word 97-2003) no se pueden abrir en la app. Descárgalo para revisarlo.');
      const blob = await documento.descargar(version);
      if (!dlg.open) return;

      if (clase === 'pdf') {
        pdf = await documento.abrirPdf(blob);
        const paginas = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const pagina = await pdf.getPage(n);
          const v = pagina.getViewport({ scale: 1 });
          paginas.push(`<div class="pag" data-pagina="${n}" style="aspect-ratio:${v.width} / ${v.height}">
            <canvas aria-hidden="true"></canvas><div class="pag-capa" role="group" aria-label="Página ${n}"></div><span class="pag-num">${n}</span></div>`);
        }
        doc.innerHTML = paginas.join('');

        const dibujar = async (div) => {
          if (div.dataset.lista || !pdf) return;
          div.dataset.lista = '1';
          const n = Number(div.dataset.pagina);
          const pagina = await pdf.getPage(n);
          const base = pagina.getViewport({ scale: 1 });
          const escala = (div.clientWidth / base.width) * Math.min(2, window.devicePixelRatio || 1);
          const vista = pagina.getViewport({ scale: escala });
          const lienzo = div.querySelector('canvas');
          lienzo.width = Math.floor(vista.width);
          lienzo.height = Math.floor(vista.height);
          await pagina.render({ canvasContext: lienzo.getContext('2d'), viewport: vista }).promise;
          if (puedeAnotar) {
            const { items } = await pagina.getTextContent();
            textoPagina.set(n, {
              alto: base.height,
              lineas: items.filter((it) => it.str.trim()).map((it) => ({ texto: it.str.trim(), y: it.transform[5], alto: Math.abs(it.height) || 10 })),
            });
          }
          div.classList.add('dibujada');
        };
        observador = new IntersectionObserver((entradas) => entradas.forEach((en) => en.isIntersecting && dibujar(en.target)), { root: doc, rootMargin: '800px 0px' });
        doc.querySelectorAll('.pag').forEach((p) => observador.observe(p));
      } else {
        ({ parrafos } = await documento.leer(blob, version.tipo));
        doc.innerHTML = `<div class="hoja-texto">${parrafos.map((p, i) => `
          <div class="parrafo${/^(heading|t[ií]tulo|ttulo)/i.test(p.estilo) ? ' titulo' : ''}" data-parrafo="${i}">
            <span class="parrafo-marcas"></span><p>${ui.esc(p.texto)}</p></div>`).join('')}</div>`;
      }
      pintarMarcas();
      if (opciones.nota) setTimeout(() => panel.querySelector(`[data-ir="${CSS.escape(opciones.nota)}"]`)?.click(), 150);
    } catch (error) {
      ui.pintar(doc, `<p class="help bad"><i data-ic="alert"></i><span>${ui.esc(error.message)}</span></p>`);
    }
  }

  return { abrir };
})();
