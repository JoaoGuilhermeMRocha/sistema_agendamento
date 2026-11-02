from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.generic import RedirectView
from django.views.static import serve

from barbearia.views import pagina

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("barbearia.urls")),
    path("", RedirectView.as_view(url="/agendar")),
    path("agendar", pagina, {"nome": "agendar"}),
    path("loja", pagina, {"nome": "loja"}),
    path("barbeiros", pagina, {"nome": "barbeiros"}),
]

# No computador, o Django também entrega as fotos enviadas e os arquivos de web/
# (CSS, JS e imagens). Na VPS, o Caddy faz isso.
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    # Só caminhos de arquivo (com extensão), para não engolir /admin e outras rotas sem barra.
    urlpatterns += [re_path(r"^(?P<path>(?:imagens/)?[\w.-]+\.\w+)$", serve, {"document_root": settings.WEB_DIR})]
