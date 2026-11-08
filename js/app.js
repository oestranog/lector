/**
 * app.js — Interfaz: biblioteca, importación, lectura, subrayados y ajustes.
 */
const $ = id => document.getElementById(id);

const estado = {
    libro: null,      // registro del libro abierto
    n: 0,             // parte abierta
    parte: null,      // registro de la parte abierta
    notas: [],        // notas del libro abierto
    marca: null,      // «desde aquí» pendiente: { parte, ini, fin, pag }
    prefs: { wpm: 300, golpe: 3, letra: 40, voz: true, vozNombre: '', velocidad: 1, tema: 'oscuro' }
};
const lector = new Lector($('pantalla'));

// =================================================================== utilidades
function aviso(texto, ms = 2600) {
    const t = $('toast');
    t.textContent = texto;
    t.classList.add('ver');
    clearTimeout(aviso.reloj);
    aviso.reloj = setTimeout(() => t.classList.remove('ver'), ms);
}

function dialogo(d) {
    return new Promise(ok => {
        d.addEventListener('close', () => ok(d.returnValue), { once: true });
        d.returnValue = '';
        d.showModal();
    });
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cmp = (a, b) => (a.parte - b.parte) || (a.pos - b.pos);

function cargando(texto, valor = 0, max = 1) {
    $('cargando').hidden = texto == null;
    if (texto != null) { $('cargando-t').textContent = texto; $('cargando-p').max = max; $('cargando-p').value = valor; }
}

function paginaDe(parte, w) {
    if (!parte || !parte.paginas || !parte.paginas.length) return null;
    let pag = parte.paginas[0][1];
    for (const [i, p] of parte.paginas) { if (i <= w) pag = p; else break; }
    return pag;
}

// =================================================================== preferencias
async function cargarPrefs() {
    const p = await DB.get('ajustes', 'prefs').catch(() => null);
    if (p) Object.assign(estado.prefs, p);
    aplicarPrefs();
}

function aplicarPrefs() {
    const p = estado.prefs;
    document.body.dataset.tema = p.tema;
    document.documentElement.style.setProperty('--letra', p.letra + 'px');
    Object.assign(lector.prefs, { wpm: p.wpm, golpe: p.golpe, voz: p.voz, velocidad: p.velocidad, vozNombre: p.vozNombre });
    $('b-voz').classList.toggle('on', p.voz);
    $('b-voz').textContent = p.voz ? '🔊 Voz' : '🔇 Sin voz';
}

function guardarPrefs() { DB.put('ajustes', estado.prefs, 'prefs').catch(() => {}); }

// =================================================================== biblioteca
async function verBiblioteca() {
    lector.pausar();
    $('v-lector').classList.remove('activa');
    $('v-biblioteca').classList.add('activa');
    const libros = (await DB.todos('libros')).sort((a, b) => b.abierto - a.abierto);
    const notas = await DB.todos('notas');
    $('vacio').hidden = libros.length > 0;
    $('lista-libros').innerHTML = libros.map(l => {
        const leidas = l.partes.slice(0, l.progreso.parte).reduce((s, p) => s + p.palabras, 0) + l.progreso.pos;
        const pct = l.totalPalabras ? Math.round(100 * leidas / l.totalPalabras) : 0;
        const nn = notas.filter(n => n.libro === l.id).length;
        return `<article class="libro" data-id="${esc(l.id)}" title="Abrir">
            <div class="cabeza">
                <span class="formato f-${esc(l.formato)}">${esc(l.formato.toUpperCase())}</span>
                <div class="nombre">
                    <h3>${esc(l.meta.titulo)}</h3>
                    <div class="autor">${esc(l.meta.autor || 'Autor sin indicar')}${l.meta.anio ? ' · ' + esc(l.meta.anio) : ''}</div>
                </div>
                <button data-a="borrar" class="borrar" title="Borrar este libro de la app">🗑</button>
            </div>
            <div class="avance"><i style="width:${pct}%"></i></div>
            <div class="datos">${pct}% leído · ${l.partes.length} partes · ${nn} subrayado(s)</div>
            <div class="datos donde">${dondeEsta(l)}</div>
            <div class="acciones">
                <button data-a="leer" class="primario">▶ Leer</button>
                <button data-a="ficha">Ficha</button>
                <button data-a="filtros" title="Ver y cambiar lo que se quita del texto">Filtros${(l.filtros || []).length + (l.textos || []).length ? ' (' + ((l.filtros || []).length + (l.textos || []).length) + ')' : ''}</button>
                <button data-a="txt">Notas .txt</button>
            </div></article>`;
    }).join('');
}

$('lista-libros').addEventListener('click', async e => {
    const tarjeta = e.target.closest('.libro');
    if (!tarjeta) return;
    const id = tarjeta.dataset.id;
    const b = e.target.closest('button');
    if (!b) { abrirLibro(id); return; }     // tocar la tarjeta abre el libro
    const libro = await DB.get('libros', id);
    if (b.dataset.a === 'leer') abrirLibro(id);
    if (b.dataset.a === 'ficha') { if (await editarFicha(libro)) verBiblioteca(); }
    if (b.dataset.a === 'txt') exportarNotas(libro);
    if (b.dataset.a === 'filtros') reprocesar(libro);
    if (b.dataset.a === 'borrar' && confirm(`¿Borrar «${libro.meta.titulo}» y sus subrayados de esta app?\n(El archivo original y los .txt ya guardados no se tocan.)`)) {
        await DB.borrarLibro(id);
        verBiblioteca();
    }
});

// =================================================================== importar
$('archivo').addEventListener('change', async e => {
    const archivo = e.target.files[0];
    e.target.value = '';
    if (archivo) importar(archivo);
});

// En PC (Chrome / Edge) se elige la CARPETA del libro: así las notas se guardan junto a él
const conCarpetas = 'showDirectoryPicker' in window && !window.Capacitor;
document.querySelector('.fab').addEventListener('click', async e => {
    if (!conCarpetas) return; // teléfono: selector de archivo normal
    e.preventDefault();
    let carpeta;
    try { carpeta = await showDirectoryPicker({ id: 'lector-libros', mode: 'readwrite' }); }
    catch (err) { return; }
    // También en subcarpetas (Calibre guarda cada libro en «Autor/Título (n)/»)
    const libros = [];
    const buscar = async (dir, ruta, nivel) => {
        for await (const h of dir.values()) {
            if (libros.length >= 300) return;
            if (h.kind === 'file' && /\.(pdf|epub|txt)$/i.test(h.name) && !/_notas\.txt$/i.test(h.name)) libros.push({ h, dir, ruta });
            else if (h.kind === 'directory' && nivel < 2) await buscar(h, ruta + h.name + '\\', nivel + 1);
        }
    };
    cargando('Buscando libros en «' + carpeta.name + '»…');
    try { await buscar(carpeta, '', 0); } finally { cargando(null); }
    if (!libros.length) return aviso(`No hay PDF, EPUB ni TXT en «${carpeta.name}» ni en sus subcarpetas.`, 5000);
    libros.sort((a, b) => (a.ruta + a.h.name).localeCompare(b.ruta + b.h.name, 'es'));
    let elegido = libros[0];
    if (libros.length > 1) {
        $('el-carpeta').textContent = carpeta.name;
        $('el-lista').innerHTML = libros.map((l, i) =>
            `<button value="${i}">${l.ruta ? `<small>${esc(l.ruta)}</small><br>` : ''}${esc(l.h.name)}</button>`).join('');
        const r = await dialogo($('d-elegir'));
        if (!/^\d+$/.test(r)) return;
        elegido = libros[+r];
    }
    // La carpeta del libro es la suya propia (ahí van sus notas), no la que se eligió arriba
    importar(await elegido.h.getFile(), elegido.dir);
});

// Android no siempre reconoce el tipo EPUB y lo deja en gris en el selector: ahí se acepta cualquier archivo
if (/Android/i.test(navigator.userAgent)) $('archivo').removeAttribute('accept');

/** Cambiar filtros de un libro ya cargado: se vuelve a leer el original (desde su carpeta si la hay). */
async function reprocesar(libro) {
    if (libro.carpeta) {
        try {
            let p = await libro.carpeta.queryPermission({ mode: 'readwrite' });
            if (p !== 'granted') p = await libro.carpeta.requestPermission({ mode: 'readwrite' });
            if (p === 'granted') {
                const h = await libro.carpeta.getFileHandle(libro.archivo);
                return importar(await h.getFile(), libro.carpeta);
            }
        } catch (err) { console.warn(err); }
    }
    // Sin carpeta (teléfono) o el archivo se movió: elegirlo de nuevo
    aviso(`Para cambiar los filtros elige otra vez «${libro.archivo}».`, 5000);
    if (conCarpetas) document.querySelector('.fab').click();
    else $('archivo').click();
}

async function importar(archivo, carpeta = null) {
    let bruto;
    try {
        cargando('Leyendo ' + archivo.name + '…');
        bruto = await Parser.leer(archivo, (i, n) => cargando(`Leyendo ${i} de ${n}…`, i, n));
    } catch (err) {
        cargando(null);
        console.error(err);
        return aviso('No pude leer el archivo: ' + err.message, 5000);
    }
    cargando(null);

    // Si el libro está en una carpeta de Calibre, su metadata.opf trae título y autor revisados
    if (carpeta) {
        try {
            const opf = await (await (await carpeta.getFileHandle('metadata.opf')).getFile()).text();
            const cal = Parser.metaCalibre(opf);
            for (const k in cal) if (cal[k]) bruto.meta[k] = cal[k];
        } catch { /* no es una carpeta de Calibre */ }
    }

    const total = bruto.unidades.reduce((s, u) => s + u.lineas.reduce((a, l) => a + l.t.split(' ').length, 0), 0);
    if (total < 5) return aviso('El archivo no tiene texto seleccionable (¿es un PDF escaneado?).', 6000);

    const id = `${archivo.name}|${archivo.size}`;
    const previo = await DB.get('libros', id);
    const meta = previo ? previo.meta : metaInicial(bruto.meta);

    // --- llenar el diálogo
    $('i-resumen').textContent = `${archivo.name} · ${bruto.paginado ? bruto.unidades.length + ' páginas · ' : ''}~${total.toLocaleString()} palabras`;
    camposFicha($('i-ficha'), meta);

    const candidatos = Importar.detectar(bruto);
    const textos = previo && previo.textos ? [...previo.textos] : [];
    const previa = prepararFiltros(bruto, candidatos, textos, previo);

    const sug = Importar.sugerencia(bruto);
    $('i-op-cap').hidden = sug.capitulos < 2;
    $('i-ncap').textContent = sug.capitulos + ' encontrados';
    $('i-unidad').textContent = sug.unidad;
    $('i-n').value = sug.n;
    document.querySelector(`#d-importar input[name=modo][value=${sug.modo}]`).checked = true;

    const r = await dialogo($('d-importar'));
    previa.soltar();
    if (r !== 'ok') return;

    const filtros = previa.patrones();
    const modo = document.querySelector('#d-importar input[name=modo]:checked').value;
    const particion = { modo, n: Math.max(1, parseInt($('i-n').value, 10) || sug.n) };
    const metaFinal = leerFicha($('i-ficha'));

    cargando('Filtrando y dividiendo en partes…');
    await new Promise(r => setTimeout(r, 30));
    try {
        const { libro, partes } = Importar.construir(bruto, archivo, filtros, particion, metaFinal, textos);
        if (previo) libro.creado = previo.creado;
        libro.carpeta = carpeta || (previo && previo.carpeta) || null;
        await DB.guardarLibro(libro, partes);
        cargando(null);
        aviso(`Guardado en ${partes.length} parte(s).`);
        if (previo && (await DB.notasDe(id)).length) aviso('Libro reprocesado. Sus subrayados se conservan; si cambiaste filtros, revisa que «Ir» lleve al sitio correcto.', 6000);
        abrirLibro(libro.id);
    } catch (err) {
        cargando(null);
        console.error(err);
        aviso('Error al guardar: ' + err.message, 6000);
    }
}

/**
 * Bloque «Lo que se quita» del diálogo de importar: candidatos con sus ejemplos,
 * textos propios y vista previa de una página con lo que se quita tachado.
 * `textos` se modifica en el sitio. Devuelve { patrones(), soltar() }.
 */
function prepararFiltros(bruto, candidatos, textos, previo) {
    const unidades = bruto.unidades, nU = unidades.length;
    const marcadoInicial = c => previo && previo.filtros ? previo.filtros.includes(c.patron) : c.marcado;

    $('i-bloque-filtro').hidden = !candidatos.length;
    const ud = bruto.paginado ? 'págs.' : 'secc.';
    $('i-filtros').innerHTML = candidatos.map((c, k) => {
        const pi = unidades[c.primera].etiqueta || unidades[c.primera].fisica || c.primera + 1;
        const pf = unidades[c.ultima].etiqueta || unidades[c.ultima].fisica || c.ultima + 1;
        return `<div class="cand">
            <label><input type="checkbox" data-k="${k}" ${marcadoInicial(c) ? 'checked' : ''}> ${esc(c.descripcion)}
                <small>${c.paginas} ${ud} · ${esc(pi)}–${esc(pf)}</small></label>
            <details><summary>ver</summary><ul>${c.muestras.map(m =>
                `<li data-u="${m.u}" title="Verla en la vista previa">${bruto.paginado ? 'p. ' : ''}${esc(m.pag)}: «${esc(m.t)}»</li>`).join('')}</ul></details>
        </div>`;
    }).join('');

    const patrones = () => [...$('i-filtros').querySelectorAll('input:checked')].map(i => candidatos[i.dataset.k].patron);

    // ---- vista previa
    $('i-pag-et').textContent = bruto.paginado ? 'Página' : 'Sección';
    $('i-npag').textContent = nU;
    $('i-pag').max = nU;
    let u = Math.min(nU - 1, Math.floor(nU * 0.3));
    let lineasVistas = [];

    /** Marca en `t` los trozos que quitan los textos propios. */
    const marcar = (t, regs) => {
        const tramos = [];
        for (const r of regs) for (const m of t.matchAll(r)) if (m[0]) tramos.push([m.index, m.index + m[0].length]);
        if (!tramos.length) return esc(t);
        tramos.sort((a, b) => a[0] - b[0]);
        let h = '', i = 0;
        for (const [a, b] of tramos) {
            if (b <= i) continue;
            h += esc(t.slice(i, Math.max(a, i))) + `<s class="quita">${esc(t.slice(Math.max(a, i), b))}</s>`;
            i = b;
        }
        return h + esc(t.slice(i));
    };

    const pintar = () => {
        u = Math.max(0, Math.min(nU - 1, u));
        $('i-pag').value = u + 1;
        const pats = new Set(patrones());
        const regs = textos.map(t => Importar.regexTexto(t)).filter(Boolean);
        lineasVistas = unidades[u].lineas.slice(0, 120);
        $('i-previa').innerHTML = lineasVistas.map((l, j) => {
            const fuera = l.borde && pats.has(Importar.patron(l.t));
            const cl = 'ln' + (l.borde ? ' borde' : '') + (fuera ? ' fuera quita' : '');
            return `<div class="${cl}" data-j="${j}">${fuera ? esc(l.t) : marcar(l.t, regs)}</div>`;
        }).join('') + (unidades[u].lineas.length > 120 ? '<div class="ayuda">…</div>' : '')
            || '<div class="ayuda">(página sin texto)</div>';
        $('i-textos').innerHTML = textos.map((t, k) =>
            `<li title="${esc(t)}"><span>${esc(t)}</span><button type="button" data-k="${k}" title="Dejar de quitar">×</button></li>`).join('');
    };

    const agregar = t => {
        t = (t || '').trim();
        if (!t) return;
        if (!textos.some(x => x.toLowerCase() === t.toLowerCase())) textos.push(t);
        pintar();
    };

    // ---- eventos (se quitan al cerrar el diálogo)
    const d = $('d-importar');
    const alClic = e => {
        const ej = e.target.closest('.cand li');
        if (ej) { u = +ej.dataset.u; pintar(); $('i-previa').scrollIntoView({ block: 'nearest' }); return; }
        const ln = e.target.closest('#i-previa .ln');
        if (ln && !ln.classList.contains('fuera')) {
            const t = lineasVistas[+ln.dataset.j].t;
            if (confirm(`¿Quitar este texto en todo el libro?\n\n«${t}»`)) agregar(t);
            return;
        }
        const x = e.target.closest('#i-textos button');
        if (x) { textos.splice(+x.dataset.k, 1); pintar(); return; }
        if (e.target.id === 'i-agregar') { agregar($('i-texto').value); $('i-texto').value = ''; }
        if (e.target.id === 'i-ant') { u--; pintar(); }
        if (e.target.id === 'i-sig') { u++; pintar(); }
    };
    const alCambiar = e => {
        if (e.target.closest('#i-filtros')) pintar();
        if (e.target.id === 'i-pag') { u = (parseInt(e.target.value, 10) || 1) - 1; pintar(); }
    };
    // Enter en un campo no debe cerrar el diálogo
    const alTecla = e => {
        if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
        e.preventDefault();
        if (e.target.id === 'i-texto') { agregar(e.target.value); e.target.value = ''; }
        if (e.target.id === 'i-pag') alCambiar(e);
    };
    d.addEventListener('click', alClic);
    d.addEventListener('change', alCambiar);
    d.addEventListener('keydown', alTecla);
    pintar();

    return {
        patrones,
        soltar() {
            d.removeEventListener('click', alClic);
            d.removeEventListener('change', alCambiar);
            d.removeEventListener('keydown', alTecla);
        }
    };
}

// =================================================================== ficha
const CAMPOS = [
    ['autor', 'Autor(es)', 'Apellido, Nombre; Apellido2, Nombre2'],
    ['titulo', 'Título', ''], ['subtitulo', 'Subtítulo', ''],
    ['anio', 'Año', ''], ['edicion', 'Edición', 'p. ej. 2.ª'],
    ['editorial', 'Editorial', ''], ['ciudad', 'Ciudad', ''],
    ['isbn', 'ISBN', ''], ['doi', 'DOI o URL', ''],
    ['ubicacion', 'Ubicación en el PC (referencia)', 'p. ej. D:\\Libros\\Rojas\\La Celestina.epub']
];

/** Dónde está el libro: la carpeta vinculada (el navegador solo da su nombre) o la ruta anotada. */
function dondeEsta(l) {
    const partes = [];
    if (l.carpeta) partes.push(`📁 ${esc(l.carpeta.name)}\\${esc(l.archivo)}`);
    else partes.push(`📄 ${esc(l.archivo)} · sin carpeta vinculada`);
    if (l.meta.ubicacion) partes.push(esc(l.meta.ubicacion));
    return partes.join(' · ');
}

/** «Gabriel García Márquez» → «García Márquez, Gabriel» (se puede corregir a mano). */
function invertirAutor(a) {
    return (a || '').split(/;|&| y | and /).map(s => s.trim()).filter(Boolean).map(s => {
        if (s.includes(',')) return s;
        const t = s.split(/\s+/);
        if (t.length < 2) return s;
        const corte = t.length >= 3 ? t.length - 2 : t.length - 1;
        return t.slice(corte).join(' ') + ', ' + t.slice(0, corte).join(' ');
    }).join('; ');
}

function metaInicial(m) {
    return { autor: invertirAutor(m.autor), titulo: m.titulo || '', subtitulo: '', anio: m.anio || '', edicion: '',
        editorial: m.editorial || '', ciudad: '', isbn: m.isbn || '', doi: '', idioma: m.idioma || 'es' };
}

function camposFicha(cont, meta) {
    cont.innerHTML = CAMPOS.map(([k, et, ph]) =>
        `<label class="campo">${et}<input data-k="${k}" value="${esc(meta[k])}" placeholder="${esc(ph)}"></label>`).join('');
    cont.dataset.idioma = meta.idioma || 'es';
}

function leerFicha(cont) {
    const m = { idioma: cont.dataset.idioma || 'es' };
    cont.querySelectorAll('input').forEach(i => m[i.dataset.k] = i.value.trim());
    return m;
}

async function editarFicha(libro) {
    const cont = $('f-campos');
    camposFicha(cont, libro.meta);
    $('f-carpeta').innerHTML = 'Archivo: ' + dondeEsta(libro);
    const previa = () => $('f-cita').textContent = Notas.citaAPA(leerFicha(cont));
    cont.oninput = previa;
    previa();
    if (await dialogo($('d-ficha')) !== 'ok') return false;
    libro.meta = leerFicha(cont);
    await DB.put('libros', libro);
    if (estado.libro && estado.libro.id === libro.id) { estado.libro = libro; $('l-titulo').textContent = libro.meta.titulo; }
    const notas = await DB.notasDe(libro.id);
    if (notas.length) await Notas.guardar(libro, notas, 'silencioso').catch(() => {});
    return true;
}

// =================================================================== lectura
async function abrirLibro(id) {
    const libro = await DB.get('libros', id);
    if (!libro) return;
    libro.abierto = Date.now();
    DB.put('libros', libro);
    estado.libro = libro;
    estado.notas = await DB.notasDe(id);
    estado.marca = null;
    actualizarMarca();
    lector.prefs.idioma = libro.meta.idioma || 'es';
    $('l-titulo').textContent = libro.meta.titulo;
    $('sel-parte').innerHTML = libro.partes.map((p, i) =>
        `<option value="${i}">${i + 1}/${libro.partes.length} · ${esc(p.titulo)}</option>`).join('');
    $('v-biblioteca').classList.remove('activa');
    $('v-lector').classList.add('activa');
    await cargarParte(libro.progreso.parte || 0, libro.progreso.pos || 0);
}

async function cargarParte(n, pos = 0, seguir = false) {
    const parte = await DB.get('partes', [estado.libro.id, n]);
    if (!parte) return aviso('No encuentro esa parte.');
    estado.n = n;
    estado.parte = parte;
    $('sel-parte').value = n;
    $('barra-pos').max = Math.max(0, lector.total - 1);
    lector.cargar(parte.texto, pos);
    $('barra-pos').max = Math.max(0, lector.total - 1);
    pintarLateral();
    pintarEstado(lector.vista.ini);
    pintarContexto();
    if (seguir) lector.reproducir();
}

/** Índice lateral (PC): todas las partes, con páginas, subrayados y avance. */
function pintarLateral() {
    const libro = estado.libro;
    $('lat-lista').innerHTML = libro.partes.map((p, i) => {
        const pags = p.pagIni ? (p.pagIni === p.pagFin ? `p. ${p.pagIni}` : `pp. ${p.pagIni}–${p.pagFin}`) : `${p.palabras.toLocaleString()} palabras`;
        const nn = estado.notas.filter(n => n.desde.parte <= i && n.hasta.parte >= i).length;
        const pct = i < estado.n ? 100 : 0;
        return `<li data-n="${i}"${i === estado.n ? ' class="actual"' : ''}>
            <b>${esc(p.titulo)}</b>
            <small>${pags}${nn ? ` · <span class="subr">${nn} subrayado(s)</span>` : ''}</small>
            <span class="avance"><i style="width:${pct}%"></i></span></li>`;
    }).join('');
    const actual = $('lat-lista').querySelector('.actual');
    if (actual) actual.scrollIntoView({ block: 'nearest' });

    const notas = [...estado.notas].sort((a, b) => cmp(a.desde, b.desde));
    $('b-notas-n').textContent = notas.length ? `(${notas.length})` : '';
    $('lat-notas').innerHTML = notas.length ? notas.map(n => {
        const pag = Notas.rangoPaginas(n.pagIni, n.pagFin);
        const txt = n.texto.length > 110 ? n.texto.slice(0, 110) + '…' : n.texto;
        return `<li data-id="${n.id}"><small>[${String(n.n).padStart(3, '0')}]${pag ? ' ' + pag : ''}</small><span>«${esc(txt)}»</span></li>`;
    }).join('') : '<li><small>Aún no hay. Selecciona texto en pausa o usa «⟦ Desde aquí».</small></li>';
}

$('lat-lista').addEventListener('click', e => {
    const li = e.target.closest('li');
    if (!li || +li.dataset.n === estado.n) return;
    const seguir = lector.activo;
    lector.pausar();
    cargarParte(+li.dataset.n, 0, seguir);
});

$('lat-notas').addEventListener('click', e => {
    const li = e.target.closest('li[data-id]');
    if (li) irANota(estado.notas.find(n => n.id === +li.dataset.id));
});

async function irANota(nota) {
    lector.pausar();
    if (nota.desde.parte !== estado.n) await cargarParte(nota.desde.parte, nota.desde.pos);
    else lector.ir(nota.desde.pos);
}

lector.onAvance = ini => {
    pintarEstado(ini);
    guardarProgreso();
    if (!lector.activo) pintarContexto();
};

lector.onEstado = activo => {
    $('b-play').textContent = activo ? '⏸' : '▶';
    document.body.classList.toggle('leyendo', activo);
    pintarContexto();
};

lector.onAviso = t => { aviso(t, 5000); estado.prefs.voz = false; aplicarPrefs(); };

lector.onFin = async () => {
    guardarProgreso(true);
    if (estado.n + 1 < estado.libro.partes.length) {
        aviso('Siguiente parte: ' + estado.libro.partes[estado.n + 1].titulo);
        await cargarParte(estado.n + 1, 0, true);
    } else aviso('Fin del libro.');
};

function pintarEstado(ini) {
    const libro = estado.libro;
    if (!libro) return;
    const pag = paginaDe(estado.parte, ini);
    const antes = libro.partes.slice(0, estado.n).reduce((s, p) => s + p.palabras, 0);
    const pctParte = lector.total ? Math.round(100 * ini / lector.total) : 0;
    const pctLibro = libro.totalPalabras ? Math.round(100 * (antes + ini) / libro.totalPalabras) : 0;
    const ritmo = estado.prefs.voz ? 160 * estado.prefs.velocidad : estado.prefs.wpm;
    const min = Math.round((libro.totalPalabras - antes - ini) / ritmo);
    $('e-pagina').textContent = pag ? 'p. ' + pag : `palabra ${ini + 1}`;
    $('e-parte').textContent = `parte ${pctParte}%`;
    $('e-libro').textContent = `libro ${pctLibro}%`;
    $('e-tiempo').textContent = min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
    $('barra-pos').value = ini;
    const barra = document.querySelector('#lat-lista li.actual .avance i');
    if (barra) barra.style.width = pctParte + '%';
}

/** En pausa: el texto alrededor, para ubicarse y tocar una palabra para ir ahí. */
function pintarContexto() {
    const c = $('contexto');
    if (lector.activo || !lector.total) { c.classList.remove('visible'); return; }
    const { ini, fin } = lector.vista;
    const desde = Math.max(0, ini - 110), hasta = Math.min(lector.total, fin + 150);
    const marcas = new Map((estado.parte.paginas || []).map(([w, p]) => [w, p]));
    const subr = estado.notas.filter(n => n.desde.parte <= estado.n && n.hasta.parte >= estado.n);
    const enNota = i => subr.some(n => cmp(n.desde, { parte: estado.n, pos: i }) <= 0 && cmp({ parte: estado.n, pos: i }, n.hasta) < 0);
    let html = '';
    for (let i = desde; i < hasta; i++) {
        if (marcas.has(i)) html += `<span class="pag">[p. ${esc(marcas.get(i))}]</span>`;
        const cl = [i >= ini && i < fin ? 'actual' : '', enNota(i) ? 'subrayado' : ''].join(' ').trim();
        html += `<span data-i="${i}"${cl ? ` class="${cl}"` : ''}>${esc(lector.palabras[i])}</span> `;
    }
    c.innerHTML = html;
    c.classList.add('visible');
    const actual = c.querySelector('.actual');
    if (actual) actual.scrollIntoView({ block: 'center' });
}

$('contexto').addEventListener('click', e => {
    if (!getSelection().isCollapsed) return; // está seleccionando, no saltando
    const i = e.target.dataset && e.target.dataset.i;
    if (i != null) lector.ir(+i);
});

// Seleccionar texto en pausa (ratón o dedo) → el botón pasa a «Subrayar selección».
// En el teléfono, tocar el botón borra la selección justo antes del clic:
// por eso se recuerda unos instantes.
document.addEventListener('selectionchange', () => {
    const sel = getSelection();
    const c = $('contexto');
    if (sel.isCollapsed || !sel.rangeCount || !c.contains(sel.anchorNode)) {
        if (estado.seleccion && !estado.seleccion.suelta) {
            estado.seleccion.suelta = Date.now();
            setTimeout(() => { if (estado.seleccion && estado.seleccion.suelta) { estado.seleccion = null; actualizarMarca(); } }, 1500);
        }
        return;
    }
    const rango = sel.getRangeAt(0);
    const ids = [...c.querySelectorAll('span[data-i]')].filter(s => rango.intersectsNode(s)).map(s => +s.dataset.i);
    estado.seleccion = ids.length ? { ini: ids[0], fin: ids[ids.length - 1] + 1, parte: estado.n } : null;
    actualizarMarca();
});

$('b-notas').onclick = () => { lector.pausar(); abrirIndice(); };

let relojProgreso;
function guardarProgreso(ya = false) {
    clearTimeout(relojProgreso);
    const hacer = () => {
        if (!estado.libro) return;
        estado.libro.progreso = { parte: estado.n, pos: lector.vista.ini };
        DB.put('libros', estado.libro).catch(() => {});
    };
    ya ? hacer() : (relojProgreso = setTimeout(hacer, 1500));
}

// --- mandos
$('b-play').onclick = () => lector.alternar();
$('pantalla').onclick = () => lector.alternar();
$('b-m50').onclick = () => lector.saltar(-50);
$('b-m10').onclick = () => lector.saltar(-10);
$('b-p10').onclick = () => lector.saltar(10);
$('b-p50').onclick = () => lector.saltar(50);
$('barra-pos').oninput = e => lector.ir(+e.target.value);
$('sel-parte').onchange = e => { lector.pausar(); cargarParte(+e.target.value, 0); };
$('b-volver').onclick = () => { guardarProgreso(true); verBiblioteca(); };
$('b-voz').onclick = () => {
    estado.prefs.voz = !estado.prefs.voz;
    const seguir = lector.activo;
    lector.pausar();
    aplicarPrefs();
    guardarPrefs();
    if (seguir) lector.reproducir();
};
document.addEventListener('keydown', e => {
    if (!$('v-lector').classList.contains('activa') || document.querySelector('dialog[open]')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); lector.alternar(); }
    if (e.code === 'ArrowLeft') lector.saltar(e.shiftKey ? -50 : -10);
    if (e.code === 'ArrowRight') lector.saltar(e.shiftKey ? 50 : 10);
    if (e.code === 'KeyN') $('b-nota').click();
});

