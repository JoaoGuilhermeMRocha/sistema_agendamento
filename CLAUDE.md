# Sistema de agendamento para barbearias

Protótipo de um sistema que o João vai **vender para barbearias**. O primeiro cliente é a **Santiago Barbearia** (Arapoti, PR). Não é multi-tenant: é um **modelo replicado por contratante**. Cada cliente recebe uma cópia própria, em que só mudam a identidade visual, os textos e os contatos. As funcionalidades são as mesmas para todos.

Responda ao usuário em português do Brasil, num tom direto e informal.

## Como rodar

O front fala com um backend Django + PostgreSQL pela API em `/api/`. O caminho até o sistema no ar e o andamento estão no `PLANO.md`.

```bash
podman start agenda-postgres          # PostgreSQL 16 local, num container
uv run python manage.py runserver
```

- `http://127.0.0.1:8000/agendar`: área do cliente para marcar horário
- `http://127.0.0.1:8000/loja`: vitrine de produtos
- `http://127.0.0.1:8000/barbeiros`: painel dos barbeiros
- `http://127.0.0.1:8000/privacidade`: política de privacidade (pública)
- `http://127.0.0.1:8000/admin/`: admin do Django (só do João)

Em produção: `https://santiago.arsystems.com.br` (veja **No ar**, mais abaixo).

O front é HTML, CSS e JavaScript puro, com módulos ES, sem build, e fica em `web/`. O backend é Python 3.12 (preso pelo `uv`, igual à VPS) com Django e PostgreSQL. Senhas e banco vêm do `.env` (modelo em `.env.exemplo`), que nunca vai para o Git.

No computador (`DJANGO_DEBUG=1`), o Django entrega as páginas e qualquer arquivo de `web/` com extensão, inclusive os de `web/imagens/`. Na VPS, quem entrega `web/` é o Caddy.

## Regras de navegação

- `/agendar`, `/loja` e `/privacidade` são públicas. Agendar e loja linkam uma para a outra, e as três têm o link da política no rodapé.
- `/barbeiros` é a área administrativa. Ela linka para as páginas públicas, mas **nenhuma página pública pode linkar para o painel**. O painel tem `noindex` (meta e cabeçalho `X-Robots-Tag`).
- **Login**: o painel exige login (usuário do Django ligado ao barbeiro em `Profissional.usuario`, criado pelo admin). Sem login, o `/barbeiros` mostra a tela de entrar (`#entrar`, com `body[data-entrar]` escondendo abas e painel), e o `barbeiros.js` só continua depois que o login dá certo (`await carregarPainel()` no topo do módulo). "Sair" fica no rodapé. **Todos os barbeiros podem alterar tudo** (decisão do João); a única restrição é o valor: cada um vê só o dos próprios atendimentos.

## Arquivos

Os arquivos do front abaixo ficam em `web/`.

