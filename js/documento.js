/* ==========================================================================
   documento.js — Lectura de los archivos de la tesina (PDF y Word)
   --------------------------------------------------------------------------
   Lo usan el comparador de versiones, el visor con notas y la pre-revisión.

   Expone App.documento con:
     descargar(version)          Blob del archivo: de la caché o de Supabase
                                 Storage (y lo guarda para usarlo sin conexión)
     guardarSinConexion(lista)   descarga en segundo plano las versiones indicadas
     clase(tipoOnombre)          'pdf' | 'docx' | 'doc' | ''
     abrirPdf(blob)              documento de PDF.js (para dibujar páginas)
     leer(blob, tipo)            { clase, parrafos, paginas?, docx? }
     normalizar(texto)           minúsculas y sin acentos (para buscar)

   · PDF: se lee con PDF.js (js/vendor/pdfjs, licencia Apache 2.0), que se
     carga solo la primera vez que se necesita.
   · Word (.docx): es un ZIP con XML; se abre con DecompressionStream del
     navegador, sin librerías. Los .doc antiguos no se pueden leer.
   Depende de auth.js y cache-api.js.
   ========================================================================== */
window.App = window.App || {};

App.documento = (() => {
  'use strict';

  const { auth, cacheApi } = App;
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  const normalizar = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

  function clase(tipoOnombre) {
    const t = String(tipoOnombre || '').toLowerCase();
    if (t === 'application/pdf' || t.endsWith('.pdf')) return 'pdf';
    if (t === DOCX || t.endsWith('.docx')) return 'docx';
    if (t === 'application/msword' || t.endsWith('.doc')) return 'doc';
    return '';
  }

  /* ---------- Archivo de una versión (caché primero) ---------- */
  const clave = (version) => `archivo/${version.id}`;

  async function descargar(version) {
    const guardado = await cacheApi.leerArchivo(clave(version)).catch(() => null);
    if (guardado) return guardado;
    if (!navigator.onLine) {
      throw new Error('Este archivo no está guardado en el dispositivo. Ábrelo una vez con conexión para consultarlo después sin internet.');
    }
    const { data, error } = await auth.cliente.storage.from('tesinas').download(version.archivo_path);
    if (error) throw auth.error(error);
    const blob = new Blob([data], { type: version.tipo });
    await cacheApi.guardarArchivo(clave(version), blob).catch(() => {});
    return blob;
  }

  // Descarga una por una, sin estorbar a la página, las que falten
  async function guardarSinConexion(versiones) {
    for (const version of versiones) {
      if (!navigator.onLine) return;
      if (await cacheApi.leerArchivo(clave(version)).catch(() => null)) continue;
      await descargar(version).catch(() => {});
    }
  }

  /* ---------- PDF (PDF.js) ---------- */
  let pdfjs = null;
  async function cargarPdfjs() {
    if (!pdfjs) {
      const base = document.baseURI;
      pdfjs = await import(new URL('js/vendor/pdfjs/pdf.min.mjs', base).href);
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('js/vendor/pdfjs/pdf.worker.min.mjs', base).href;
    }
    return pdfjs;
  }

  async function abrirPdf(blob) {
    const lib = await cargarPdfjs();
    const datos = new Uint8Array(await blob.arrayBuffer());
    return lib.getDocument({ data: datos, isEvalSupported: false }).promise;
  }

  // Une los trozos de texto de cada página en renglones y los renglones en párrafos
  async function leerPdf(blob) {
    const pdf = await abrirPdf(blob);
    const paginas = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const pagina = await pdf.getPage(n);
      const vista = pagina.getViewport({ scale: 1 });
      const { items } = await pagina.getTextContent();
      const lineas = [];
      let actual = null;
      for (const item of items) {
        const [, , , , x, y] = item.transform;
        const alto = Math.abs(item.height) || Math.abs(item.transform[3]) || 10;
        if (item.str) {
          if (actual && Math.abs(y - actual.y) > Math.max(2, alto * 0.4)) { lineas.push(actual); actual = null; }
          if (!actual) actual = { texto: '', x, y, fin: x, alto };
          const hueco = x - actual.fin;
          if (actual.texto && hueco > alto * 0.2 && !/\s$/.test(actual.texto) && !/^\s/.test(item.str)) actual.texto += ' ';
          actual.texto += item.str;
          actual.x = Math.min(actual.x, x);
          actual.fin = Math.max(actual.fin, x + item.width);
          actual.alto = Math.max(actual.alto, alto);
        }
        if (item.hasEOL && actual) { lineas.push(actual); actual = null; }
      }
      if (actual) lineas.push(actual);
      const limpias = lineas
        .map((l) => ({ ...l, texto: l.texto.replace(/\s+/g, ' ').trim(), ancho: l.fin - l.x }))
        .filter((l) => l.texto);
      paginas.push({ numero: n, ancho: vista.width, alto: vista.height, lineas: limpias });
      pagina.cleanup();
    }
    await pdf.destroy();
    return { clase: 'pdf', paginas, parrafos: parrafosPdf(paginas) };
  }

  function parrafosPdf(paginas) {
    const parrafos = [];
    for (const pagina of paginas) {
      // Se omiten los números de página (renglones de solo dígitos arriba o abajo)
      const lineas = pagina.lineas.filter((l) => !(/^\d{1,3}$/.test(l.texto) && (l.y < pagina.alto * 0.12 || l.y > pagina.alto * 0.88)));
      const saltos = lineas.slice(1).map((l, i) => lineas[i].y - l.y).filter((d) => d > 0).sort((a, b) => a - b);
      const normal = saltos.length ? saltos[Math.floor(saltos.length / 2)] : 14;
      const maxAncho = Math.max(...lineas.map((l) => l.ancho), 1);
      let previa = null;
      for (const linea of lineas) {
        const ultimo = parrafos[parrafos.length - 1];
        const separada = !previa || (previa.y - linea.y) > normal * 1.45 || (previa.y - linea.y) < 0;
        const cierre = previa && previa.ancho < maxAncho * 0.75 && /[.:?!]$/.test(previa.texto);
        // Un cambio de tamaño de letra separa un título del texto que lo sigue
        const otraLetra = previa && Math.abs(linea.alto - previa.alto) > Math.max(1.5, previa.alto * 0.12);
        if (!ultimo || separada || cierre || otraLetra) {
          parrafos.push({ texto: linea.texto, pagina: pagina.numero });
        } else if (/\p{L}-$/u.test(ultimo.texto)) {
          ultimo.texto = ultimo.texto.slice(0, -1) + linea.texto; // palabra cortada con guion
        } else {
          ultimo.texto += ` ${linea.texto}`;
        }
        previa = linea;
      }
    }
    return parrafos;
  }

  /* ---------- Word (.docx): ZIP + XML ---------- */
  async function abrirZip(blob) {
    const buffer = await blob.arrayBuffer();
    const vista = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const texto = new TextDecoder();

    // Fin del directorio central: firma PK\x05\x06 al final del archivo
    let fin = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
      if (vista.getUint32(i, true) === 0x06054b50) { fin = i; break; }
    }
    if (fin < 0) throw new Error('El archivo Word está dañado o no es un .docx.');

    const entradas = new Map();
    let p = vista.getUint32(fin + 16, true);
    for (let n = vista.getUint16(fin + 10, true); n > 0; n--) {
      if (vista.getUint32(p, true) !== 0x02014b50) break;
      const largo = vista.getUint16(p + 28, true);
      entradas.set(texto.decode(bytes.subarray(p + 46, p + 46 + largo)), {
        metodo: vista.getUint16(p + 10, true),
        tamano: vista.getUint32(p + 20, true),
        local: vista.getUint32(p + 42, true),
      });
      p += 46 + largo + vista.getUint16(p + 30, true) + vista.getUint16(p + 32, true);
    }

    async function leerArchivo(nombre) {
      const e = entradas.get(nombre);
      if (!e) return null;
      const inicio = e.local + 30 + vista.getUint16(e.local + 26, true) + vista.getUint16(e.local + 28, true);
      const datos = bytes.subarray(inicio, inicio + e.tamano);
      if (e.metodo === 0) return texto.decode(datos);
      if (e.metodo !== 8 || typeof DecompressionStream === 'undefined') {
        throw new Error('Este navegador no puede leer archivos Word. Usa una versión reciente de Chrome, Edge, Firefox o Safari.');
      }
      const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(flujo).text();
    }

    return { nombres: [...entradas.keys()], leerArchivo };
  }

  const xml = (texto) => (texto ? new DOMParser().parseFromString(texto, 'application/xml') : null);

  async function leerDocx(blob) {
    const zip = await abrirZip(blob);
    const documento = xml(await zip.leerArchivo('word/document.xml'));
    if (!documento) throw new Error('El archivo Word está dañado o no es un .docx.');
    const estilos = xml(await zip.leerArchivo('word/styles.xml'));
    const extras = await Promise.all(zip.nombres
      .filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n))
      .map(async (n) => ({ nombre: n, xml: xml(await zip.leerArchivo(n)) })));

    const parrafos = [...documento.getElementsByTagNameNS(W, 'p')].map((p) => {
      const partes = [...p.getElementsByTagNameNS(W, '*')]
        .filter((n) => n.localName === 't' || n.localName === 'tab' || n.localName === 'br')
        .map((n) => (n.localName === 't' ? n.textContent : ' '));
      const estilo = p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') || '';
      return { texto: partes.join('').replace(/\s+/g, ' ').trim(), estilo };
    }).filter((p) => p.texto);

    return { clase: 'docx', parrafos, docx: { documento, estilos, extras, W } };
  }

  async function leer(blob, tipo) {
    const c = clase(tipo || blob.type);
    if (c === 'pdf') return leerPdf(blob);
    if (c === 'docx') return leerDocx(blob);
    throw new Error('Los archivos .doc (Word 97-2003) no se pueden leer en la app. Guárdalo como .docx o PDF.');
  }

  return { descargar, guardarSinConexion, clase, abrirPdf, leer, normalizar };
})();