// =================================================================== subrayado: desde aquí / hasta aquí
function actualizarMarca() {
    const m = estado.marca;
    $('aviso-nota').hidden = !m;
    const sel = !m && estado.seleccion;
    $('b-nota').classList.toggle('abierta', !!m);
    $('b-nota').classList.toggle('seleccion', !!sel);
    $('b-nota').textContent = m ? 'Hasta aquí ⟧' : sel ? '✎ Subrayar selección' : '⟦ Desde aquí';
    if (m) $('nota-desde').textContent = (m.pag ? 'p. ' + m.pag : 'parte ' + (m.parte + 1)) + ` «${lector.palabras[m.ini] || ''}…»`;
}

$('b-nota').onclick = async () => {
    const { ini, fin } = lector.vista;
    const sel = estado.seleccion;
    if (!estado.marca && sel && sel.parte === estado.n && (!sel.suelta || Date.now() - sel.suelta < 1500)) {
        estado.seleccion = null;
        getSelection().removeAllRanges();
        actualizarMarca();
        return crearNota({ parte: sel.parte, pos: sel.ini }, { parte: sel.parte, pos: sel.fin });
    }
    if (!estado.marca) {
        estado.marca = { parte: estado.n, ini, fin, pag: paginaDe(estado.parte, ini) };
        actualizarMarca();
        return aviso('Marcado el inicio. Sigue leyendo y toca «Hasta aquí».');
    }
    let desde = { parte: estado.marca.parte, pos: estado.marca.ini };
    let hasta = { parte: estado.n, pos: fin };
    if (cmp(hasta, desde) <= 0) { // se marcó el final antes que el inicio
        desde = { parte: estado.n, pos: ini };
        hasta = { parte: estado.marca.parte, pos: estado.marca.fin };
    }
    estado.marca = null;
    actualizarMarca();
    await crearNota(desde, hasta);
};
$('b-cancelar-nota').onclick = () => { estado.marca = null; actualizarMarca(); };