| Arquivo | Papel |
| --- | --- |
| `config.js` | **Textos e contatos do cliente**: nome, selo ("Since 2017"), slogan, endereço, link do Google Maps, WhatsApp, Instagram, a foto provisória de cada profissional (vale enquanto não houver uma enviada; nome e descrição vêm do servidor, que substitui `config.profissionais` ao carregar) e os parâmetros da agenda (os mesmos de `AGENDA` no `settings.py`) |
| `tema.css` | **Identidade visual por cliente**: fontes, cores (tokens `--cor-*`, incluindo a cor de cada símbolo de serviço), imagens (`--imagem-*`) e cores do xadrez |
| `imagens/` | Imagens do cliente: `capa.jpg` (capa do agendamento), `loja.jpg` (topo da loja), `emblema.svg` (logo redondo, usado também como favicon), `arabesco.svg` (ornamento) e o retrato de cada profissional (hoje `santiago.svg` e `damigo.svg`, silhuetas provisórias até chegarem as fotos) |
| `agenda.js` | Regras de agenda, em **funções puras**: datas, recorrência, disponibilidade, escolha de profissional e conflitos |
| `dados.js` | **Camada de dados**: as chamadas à API (`fetch` com o cabeçalho de CSRF). Toda função devolve uma Promise de `{ ok: true, ... }` ou `{ ok: false, erro, status }` e nunca lança erro (sem internet também vira `{ ok: false }`). `aoMudar(buscar, callback)` confere a cada 30 s e quando a aba volta a aparecer |
| `ui.js` | Peças de interface compartilhadas: `el()`, ícones SVG, `preencherMarca()`, máscara de telefone, links de WhatsApp e Google Maps, aviso flutuante e confirmação com dois toques |
| `base.css` | Base comum: reset, cabeçalho, botões, campos, chips, folha (`<dialog>`) e ornamentos (`.filete`, `.faixa`, `.arabescos`, `.xadrez`, `.capitone`) |
| `agendar.*`, `loja.*`, `barbeiros.*`, `privacidade.*` | HTML, CSS e JS de cada página. O texto da política (`privacidade.html`) fala do prazo de guarda: mudou `LGPD_GUARDA_DIAS`, mude o texto |
| `relatorios.js`, `relatorios.css` | Aba Relatórios do painel: filtros, indicadores, agrupamento, tabela, CSV e a versão impressa (PDF) |
| `exemplo.js` | Gerador de dados de exemplo (botão "Gerar dados de exemplo" no rodapé do painel, só com `DJANGO_DEBUG=1`; os serviços são achados pelo símbolo, porque os ids vêm do banco): 150 atendimentos em agosto, 150 em setembro e 100 em outubro do ano atual, com 4 séries recorrentes, e a **semana atual lotada** (todo horário livre de cada profissional ganha um atendimento que caiba no espaço). Respeita as regras da agenda e é determinístico (semente fixa). As metas ficam em `METAS` |
| `graficos.js` | Gráficos em SVG puro (colunas, barras, linha e rosca), com dica no mouse, toque e teclado |
| `referencias/` | Material de referência da Santiago (logo, posts e fotos do salão). Não é servido nem usado pelo sistema |

Backend, na raiz:

| Arquivo | Papel |
| --- | --- |
| `arsystems/` | Projeto Django: `settings.py` (lê o `.env`) e `urls.py` (páginas, admin e, no computador, os arquivos de `web/`) |
| `barbearia/` | O app: `models.py` (tabelas, com `CheckConstraint` garantindo as regras no banco), `admin.py` e `views.py` |
| `barbearia/agenda.py` | **As regras da agenda em Python** (tradução do `agenda.js`), em funções puras sobre um `Estado` montado por `carregar_estado()`. É o servidor que decide; o `agenda.js` só desenha o painel. **Mudou uma regra num, mude no outro** |
| `barbearia/dados.py` | **Validação e gravação**, com as mensagens que aparecem na tela. Recusa com `Recusado("mensagem")`. Marcar horário trava as linhas dos profissionais (`select_for_update`) antes de conferir a agenda: é a trava contra reserva dupla. `{ simular }` aplica a mudança numa transação, devolve os conflitos novos e desfaz. A foto do produto chega em data URL, é conferida pelo Pillow e vira arquivo em `midia/` |
| `barbearia/api.py`, `barbearia/urls.py` | **API JSON** em `/api/`. Respostas `{ ok: true, ... }` ou `{ ok: false, erro }` (status 400; falha de CSRF também responde assim, com 403) e campos em camelCase como no front. `/api/publico/` (vitrine, horários e agendar) nunca devolve dado de outros clientes. `/api/painel/` devolve o estado inteiro e recebe as alterações. `painel/exemplo` e `painel/dados-de-teste` só existem com `DJANGO_DEBUG=1`. Login por `painel/entrar` e `painel/sair`. `painel/eu` diz quem está logado (401 sem login). Sem login, o painel responde 401; usuário sem barbeiro ativo, 403. 5 senhas erradas seguidas bloqueiam o usuário por 15 minutos. No estado, o `preco` dos atendimentos dos colegas vem `null`; o superusuário (o João, no suporte) vê tudo. Os POST, PUT e DELETE precisam do cabeçalho `X-CSRFToken` (cookie `csrftoken`, entregue pela vitrine e pelo estado) |
| `barbearia/management/commands/anonimizar_antigos.py` | LGPD: tira nome e WhatsApp de quem não tem atendimento há mais de `LGPD_GUARDA_DIAS` (730 dias, no `settings.py`). Conta pelo cliente (telefone), não pelo atendimento, e série sem fim nunca vence. Na VPS, roda todo dia |
| `barbearia/tests/` | Testes automáticos (`uv run python manage.py test barbearia`). O "agora" dos testes é fixo (segunda, 02/11/2026, 10h) |
| `clientes/<slug>/dados_iniciais.json` | Dados iniciais de cada barbearia (profissionais, expedientes, serviços e produtos), carregados com `manage.py loaddata` |
| `pyproject.toml`, `uv.lock`, `.python-version` | Dependências e versão do Python, gerenciadas pelo `uv` |
| `deploy/` | Scripts da VPS (veja **No ar**): `preparar_servidor.sh`, `novo_cliente.sh`, `atualizar.sh`, `manage.sh`, `backup.sh`, o modelo do site no Caddy (`cliente.caddy`) e os modelos do systemd (`systemd/*@.service` e `*@.timer`, em que `%i` é o slug) |

