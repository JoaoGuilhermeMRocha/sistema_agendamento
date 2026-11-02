#!/usr/bin/env bash
# Backup de uma barbearia: banco (pg_dump) e fotos (midia/). Guarda os últimos 14 dias na VPS.
# Roda todo dia pelo backup@<slug>.timer, como o usuário da barbearia.
# Com /etc/arsystems/rclone.conf configurado (remoto "fora", legível pelo grupo arsystems),
# manda uma cópia para fora da VPS (Cloudflare R2). O R2 apaga sozinho o que passar de 90 dias.
set -euo pipefail
SLUG="${1:?Informe o slug}"
CASA="/srv/clientes/$SLUG"
DESTINO="$CASA/backups"
QUANDO="$(date +%Y-%m-%d)"

pg_dump --format=custom --file="$DESTINO/banco-$QUANDO.dump" "$SLUG"
tar -czf "$DESTINO/midia-$QUANDO.tar.gz" -C "$CASA" midia
find "$DESTINO" -type f -mtime +14 -delete

if [[ -r /etc/arsystems/rclone.conf ]] && command -v rclone >/dev/null; then
  rclone --config /etc/arsystems/rclone.conf copy "$DESTINO" "fora:arsystems-backups/$SLUG" --max-age 48h
fi
echo "Backup de $SLUG feito em $DESTINO ($QUANDO)."
