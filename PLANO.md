# Plano: colocar o sistema no ar

O Santiago fechou o sistema em 02/11/2026. Este é o caminho do protótipo (`localStorage`) até o sistema rodando em `santiago.arsystems.com.br`.

## Decisões

- **Domínio:** `arsystems.com.br` (registro.br), com DNS na Cloudflare. Cada cliente ganha um subdomínio (`santiago.arsystems.com.br`). O domínio raiz fica para a página de venda do sistema.
- **Servidor:** VPS Hostinger KVM 1 no Brasil (1 vCPU, 4 GB, 50 GB), Ubuntu 24.04. Já protegida: usuário `joao` com `sudo`, SSH só por chave e sem root, firewall (22, 80 e 443), fail2ban e swap de 2 GB.
- **Backend:** Python 3.12 + Django + PostgreSQL 16. Uma instância do Django e um banco por cliente (o modelo continua replicado, não multi-tenant). O Caddy recebe os subdomínios, cuida do HTTPS e manda cada um para o Django certo.
- **O visual não muda.** HTML, CSS e JS continuam. O `dados.js` troca o `localStorage` pela API, e o `agenda.js` continua desenhando o painel, mas **quem decide é o servidor** (disponibilidade, conflitos e reserva dupla).
- **A página do cliente não recebe dado de outros clientes.** Hoje o `/agendar` carrega o estado inteiro (nomes e telefones) para calcular os horários livres. No sistema de verdade, ele pede ao servidor só os horários livres (LGPD).

## Etapas

Cada etapa termina funcionando e com um commit.

1. [x] **Ambiente local:** Python 3.12 com `uv` (a mesma versão da VPS) e PostgreSQL 16 num container `podman`.
2. [x] **Projeto Django e modelos:** agendamentos, serviços, produtos, expedientes, ausências e bloqueios viram tabelas. Os profissionais saem do `config.js` para o banco. O admin do Django fica disponível para o João.
3. [x] **Regras da agenda em Python:** disponibilidade, recorrência e conflitos (tradução do `agenda.js`), com testes automáticos.
4. [ ] **API:** rotas JSON que o site chama, com validação no servidor e trava contra reserva dupla no banco.
5. [ ] **Login no painel:** uma conta por barbeiro. Cada um vê só os próprios valores, inclusive o Santiago (ver Pendências no `CLAUDE.md`).
6. [ ] **Front ligado à API:** o `dados.js` passa a usar `fetch` e as chamadas viram assíncronas. O `/agendar` usa a rota de horários livres. "Gerar dados de exemplo" e "Apagar dados de teste" ficam só no ambiente de desenvolvimento.
7. [ ] **Fotos e LGPD:** fotos salvas como arquivo no servidor (não mais data URL) e política de privacidade com consentimento.
8. [ ] **Deploy:** PostgreSQL, Gunicorn e Caddy na VPS, backup diário do banco fora do servidor e um script para criar um cliente novo.