As páginas preenchem nome, endereço e contatos a partir do `config.js` (`data-marca="chave"`, `data-link="whatsapp|instagram|mapa"`). O endereço abre o Google Maps: usa `config.mapa` se preenchido, senão busca pelo endereço. O texto escrito no HTML é só um valor provisório.

## Replicar para um novo cliente

1. Editar `config.js`: textos, contatos e a foto provisória de cada profissional. Trocar o `slug`.
2. Editar `tema.css`: fontes, cores e caminhos das imagens.
3. Trocar os arquivos de `imagens/` e o `favicon.svg`.
4. Ajustar o `<meta name="theme-color">` dos três HTML para a cor de fundo do tema.
5. Criar `clientes/<slug>/dados_iniciais.json` com profissionais, expedientes, serviços e produtos.

Não espalhe dado de cliente pelo código: o que for específico de uma barbearia vai para `config.js`, `tema.css` ou `clientes/<slug>/`.

## Funcionalidades

**Cliente (`/agendar`)**
- Fluxo em 4 etapas: serviços (vários, somando preço e duração; começa sem nenhum marcado), profissional ("Sem preferência" ou um barbeiro), dia e horário (próximos 14 dias, horários a cada 15 min) e dados (nome e WhatsApp com máscara).
- A página recebe só a vitrine (serviços, profissionais e produtos). **Os horários livres vêm prontos do servidor** (`horariosDisponiveis`), sem dado de quem já marcou, e são conferidos de novo a cada minuto. O botão de confirmar trava enquanto o servidor responde.
- **Profissional com foto**: cada barbeiro é um cartão (`.profissional`) com retrato redondo, nome e `descricao`, vindos do servidor (a foto cai na do `config.js` enquanto não houver uma enviada). Sem foto, aparece a inicial (`retrato--inicial`). "Sem preferência" mostra os retratos de todos, encavalados. Com 4 barbeiros ou mais, a fileira rola para o lado. O retrato pequeno (`retrato--mini`) aparece também no resumo e na confirmação. Fotos: quadradas, rosto centralizado, 400×400px basta.
- O cliente marca **um atendimento por vez**. Repetição só pelo painel (decisão da barbearia): a rota pública do servidor ignora a repetição.
- O agendamento é **confirmado na hora**: não há etapa de aprovar ou recusar.
- No celular, uma barra fixa embaixo mostra o valor e o próximo passo. No computador, o resumo fica num cartão lateral fixo.
- A tela de confirmação tem "Marcar outro horário" e "Falar com a barbearia" (WhatsApp).

**Loja (`/loja`)**
- Mostra os produtos cadastrados no painel, com foto, descrição e preço. Não vende online.
- O botão "Perguntar" abre o WhatsApp da barbearia com o nome do produto.

