from django.conf import settings
from django.http import FileResponse


def pagina(request, nome):
    """Entrega uma página do site (web/<nome>.html). Na VPS, quem faz isso é o Caddy."""
    resposta = FileResponse(open(settings.WEB_DIR / f"{nome}.html", "rb"), content_type="text/html; charset=utf-8")
    resposta["Cache-Control"] = "no-store"
    if nome == "barbeiros":
        resposta["X-Robots-Tag"] = "noindex, nofollow"
    return resposta
