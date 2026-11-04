"""Configurações do Django.

Tudo o que muda entre o computador e a VPS (ou entre um cliente e outro) vem de
variáveis de ambiente, lidas do arquivo .env. Modelo em .env.exemplo.
"""

import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = BASE_DIR / "web"


def carregar_env(caminho):
    """Lê linhas CHAVE=valor do .env. O que já estiver no ambiente tem prioridade."""
    if not caminho.exists():
        return
    for linha in caminho.read_text().splitlines():
        linha = linha.strip()
        if linha and not linha.startswith("#") and "=" in linha:
            chave, valor = linha.split("=", 1)
            os.environ.setdefault(chave.strip(), valor.strip())


carregar_env(BASE_DIR / ".env")

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    raise ImproperlyConfigured("Preencha DJANGO_SECRET_KEY no .env (veja .env.exemplo).")
DEBUG = os.environ.get("DJANGO_DEBUG") == "1"
ALLOWED_HOSTS = [host for host in os.environ.get("DJANGO_HOSTS", "").split(",") if host]


INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "barbearia",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "arsystems.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "arsystems.wsgi.application"


DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ["POSTGRES_DB"],
        "USER": os.environ["POSTGRES_USER"],
        # Na VPS, o Django entra pelo socket do Postgres com o usuário do sistema (peer), sem senha.
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""),
        "HOST": os.environ.get("POSTGRES_HOST", "127.0.0.1"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Cache no banco, e não na memória: na VPS o Gunicorn roda com mais de um processo, e as contagens
# (senhas erradas, agendamentos por IP) precisam valer para todos. Tabela: manage.py createcachetable.
CACHES = {"default": {"BACKEND": "django.core.cache.backends.db.DatabaseCache", "LOCATION": "cache"}}


AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


CSRF_FAILURE_VIEW = "barbearia.api.falha_de_csrf"

# O barbeiro entra uma vez no celular e fica logado por 30 dias.
SESSION_COOKIE_AGE = 30 * 24 * 60 * 60

LANGUAGE_CODE = "pt-br"
# Fuso da barbearia: "hoje" e "horário que já passou" são calculados nele.
TIME_ZONE = os.environ.get("DJANGO_FUSO", "America/Sao_Paulo")
USE_I18N = True
USE_TZ = True

# Parâmetros da agenda. Os mesmos de config.agenda em web/config.js: mudou um, mude o outro.
AGENDA = {
    "intervalo_minutos": 15,
    # Duração de um serviço: de 5 em 5 min, até 4 h.
    "passo_duracao_minutos": 5,
    "duracao_maxima_minutos": 240,
    "dias_para_agendar": 14,
    # Até onde conferir conflitos de uma repetição sem data para terminar.
    "horizonte_recorrencia_dias": 180,
    "max_atendimentos_repetidos": 52,
}

# LGPD: depois de 2 anos sem atendimento, o nome e o WhatsApp do cliente são apagados
# (comando anonimizar_antigos, rodado todo dia na VPS). Está escrito na política de privacidade.
LGPD_GUARDA_DIAS = 730


# Arquivos do admin do Django (o site em si fica em web/).
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "static"

# Fotos enviadas pelo painel (produtos e profissionais).
MEDIA_URL = "/midia/"
MEDIA_ROOT = Path(os.environ.get("DJANGO_MIDIA", BASE_DIR / "midia"))


# Na VPS: o Caddy recebe o HTTPS e repassa avisando no X-Forwarded-Proto.
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = True
    SECURE_HSTS_SECONDS = 365 * 24 * 60 * 60
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    CSRF_TRUSTED_ORIGINS = [f"https://{host}" for host in ALLOWED_HOSTS]

# Erros vão para a saída padrão; na VPS, o systemd guarda (journalctl -u agenda@<slug>).
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {"django": {"handlers": ["console"], "level": "WARNING"}},
}