async function crearNota(desde, hasta) {
    const libro = estado.libro;
    const trozos = [];
    let pagIni = null, pagFin = null;
    for (let p = desde.parte; p <= hasta.parte; p++) {
        const parte = p === estado.n ? estado.parte : await DB.get('partes', [libro.id, p]);
        const ws = parte.texto.split(' ');
        const a = p === desde.parte ? desde.pos : 0;
        const b = p === hasta.parte ? hasta.pos : ws.length;
        trozos.push(ws.slice(a, b).join(' '));
        if (p === desde.parte) pagIni = paginaDe(parte, a);
        if (p === hasta.parte) pagFin = paginaDe(parte, Math.max(a, b - 1));
    }
    const nota = {
        libro: libro.id,
        n: estado.notas.reduce((m, x) => Math.max(m, x.n), 0) + 1,
        desde, hasta, pagIni, pagFin,
        parteTitulo: libro.partes[desde.parte].titulo,
        texto: trozos.join(' '),
        creada: Date.now()
    };
    nota.id = await DB.put('notas', nota);
    estado.notas.push(nota);
    pintarContexto();
    pintarLateral();
    let donde = null;
    try { donde = await Notas.guardar(libro, estado.notas, 'nota'); } catch (e) { console.warn(e); }
    const num = String(nota.n).padStart(3, '0');
    aviso(donde ? `Nota ${num} guardada en ${donde}` : `Nota ${num} guardada. Para el .txt: ☰ → Guardar .txt`, 4000);
}