**Painel (`/barbeiros`)**: abas embaixo no celular e no topo no computador, navegadas por `#hash`.
- **Agenda**: no computador, semana de segunda a domingo em colunas (estilo kanban), com as horas na esquerda. **No celular (abaixo de 900px) é sempre um dia só**, com uma coluna por profissional (ou uma, com o filtro), cabeçalho com o nome, a quantidade e o valor, e a faixa `.dias` com os 7 dias da semana para trocar de dia (com quantos atendimentos cada um tem). Deslizar o dedo no quadro anda de dia. `colunasDoQuadro()` monta as colunas (`{ data, ids }`) das duas visões, e `visao.dia` guarda o dia escolhido (a semana sai dele). **O quadro cabe inteiro na tela, sem rolagem própria**: `ajustarEscala()` calcula `--px-min` (pixels por minuto) pelo espaço que sobra, com mínimo de 0,72 no celular e 1 no computador (abaixo disso a página rola um pouco). Coluna sem expediente ocupa só a largura do cabeçalho (`max-content`), a não ser que todas estejam fechadas.
  - **Faixa de opções** (`.agenda__faixa`, acima do quadro, numa linha só no computador): `˅ Out 2026` abre o mini calendário (no computador cada linha é uma semana; no celular cada dia é um botão; ponto vermelho nos dias com conflito), depois "Hoje" e as setas (com o calendário fechado andam de dia no celular e de semana no computador; aberto, andam de mês). Ao lado, o filtro de profissional como seletor deslizante (`.seletor`, `role="radiogroup"`: Todos, Santiago, Damigo, com a cor de cada um; aceita toque, arrasto e as setas do teclado). Por último, o botão com o total da semana (no celular, do dia), que abre a lista dos atendimentos por dia; tocar num item abre o detalhe. Calendário e lista são `.suspenso`: abrem por cima do quadro (não mudam a escala), um de cada vez, e fecham com Esc ou clique fora.
  - A legenda dos símbolos fica numa coluna estreita à esquerda do quadro no computador e embaixo dele no celular. Não há botão de novo atendimento: marca-se tocando num horário livre.
  - Atendimento = bloco com o primeiro nome do cliente e símbolos: repetição, o ícone de cada serviço e alerta de conflito. Atendimentos no mesmo horário dividem a coluna lado a lado.
  - Trechos sem atendimento (fora do expediente, pausa, folga, ausência, bloqueio) ficam hachurados, com o motivo quando é o mesmo para todos do filtro. Dia em que ninguém trabalha vira coluna estreita. Linha vermelha marca a hora atual.
  - Tocar num horário livre abre a janela de novo atendimento (`#janelaNovo`, uma `.folha`) com dia, hora e profissional da coluna (ou do filtro).
  - Tocar num atendimento abre uma folha com os detalhes, o lembrete pronto no WhatsApp, "Tornar recorrente" (só em avulsos, de qualquer data), "cancelar só este dia" e "encerrar repetição a partir deste dia".
- **Novo atendimento** (janela aberta pelo horário livre do quadro, não é mais aba nem botão): agendamento manual, com repetição opcional (semanal, quinzenal ou mensal, com 2 a 52 atendimentos ou **sem data para terminar**). O seletor mostra só horários livres. Blocos baixos ganham `bloco--curto` (sem horário) ou `bloco--mini` (uma linha só). Na visão do dia o bloco mostra o nome inteiro do cliente.
- **Horários**: expediente individual de cada profissional por dia da semana (início, fim e pausa), **perfil no agendamento** (nome, descrição e foto; a foto é cortada quadrada em 400px antes de enviar, com `reduzirFoto(arquivo, 400, { quadrada: true })`), folgas e ausências por profissional, feriados e bloqueios da barbearia toda. Incluir ou tirar barbeiro e criar o login dele é pelo admin. Os quatro cartões recolhem (`<details class="cartao cartao--recolhivel">`, seta à direita do título) e começam fechados.
- **Serviços**: cadastrar, editar e remover (nome, preço, duração em passos de 15 min e símbolo na agenda, de `ICONES_DE_SERVICO` em `dados.js`). Cada símbolo tem uma cor própria (tokens `--cor-icone-*` no `tema.css`, aplicados pela classe `icone-servico--<nome>`), para reconhecer o serviço só pela cor. Os serviços ficam no banco; os iniciais vêm do `dados_iniciais.json`. Remover só marca `removido: true`, para os atendimentos antigos continuarem com o nome, e o último serviço não pode ser removido. Mudar preço ou duração não altera quem já marcou, porque o agendamento guarda `preco` e `duracao`.
- **Produtos**: cadastrar, **editar** (reaproveita o formulário) e remover. A foto é reduzida para 900px em JPEG antes de salvar.
- **Relatórios**: funciona como um painel de BI. Filtros numa faixa só no topo (período com atalhos ou datas, profissional, serviço, origem e tipo); indicadores (faturamento, atendimentos, ticket médio, clientes e ocupação da agenda) com variação contra o período anterior; um gráfico em que o barbeiro escolhe o que mostrar (faturamento, atendimentos, horas ou ticket), como agrupar (dia, semana, mês, dia da semana, horário, profissional, serviço, origem, tipo ou cliente) e o tipo (colunas, barras, linha, rosca ou só tabela); e a tabela com os mesmos números, sempre visível.
  - Os números saem das ocorrências no período (repetições abertas dia a dia, `atendimentosDoDia`). Atendimento com vários serviços conta em cada um, com valor e tempo divididos na proporção do preço e da duração dos serviços.
  - Linha só para agrupamentos de tempo; rosca só para categorias com soma (não para ticket nem cliente), com no máximo 5 fatias com cor própria + "Outros". No gráfico, clientes viram os 9 maiores + "Outros"; a tabela traz todos.
  - **CSV**: os atendimentos filtrados, um por linha, no padrão do Excel em português (`;`, vírgula decimal, BOM). Nome começando com `= + - @` ganha um apóstrofo para não virar fórmula.
  - **PDF**: `window.print()` (o barbeiro escolhe "Salvar como PDF"). O `@media print` do `relatorios.css` mostra só o relatório, com cabeçalho da barbearia e filtros; as cores de papel ficam no `@media print` do `tema.css`.
