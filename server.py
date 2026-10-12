from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

DIRECTORY = Path(__file__).resolve().parent
PAGES = {
    "/agendar": ("index.html", "text/html; charset=utf-8"),
    "/loja": ("loja.html", "text/html; charset=utf-8"),
    "/barbeiros": ("barbeiros.html", "text/html; charset=utf-8"),
}
ASSETS = {
    "/header.css": ("header.css", "text/css; charset=utf-8"),
    "/agendar.css": ("agendar.css", "text/css; charset=utf-8"),
    "/agendar.js": ("agendar.js", "text/javascript; charset=utf-8"),
    "/loja.css": ("loja.css", "text/css; charset=utf-8"),
    "/loja.js": ("loja.js", "text/javascript; charset=utf-8"),
    "/barbeiros.css": ("barbeiros.css", "text/css; charset=utf-8"),
    "/barbeiros.js": ("barbeiros.js", "text/javascript; charset=utf-8"),
}
HOST = "127.0.0.1"
PORT = 8000

# Execute com: python server.py
# Acesse: http://127.0.0.1:8000/agendar
#         http://127.0.0.1:8000/loja
#         http://127.0.0.1:8000/barbeiros


class DemoHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path

        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/agendar")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        resource = PAGES.get(path) or ASSETS.get(path)
        if resource is None:
            self.send_error(404, "Pagina ou arquivo nao encontrado")
            return

        filename, content_type = resource
        try:
            content = (DIRECTORY / filename).read_bytes()
        except OSError:
            self.send_error(500, f"Arquivo ausente: {filename}")
            return

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), DemoHandler)
    print(f"Agendamento: http://{HOST}:{PORT}/agendar")
    print(f"Loja:        http://{HOST}:{PORT}/loja")
    print(f"Barbeiros:   http://{HOST}:{PORT}/barbeiros")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado.")
    finally:
        server.server_close()