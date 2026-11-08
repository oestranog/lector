/**
 * importar.js — Del «bruto» del parser al libro guardado:
 *   1. detectar patrones de encabezado / pie (los números se agrupan: «45», «46»… = un solo patrón)
 *   2. aplicar el filtro elegido y deducir el número de página impreso
 *   3. fraccionar en partes y armar el registro del libro
 */
const Importar = {

    /** Normaliza una línea: sin acentos, minúsculas y cualquier número → «#». */
    patron(t) {
        const s = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
        if (/^[ivxlcdm]+\.?$/.test(s)) return '#';
        return s.replace(/\d+/g, '#');
    },

    /** Lista corta de patrones que se repiten en los bordes de las páginas. */
    detectar(bruto) {
        if (!bruto.unidades.some(u => u.lineas.some(l => l.borde))) return [];
        const conteo = new Map();
        bruto.unidades.forEach((u, i) => {
            const vistos = new Set();
            for (const l of u.lineas) {
                if (!l.borde) continue;
                const p = this.patron(l.t);
                if (!p || p.length > 150 || vistos.has(p)) continue;
                vistos.add(p);
                const e = conteo.get(p) || { patron: p, paginas: 0, ejemplos: [], muestras: [], primera: i };
                e.paginas++;
                e.ultima = i;
                if (e.ejemplos.length < 3 && !e.ejemplos.includes(l.t)) e.ejemplos.push(l.t);
                if (e.muestras.length < 8) e.muestras.push({ t: l.t, u: i, pag: u.etiqueta || u.fisica || 'secc. ' + (i + 1) });
                conteo.set(p, e);
            }
        });
        // Se premarca lo que es corto y aparece con regularidad en su tramo
        // (cada página o cada dos, como un encabezado). Un «Capítulo #» suelto
        // cada 20 páginas es contenido y queda sin marcar.
        const regular = e => e.paginas >= 3 && e.paginas / (e.ultima - e.primera + 1) >= 0.35 && e.ejemplos[0].length <= 90;
        return [...conteo.values()]
            .filter(e => e.paginas >= 2)
            .sort((a, b) => b.paginas - a.paginas)
            .slice(0, 15)
            .map(e => ({
                ...e,
                // En un EPUB normal nada va premarcado: el primer párrafo suele ser el título
                // del capítulo. Sí en los convertidos de PDF (una página por archivo).
                marcado: (bruto.paginado || bruto.comoPaginas) && ((e.patron === '#' && e.paginas >= 2) || regular(e)),
                descripcion: e.patron === '#' ? 'Números de página (1, 2, 3…)'
                    : e.patron.includes('#') ? `«${e.ejemplos[0]}» (con números que cambian)` : `«${e.ejemplos[0]}»`
            }));
    },

    /**
     * Texto propio a quitar → expresión regular: sin distinguir mayúsculas,
     * cualquier número vale por cualquier número y los espacios son flexibles.
     */
    regexTexto(s) {
        s = (s || '').trim();
        if (!s) return null;
        const r = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\d+/g, '\\d+').replace(/\s+/g, '\\s*');
        return new RegExp(r, 'gi');
    },

    /** Quita de una línea los textos propios; devuelve lo que queda. */
    limpiar(t, regs) {
        for (const r of regs) t = t.replace(r, ' ');
        return t.replace(/\s+/g, ' ').trim();
    },

    /** Propuesta de partes: capítulos si los hay, si no cada N páginas / palabras. */
    sugerencia(bruto) {
        const caps = bruto.capitulos.length;
        return {
            modo: caps >= 2 ? 'capitulos' : 'tamano',
            n: bruto.paginado ? 20 : 8000,
            unidad: bruto.paginado ? 'páginas' : 'palabras',
            capitulos: caps
        };
    },

    /** Construye { libro, partes } listo para DB.guardarLibro. */
    construir(bruto, archivo, filtros, particion, meta, textos = []) {
        const quitar = new Set(filtros);
        const regs = textos.map(t => this.regexTexto(t)).filter(Boolean);
        const unidades = bruto.unidades;

        // 1. Filtrar y recoger el número impreso cuando el pie/encabezado era solo un número;
        //    después, quitar los textos propios donde aparezcan
        const lineasPorUnidad = unidades.map(u => {
            let impresa = null;
            const ls = u.lineas.filter(l => {
                if (!l.borde || !quitar.has(this.patron(l.t))) return true;
                if (/^\d{1,4}$/.test(l.t.trim())) impresa = parseInt(l.t, 10);
                return false;
            });
            u.impresa = impresa;
            return ls.map(l => regs.length ? this.limpiar(l.t, regs) : l.t).filter(Boolean);
        });

        // 2. Etiqueta de cada página: impresa (propagando el desfase) > etiqueta del PDF > física
        if (bruto.paginado) {
            let desfase = null;
            const desfases = unidades.map(u => u.impresa != null ? (desfase = u.impresa - u.fisica) : desfase);
            let siguiente = null;
            for (let i = unidades.length - 1; i >= 0; i--) {
                if (unidades[i].impresa != null) siguiente = unidades[i].impresa - unidades[i].fisica;
                if (desfases[i] == null) desfases[i] = siguiente;
            }
            unidades.forEach((u, i) => {
                u.pagina = desfases[i] != null ? String(u.fisica + desfases[i])
                    : (u.etiqueta || String(u.fisica));
            });
        }

        // 3. Dónde empieza cada parte
        const cortes = new Map(); // índice de unidad → título
        if (particion.modo === 'capitulos' && bruto.capitulos.length) {
            if (bruto.capitulos[0].unidad > 0) cortes.set(0, 'Inicio');
            bruto.capitulos.forEach(c => { if (!cortes.has(c.unidad)) cortes.set(c.unidad, c.titulo); });
        } else if (bruto.paginado) {
            for (let i = 0; i < unidades.length; i += particion.n) cortes.set(i, null);
        }
        if (!cortes.has(0)) cortes.set(0, null);

        // 4. Recorrer el texto, uniendo palabras cortadas con guion al final de línea
        const partes = [];
        let actual = null, pendiente = null;
        const cerrar = () => {
            if (actual && actual.palabras.length) partes.push(actual);
            actual = null;
        };
        const abrir = titulo => { cerrar(); actual = { titulo, palabras: [], paginas: [] }; };

        unidades.forEach((u, i) => {
            if (cortes.has(i)) abrir(cortes.get(i));
            if (bruto.paginado) actual.paginas.push([actual.palabras.length, u.pagina]);
            for (const linea of lineasPorUnidad[i]) {
                const ws = linea.replace(/\.([A-ZÁÉÍÓÚÑ¿¡«“"])/g, '. $1').split(/\s+/).filter(Boolean);
                if (!ws.length) continue;
                if (pendiente) {
                    if (/^[a-záéíóúñü]/.test(ws[0])) ws[0] = pendiente + ws[0];
                    else ws.unshift(pendiente + '-');
                    pendiente = null;
                }
                const ult = ws[ws.length - 1];
                if (/[a-záéíóúñü]-$/i.test(ult) && ult.length > 2) pendiente = ws.pop().slice(0, -1);
                for (const w of ws) actual.palabras.push(w);
                // Sin páginas: cortar por número de palabras
                if (!bruto.paginado && particion.modo === 'tamano' && actual.palabras.length >= particion.n) abrir(null);
            }
        });
        if (pendiente) actual.palabras.push(pendiente);
        cerrar();

        // 5. Títulos y registro
        const resumen = partes.map((p, k) => {
            const pi = p.paginas.length ? p.paginas[0][1] : null;
            const pf = p.paginas.length ? p.paginas[p.paginas.length - 1][1] : null;
            const titulo = p.titulo || (pi ? `Págs. ${pi}–${pf}` : `Parte ${k + 1}`);
            return { titulo, palabras: p.palabras.length, pagIni: pi, pagFin: pf };
        });
        const id = `${archivo.name}|${archivo.size}`;
        const libro = {
            id, archivo: archivo.name, formato: bruto.formato, paginado: bruto.paginado,
            meta, filtros: [...quitar], textos: [...textos], particion,
            partes: resumen,
            totalPalabras: resumen.reduce((s, p) => s + p.palabras, 0),
            progreso: { parte: 0, pos: 0 },
            creado: Date.now(), abierto: Date.now()
        };
        const registros = partes.map((p, n) => ({ libro: id, n, texto: p.palabras.join(' '), paginas: p.paginas }));
        return { libro, partes: registros };
    }
};
