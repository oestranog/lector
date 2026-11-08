// Guarda la app en el teléfono para que funcione sin conexión.
// Al cambiar cualquier archivo, subir VERSION para que se actualice.
const VERSION = 'lector-13';
const ARCHIVOS = [
    './', 'index.html', 'manifest.webmanifest', 'css/app.css',
    'js/db.js', 'js/parser.js', 'js/importar.js', 'js/lector.js', 'js/notas.js', 'js/app.js',
    'libs/pdf.min.js', 'libs/pdf.worker.min.js', 'libs/jszip.min.js', 'libs/epub.min.js',
    'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(VERSION)
        .then(c => c.addAll(ARCHIVOS.map(f => new Request(f, { cache: 'reload' }))))
        .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys()
        .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

// Primero la red (para recibir cambios); sin conexión, la copia guardada.
// «no-cache» obliga a preguntar al servidor: sin eso el navegador puede dar un archivo viejo de su caché.
self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
    e.respondWith(fetch(e.request, { cache: 'no-cache' })
        .then(r => { const copia = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copia)); return r; })
        .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
