/**
 * db.js — Almacén del navegador (IndexedDB).
 * libros: ficha + índice de partes + progreso
 * partes: texto ya filtrado de cada parte, con marcas de página
 * notas:  fragmentos subrayados (índice por libro)
 * ajustes: preferencias y carpeta de notas
 */
const DB = (() => {
    let abierta = null;

    function abrir() {
        if (abierta) return abierta;
        abierta = new Promise((ok, mal) => {
            const r = indexedDB.open('lector', 1);
            r.onupgradeneeded = () => {
                const d = r.result;
                d.createObjectStore('libros', { keyPath: 'id' });
                d.createObjectStore('partes', { keyPath: ['libro', 'n'] });
                d.createObjectStore('notas', { keyPath: 'id', autoIncrement: true }).createIndex('libro', 'libro');
                d.createObjectStore('ajustes');
            };
            r.onsuccess = () => ok(r.result);
            r.onerror = () => mal(r.error);
        });
        return abierta;
    }

    const esperar = r => new Promise((ok, mal) => { r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); });

    async function almacen(nombre, modo = 'readonly') {
        return (await abrir()).transaction(nombre, modo).objectStore(nombre);
    }

    return {
        async get(nombre, clave) { return esperar((await almacen(nombre)).get(clave)); },
        async put(nombre, valor, clave) { return esperar((await almacen(nombre, 'readwrite')).put(valor, clave)); },
        async todos(nombre) { return esperar((await almacen(nombre)).getAll()); },
        async borrar(nombre, clave) { return esperar((await almacen(nombre, 'readwrite')).delete(clave)); },
        async notasDe(libro) {
            return esperar((await almacen('notas')).index('libro').getAll(libro));
        },
        /** Guarda libro y partes en una sola transacción. */
        async guardarLibro(libro, partes) {
            const t = (await abrir()).transaction(['libros', 'partes'], 'readwrite');
            const p = t.objectStore('partes');
            p.delete(IDBKeyRange.bound([libro.id, 0], [libro.id, Infinity]));
            partes.forEach(x => p.put(x));
            t.objectStore('libros').put(libro);
            return new Promise((ok, mal) => { t.oncomplete = ok; t.onerror = () => mal(t.error); });
        },
        async borrarLibro(id) {
            const t = (await abrir()).transaction(['libros', 'partes', 'notas'], 'readwrite');
            t.objectStore('partes').delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
            t.objectStore('libros').delete(id);
            const idx = t.objectStore('notas').index('libro');
            idx.openKeyCursor(IDBKeyRange.only(id)).onsuccess = e => {
                const c = e.target.result;
                if (c) { t.objectStore('notas').delete(c.primaryKey); c.continue(); }
            };
            return new Promise((ok, mal) => { t.oncomplete = ok; t.onerror = () => mal(t.error); });
        }
    };
})();

// Pedir al navegador que no borre los datos si falta espacio
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
