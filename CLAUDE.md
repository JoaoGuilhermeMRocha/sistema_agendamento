# Sistema de agendamento para barbearias

Protótipo de um sistema que o João vai **vender para barbearias**. O primeiro cliente é a **Santiago Barbearia** (Arapoti, PR). Não é multi-tenant: é um **modelo replicado por contratante**. Cada cliente recebe uma cópia própria, em que só mudam a identidade visual, os textos e os contatos. As funcionalidades são as mesmas para todos.

Responda ao usuário em português do Brasil, num tom direto e informal.

## Como rodar

```bash
python server.py
```

- `http://127.0.0.1:8000/agendar`: área do cliente para marcar horário
- `http://127.0.0.1:8000/loja`: vitrine de produtos
- `http://127.0.0.1:8000/barbeiros`: painel dos barbeiros

Não há build, dependências nem framework. É HTML, CSS e JavaScript puro, com módulos ES. Python é usado só para o servidor estático (biblioteca padrão).

O `server.py` entrega uma **lista fechada** de arquivos (`PAGES` e `ASSETS`), mais qualquer imagem `.svg`, `.jpg`, `.png` ou `.webp` que esteja direto em `imagens/`. **Arquivo novo de CSS ou JS precisa entrar em `ASSETS`**, senão dá 404. Depois de mudar o `server.py`, reinicie o servidor.

## Regras de navegação

- `/agendar` e `/loja` são públicas e linkam uma para a outra.
- `/barbeiros` é a área administrativa. Ela linka para as páginas públicas, mas **nenhuma página pública pode linkar para o painel**. O painel tem `noindex` (meta e cabeçalho `X-Robots-Tag`).
- Ainda **não há login**. Ele entra junto com o backend.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `config.js` | **Tudo o que muda por cliente**: nome, selo ("Since 2017"), slogan, endereço, link do Google Maps, WhatsApp, Instagram, profissionais, expediente padrão, parâmetros da agenda, serviços iniciais e produtos iniciais |
| `tema.css` | **Identidade visual por cliente**: fontes, cores (tokens `--cor-*`, incluindo a cor de cada símbolo de serviço), imagens (`--imagem-*`) e cores do xadrez |
| `imagens/` | Imagens do cliente: `capa.jpg` (capa do agendamento), `loja.jpg` (topo da loja), `emblema.svg` (logo redondo, usado também como favicon), `arabesco.svg` (ornamento) e o retrato de cada profissional (hoje `santiago.svg` e `damigo.svg`, silhuetas provisórias até chegarem as fotos) |
| `agenda.js` | Regras de agenda, em **funções puras**: datas, recorrência, disponibilidade, escolha de profissional e conflitos |
| `dados.js` | **Camada de dados**. Hoje grava no `localStorage`; é o único arquivo que troca quando entrar o PostgreSQL. Valida tudo como o servidor vai ter que validar |
| `ui.js` | Peças de interface compartilhadas: `el()`, ícones SVG, `preencherMarca()`, máscara de telefone, links de WhatsApp e Google Maps, aviso flutuante e confirmação com dois toques |
| `base.css` | Base comum: reset, cabeçalho, botões, campos, chips, folha (`<dialog>`) e ornamentos (`.filete`, `.faixa`, `.arabescos`, `.xadrez`, `.capitone`) |
| `agendar.*`, `loja.*`, `barbeiros.*` | HTML, CSS e JS de cada página |
| `relatorios.js`, `relatorios.css` | Aba Relatórios do painel: filtros, indicadores, agrupamento, tabela, CSV e a versão impressa (PDF) |
| `exemplo.js` | Gerador de dados de exemplo (botão "Gerar dados de exemplo" no rodapé do painel): 150 atendimentos em agosto, 150 em setembro e 100 em outubro do ano atual, com 4 séries recorrentes, e a **semana atual lotada** (todo horário livre de cada profissional ganha um atendimento que caiba no espaço). Respeita as regras da agenda e é determinístico (semente fixa). As metas ficam em `METAS` |
| `graficos.js` | Gráficos em SVG puro (colunas, barras, linha e rosca), com dica no mouse, toque e teclado |
| `server.py` | Servidor estático com lista fechada de arquivos |
| `referencias/` | Material de referência da Santiago (logo, posts e fotos do salão). Não é servido nem usado pelo sistema |

As páginas preenchem nome, endereço e contatos a partir do `config.js` (`data-marca="chave"`, `data-link="whatsapp|instagram|mapa"`). O endereço abre o Google Maps: usa `config.mapa` se preenchido, senão busca pelo endereço. O texto escrito no HTML é só um valor provisório.