async function exportarNotas(libro) {
    const notas = await DB.notasDe(libro.id);
    if (!notas.length) return aviso('Este libro aún no tiene subrayados.');
    try {
        const donde = await Notas.guardar(libro, notas, 'manual');
        if (donde) aviso(donde === 'compartido' ? 'Notas compartidas.' : 'Guardado: ' + donde, 4000);
    } catch (e) {
        console.error(e);
        aviso('No se pudo guardar: ' + e.message, 5000);
    }
}

// =================================================================== índice de subrayados
$('b-indice').onclick = () => { lector.pausar(); abrirIndice(); };

function abrirIndice() {
    const libro = estado.libro;
    $('n-libro').textContent = `${libro.meta.titulo} · ${estado.notas.length} subrayado(s) · archivo: ${Notas.nombreArchivo(libro)}`;
    pintarIndice();
    dialogo($('d-indice'));
}

function pintarIndice() {
    const notas = [...estado.notas].sort((a, b) => cmp(a.desde, b.desde));
    $('n-lista').innerHTML = notas.length ? notas.map(n => {
        const pag = Notas.rangoPaginas(n.pagIni, n.pagFin);
        const txt = n.texto.length > 220 ? n.texto.slice(0, 220) + '…' : n.texto;
        return `<div class="nota-item" data-id="${n.id}">
            <div class="cab">[${String(n.n).padStart(3, '0')}] ${Notas.fecha(n.creada)}${pag ? ' · ' + pag : ''} · ${esc(n.parteTitulo)}</div>
            <p>«${esc(txt)}»</p>
            <div class="acciones"><button type="button" data-a="ir">Ir</button><button type="button" data-a="copiar">Copiar con cita</button><button type="button" data-a="borrar">Borrar</button></div>
        </div>`;
    }).join('') : '<p class="ayuda">Aún no hay subrayados. Usa «⟦ Desde aquí» y «Hasta aquí ⟧» mientras lees.</p>';
}

