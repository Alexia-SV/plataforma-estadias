/* ==========================================================================
   prerevision.js — Pre-revisión automática del formato de la tesina
   --------------------------------------------------------------------------
   Antes de subir el archivo, la app lo lee en el navegador (sin enviarlo a
   ningún lado) y revisa los puntos de formato de REGLAS. El resultado se
   muestra al alumno como «arregla esto antes de enviarlo» y se guarda con la
   versión para que el asesor lo vea.

   Expone App.prerevision con:
     REGLAS                       valores que se revisan (ajústalos a la guía oficial)
     revisar(blob, { nombre })    { revisadoEn, clase, cumplidos, total, puntos[] }
     html(resultado, opciones)    lista de puntos lista para pintar
   Cada punto: { id, titulo, estado: 'ok' | 'falla' | 'na', detalle }
   Depende de documento.js.
   ========================================================================== */
window.App = window.App || {};

App.prerevision = (() => {
  'use strict';

  const { documento } = App;
  const { normalizar } = documento;

  const REGLAS = {
    universidad: 'Universidad Tecnológica de Puebla',
    margenMinimoCm: 2.5,
    toleranciaCm: 0.3,
    hoja: { nombre: 'carta', anchoCm: 21.59, altoCm: 27.94 },
    secciones: ['Introducción', 'Conclusiones'],
  };

  const PT_CM = 2.54 / 72;     // puntos de PDF a centímetros
  const TWIP_CM = 2.54 / 1440; // twips de Word a centímetros
  const cm = (v) => `${v.toFixed(1)} cm`;
  const punto = (id, titulo, estado, detalle) => ({ id, titulo, estado, detalle });

  /* ---------- Búsquedas en el texto ---------- */
  const esTitulo = (p) => p.texto.length <= 70;
  const quitarNumero = (t) => t.replace(/^(cap[ií]tulo\s+[\divxlc]+\s*[:.\-–]?\s*|\d+(\.\d+)*\.?\s+)/i, '');

  function buscarTitulo(parrafos, patron, desde = 0) {
    for (let i = parrafos.length - 1; i >= desde; i--) {
      if (esTitulo(parrafos[i]) && patron.test(normalizar(quitarNumero(parrafos[i].texto)))) return i;
    }
    return -1;
  }

  // Las entradas del índice terminan en número de página; los títulos reales no
  const PATRON_REFERENCIAS = /^(referencias( bibliograficas)?|bibliografia|fuentes (consultadas|de consulta))$/;

  function citasApa(texto) {
    const citas = [];
    // Entre paréntesis: (García, 2021) · (García y López, 2020; Pérez et al., 2019, p. 4)
    for (const [, dentro] of texto.matchAll(/\(([^()]{3,200}?)\)/g)) {
      for (const parte of dentro.split(';')) {
        const m = parte.trim().match(/^(?:v[eé]ase\s+|ver\s+|cf\.\s+)?(.+?),?\s+(\d{4}[a-z]?|s\.\s?f\.)(?:\s*,\s*p+\.\s*[\d\-–]+)?$/i);
        if (m && /\p{Lu}/u.test(m[1][0])) citas.push({ autor: m[1], anio: m[2] });
      }
    }
    // Narrativas: García (2021) · García y López (2020) · Pérez et al. (2019)
    const narrativa = /(\p{Lu}[\p{L}'’-]+(?:\s+(?:y|&)\s+\p{Lu}[\p{L}'’-]+)?(?:\s+et\s+al\.)?)\s+\((\d{4}[a-z]?)(?:,\s*p+\.\s*[\d\-–]+)?\)/gu;
    for (const [, autor, anio] of texto.matchAll(narrativa)) citas.push({ autor, anio });
    return citas;
  }

  const apellido = (autor) => normalizar(autor.replace(/\bet al\.?/i, '').split(/\s+(?:y|&)\s+|,/)[0])
    .split(' ').filter((p) => !/^(de|del|la|las|los|y)$/.test(p)).pop() || '';

  /* ---------- Puntos que dependen del texto (PDF y Word) ---------- */
  function puntosDeTexto(parrafos, { nombre, portada, campoIndice }) {
    const puntos = [];

    // Portada
    const textoPortada = normalizar(portada.join(' '));
    const tieneUni = textoPortada.includes(normalizar(REGLAS.universidad));
    const partesNombre = normalizar(nombre || '').split(' ').filter((p) => p.length > 2);
    const tieneNombre = !partesNombre.length || partesNombre.filter((p) => textoPortada.includes(p)).length >= Math.min(2, partesNombre.length);
    puntos.push(punto('portada', 'Portada', tieneUni && tieneNombre ? 'ok' : 'falla',
      tieneUni && tieneNombre ? `Incluye «${REGLAS.universidad}»${partesNombre.length ? ' y tu nombre' : ''}.`
        : `En la primera página falta ${[!tieneUni && `«${REGLAS.universidad}»`, !tieneNombre && 'tu nombre completo'].filter(Boolean).join(' y ')}.`));

    // Índice
    const limite = Math.max(10, Math.ceil(parrafos.length * 0.4));
    const indice = campoIndice || parrafos.slice(0, limite).some((p) => esTitulo(p) && /^(indice( general)?|contenido|tabla de contenido)\b/.test(normalizar(p.texto)));
    puntos.push(punto('indice', 'Índice', indice ? 'ok' : 'falla',
      indice ? 'El documento tiene índice.' : 'No se encontró el índice (un título «Índice» al principio del documento).'));

    // Secciones obligatorias: «Conclusión» o «Conclusiones»; las entradas del
    // índice (que terminan en número de página) no cuentan
    const faltan = REGLAS.secciones.filter((s) => buscarTitulo(parrafos, new RegExp(`^${normalizar(s).slice(0, 9)}\\D*$`)) < 0);
    puntos.push(punto('secciones', 'Secciones principales', faltan.length ? 'falla' : 'ok',
      faltan.length ? `Falta el título: ${faltan.join(', ')}.` : `Tiene ${REGLAS.secciones.join(' y ').toLowerCase()}.`));

    // Referencias y citas
    const iRef = buscarTitulo(parrafos, PATRON_REFERENCIAS, Math.floor(parrafos.length * 0.3));
    puntos.push(punto('referencias', 'Apartado de referencias', iRef >= 0 ? 'ok' : 'falla',
      iRef >= 0 ? `Encontrado: «${parrafos[iRef].texto}».` : 'No se encontró el título «Referencias» o «Bibliografía» al final.'));

    const cuerpo = parrafos.slice(0, iRef >= 0 ? iRef : parrafos.length).map((p) => p.texto).join(' ');
    const referencias = normalizar(iRef >= 0 ? parrafos.slice(iRef + 1).map((p) => p.texto).join(' ') : '');
    const vistas = new Map();
    citasApa(cuerpo).forEach((c) => {
      const clave = `${apellido(c.autor)}|${c.anio}`;
      if (apellido(c.autor) && !vistas.has(clave)) vistas.set(clave, c);
    });
    const citas = [...vistas.values()];
    const sinReferencia = iRef < 0 ? citas : citas.filter((c) => {
      const anio = normalizar(c.anio);
      return !(referencias.includes(apellido(c.autor)) && referencias.includes(anio));
    });
    let detalle;
    if (!citas.length) detalle = 'No se encontraron citas en formato APA, por ejemplo (García, 2021) o García (2021).';
    else if (!sinReferencia.length) detalle = `Las ${citas.length} citas del texto aparecen en las referencias.`;
    else {
      const lista = sinReferencia.slice(0, 5).map((c) => `${c.autor} (${c.anio})`).join(', ');
      detalle = `${sinReferencia.length} de ${citas.length} citas no aparecen en las referencias: ${lista}${sinReferencia.length > 5 ? '…' : ''}.`;
    }
    puntos.push(punto('citas', 'Citas con su referencia', citas.length && !sinReferencia.length ? 'ok' : 'falla', detalle));
    return puntos;
  }

  /* ---------- PDF ---------- */
  function revisarPdf(leido, opciones) {
    const { paginas, parrafos } = leido;
    const puntos = [];
    const caracteres = paginas.reduce((n, p) => n + p.lineas.reduce((m, l) => m + l.texto.length, 0), 0);

    if (caracteres < 80 * paginas.length) {
      puntos.push(punto('texto', 'Texto seleccionable', 'falla',
        'El PDF casi no tiene texto (parece escaneado o exportado como imagen). Expórtalo desde Word con «Guardar como PDF».'));
      return puntos;
    }
    puntos.push(punto('texto', 'Texto seleccionable', 'ok', `${paginas.length} páginas con texto que se puede buscar y copiar.`));

    // Tamaño de hoja
    const [ancho, alto] = [paginas[0].ancho * PT_CM, paginas[0].alto * PT_CM].sort((a, b) => a - b);
    const carta = Math.abs(ancho - REGLAS.hoja.anchoCm) < 0.2 && Math.abs(alto - REGLAS.hoja.altoCm) < 0.2;
    puntos.push(punto('hoja', `Tamaño ${REGLAS.hoja.nombre}`, carta ? 'ok' : 'falla',
      carta ? `${cm(ancho)} × ${cm(alto)}.` : `La hoja mide ${cm(ancho)} × ${cm(alto)}; tamaño ${REGLAS.hoja.nombre}: ${cm(REGLAS.hoja.anchoCm)} × ${cm(REGLAS.hoja.altoCm)}.`));

    // Encabezados y pies: renglones que se repiten en muchas páginas o solo números
    const firma = (t) => normalizar(t).replace(/\d+/g, '#');
    const repeticiones = new Map();
    paginas.forEach((p) => new Set(p.lineas.map((l) => firma(l.texto))).forEach((f) => repeticiones.set(f, (repeticiones.get(f) || 0) + 1)));
    const esMargen = (l, p) => (/^\d{1,3}$|^[ivxlc]{1,6}$|^p[aá]gina \d+/i.test(l.texto) && (l.y < p.alto * 0.15 || l.y > p.alto * 0.85))
      || (repeticiones.get(firma(l.texto)) >= Math.max(2, Math.ceil(paginas.length * 0.5)) && (l.y < p.alto * 0.15 || l.y > p.alto * 0.85));

    // Márgenes: se miden en las páginas 2 en adelante (la portada suele ser distinta)
    const medibles = (paginas.length > 1 ? paginas.slice(1) : paginas).filter((p) => p.lineas.some((l) => !esMargen(l, p)));
    if (medibles.length) {
      const izq = []; const der = []; const sup = []; const inf = [];
      medibles.forEach((p) => {
        const cuerpo = p.lineas.filter((l) => !esMargen(l, p));
        cuerpo.forEach((l) => { izq.push(l.x); der.push(p.ancho - (l.x + l.ancho)); });
        sup.push(p.alto - Math.max(...cuerpo.map((l) => l.y + l.alto * 0.8)));
        inf.push(Math.min(...cuerpo.map((l) => l.y - l.alto * 0.25)));
      });
      // Izquierdo y derecho: casi todos los renglones; superior e inferior: la
      // página más llena (las páginas cortas no llegan hasta abajo)
      const percentil = (lista, q) => [...lista].sort((a, b) => a - b)[Math.floor((lista.length - 1) * q)];
      const m = {
        izquierdo: percentil(izq, 0.03) * PT_CM,
        derecho: percentil(der, 0.03) * PT_CM,
        superior: Math.min(...sup) * PT_CM,
        inferior: Math.min(...inf) * PT_CM,
      };
      const minimo = REGLAS.margenMinimoCm - REGLAS.toleranciaCm;
      const angostos = Object.entries(m).filter(([, v]) => v < minimo);
      puntos.push(punto('margenes', `Márgenes de al menos ${cm(REGLAS.margenMinimoCm)}`, angostos.length ? 'falla' : 'ok',
        `${angostos.length ? `Margen ${angostos.map(([k]) => k).join(' y ')} muy angosto. ` : ''}Medidos: izquierdo ${cm(m.izquierdo)}, derecho ${cm(m.derecho)}, superior ${cm(m.superior)}, inferior ${cm(m.inferior)}.`));
    }

    // Números de página (desde la página 3)
    const revisables = paginas.slice(2);
    if (revisables.length) {
      const numeradas = revisables.filter((p) => p.lineas.some((l) => /^\d{1,3}$|^p[aá]gina \d+/i.test(l.texto) && (l.y < p.alto * 0.15 || l.y > p.alto * 0.85))).length;
      const bien = numeradas >= Math.ceil(revisables.length * 0.6);
      puntos.push(punto('numeracion', 'Números de página', bien ? 'ok' : 'falla',
        bien ? `${numeradas} de ${revisables.length} páginas (desde la 3) tienen número.` : `Solo ${numeradas} de ${revisables.length} páginas (desde la 3) tienen número de página.`));
    } else {
      puntos.push(punto('numeracion', 'Números de página', 'na', 'El documento tiene menos de 3 páginas.'));
    }

    const portada = paginas[0].lineas.map((l) => l.texto);
    return [...puntos, ...puntosDeTexto(parrafos, { ...opciones, portada })];
  }

  /* ---------- Word (.docx) ---------- */
  function revisarDocx(leido, opciones) {
    const { parrafos, docx } = leido;
    const { documento: d, extras, W } = docx;
    const puntos = [];
    const valor = (nodo, atributo) => Number(nodo?.getAttributeNS(W, atributo) || 0);

    // Tamaño de hoja y márgenes: los toma de cada sección del documento
    const secciones = [...d.getElementsByTagNameNS(W, 'sectPr')];
    const hojas = secciones.map((s) => s.getElementsByTagNameNS(W, 'pgSz')[0]).filter(Boolean);
    if (hojas.length) {
      const medidas = hojas.map((h) => [valor(h, 'w') * TWIP_CM, valor(h, 'h') * TWIP_CM].sort((a, b) => a - b));
      const otra = medidas.find(([an, al]) => Math.abs(an - REGLAS.hoja.anchoCm) > 0.2 || Math.abs(al - REGLAS.hoja.altoCm) > 0.2);
      puntos.push(punto('hoja', `Tamaño ${REGLAS.hoja.nombre}`, otra ? 'falla' : 'ok',
        otra ? `Hay hojas de ${cm(otra[0])} × ${cm(otra[1])}; tamaño ${REGLAS.hoja.nombre}: ${cm(REGLAS.hoja.anchoCm)} × ${cm(REGLAS.hoja.altoCm)}.`
          : `${cm(medidas[0][0])} × ${cm(medidas[0][1])}.`));
    }

    const margenes = secciones.map((s) => s.getElementsByTagNameNS(W, 'pgMar')[0]).filter(Boolean);
    if (margenes.length) {
      const m = {
        izquierdo: Math.min(...margenes.map((g) => valor(g, 'left'))) * TWIP_CM,
        derecho: Math.min(...margenes.map((g) => valor(g, 'right'))) * TWIP_CM,
        superior: Math.min(...margenes.map((g) => Math.abs(valor(g, 'top')))) * TWIP_CM,
        inferior: Math.min(...margenes.map((g) => Math.abs(valor(g, 'bottom')))) * TWIP_CM,
      };
      const angostos = Object.entries(m).filter(([, v]) => v < REGLAS.margenMinimoCm - 0.05);
      puntos.push(punto('margenes', `Márgenes de al menos ${cm(REGLAS.margenMinimoCm)}`, angostos.length ? 'falla' : 'ok',
        `${angostos.length ? `Margen ${angostos.map(([k]) => k).join(' y ')} muy angosto. ` : ''}Configurados: izquierdo ${cm(m.izquierdo)}, derecho ${cm(m.derecho)}, superior ${cm(m.superior)}, inferior ${cm(m.inferior)}.`));
    }

    // Números de página: un campo PAGE en algún encabezado o pie
    const campos = (x) => [...x.getElementsByTagNameNS(W, 'instrText')].map((n) => n.textContent)
      .concat([...x.getElementsByTagNameNS(W, 'fldSimple')].map((n) => n.getAttributeNS(W, 'instr')));
    const numerada = extras.some((e) => e.xml && campos(e.xml).some((c) => /\bPAGE\b/.test(c)));
    puntos.push(punto('numeracion', 'Números de página', numerada ? 'ok' : 'falla',
      numerada ? 'El encabezado o el pie de página tiene el número de página.' : 'Ningún encabezado ni pie de página tiene el número de página (Insertar → Número de página).'));

    // Portada: el texto antes del primer salto de página (máximo 20 párrafos)
    const portada = [];
    for (const p of d.getElementsByTagNameNS(W, 'p')) {
      const t = p.textContent.trim();
      if (t) portada.push(t);
      const salto = [...p.getElementsByTagNameNS(W, 'br')].some((b) => b.getAttributeNS(W, 'type') === 'page')
        || p.getElementsByTagNameNS(W, 'sectPr').length > 0;
      if ((salto && portada.length) || portada.length >= 20) break;
    }
    const campoIndice = campos(d).some((c) => /\bTOC\b/.test(c));
    return [...puntos, ...puntosDeTexto(parrafos, { ...opciones, portada, campoIndice })];
  }

  /* ---------- Revisión completa ---------- */
  async function revisar(blob, { nombre = '', archivo = '' } = {}) {
    const clase = documento.clase(blob.type || archivo);
    let puntos;
    if (clase === 'doc') {
      puntos = [punto('formato', 'Formato del archivo', 'na', 'Los archivos .doc (Word 97-2003) no se pueden revisar. Guárdalo como .docx o PDF para obtener la pre-revisión.')];
    } else {
      const leido = await documento.leer(blob, blob.type || archivo);
      puntos = clase === 'pdf' ? revisarPdf(leido, { nombre }) : revisarDocx(leido, { nombre });
    }
    const evaluados = puntos.filter((p) => p.estado !== 'na');
    return {
      revisadoEn: new Date().toISOString(),
      clase,
      cumplidos: evaluados.filter((p) => p.estado === 'ok').length,
      total: evaluados.length,
      puntos,
    };
  }

  /* ---------- Dibujo ---------- */
  const ICONO = { ok: 'checkCircle', falla: 'alert', na: 'info' };

  function html(resultado, { titulo = true } = {}) {
    const esc = App.ui.esc;
    if (!resultado?.puntos?.length) return '';
    const pendientes = resultado.total - resultado.cumplidos;
    return `
      ${titulo ? `<p class="pre-resumen ${pendientes ? 'falla' : 'ok'}"><b>${resultado.cumplidos} de ${resultado.total} puntos cumplidos</b>
        ${pendientes ? `<span>Arregla ${pendientes === 1 ? 'este punto' : `estos ${pendientes} puntos`} antes de enviarla.</span>` : '<span>¡El formato está en orden!</span>'}</p>` : ''}
      <ul class="pre-lista">
        ${resultado.puntos.map((p) => `
          <li class="${p.estado}"><i data-ic="${ICONO[p.estado]}" data-s="18"></i>
            <div><b>${esc(p.titulo)}</b><small>${esc(p.detalle)}</small></div></li>`).join('')}
      </ul>`;
  }

  return { REGLAS, revisar, html };
})();
