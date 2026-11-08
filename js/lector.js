/**
 * lector.js — Motor de lectura de una parte.
 * Modo silencioso: muestra grupos de palabras a N palabras por minuto.
 * Modo voz: lee frase por frase con la voz del sistema; el texto en pantalla
 * sigue a la voz (por evento de palabra si el navegador lo da, si no por estimación).
 */
const FIN_FRASE = /[.?!…]["»”’)\]]*$/;

class Lector {
    constructor(pantalla) {
        this.pantalla = pantalla;
        this.palabras = [];
        this.pos = 0;                  // próxima palabra a mostrar
        this.vista = { ini: 0, fin: 0 }; // palabras en pantalla [ini, fin)
        this.activo = false;
        this.token = 0;                // invalida temporizadores y eventos viejos
        this.msPorCar = 65;            // calibración de la voz a velocidad 1
        this.prefs = { wpm: 300, golpe: 3, voz: true, velocidad: 1, vozNombre: '', idioma: 'es' };
        this.onAvance = null;          // (ini) al cambiar lo que se ve
        this.onEstado = null;          // (activo)
        this.onFin = null;             // fin de la parte
        this.onAviso = null;           // (texto)
    }

    cargar(texto, pos = 0) {
        this.parar();
        this.palabras = texto ? texto.split(' ') : [];
        this.pos = Math.max(0, Math.min(pos, this.palabras.length - 1));
        this.mostrar(this.pos);
    }

    get total() { return this.palabras.length; }

    // ------------------------------------------------------------- pantalla
    /** Fin del grupo que empieza en «ini»: hasta «golpe» palabras, cortando en fin de frase. */
    grupo(ini, tope = this.total) {
        let fin = ini;
        while (fin < tope && fin - ini < this.prefs.golpe) {
            if (FIN_FRASE.test(this.palabras[fin++]) || /[:;]$/.test(this.palabras[fin - 1])) break;
        }
        return fin;
    }

    mostrar(ini, fin = this.grupo(ini)) {
        this.vista = { ini, fin };
        const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
        this.pantalla.innerHTML = `<span>${esc(this.palabras.slice(ini, fin).join(' ')) || '—'}</span>`;
        if (this.onAvance) this.onAvance(ini);
    }

    // ------------------------------------------------------------- control
    reproducir() {
        if (!this.total || this.activo) return;
        if (this.pos >= this.total) this.pos = 0;
        this.activo = true;
        this.bloquearPantalla(true);
        if (this.onEstado) this.onEstado(true);
        const t = this.token;
        if (this.prefs.voz && 'speechSynthesis' in window) setTimeout(() => t === this.token && this.hablar(this.pos), 60);
        else this.paso();
    }

    pausar() {
        if (!this.activo) return;
        this.parar();
        this.pos = this.vista.ini;
        if (this.onEstado) this.onEstado(false);
    }

    alternar() { this.activo ? this.pausar() : this.reproducir(); return this.activo; }

    /** Detiene todo sin avisar (uso interno). */
    parar() {
        this.token++;
        clearTimeout(this.reloj);
        if ('speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
        this.activo = false;
        this.bloquearPantalla(false);
    }

    ir(pos) {
        const seguir = this.activo;
        this.parar();
        this.pos = Math.max(0, Math.min(pos, this.total - 1));
        this.mostrar(this.pos);
        if (seguir) this.reproducir();
        else if (this.onEstado) this.onEstado(false);
    }

    saltar(n) { this.ir(this.vista.ini + n); }

    terminar() {
        this.parar();
        this.pos = this.total;
        if (this.onEstado) this.onEstado(false);
        if (this.onFin) this.onFin();
    }

    // ------------------------------------------------------------- silencioso
    paso() {
        const t = this.token;
        if (this.pos >= this.total) return this.terminar();
        const ini = this.pos;
        this.mostrar(ini);
        const fin = this.vista.fin;
        this.pos = fin;
        let ms = (60000 / this.prefs.wpm) * (fin - ini);
        const ult = this.palabras[fin - 1] || '';
        if (FIN_FRASE.test(ult)) ms *= 1.6;
        else if (/[,;:]$/.test(ult)) ms *= 1.2;
        this.reloj = setTimeout(() => t === this.token && this.paso(), ms);
    }

    // ------------------------------------------------------------- voz
    /** Fin de la frase que empieza en «ini» (frases largas se cortan en comas). */
    frase(ini) {
        let fin = ini;
        while (fin < this.total) {
            const w = this.palabras[fin++];
            if (FIN_FRASE.test(w)) break;
            if (fin - ini >= 35 && /[,;:]$/.test(w)) break;
            if (fin - ini >= 60) break;
        }
        return fin;
    }

    voz() {
        const voces = speechSynthesis.getVoices();
        return voces.find(v => v.name === this.prefs.vozNombre)
            || voces.find(v => v.lang.toLowerCase().startsWith(this.prefs.idioma.slice(0, 2).toLowerCase()) && v.localService)
            || voces.find(v => v.lang.toLowerCase().startsWith(this.prefs.idioma.slice(0, 2).toLowerCase()))
            || null;
    }

    hablar(ini) {
        const t = this.token;
        if (ini >= this.total) return this.terminar();
        const fin = this.frase(ini);
        const ws = this.palabras.slice(ini, fin);

        // Inicio de cada grupo dentro de la frase y posición de cada palabra en caracteres
        const grupos = [];
        for (let g = ini; g < fin; g = this.grupo(g, fin)) grupos.push(g);
        const offs = [];
        let c = 0;
        for (const w of ws) { offs.push(c); c += w.length + 1; }

        let mostrado = -1;
        const verPalabra = i => {
            let g = grupos[0];
            for (const x of grupos) if (x <= ini + i) g = x; else break;
            if (g !== mostrado) { mostrado = g; this.mostrar(g, this.grupo(g, fin)); }
        };
        const palabraEn = car => { let i = 0; while (i + 1 < offs.length && offs[i + 1] <= car) i++; return i; };

        const u = new SpeechSynthesisUtterance(ws.join(' '));
        this.dicho = u; // evita que Chrome lo descarte antes de terminar
        const voz = this.voz();
        if (voz) { u.voice = voz; u.lang = voz.lang; } else u.lang = this.prefs.idioma;
        u.rate = this.prefs.velocidad;

        let conEventos = false, t0 = performance.now();
        const estimar = () => {
            if (t !== this.token || conEventos) return;
            verPalabra(palabraEn((performance.now() - t0) / (this.msPorCar / this.prefs.velocidad)));
            this.reloj = setTimeout(estimar, 80);
        };
        u.onstart = () => { t0 = performance.now(); estimar(); };
        u.onboundary = e => {
            if (t !== this.token || (e.name && e.name !== 'word')) return;
            conEventos = true;
            verPalabra(palabraEn(e.charIndex));
        };
        u.onend = () => {
            if (t !== this.token) return;
            clearTimeout(this.reloj);
            const dur = performance.now() - t0;
            if (c > 25 && dur > 300) this.msPorCar = 0.7 * this.msPorCar + 0.3 * (dur / c) * this.prefs.velocidad;
            this.pos = fin;
            this.hablar(fin);
        };
        u.onerror = e => {
            if (t !== this.token || e.error === 'interrupted' || e.error === 'canceled') return;
            if (this.onAviso) this.onAviso('La voz no está disponible (' + e.error + '); sigo en silencio.');
            this.prefs.voz = false;
            this.pos = ini;
            this.paso();
        };
        verPalabra(0);
        speechSynthesis.speak(u);
    }

    // ------------------------------------------------------------- pantalla encendida
    async bloquearPantalla(si) {
        try {
            if (si && 'wakeLock' in navigator && !this.candado) this.candado = await navigator.wakeLock.request('screen');
            if (!si && this.candado) { await this.candado.release(); this.candado = null; }
        } catch { this.candado = null; }
    }
}