$('n-lista').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const nota = estado.notas.find(n => n.id === +b.closest('.nota-item').dataset.id);
    if (b.dataset.a === 'ir') {
        $('d-indice').close();
        await irANota(nota);
    }
    if (b.dataset.a === 'copiar') {
        const t = `«${nota.texto}» ${Notas.citaTexto(estado.libro.meta, nota)}`;
        try { await navigator.clipboard.writeText(t); aviso('Copiado al portapapeles.'); }
        catch { aviso('El navegador no dejó copiar.'); }
    }
    if (b.dataset.a === 'borrar' && confirm(`¿Borrar la nota ${nota.n}?`)) {
        await DB.borrar('notas', nota.id);
        estado.notas = estado.notas.filter(n => n !== nota);
        pintarIndice();
        pintarContexto();
        pintarLateral();
        Notas.guardar(estado.libro, estado.notas, 'silencioso').catch(() => {});
    }
});
$('n-exportar').onclick = () => exportarNotas(estado.libro);
$('n-ficha').onclick = async () => { $('d-indice').close(); await editarFicha(estado.libro); };

// =================================================================== ajustes
function llenarVoces() {
    if (!('speechSynthesis' in window)) { $('a-voz').innerHTML = '<option>Este navegador no tiene voz</option>'; return; }
    const idioma = (lector.prefs.idioma || 'es').slice(0, 2);
    const voces = speechSynthesis.getVoices().slice()
        .sort((a, b) => (b.lang.startsWith(idioma) - a.lang.startsWith(idioma)) || a.lang.localeCompare(b.lang));
    $('a-voz').innerHTML = '<option value="">Automática</option>' + voces.map(v =>
        `<option value="${esc(v.name)}">${esc(v.name)} (${esc(v.lang)})</option>`).join('');
    $('a-voz').value = estado.prefs.vozNombre;
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = llenarVoces;

async function abrirAjustes() {
    lector.pausar();
    const p = estado.prefs;
    const enlazar = (id, k, fmt = v => v) => {
        const el = $(id);
        el.value = p[k];
        $(id + '-v').textContent = fmt(p[k]);
        el.oninput = () => { p[k] = +el.value; $(id + '-v').textContent = fmt(p[k]); aplicarPrefs(); if (!lector.activo && lector.total) lector.mostrar(lector.vista.ini); };
    };
    enlazar('a-wpm', 'wpm');
    enlazar('a-golpe', 'golpe');
    enlazar('a-letra', 'letra', v => v + ' px');
    enlazar('a-vel', 'velocidad', v => '×' + (+v).toFixed(1));
    llenarVoces();
    $('a-voz').onchange = e => { p.vozNombre = e.target.value; aplicarPrefs(); };
    $('a-tema').value = p.tema;
    $('a-tema').onchange = e => { p.tema = e.target.value; aplicarPrefs(); };

    const libroAbierto = $('v-lector').classList.contains('activa') && estado.libro;
    $('a-bloque-carpeta').hidden = !conCarpetas || !libroAbierto;
    if (conCarpetas && libroAbierto) {
        const c = estado.libro.carpeta;
        $('a-carpeta-v').textContent = c ? 'Actual: ' + c.name : 'Sin elegir: se pedirá al guardar la primera nota.';
    }
    if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(e => $('a-espacio').textContent =
            `Espacio usado: ${(e.usage / 1048576).toFixed(1)} MB de ${(e.quota / 1048576 / 1024).toFixed(1)} GB disponibles.`);
    }
    await dialogo($('d-ajustes'));
    guardarPrefs();
}
$('b-ajustes-1').onclick = abrirAjustes;
$('b-ajustes-2').onclick = abrirAjustes;
$('a-carpeta').onclick = async () => {
    try { $('a-carpeta-v').textContent = 'Actual: ' + await Notas.elegirCarpeta(estado.libro); }
    catch (e) { if (e.name !== 'AbortError') aviso('No se pudo elegir la carpeta: ' + e.message); }
};

// =================================================================== arranque
document.addEventListener('visibilitychange', () => { if (document.hidden) guardarProgreso(true); });

(async () => {
    await cargarPrefs();
    await verBiblioteca();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
})();
