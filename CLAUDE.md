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
| `config.js` | **Tudo o que muda por cliente**: nome, selo ("Since 2017"), slogan, endereço, WhatsApp, Instagram, serviços (preço e duração), profissionais, expediente padrão, parâmetros da agenda e produtos iniciais |
| `tema.css` | **Identidade visual por cliente**: fontes, cores (tokens `--cor-*`), imagens (`--imagem-*`) e cores do xadrez |
| `imagens/` | Imagens do cliente: `capa.jpg` (capa do agendamento), `loja.jpg` (topo da loja), `emblema.svg` (logo redondo, usado também como favicon) e `arabesco.svg` (ornamento) |
| `agenda.js` | Regras de agenda, em **funções puras**: datas, recorrência, disponibilidade, escolha de profissional e conflitos |
| `dados.js` | **Camada de dados**. Hoje grava no `localStorage`; é o único arquivo que troca quando entrar o PostgreSQL. Valida tudo como o servidor vai ter que validar |
| `ui.js` | Peças de interface compartilhadas: `el()`, ícones SVG, `preencherMarca()`, máscara de telefone, link de WhatsApp, aviso flutuante e confirmação com dois toques |
| `base.css` | Base comum: reset, cabeçalho, botões, campos, chips, folha (`<dialog>`) e ornamentos (`.filete`, `.faixa`, `.arabescos`, `.xadrez`, `.capitone`) |
| `agendar.*`, `loja.*`, `barbeiros.*` | HTML, CSS e JS de cada página |
| `server.py` | Servidor estático com lista fechada de arquivos |
| `referencias/` | Material de referência da Santiago (logo, posts e fotos do salão). Não é servido nem usado pelo sistema |

As páginas preenchem nome, endereço e contatos a partir do `config.js` (`data-marca="chave"`, `data-link="whatsapp|instagram"`). O texto escrito no HTML é só um valor provisório.

## Replicar para um novo cliente

1. Editar `config.js`: textos, contatos, serviços, profissionais e expediente. Trocar o `slug`, que separa os dados salvos de cada barbearia.
2. Editar `tema.css`: fontes, cores e caminhos das imagens.
3. Trocar os arquivos de `imagens/` e o `favicon.svg`.
4. Ajustar o `<meta name="theme-color">` dos três HTML para a cor de fundo do tema.

Não espalhe dado de cliente pelo código: o que for específico de uma barbearia vai para `config.js` ou `tema.css`.

## Funcionalidades

**Cliente (`/agendar`)**
- Fluxo em 4 etapas: serviços (vários, somando preço e duração), profissional ("Sem preferência" ou um barbeiro), dia e horário (próximos 14 dias, horários a cada 15 min) e dados (nome e WhatsApp com máscara).
- Repetição opcional: semanal, quinzenal ou mensal, com 2 a 52 atendimentos ou **sem data para terminar**.
- O agendamento é **confirmado na hora**: não há etapa de aprovar ou recusar.
- No celular, uma barra fixa embaixo mostra o valor e o próximo passo. No computador, o resumo fica num cartão lateral fixo.
- A tela de confirmação tem "Marcar outro horário" e "Falar com a barbearia" (WhatsApp).

**Loja (`/loja`)**
- Mostra os produtos cadastrados no painel, com foto, descrição e preço. Não vende online.
- O botão "Perguntar" abre o WhatsApp da barbearia com o nome do produto.

**Painel (`/barbeiros`)**: abas embaixo no celular e no topo no computador, navegadas por `#hash`.
- **Agenda**: mês compacto com pontos por dia (vermelhos quando há conflito), lista do dia com total em R$ e filtro por profissional. Tocar num atendimento abre uma folha com os detalhes, o lembrete pronto no WhatsApp, "cancelar só este dia" e "encerrar repetição a partir deste dia".
- **Novo**: agendamento manual. O seletor mostra só horários livres.
- **Horários**: expediente individual de cada profissional por dia da semana (início, fim e pausa), folgas e ausências por profissional, feriados e bloqueios da barbearia toda.
- **Produtos**: cadastrar, **editar** (reaproveita o formulário) e remover. A foto é reduzida para 900px em JPEG antes de salvar.
- O painel atualiza sozinho quando outra aba muda os dados (evento `storage`).