## Replicar para um novo cliente

1. Editar `config.js`: textos, contatos, serviços iniciais, profissionais (com foto e descrição) e expediente. Trocar o `slug`, que separa os dados salvos de cada barbearia.
2. Editar `tema.css`: fontes, cores e caminhos das imagens.
3. Trocar os arquivos de `imagens/` e o `favicon.svg`.
4. Ajustar o `<meta name="theme-color">` dos três HTML para a cor de fundo do tema.

Não espalhe dado de cliente pelo código: o que for específico de uma barbearia vai para `config.js` ou `tema.css`.

## Funcionalidades

**Cliente (`/agendar`)**
- Fluxo em 4 etapas: serviços (vários, somando preço e duração; começa sem nenhum marcado), profissional ("Sem preferência" ou um barbeiro), dia e horário (próximos 14 dias, horários a cada 15 min) e dados (nome e WhatsApp com máscara).
- **Profissional com foto**: cada barbeiro é um cartão (`.profissional`) com retrato redondo, nome e `descricao`, vindos de `config.profissionais` (`foto` e `descricao`). Sem foto, aparece a inicial (`retrato--inicial`). "Sem preferência" mostra os retratos de todos, encavalados. Com 4 barbeiros ou mais, a fileira rola para o lado. O retrato pequeno (`retrato--mini`) aparece também no resumo e na confirmação. Fotos: quadradas, rosto centralizado, 400×400px basta.
- O cliente marca **um atendimento por vez**. Repetição só pelo painel (decisão da barbearia): o `dados.js` ignora a repetição quando a origem não é `"painel"`.
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
- **Horários**: expediente individual de cada profissional por dia da semana (início, fim e pausa), folgas e ausências por profissional, feriados e bloqueios da barbearia toda. Os três cartões recolhem (`<details class="cartao cartao--recolhivel">`, seta à direita do título) e começam fechados.
- **Serviços**: cadastrar, editar e remover (nome, preço, duração em passos de 15 min e símbolo na agenda, de `ICONES_DE_SERVICO` em `dados.js`). Cada símbolo tem uma cor própria (tokens `--cor-icone-*` no `tema.css`, aplicados pela classe `icone-servico--<nome>`), para reconhecer o serviço só pela cor. Os serviços ficam nos dados salvos; o `config.js` só tem os iniciais. Remover só marca `removido: true`, para os atendimentos antigos continuarem com o nome, e o último serviço não pode ser removido. Mudar preço ou duração não altera quem já marcou, porque o agendamento guarda `preco` e `duracao`.
- **Produtos**: cadastrar, **editar** (reaproveita o formulário) e remover. A foto é reduzida para 900px em JPEG antes de salvar.
- **Relatórios**: funciona como um painel de BI. Filtros numa faixa só no topo (período com atalhos ou datas, profissional, serviço, origem e tipo); indicadores (faturamento, atendimentos, ticket médio, clientes e ocupação da agenda) com variação contra o período anterior; um gráfico em que o barbeiro escolhe o que mostrar (faturamento, atendimentos, horas ou ticket), como agrupar (dia, semana, mês, dia da semana, horário, profissional, serviço, origem, tipo ou cliente) e o tipo (colunas, barras, linha, rosca ou só tabela); e a tabela com os mesmos números, sempre visível.
  - Os números saem das ocorrências no período (repetições abertas dia a dia, `atendimentosDoDia`). Atendimento com vários serviços conta em cada um, com valor e tempo divididos na proporção do preço e da duração dos serviços.
  - Linha só para agrupamentos de tempo; rosca só para categorias com soma (não para ticket nem cliente), com no máximo 5 fatias com cor própria + "Outros". No gráfico, clientes viram os 9 maiores + "Outros"; a tabela traz todos.
  - **CSV**: os atendimentos filtrados, um por linha, no padrão do Excel em português (`;`, vírgula decimal, BOM). Nome começando com `= + - @` ganha um apóstrofo para não virar fórmula.
  - **PDF**: `window.print()` (o barbeiro escolhe "Salvar como PDF"). O `@media print` do `relatorios.css` mostra só o relatório, com cabeçalho da barbearia e filtros; as cores de papel ficam no `@media print` do `tema.css`.
- O painel atualiza sozinho quando outra aba muda os dados (evento `storage`).

## Regras de negócio (em `agenda.js`)

