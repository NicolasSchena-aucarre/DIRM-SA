#!/usr/bin/env python3
"""Serveur local de développement pour le widget Projets.

Sert le dossier courant sur http://localhost:8080, sans aucun cache,
afin que chaque modification soit visible dès que l'on recharge la page Grist.
Écoute uniquement sur cette machine (127.0.0.1) : personne d'autre sur le réseau n'y a accès.

Utilisation :  python3 serveur.py          (port 8080)
               python3 serveur.py 9000     (autre port)
Arrêt :        Ctrl + C
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class SansCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2',
                      '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


class Serveur(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == '__main__':
    with Serveur(('127.0.0.1', PORT), SansCache) as httpd:
        print(f'Widget disponible sur http://localhost:{PORT}/  (Ctrl + C pour arrêter)')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nServeur arrêté.')
