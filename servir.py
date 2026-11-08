"""Sirve Lector en la red local (lo usa servir.bat).
Como «python -m http.server», pero pide al navegador que pregunte siempre si hay
cambios: sin eso, el teléfono puede seguir usando archivos viejos tras una actualización."""
import http.server
import os
import sys

PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class SinCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.webmanifest': 'application/manifest+json'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


os.chdir(os.path.dirname(os.path.abspath(__file__)))
http.server.ThreadingHTTPServer(('', PUERTO), SinCache).serve_forever()
