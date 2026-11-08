/**
 * parser.js — Convierte PDF / EPUB / TXT en un formato común «bruto»:
 *   { formato, paginado, meta, unidades: [{ fisica, etiqueta, lineas: [{ t, borde }] }], capitulos: [{ titulo, unidad }] }
 * En PDF cada unidad es una página; «borde» marca las líneas de arriba y de abajo
 * (candidatas a encabezado o pie). En EPUB cada unidad es un archivo del libro.
 */
const Parser = {

    async leer(archivo, progreso) {
        const ext = await this.formato(archivo);
        const base = archivo.name.replace(/\.(pdf|epub|txt)$/i, '');
        let bruto;
        if (ext === 'pdf') bruto = await this.pdf(archivo, progreso);
        else if (ext === 'epub') bruto = await this.epub(archivo, progreso);
        else if (ext === 'txt') bruto = await this.txt(archivo);
        else throw new Error('Formato no soportado: ' + (archivo.name || archivo.type || 'archivo sin nombre'));
        bruto.meta.titulo = (bruto.meta.titulo || '').trim() || base;
        return bruto;
    },

    /**
     * pdf / epub / txt según el contenido: en Android el archivo a veces llega
     * sin extensión o con un tipo genérico, así que el nombre no basta.
     */
    async formato(archivo) {
        const cab = new Uint8Array(await archivo.slice(0, 64).arrayBuffer());
        const ascii = String.fromCharCode(...cab);
        if (ascii.startsWith('%PDF')) return 'pdf';
        if (ascii.startsWith('PK') && ascii.includes('mimetypeapplication/epub+zip')) return 'epub';
        const ext = (archivo.name || '').split('.').pop().toLowerCase();
        if (['pdf', 'epub', 'txt'].includes(ext)) return ext;
        if (ascii.startsWith('PK') || /epub/.test(archivo.type)) return 'epub';
        if (/^text\//.test(archivo.type)) return 'txt';
        return ext;
    },

    // ---------------------------------------------------------------- PDF
    async pdf(archivo, progreso) {
        const pdf = await pdfjsLib.getDocument({ data: await archivo.arrayBuffer() }).promise;
        const meta = {};
        try {
            const info = (await pdf.getMetadata()).info || {};
            meta.titulo = info.Title || '';
            meta.autor = info.Author || '';
            const d = String(info.CreationDate || '').match(/D:(\d{4})/);
            meta.anio = d ? d[1] : '';
        } catch { /* sin metadatos */ }

        let etiquetas = null;
        try { etiquetas = await pdf.getPageLabels(); } catch { }

        const unidades = [];
        for (let p = 1; p <= pdf.numPages; p++) {
            const pagina = await pdf.getPage(p);
            const tc = await pagina.getTextContent();
            unidades.push({ fisica: p, etiqueta: etiquetas ? etiquetas[p - 1] : null, lineas: this.lineasPdf(tc.items) });
            pagina.cleanup();
            if (progreso) progreso(p, pdf.numPages);
        }

        const capitulos = [];
        try {
            for (const it of (await pdf.getOutline()) || []) {
                let dest = it.dest;
                if (typeof dest === 'string') dest = await pdf.getDestination(dest);
                if (Array.isArray(dest)) capitulos.push({ titulo: it.title.trim(), unidad: await pdf.getPageIndex(dest[0]) });
            }
        } catch { }
        capitulos.sort((a, b) => a.unidad - b.unidad);

        pdf.destroy();
        return { formato: 'pdf', paginado: true, meta, unidades, capitulos };
    },

    /** Reconstruye líneas a partir de los trozos de texto de pdf.js y marca las de los bordes. */
    lineasPdf(items) {
        const lineas = [];
        let cur = null;
        for (const it of items) {
            if (!('str' in it)) continue;
            const x = it.transform[4], y = it.transform[5];
            const h = Math.abs(it.transform[3]) || 10;
            if (!cur || Math.abs(y - cur.y) > h * 0.5) {
                cur = { y, partes: [], fin: x };
                lineas.push(cur);
            }
            const ult = cur.partes[cur.partes.length - 1];
            if (ult && x - cur.fin > h * 0.15 && !/\s$/.test(ult) && !/^\s/.test(it.str)) cur.partes.push(' ');
            cur.partes.push(it.str);
            cur.fin = x + (it.width || 0);
            if (it.hasEOL) cur = null;
        }
        const limpias = lineas
            .map(l => ({ y: l.y, t: l.partes.join('').replace(/\s+/g, ' ').trim() }))
            .filter(l => l.t);
        // Las 2 líneas más altas y las 2 más bajas de la página son «borde»
        const ys = [...new Set(limpias.map(l => l.y))].sort((a, b) => b - a);
        const bordes = new Set([...ys.slice(0, 2), ...ys.slice(-2)]);
        return limpias.map(l => ({ t: l.t, borde: bordes.has(l.y) }));
    },

    // ---------------------------------------------------------------- EPUB
    async epub(archivo, progreso) {
        const libro = ePub(await archivo.arrayBuffer());
        await libro.ready;
        const md = (libro.packaging && libro.packaging.metadata) || {};
        const meta = {
            titulo: md.title || '', autor: md.creator || '', editorial: md.publisher || '',
            anio: String(md.pubdate || '').slice(0, 4), isbn: /\d{9,}/.test(md.identifier || '') ? md.identifier : '',
            idioma: md.language || ''
        };

        // Títulos de capítulo desde la tabla de contenidos
        const titulos = {};
        const recorrer = lista => lista.forEach(t => {
            const href = (t.href || '').split('#')[0];
            if (href && !titulos[href]) titulos[href] = (t.label || '').trim();
            if (t.subitems) recorrer(t.subitems);
        });
        recorrer((libro.navigation && libro.navigation.toc) || []);

        const unidades = [], capitulos = [];
        const items = libro.spine.spineItems || [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (progreso) progreso(i + 1, items.length);
            // Algunos EPUB mal armados citan en el orden de lectura archivos que no existen
            // (p. ej. una portada): se saltan en vez de rechazar el libro entero
            if (!item.href) continue;
            let doc;
            try { doc = await this.capituloEpub(libro, item); }
            catch (err) { console.warn('EPUB: no se pudo leer', item.href, err); continue; }
            if (!doc) continue;
            const lineas = this.bordesEpub(this.parrafos(doc));
            if (!lineas.length) continue;
            const clave = Object.keys(titulos).find(h => item.href.endsWith(h) || h.endsWith(item.href));
            if (clave) capitulos.push({ titulo: titulos[clave], unidad: unidades.length });
            unidades.push({ fisica: null, etiqueta: null, lineas });
        }
        libro.destroy();
        // EPUB convertido de un PDF: muchos archivos de uno o dos párrafos (= páginas)
        const comoPaginas = unidades.length >= 20 &&
            unidades.reduce((s, u) => s + u.lineas.filter(l => !l.borde).length, 0) / unidades.length <= 3;
        return { formato: 'epub', paginado: false, comoPaginas, meta, unidades, capitulos };
    },

    /**
     * Primer y último párrafo de cada archivo: candidatos a encabezado / pie.
     * En los EPUB convertidos de PDF el encabezado viene pegado al texto
     * («SOBRE EL PROBLEMA DE LA EMPATÍA ocupación con mi tema…») y el número de
     * página al final («…cambios. 18»): se separan como líneas aparte.
     */
    bordesEpub(ps) {
        const lineas = ps.map(t => ({ t, borde: false }));
        if (!lineas.length) return lineas;
        const mayus = w => /\p{L}/u.test(w) && w === w.toUpperCase();
        // Encabezado: palabras en MAYÚSCULAS al inicio (admite alguna mal leída, como «El»)
        const primero = lineas[0], ws = primero.t.split(' ');
        let k = 0;
        while (k < ws.length && (mayus(ws[k]) || (/^\p{Lu}\p{Ll}$/u.test(ws[k]) && k + 1 < ws.length && mayus(ws[k + 1])))) k++;
        const cab = ws.slice(0, k).join(' ');
        if (k >= 2 && k < ws.length && cab.length >= 10) lineas.splice(0, 1, { t: cab, borde: true }, { t: ws.slice(k).join(' '), borde: false });
        else primero.borde = true;
        // Pie: número de página al final del último párrafo
        const ult = lineas[lineas.length - 1];
        const m = !ult.borde && ult.t.match(/^(.*\S)\s+(\d{1,4})$/);
        if (m) lineas.splice(lineas.length - 1, 1, { t: m[1], borde: false }, { t: m[2], borde: true });
        else if (lineas.length > 1) ult.borde = true;
        return lineas;
    },

    /**
     * Un capítulo del EPUB como documento. Se lee en bytes y se decodifica aquí:
     * hay EPUB (conversiones automáticas) que dicen UTF-8 pero están en Windows-1252,
     * y entonces las tildes salen como «�».
     */
    async capituloEpub(libro, item) {
        const ruta = decodeURIComponent(libro.resolve(item.href)).replace(/^\//, '');
        const f = libro.archive && libro.archive.zip && libro.archive.zip.file(ruta);
        if (!f) {
            const doc = await libro.load(item.href);
            return typeof doc === 'string' ? new DOMParser().parseFromString(doc, 'text/html') : doc;
        }
        return new DOMParser().parseFromString(this.decodificar(await f.async('uint8array')), 'text/html');
    },

    /** UTF-8 si los bytes lo son de verdad; si no, Windows-1252 (Latin-1 ampliado). */
    decodificar(bytes) {
        try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { return new TextDecoder('windows-1252').decode(bytes); }
    },

    /** Datos de un metadata.opf de Calibre (está junto al libro en cada carpeta de Calibre). */
    metaCalibre(xml) {
        const d = new DOMParser().parseFromString(xml, 'application/xml');
        const dc = n => [...d.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', n)];
        const uno = n => (dc(n)[0] || {}).textContent || '';
        const autores = dc('creator')
            .filter(e => !e.getAttribute('opf:role') || e.getAttribute('opf:role') === 'aut')
            .map(e => (e.getAttribute('opf:file-as') || e.textContent).trim()).filter(Boolean);
        const anio = (uno('date').match(/^(\d{4})/) || [])[1] || '';
        const isbn = dc('identifier').find(e => /isbn/i.test(e.getAttribute('opf:scheme') || ''));
        return {
            titulo: uno('title').trim(), autor: autores.join('; '), editorial: uno('publisher').trim(),
            anio: +anio > 1000 ? anio : '', // Calibre pone 0101 cuando no sabe el año
            isbn: isbn ? isbn.textContent.trim() : '', idioma: uno('language').trim()
        };
    },

    /** Párrafos de un capítulo EPUB, sin notas al pie ni llamadas numéricas. */
    parrafos(doc) {
        const cuerpo = doc.body || doc.documentElement;
        if (!cuerpo) return [];
        cuerpo.querySelectorAll('script,style,aside').forEach(e => e.remove());
        cuerpo.querySelectorAll('*').forEach(e => {
            const tipo = e.getAttribute('epub:type') || e.getAttribute('role') || '';
            if (/note|footnote|endnote/i.test(tipo)) e.remove();
        });
        cuerpo.querySelectorAll('sup').forEach(e => { if (/^[\s\d*†‡,\[\]()]+$/.test(e.textContent)) e.remove(); });

        const sel = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,dt,dd,td';
        const bloques = [...cuerpo.querySelectorAll(sel)].filter(e => !e.querySelector(sel));
        const textos = (bloques.length ? bloques.map(e => e.textContent) : [cuerpo.textContent]);
        return textos.map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    },

    // ---------------------------------------------------------------- TXT
    async txt(archivo) {
        const buf = await archivo.arrayBuffer();
        let texto = new TextDecoder('utf-8').decode(buf);
        if ((texto.match(/�/g) || []).length > 5) texto = new TextDecoder('windows-1252').decode(buf);
        texto = texto.replace(/\r\n?/g, '\n');

        const unidades = [];
        let paginado = false;
        if (texto.includes('\f')) {
            // Texto exportado de PDF: el salto de página \f separa páginas
            paginado = true;
            texto.split('\f').forEach((pag, i) => {
                const ls = pag.split('\n').map(s => s.trim()).filter(Boolean);
                unidades.push({ fisica: i + 1, etiqueta: null, lineas: ls.map((t, j) => ({ t, borde: j < 2 || j >= ls.length - 2 })) });
            });
        } else {
            const parrafos = texto.split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
            for (let i = 0; i < parrafos.length; i += 50) {
                unidades.push({ fisica: null, etiqueta: null, lineas: parrafos.slice(i, i + 50).map(t => ({ t, borde: false })) });
            }
        }

        const capitulos = [];
        unidades.forEach((u, i) => {
            const l = u.lineas.find(l => l.t.length < 80 && /^(cap[ií]tulo|chapter|parte|libro)\b/i.test(l.t));
            if (l) capitulos.push({ titulo: l.t, unidad: i });
        });
        return { formato: 'txt', paginado, meta: {}, unidades, capitulos };
    }
};
