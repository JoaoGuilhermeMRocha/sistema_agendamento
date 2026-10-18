from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

DIRECTORY = Path(__file__).resolve().parent
PAGES = {
    "/agendar": "agendar.html",
    "/loja": "loja.html",
    "/barbeiros": "barbeiros.html",
}
# Só estes arquivos são entregues; o resto da pasta (server.py, .git...) fica de fora.
ASSETS = [
    "tema.css", "base.css", "agendar.css", "loja.css", "barbeiros.css",
    "config.js", "agenda.js", "dados.js", "ui.js", "agendar.js", "loja.js", "barbeiros.js",
    "favicon.svg",
]
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}
# Imagens da identidade visual: qualquer arquivo de imagem direto dentro de /imagens.
IMAGES_DIR = DIRECTORY / "imagens"
IMAGE_TYPES = {".svg", ".jpg", ".png", ".webp"}
ROUTES = {**PAGES, **{f"/{name}": name for name in ASSETS}}
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

        filename = ROUTES.get(path)
        if filename is None and path.startswith("/imagens/"):
            name = path.removeprefix("/imagens/")
            candidate = IMAGES_DIR / name
            if "/" not in name and candidate.suffix in IMAGE_TYPES and candidate.is_file():
                filename = f"imagens/{name}"
        if filename is None:
            self.send_error(404, "Pagina ou arquivo nao encontrado")
            return

        try:
            content = (DIRECTORY / filename).read_bytes()
        except OSError:
            self.send_error(500, f"Arquivo ausente: {filename}")
            return

        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES[Path(filename).suffix])
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        if path == "/barbeiros":
            self.send_header("X-Robots-Tag", "noindex, nofollow")
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
