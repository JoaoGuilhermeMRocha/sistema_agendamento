#!/usr/bin/env bash
# Prepara a VPS, uma vez só: PostgreSQL, Caddy, uv e os modelos de serviço do systemd.
# Uso: sudo /srv/arsystems/deploy/preparar_servidor.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Rode com sudo."; exit 1; }
PASTA="$(cd "$(dirname "$0")" && pwd)"

apt-get update -q
apt-get install -y -q postgresql git curl gnupg debian-keyring debian-archive-keyring apt-transport-https

# Caddy, do repositório oficial (o do Ubuntu fica para trás nas versões).
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

# uv (gerencia o Python e as dependências de cada barbearia), para todos os usuários.
if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh
fi

mkdir -p /srv/clientes /etc/caddy/clientes
cat > /etc/caddy/Caddyfile <<'CADDY'
# Cada barbearia tem o seu arquivo em /etc/caddy/clientes/ (criado pelo deploy/novo_cliente.sh).
import /etc/caddy/clientes/*.caddy
CADDY

instalar_servicos() {
  install -m 644 "$PASTA"/systemd/*.service "$PASTA"/systemd/*.timer /etc/systemd/system/
  systemctl daemon-reload
}
instalar_servicos
systemctl enable --now caddy
systemctl reload caddy

echo
echo "Servidor pronto. Próximo passo: sudo $PASTA/novo_cliente.sh <slug> <domínio>"
