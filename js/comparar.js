/* ==========================================================================
   comparar.js — Comparador de versiones de la tesina
   --------------------------------------------------------------------------
   Lee el texto de dos versiones (PDF o .docx) y muestra lado a lado lo que
   cambió: en verde lo que se agregó y en rojo lo que se quitó. Así el
   asesor revisa solo lo nuevo y el alumno confirma sus correcciones.

   Cómo compara
   1. Empareja los párrafos idénticos de las dos versiones (subsecuencia
      común más larga).
   2. En los tramos que no coinciden, compara palabra por palabra.

   Expone App.comparar con:
     diferencias(parrafosA, parrafosB)  { bloques, agregadas, quitadas, cambios }
     abrir(versiones, { a, b })         ventana con la comparación
   Funciona sin conexión si los dos archivos ya se abrieron antes.
   Depende de documento.js y panel.js (App.ui).
   ========================================================================== */
window.App = window.App || {};

App.comparar = (() => {
  'use strict';

  const { documento, ui } = App;
  const LIMITE_CELDAS = 4_000_000; // tamaño máximo de la tabla de comparación

  /* ---------- Subsecuencia común más larga ---------- */
  // Devuelve los pares [i, j] de elementos iguales, en orden
  function emparejar(a, b) {
    const n = a.length;
    const m = b.length;
    if (!n || !m) return [];
    if (n * m > LIMITE_CELDAS) return null;
    const tabla = new Uint32Array((n + 1) * (m + 1));
    const col = m + 1;
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        tabla[i * col + j] = a[i] === b[j]
          ? tabla[(i + 1) * col + j + 1] + 1
          : Math.max(tabla[(i + 1) * col + j], tabla[i * col + j + 1]);
      }
    }
    const pares = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { pares.push([i, j]); i++; j++; }
      else if (tabla[(i + 1) * col + j] >= tabla[i * col + j + 1]) i++;
      else j++;
    }
    return pares;
  }

  // Igual que emparejar, pero quita antes el principio y el final comunes
  function emparejarRapido(a, b) {
    let inicio = 0;
    while (inicio < a.length && inicio < b.length && a[inicio] === b[inicio]) inicio++;
    let fin = 0;
    while (fin < a.length - inicio && fin < b.length - inicio && a[a.length - 1 - fin] === b[b.length - 1 - fin]) fin++;
    const medio = emparejar(a.slice(inicio, a.length - fin), b.slice(inicio, b.length - fin));
    if (medio === null) return null;
    return [
      ...Array.from({ length: inicio }, (_, k) => [k, k]),
      ...medio.map(([i, j]) => [i + inicio, j + inicio]),
      ...Array.from({ length: fin }, (_, k) => [a.length - fin + k, b.length - fin + k]),
    ];
  }

  /* ---------- Palabra por palabra ---------- */
  function palabras(antes, despues) {
    const a = antes.match(/\S+/g) || [];
    const b = despues.match(/\S+/g) || [];
    const pares = emparejarRapido(a, b);
    if (pares === null) return [{ t: '-', texto: a.join(' ') }, { t: '+', texto: b.join(' ') }];

    const trozos = [];
    const poner = (t, texto) => {
      const ultimo = trozos[trozos.length - 1];
      if (ultimo?.t === t) ultimo.texto += ` ${texto}`;
      else trozos.push({ t, texto });
    };
    let i = 0;
    let j = 0;
    for (const [pi, pj] of [...pares, [a.length, b.length]]) {
      while (i < pi) poner('-', a[i++]);
      while (j < pj) poner('+', b[j++]);
      if (pi < a.length) { poner('=', a[pi]); i++; j++; }
    }
    return trozos;
  }

  const contar = (texto) => (texto.match(/\S+/g) || []).length;

  /* ---------- Comparación completa ---------- */
  function diferencias(parrafosA, parrafosB) {
    const clave = (p) => documento.normalizar(p.texto);
    const a = parrafosA.map(clave);
    const b = parrafosB.map(clave);
    // Documentos enormes: se empareja solo por párrafos únicos en orden
    const pares = emparejarRapido(a, b) || (() => {
      const lista = [];
      let desde = 0;
      a.forEach((texto, i) => {
        const j = b.indexOf(texto, desde);
        if (j >= 0) { lista.push([i, j]); desde = j + 1; }
      });
      return lista;
    })();

    const bloques = [];
    let agregadas = 0;
    let quitadas = 0;
    let i = 0;
    let j = 0;
    const igual = (parrafos) => {
      const ultimo = bloques[bloques.length - 1];
      if (ultimo?.tipo === 'igual') ultimo.parrafos.push(...parrafos);
      else bloques.push({ tipo: 'igual', parrafos: [...parrafos] });
    };
    for (const [pi, pj] of [...pares, [parrafosA.length, parrafosB.length]]) {
      const fuera = parrafosA.slice(i, pi);
      const dentro = parrafosB.slice(j, pj);
      if (fuera.length && dentro.length) {
        const trozos = palabras(fuera.map((p) => p.texto).join(' '), dentro.map((p) => p.texto).join(' '));
        if (trozos.every((t) => t.t === '=')) {
          igual(dentro); // mismas palabras, solo se partieron distinto en párrafos
        } else {
          trozos.forEach((t) => { if (t.t === '+') agregadas += contar(t.texto); if (t.t === '-') quitadas += contar(t.texto); });
          bloques.push({ tipo: 'cambio', trozos, pagina: dentro[0].pagina, paginaAntes: fuera[0].pagina });
        }
      } else if (fuera.length) {
        const texto = fuera.map((p) => p.texto).join(' ');
        quitadas += contar(texto);
        bloques.push({ tipo: 'quitado', trozos: [{ t: '-', texto }], paginaAntes: fuera[0].pagina });
      } else if (dentro.length) {
        const texto = dentro.map((p) => p.texto).join(' ');
        agregadas += contar(texto);
        bloques.push({ tipo: 'agregado', trozos: [{ t: '+', texto }], pagina: dentro[0].pagina });
      }
      if (pj < parrafosB.length) igual([parrafosB[pj]]);
      i = pi + 1;
      j = pj + 1;
    }
    const cambios = bloques.filter((x) => x.tipo !== 'igual').length;
    return { bloques, agregadas, quitadas, cambios };
  }

  /* ==========================================================================
     Ventana de comparación
     ========================================================================== */
  const leidos = new Map(); // id de versión → párrafos (para no volver a leer)

  async function parrafosDe(version) {
    if (!leidos.has(version.id)) {
      const blob = await documento.descargar(version);
      leidos.set(version.id, (await documento.leer(blob, version.tipo)).parrafos);
    }
    return leidos.get(version.id);
  }

  const etiqueta = (v) => `Versión ${v.numero} · ${ui.fecha(v.subida_en)}`;
  const pagina = (n, sufijo = '') => (n ? `pág. ${n}${sufijo}` : '');

  function pintarResultado(cuerpo, resultado, a, b, soloCambios) {
    const { bloques, agregadas, quitadas, cambios } = resultado;
    if (!cambios) {
      ui.pintar(cuerpo, `<p class="help ok"><i data-ic="checkCircle"></i><span>El texto de la versión ${b.numero} es igual al de la versión ${a.numero}.</span></p>`);
      return;
    }
    const trozo = (t) => (t.t === '+' ? `<ins>${ui.esc(t.texto)}</ins>` : t.t === '-' ? `<del>${ui.esc(t.texto)}</del>` : ui.esc(t.texto));
    const NOMBRE = { cambio: 'Cambió', agregado: 'Se agregó', quitado: 'Se quitó' };
    const html = bloques.map((bloque) => {
      if (bloque.tipo === 'igual') {
        const n = bloque.parrafos.length;
        if (soloCambios) return `<p class="cmp-igual-resumen">${n} ${n === 1 ? 'párrafo sin cambios' : 'párrafos sin cambios'}</p>`;
        return bloque.parrafos.map((p) => `<p class="cmp-igual">${ui.esc(p.texto)}</p>`).join('');
      }
      const donde = bloque.tipo === 'quitado' ? pagina(bloque.paginaAntes, ` de la v${a.numero}`) : pagina(bloque.pagina);
      return `<div class="cmp-bloque ${bloque.tipo}"><span class="cmp-etq">${NOMBRE[bloque.tipo]}${donde ? ` · ${donde}` : ''}</span>
        <p>${bloque.trozos.map(trozo).join(' ')}</p></div>`;
    }).join('');

    ui.pintar(cuerpo, `
      <div class="cmp-resumen" role="status">
        <span class="chip ok">+${agregadas} ${agregadas === 1 ? 'palabra agregada' : 'palabras agregadas'}</span>
        <span class="chip bad">−${quitadas} ${quitadas === 1 ? 'palabra quitada' : 'palabras quitadas'}</span>
        <span class="chip">${cambios} ${cambios === 1 ? 'parte cambió' : 'partes cambiaron'}</span>
        <span class="cmp-leyenda"><ins>agregado</ins> <del>quitado</del></span>
      </div>
      <div class="cmp-texto">${html}</div>`);
  }

  async function abrir(versiones, { a: idA, b: idB } = {}) {
    const lista = [...versiones].sort((x, y) => y.numero - x.numero);
    if (lista.length < 2) return;
    const b0 = lista.find((v) => v.id === idB) || lista[0];
    const a0 = lista.find((v) => v.id === idA) || lista.find((v) => v.numero < b0.numero) || lista[1];

    const { barra, cuerpo, abrir: mostrar } = ui.dialogo('dlg-comparar', { titulo: 'Comparar versiones', clase: 'ancho' });
    const opciones = (elegida) => lista.map((v) => `<option value="${ui.esc(v.id)}"${v.id === elegida.id ? ' selected' : ''}>${ui.esc(etiqueta(v))}</option>`).join('');
    ui.pintar(barra, `
      <label class="field">Antes<select name="a">${opciones(a0)}</select></label>
      <label class="field">Después<select name="b">${opciones(b0)}</select></label>
      <label class="cmp-solo"><input type="checkbox" name="solo" checked> Solo los cambios</label>`);
    mostrar();

    let ultimo = null;
    async function comparar() {
      const a = lista.find((v) => v.id === barra.querySelector('[name=a]').value);
      const b = lista.find((v) => v.id === barra.querySelector('[name=b]').value);
      const solo = barra.querySelector('[name=solo]').checked;
      if (a.id === b.id) {
        ui.pintar(cuerpo, '<p class="empty">Elige dos versiones distintas.</p>');
        return;
      }
      const turno = {};
      ultimo = turno;
      ui.pintar(cuerpo, `<p class="cmp-cargando"><span class="cargando" aria-hidden="true"></span>Leyendo las versiones ${a.numero} y ${b.numero}…</p>`);
      try {
        const [pa, pb] = await Promise.all([parrafosDe(a), parrafosDe(b)]);
        if (ultimo !== turno) return;
        // La más antigua siempre va como «antes»
        const [viejo, nuevo, textoViejo, textoNuevo] = a.numero < b.numero ? [a, b, pa, pb] : [b, a, pb, pa];
        pintarResultado(cuerpo, diferencias(textoViejo, textoNuevo), viejo, nuevo, solo);
      } catch (error) {
        if (ultimo !== turno) return;
        ui.pintar(cuerpo, `<p class="help bad"><i data-ic="alert"></i><span>${ui.esc(error.message)}</span></p>`);
      }
    }

    barra.onchange = comparar;
    await comparar();
  }

  return { diferencias, abrir };
})();
