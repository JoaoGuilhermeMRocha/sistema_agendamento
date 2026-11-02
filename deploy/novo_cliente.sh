#!/usr/bin/env bash
# Põe uma barbearia nova no ar: usuário, banco, código, .env, serviços e o site no Caddy.
# Uso: sudo /srv/arsystems/deploy/novo_cliente.sh santiago santiago.arsystems.com.br
#
# Antes: o repositório precisa ter clientes/<slug>/dados_iniciais.json, e o domínio precisa
# apontar para a VPS (registro A na Cloudflare, "só DNS").
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Rode com sudo."; exit 1; }
SLUG="${1:?Informe o slug (ex.: santiago)}"
DOMINIO="${2:?Informe o domínio (ex.: santiago.arsystems.com.br)}"
[[ "$SLUG" =~ ^[a-z][a-z0-9]{1,29}$ ]] || { echo "Slug: comece com letra, só letras minúsculas e números."; exit 1; }
PASTA="$(cd "$(dirname "$0")" && pwd)"
REPOSITORIO="$(git -C "$PASTA/.." remote get-url origin)"
CASA="/srv/clientes/$SLUG"
CODIGO="$CASA/codigo"
[[ ! -e "$CASA" ]] || { echo "$CASA já existe. Para atualizar, use o atualizar.sh."; exit 1; }
como() { sudo -u "$SLUG" -H "$@"; }

echo "1/7 Usuário do sistema '$SLUG' (sem login): roda o Django e é dono dos arquivos."
useradd --system --home-dir "$CASA" --create-home --shell /usr/sbin/nologin "$SLUG"
chmod 750 "$CASA"
# O Caddy entra no grupo para ler web/ e midia/ e falar com o socket do Gunicorn.
usermod -aG "$SLUG" caddy
# O grupo arsystems lê a chave do backup fora da VPS (/etc/arsystems/rclone.conf), se já existir.
getent group arsystems >/dev/null && usermod -aG arsystems "$SLUG"

echo "2/7 Código e dependências."
como git clone --quiet "$REPOSITORIO" "$CODIGO"
[[ -f "$CODIGO/clientes/$SLUG/dados_iniciais.json" ]] || { echo "Falta clientes/$SLUG/dados_iniciais.json no repositório."; exit 1; }
como mkdir -p "$CASA/midia" "$CASA/backups"
(cd "$CODIGO" && como uv sync --frozen --no-dev --quiet)

echo "3/7 Banco '$SLUG'. O papel tem o nome do usuário do sistema e entra sem senha (peer)."
sudo -u postgres createuser "$SLUG"
sudo -u postgres createdb --owner "$SLUG" "$SLUG"

echo "4/7 .env (só o usuário '$SLUG' lê)."
SEGREDO="$(como "$CODIGO/.venv/bin/python" -c 'from django.core.management.utils import get_random_secret_key as g; print(g())')"
como tee "$CODIGO/.env" >/dev/null <<ENV
DJANGO_SECRET_KEY=$SEGREDO
DJANGO_DEBUG=
DJANGO_HOSTS=$DOMINIO
DJANGO_MIDIA=$CASA/midia
POSTGRES_DB=$SLUG
POSTGRES_USER=$SLUG
POSTGRES_PASSWORD=
POSTGRES_HOST=/var/run/postgresql
ENV
chmod 600 "$CODIGO/.env"

echo "5/7 Tabelas, dados iniciais e arquivos do admin."
manage() { (cd "$CODIGO" && como .venv/bin/python manage.py "$@"); }
manage migrate --noinput -v0
manage createcachetable
manage loaddata "clientes/$SLUG/dados_iniciais.json"
manage collectstatic --noinput -v0

echo "6/7 Serviços: Django, manutenção diária (LGPD e sessões) e backup diário."
systemctl enable --now "agenda@$SLUG.service" "manutencao@$SLUG.timer" "backup@$SLUG.timer"

echo "7/7 Site no Caddy. O certificado HTTPS sai sozinho em alguns segundos."
sed -e "s/{{SLUG}}/$SLUG/g" -e "s/{{DOMINIO}}/$DOMINIO/g" "$PASTA/cliente.caddy" > "/etc/caddy/clientes/$SLUG.caddy"
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1
# Restart (e não reload) para o Caddy ganhar o grupo novo.
systemctl restart caddy

echo
echo "No ar: https://$DOMINIO/agendar"
echo "Agora crie o seu acesso de administrador: sudo $PASTA/manage.sh $SLUG createsuperuser"