- **Valores**: o servidor manda `preco: null` nos atendimentos dos colegas. A agenda soma só os próprios (`somaDosValores` e `temValor`): cabeçalho, lista e detalhe não mostram valor de colega. O relatório fica travado em quem está logado (`barbeiroTravado()`), sem o filtro e sem o agrupamento por profissional; o administrador vê tudo.
- O painel atualiza sozinho quando outro aparelho muda os dados (`aoMudar`, a cada 30 s e ao voltar para a aba). Cada envio de formulário trava o botão enquanto o servidor responde (`enviando()`), e a resposta passa por `resultado()`, que mostra o erro ou recarrega o estado.

**LGPD**
- Base legal do agendamento: execução do serviço pedido pelo cliente (art. 7º, V). Por isso **não há caixinha de consentimento** (decisão do João): o `/agendar` mostra um aviso com link para a `/privacidade` logo acima da confirmação.
- A barbearia é a controladora; a AR Systems (o João) é a operadora.
- Pedido de apagar: no admin, em Agendamentos, busque o cliente, marque um atendimento dele e rode a ação "LGPD: apagar nome e WhatsApp destes clientes" (`anonimizar_cliente`). Troca nome e telefone por "Cliente removido" e `0000000000` em todos os atendimentos dele, apaga os futuros e encerra as séries. Os números dos relatórios ficam.
- Prazo de guarda: **2 anos sem atendimento** (decisão do João), pelo comando `anonimizar_antigos`.

## Regras de negócio (em `agenda.js` e `barbearia/agenda.py`)

Os nomes em Python são os mesmos em `snake_case` (`profissionalLivre` → `profissional_livre`). Lá, horas são minutos (int), datas são `date`, e o "agora" vem no `Estado`.

- **Disponibilidade** (`profissionalLivre`): o horário cabe no expediente do dia, não pega a pausa, não está no passado e não bate com bloqueio, ausência ou outro atendimento. `motivoIndisponivel` devolve o motivo sem considerar outros clientes.
- **Sem preferência** (`escolherProfissional`): entre os livres em **todas** as datas da série, escolhe o que tem menos atendimentos no primeiro dia.
- **Recorrência**: o agendamento guarda a regra (`repeticao: { frequencia, vezes }`) e não as datas. `ocorreEm(agendamento, data)` calcula se ele cai num dia, considerando `excecoes` (dias cancelados) e `ate` (repetição encerrada).
- **Tornar recorrente** (`tornarRecorrente` em `dados.js`): atendimento de hoje ou futuro vira o primeiro da série. Se já passou, ele fica como está e nasce um agendamento novo na próxima data da regra (`inicioDaRecorrencia`), com o preço e a duração atuais dos serviços. Recusa se o profissional não estiver livre em alguma data da série.
- **Mensal = mesmo dia da semana do mês** ("toda 3ª terça"). A 5ª ocorrência vira "a última do mês". Decisão do usuário: assim o atendimento nunca cai em dia fechado nem num dia 31 que não existe.
- **Sem data para terminar**: os conflitos de uma nova série são conferidos até `config.agenda.horizonteRecorrenciaDias` (180 dias).
- **Mudança de horário com cliente já marcado**: antes de salvar expediente, ausência ou bloqueio, o painel pede ao servidor para simular a mudança (`{ simular: true }`), que devolve só os conflitos novos. Se alguém for atingido, mostra a lista agrupada por cliente e pede "Salvar mesmo assim". Os atendimentos afetados continuam na agenda, com alerta, para o barbeiro remarcar ou cancelar.