## Regras de negócio (em `agenda.js`)

- **Disponibilidade** (`profissionalLivre`): o horário cabe no expediente do dia, não pega a pausa, não está no passado e não bate com bloqueio, ausência ou outro atendimento. `motivoIndisponivel` devolve o motivo sem considerar outros clientes.
- **Sem preferência** (`escolherProfissional`): entre os livres em **todas** as datas da série, escolhe o que tem menos atendimentos no primeiro dia.
- **Recorrência**: o agendamento guarda a regra (`repeticao: { frequencia, vezes }`) e não as datas. `ocorreEm(agendamento, data)` calcula se ele cai num dia, considerando `excecoes` (dias cancelados) e `ate` (repetição encerrada).
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
  produtos:    [{ id, nome, preco, descricao, foto }]                        // foto = data URL ou null
}
```

Datas são strings `AAAA-MM-DD` e horas são `HH:MM`. Telefones são guardados só com dígitos (10 ou 11, sem DDI).

## Convenções de código

- **Nomes em português** (funções, variáveis, classes CSS), seguindo o código existente. Classes CSS no estilo BEM: `bloco__elemento--modificador`.
- Comentários curtos e só onde explicam o porquê.
- **Mobile-first**: a maioria dos usuários abre pelo celular. Alvos de toque com pelo menos 44px, campos com 16px de fonte (evita o zoom do iOS) e `env(safe-area-inset-*)`. Teste também em 360px.
- **Cores só por token.** Use `--cor-destaque` (dourado: ações, horário escolhido), `--cor-enfase` (creme: opções escolhidas, botão `.botao--enfase`) e `--cor-barra` (barras e avisos sobrepostos). Não coloque cor fixa no CSS das páginas.
- Fontes: `--fonte-letreiro` (Rye, só para nome, títulos grandes e bordões, com a classe `.letreiro`), `--fonte-titulo` (Roboto Slab) e `--fonte-texto` (Manrope).
- Elementos criados com `el(tag, atributos, ...filhos)` de `ui.js`. Os filhos `false` e `null` são ignorados, mas **em `replaceChildren` não são**: use `cond ? el(...) : ""`.
- Ação destrutiva usa `confirmarNoBotao` (segundo toque no próprio botão), nunca `window.confirm`.
- Animações curtas com `var(--mola)`, respeitando `prefers-reduced-motion`.
- Num grid que contém texto `nowrap`, use `grid-template-columns: minmax(0, 1fr)`, senão a página estoura na horizontal.

## Como testar

Não há suíte de testes automatizados. Para validar:
- Abra as três páginas **no mesmo navegador**: os dados são do `localStorage`.
- Em sessões anteriores os testes foram feitos com o Brave em modo headless via DevTools Protocol, em 360, 390 e 1280px, conferindo erros de console. O "Apagar dados de teste" do painel zera o estado.

## Pendências (fora do protótipo)

- Backend com PostgreSQL substituindo `dados.js` por chamadas de API, com validação no servidor, trava contra reserva dupla no banco e fuso horário da barbearia (hoje usa o do navegador).
- Login no painel, com acesso por barbeiro.
- Armazenamento real das fotos (hoje são data URLs no `localStorage`).
- Cliente consultar e desmarcar o próprio horário. Lembrete automático no WhatsApp (hoje é um toque, via link `wa.me`).
- LGPD: hoje há só uma linha de aviso no formulário. Falta política de privacidade e consentimento.
- Editar serviços, preços e profissionais pelo painel (hoje ficam no `config.js`).
