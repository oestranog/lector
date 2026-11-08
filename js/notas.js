/**
 * notas.js — Ficha bibliográfica, citas (APA 7) y el archivo de notas.
 * Un solo .txt por libro: ficha arriba y todos los fragmentos debajo, con fecha y hora.
 */
const Notas = {

    /** «Apellido, Nombre; Apellido2, Nombre2» → «Apellido, N., & Apellido2, N.» */
    autoresAPA(autor) {
        const lista = (autor || '').split(';').map(s => s.trim()).filter(Boolean).map(a => {
            const [ap, nom] = a.includes(',') ? a.split(',').map(s => s.trim()) : [a, ''];
            const ini = nom.split(/[\s-]+/).filter(Boolean).map(n => n[0].toUpperCase() + '.').join(' ');
            return ini ? `${ap}, ${ini}` : ap;
        });
        if (lista.length <= 1) return lista[0] || '';
        return lista.slice(0, -1).join(', ') + ', & ' + lista[lista.length - 1];
    },

    apellidos(autor) {
        const ap = (autor || '').split(';').map(s => s.split(',')[0].trim()).filter(Boolean);
        if (ap.length === 0) return 'Anónimo';
        if (ap.length === 1) return ap[0];
        if (ap.length === 2) return `${ap[0]} y ${ap[1]}`;
        return `${ap[0]} et al.`;
    },

    /** Ficha en formato APA 7 (sin cursiva, porque va a un .txt). */
    citaAPA(m) {
        const partes = [];
        partes.push(this.autoresAPA(m.autor) || m.titulo);
        partes.push(`(${m.anio || 's. f.'}).`);
        let tit = m.titulo + (m.subtitulo ? ': ' + m.subtitulo : '');
        if (m.edicion) tit += ` (${m.edicion} ed.)`;
        if (m.autor) partes.push(tit + '.');
        if (m.editorial) partes.push(m.editorial + '.');
        if (m.doi) partes.push(m.doi);
        return partes.join(' ').replace(/\.\./g, '.');
    },

    rangoPaginas(a, b) {
        if (!a) return '';
        return a === b || !b ? `p. ${a}` : `pp. ${a}–${b}`;
    },

    citaTexto(m, nota) {
        const pag = this.rangoPaginas(nota.pagIni, nota.pagFin);
        return `(${this.apellidos(m.autor)}, ${m.anio || 's. f.'}${pag ? ', ' + pag : ''})`;
    },

    fecha(ms) {
        const d = new Date(ms), z = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
    },

    nombreArchivo(libro) {
        const t = (libro.meta.titulo || libro.archivo).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 60);
        return `${t}_notas.txt`;
    },

    texto(libro, notas) {
        const m = libro.meta, linea = '='.repeat(60);
        const fila = (k, v) => v ? `${k.padEnd(11)}${v}\n` : '';
        let s = `NOTAS DE LECTURA\n${linea}\n`;
        s += fila('Título:', m.titulo + (m.subtitulo ? ': ' + m.subtitulo : ''));
        s += fila('Autor:', m.autor);
        s += fila('Año:', m.anio);
        s += fila('Edición:', m.edicion);
        s += fila('Editorial:', m.editorial);
        s += fila('Ciudad:', m.ciudad);
        s += fila('ISBN:', m.isbn);
        s += fila('DOI/URL:', m.doi);
        s += fila('Archivo:', libro.archivo);
        s += fila('Ubicación:', m.ubicacion);
        s += `\nReferencia (APA 7):\n${this.citaAPA(m)}\n${linea}\n`;
        s += `${notas.length} nota(s) · actualizado ${this.fecha(Date.now())}\n${linea}\n\n`;
        for (const n of [...notas].sort((a, b) => a.n - b.n)) {
            const pag = this.rangoPaginas(n.pagIni, n.pagFin);
            s += `[${String(n.n).padStart(3, '0')}] ${this.fecha(n.creada)}${pag ? ' · ' + pag : ''} · ${n.parteTitulo}\n`;
            s += `«${n.texto}»\n`;
            s += `Cita: ${this.citaTexto(m, n)}\n`;
            s += '-'.repeat(60) + '\n\n';
        }
        return s;
    },

    // ------------------------------------------------------------- guardar
    /**
     * Escribe el .txt del libro en la carpeta del libro.
     * modo 'silencioso': solo si ya hay permiso (no pregunta nada)
     * modo 'nota':       tras crear una nota; puede pedir permiso o la carpeta, nunca descarga
     * modo 'manual':     botón «Guardar .txt»; si no hay carpeta posible, comparte o descarga
     * Devuelve dónde quedó, o null.
     */
    async guardar(libro, notas, modo = 'manual') {
        const nombre = this.nombreArchivo(libro);
        const contenido = this.texto(libro, notas);

        // App Android (Capacitor): Documentos/Lector/
        const fs = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Filesystem;
        if (fs) {
            await fs.writeFile({ path: 'Lector/' + nombre, data: contenido, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
            return 'Documentos/Lector/' + nombre;
        }

        // PC (Chrome / Edge): la carpeta donde está el libro
        if ('showDirectoryPicker' in window) {
            if (!libro.carpeta && modo !== 'silencioso') await this.elegirCarpeta(libro).catch(() => null);
            const carpeta = libro.carpeta;
            if (carpeta) {
                let permiso = await carpeta.queryPermission({ mode: 'readwrite' });
                if (permiso !== 'granted' && modo !== 'silencioso') permiso = await carpeta.requestPermission({ mode: 'readwrite' });
                if (permiso === 'granted') {
                    const h = await carpeta.getFileHandle(nombre, { create: true });
                    const w = await h.createWritable();
                    await w.write(contenido);
                    await w.close();
                    return carpeta.name + '\\' + nombre;
                }
            }
        }
        if (modo !== 'manual') return null;

        // Teléfono o navegador sin carpeta: compartir (Drive, Keep, correo…) o descargar
        const archivo = new File([contenido], nombre, { type: 'text/plain' });
        if (navigator.canShare && navigator.canShare({ files: [archivo] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
            try { await navigator.share({ files: [archivo], title: nombre }); return 'compartido'; }
            catch (e) { if (e.name === 'AbortError') return null; }
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(archivo);
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        return 'Descargas/' + nombre;
    },

    /** Para libros cargados sin carpeta: se pide una vez la carpeta donde está el libro. */
    async elegirCarpeta(libro) {
        if (window.aviso) aviso(`Elige la carpeta donde está «${libro.archivo}»: ahí se guardarán sus notas.`, 6000);
        libro.carpeta = await window.showDirectoryPicker({ id: 'lector-libros', mode: 'readwrite' });
        await DB.put('libros', libro);
        return libro.carpeta.name;
    }
};
