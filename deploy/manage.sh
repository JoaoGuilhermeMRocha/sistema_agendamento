#!/usr/bin/env bash
# Roda um comando do Django (manage.py) numa barbearia, como o usuário dela.
# Uso: sudo /srv/arsystems/deploy/manage.sh santiago createsuperuser
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Rode com sudo."; exit 1; }
SLUG="${1:?Informe o slug (ex.: santiago)}"
shift
cd "/srv/clientes/$SLUG/codigo"
exec sudo -u "$SLUG" -H .venv/bin/python manage.py "$@"
