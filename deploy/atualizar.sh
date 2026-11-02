#!/usr/bin/env bash
# Põe no ar, numa barbearia, a versão mais nova que está no GitHub. Faz um backup antes.
# Uso: sudo /srv/arsystems/deploy/atualizar.sh santiago
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Rode com sudo."; exit 1; }
SLUG="${1:?Informe o slug (ex.: santiago)}"
PASTA="$(cd "$(dirname "$0")" && pwd)"
CODIGO="/srv/clientes/$SLUG/codigo"
[[ -d "$CODIGO" ]] || { echo "Não achei $CODIGO."; exit 1; }
como() { sudo -u "$SLUG" -H "$@"; }
manage() { (cd "$CODIGO" && como .venv/bin/python manage.py "$@"); }

echo "Backup antes de mexer."
systemctl start "backup@$SLUG.service"

echo "Scripts e modelos de serviço."
git -C "$PASTA/.." pull --ff-only --quiet
install -m 644 "$PASTA"/systemd/*.service "$PASTA"/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload

echo "Código da barbearia."
como git -C "$CODIGO" pull --ff-only
(cd "$CODIGO" && como uv sync --frozen --no-dev --quiet)
manage migrate --noinput
manage collectstatic --noinput -v0

# HUP: o Gunicorn troca os processos pela versão nova sem derrubar quem está usando.
systemctl reload "agenda@$SLUG.service"
echo "Atualizado: $(git -C "$CODIGO" log --oneline -1)"