## Formato do estado (`GET /api/painel/estado`)

As tabelas estão em `barbearia/models.py`. O front recebe o estado neste formato, o mesmo do antigo `localStorage`:

```js
{
  hoje, ferramentasDeTeste,                                                  // ferramentasDeTeste = DJANGO_DEBUG
  eu: { usuario, nome, profissionalId, administrador },
  profissionais: [{ id, nome, descricao, foto }],
  agendamentos: [{ id, cliente: { nome, telefone }, servicos: [ids], profissionalId, data, inicio,
                   duracao, preco, repeticao: { frequencia, vezes }, excecoes: [datas], ate, origem, criadoEm }],
                                                                             // preco = null nos atendimentos dos colegas
  ausencias:   [{ id, profissionalId, inicio, fim, horaInicio, horaFim }],  // horas vazias = dia inteiro
  bloqueios:   [{ id, data, motivo, horaInicio, horaFim }],
  expedientes: { [profissionalId]: { 0..6: { inicio, fim, pausaInicio, pausaFim } | null } },
  servicos:    [{ id, nome, preco, duracao, icone, removido? }],            // id em texto
  produtos:    [{ id, nome, preco, descricao, foto }]                        // foto = endereço em /midia/ ou null
}
```

Datas são strings `AAAA-MM-DD` e horas são `HH:MM`. Telefones são guardados só com dígitos (10 ou 11, sem DDI).

## Convenções de código

- **Nomes em português** (funções, variáveis, classes CSS), seguindo o código existente. Classes CSS no estilo BEM: `bloco__elemento--modificador`.
- Comentários curtos e só onde explicam o porquê.
- **Mobile-first**: a maioria dos usuários abre pelo celular. Alvos de toque com pelo menos 44px, campos com 16px de fonte (evita o zoom do iOS) e `env(safe-area-inset-*)`. Teste também em 360px.
- **Gráficos**: as cores (`--cor-grafico` para uma série, `--cor-grafico-1..6` e `--cor-grafico-outros` para a rosca) foram validadas com o script do dataviz (faixa de luminosidade, daltonismo e contraste) contra `--cor-superficie` e contra o papel. Ao trocar o tema de um cliente, valide de novo.
- **Cores só por token.** Use `--cor-destaque` (dourado: ações, horário escolhido), `--cor-enfase` (creme: opções escolhidas, botão `.botao--enfase`) e `--cor-barra` (barras e avisos sobrepostos). Não coloque cor fixa no CSS das páginas.
- Fontes: `--fonte-letreiro` (Rye, só para nome, títulos grandes e bordões, com a classe `.letreiro`), `--fonte-titulo` (Roboto Slab) e `--fonte-texto` (Manrope).
- Elementos criados com `el(tag, atributos, ...filhos)` de `ui.js`. Os filhos `false` e `null` são ignorados, mas **em `replaceChildren` não são**: use `cond ? el(...) : ""`.
- Ação destrutiva usa `confirmarNoBotao` (segundo toque no próprio botão), nunca `window.confirm`.
- Animações curtas com `var(--mola)`, respeitando `prefers-reduced-motion`.
- Num grid que contém texto `nowrap`, use `grid-template-columns: minmax(0, 1fr)`, senão a página estoura na horizontal.

## Como testar

- **Backend**: `uv run python manage.py test barbearia` (regras, API, login, fotos e a reserva dupla com dois pedidos simultâneos). Precisa do container do Postgres ligado.
- **Front**: sem testes automáticos no projeto. Na etapa 6 o teste foi feito com o Brave (Flatpak) em headless (`flatpak run com.brave.Browser --headless=new --remote-debugging-port=9222`) e o Playwright ligado nele por CDP (`uv run --with playwright`), contra um **segundo servidor na porta 8001 com um banco de rascunho** (`POSTGRES_DB=rascunho`, que tem prioridade sobre o `.env`), para não mexer nos dados do João. Em 360, 390 e 1280px, conferindo erros de console (o 401 de antes do login e o 400 de senha errada são esperados).
- "Gerar dados de exemplo" troca os atendimentos por uma base de agosto a outubro, com a semana atual lotada (bom para testar agenda e relatórios). "Apagar dados de teste" apaga atendimentos, ausências e bloqueios. Os dois só aparecem com `DJANGO_DEBUG=1`.