- **Disponibilidade** (`profissionalLivre`): o horário cabe no expediente do dia, não pega a pausa, não está no passado e não bate com bloqueio, ausência ou outro atendimento. `motivoIndisponivel` devolve o motivo sem considerar outros clientes.
- **Sem preferência** (`escolherProfissional`): entre os livres em **todas** as datas da série, escolhe o que tem menos atendimentos no primeiro dia.
- **Recorrência**: o agendamento guarda a regra (`repeticao: { frequencia, vezes }`) e não as datas. `ocorreEm(agendamento, data)` calcula se ele cai num dia, considerando `excecoes` (dias cancelados) e `ate` (repetição encerrada).
- **Tornar recorrente** (`tornarRecorrente` em `dados.js`): atendimento de hoje ou futuro vira o primeiro da série. Se já passou, ele fica como está e nasce um agendamento novo na próxima data da regra (`inicioDaRecorrencia`), com o preço e a duração atuais dos serviços. Recusa se o profissional não estiver livre em alguma data da série.
- **Mensal = mesmo dia da semana do mês** ("toda 3ª terça"). A 5ª ocorrência vira "a última do mês". Decisão do usuário: assim o atendimento nunca cai em dia fechado nem num dia 31 que não existe.
- **Sem data para terminar**: os conflitos de uma nova série são conferidos até `config.agenda.horizonteRecorrenciaDias` (180 dias).
- **Mudança de horário com cliente já marcado**: antes de salvar expediente, ausência ou bloqueio, o painel simula a mudança (`{ simular: true }` em `dados.js`) e compara `conflitosFuturos` antes e depois. Se alguém for atingido, mostra a lista agrupada por cliente e pede "Salvar mesmo assim". Os atendimentos afetados continuam na agenda, com alerta, para o barbeiro remarcar ou cancelar.

## Modelo de dados (`localStorage`, chave `agenda:<slug>:v1`)

```js
{
  proximoId,
  agendamentos: [{ id, cliente: { nome, telefone }, servicos: [ids], profissionalId, data, inicio,
                   duracao, preco, repeticao: { frequencia, vezes }, excecoes: [datas], ate, origem, criadoEm }],
  ausencias:   [{ id, profissionalId, inicio, fim, horaInicio, horaFim }],  // horas vazias = dia inteiro
  bloqueios:   [{ id, data, motivo, horaInicio, horaFim }],
  expedientes: { [profissionalId]: { 0..6: { inicio, fim, pausaInicio, pausaFim } | null } },
  servicos:    [{ id, nome, preco, duracao, icone, removido? }],            // id em texto
  produtos:    [{ id, nome, preco, descricao, foto }]                        // foto = data URL ou null
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

Não há suíte de testes automatizados. Para validar:
- Abra as três páginas **no mesmo navegador**: os dados são do `localStorage`.
- Em sessões anteriores os testes foram feitos com o Brave em modo headless via DevTools Protocol, em 360, 390 e 1280px, conferindo erros de console. O "Apagar dados de teste" do painel zera o estado, e o "Gerar dados de exemplo" troca os atendimentos por uma base de agosto a outubro, com a semana atual lotada (bom para testar agenda e relatórios).

## Pendências (fora do protótipo)

- Backend com PostgreSQL substituindo `dados.js` por chamadas de API, com validação no servidor, trava contra reserva dupla no banco e fuso horário da barbearia (hoje usa o do navegador).
- Login no painel, com acesso por barbeiro. Junto com ele entra o pedido do Santiago: **cada barbeiro vê só os próprios valores**, e isso vale para ele também, que é o dono. Na agenda, os atendimentos dos outros continuam visíveis, mas sem valor (bloco, detalhe, cabeçalhos e lista). Nos relatórios, o barbeiro vê só os próprios dados: o relatório fica travado nele, sem o filtro e sem o agrupamento por profissional.
- Armazenamento real das fotos (hoje são data URLs no `localStorage`).
- Cliente consultar e desmarcar o próprio horário. Lembrete automático no WhatsApp (hoje é um toque, via link `wa.me`).
- LGPD: hoje há só uma linha de aviso no formulário. Falta política de privacidade e consentimento.
- Editar profissionais pelo painel (hoje ficam no `config.js`), incluindo o envio da foto (dá para reaproveitar o `reduzirFoto()` dos produtos).
- Trocar os retratos provisórios pelas fotos reais do Santiago e do Damigo, e confirmar as descrições ("Fundador da casa" e "Barbeiro" foram inventadas).
- Avaliações no Google: o Google não aceita avaliação enviada pelo site (a API só lê e responde). O caminho é o link direto de avaliação do perfil, pedido pelo WhatsApp depois do atendimento e no rodapé. Regras do Google: não filtrar quem é mandado para lá pela nota e não dar brinde em troca.