## No ar (VPS)

Hostinger, Ubuntu 24.04, IP `187.41.112.224`, no Brasil. Acesso só por chave SSH, com o usuário `joao` (o root não entra). Firewall com 22, 80 e 443, fail2ban e atualizações de segurança automáticas. O domínio `arsystems.com.br` tem o DNS na Cloudflare, com um registro A curinga (`*`) apontando para a VPS, **só DNS** (nuvem cinza: o Caddy precisa ver o IP real para o limite por IP e para tirar o certificado).

```
internet → Caddy (HTTPS automático, /etc/caddy/clientes/<slug>.caddy)
             ├── web/  e  midia/            arquivos, direto do disco
             └── /api/  e  /admin/          → Gunicorn (agenda@<slug>, socket em /run/agenda-<slug>/) → Django → PostgreSQL
```

- `/srv/arsystems`: cópia do repositório só com os scripts (é de onde se roda o `deploy/`).
- `/srv/clientes/<slug>/`: casa do usuário de sistema `<slug>` (sem login), com `codigo/` (outro clone, com o `.env` de produção, só leitura para o usuário), `midia/` e `backups/`. O Caddy está no grupo `<slug>` para ler os arquivos e o socket (o Gunicorn roda com `umask 007`).
- Banco `<slug>`, com papel `<slug>` e **sem senha**: o Django entra pelo socket do Postgres e o Postgres confere o usuário do sistema (peer).
- Tarefas: `backup@<slug>.timer` (3h: `pg_dump` + `midia/`, guarda 14 dias; cópia para fora da VPS se existir `/etc/arsystems/rclone.conf`) e `manutencao@<slug>.timer` (4h: `anonimizar_antigos` e `clearsessions`).
- Logs: `journalctl -u agenda@<slug>` (o `LOGGING` manda os erros do Django para a saída padrão).

Comandos, sempre com `sudo` na VPS:

| Para | Comando |
| --- | --- |
| Pôr no ar o que está no GitHub (faz backup antes) | `sudo /srv/arsystems/deploy/atualizar.sh santiago` |
| Barbearia nova | criar `clientes/<slug>/` no repositório, dar push e `sudo /srv/arsystems/deploy/novo_cliente.sh <slug> <slug>.arsystems.com.br` |
| Comando do Django | `sudo /srv/arsystems/deploy/manage.sh santiago <comando>` (ex.: `createsuperuser`) |
| Backup agora | `sudo systemctl start backup@santiago` |

Em produção (`DJANGO_DEBUG` vazio), o `settings.py` liga HTTPS obrigatório, cookies seguros, HSTS e `CSRF_TRUSTED_ORIGINS` a partir de `DJANGO_HOSTS`. O cache fica no banco (`createcachetable`) para as contagens valerem nos dois processos do Gunicorn. O agendamento público aceita 10 por IP por hora (`AGENDAMENTOS_POR_IP`).

## Pendências (fora do protótipo)

- O front ainda calcula "hoje" e "agora" pelo relógio do aparelho (o servidor usa o fuso da barbearia). Só faz diferença em celular com a hora errada; quem decide se o horário está livre é o servidor.
- Cliente consultar e desmarcar o próprio horário. Lembrete automático no WhatsApp (hoje é um toque, via link `wa.me`).
- Incluir um barbeiro novo pelo painel (hoje é pelo admin: cadastro, expediente e login).
- A política de privacidade foi escrita pelo Claude, sem revisão jurídica. Vale um advogado dar uma olhada antes de vender para muitos clientes.
- Trocar os retratos provisórios pelas fotos reais do Santiago e do Damigo e confirmar as descrições ("Fundador da casa" e "Barbeiro" foram inventadas). Já dá para fazer pelo painel, em Horários → Perfil no agendamento.
- Avaliações no Google: o Google não aceita avaliação enviada pelo site (a API só lê e responde). O caminho é o link direto de avaliação do perfil, pedido pelo WhatsApp depois do atendimento e no rodapé. Regras do Google: não filtrar quem é mandado para lá pela nota e não dar brinde em troca.
