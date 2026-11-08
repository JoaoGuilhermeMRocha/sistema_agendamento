import { config } from "./config.js";
import {
  FREQUENCIAS, atendimentosDoDia, conflitoDoAtendimento, daChave, datasDaSerie, descreverMensal,
  descreverRepeticao, diaFechado, expedienteDoDia, formatarData, formatarMoeda, hoje, horaTexto, horariosLivres,
  inicioDaRecorrencia, inicioDaSemana, minutos, motivoIndisponivel, paraChave, profissionalPorId, servicoPorId,
  servicosAtivos, somarDias, somarServicos, temServicoComum
} from "./agenda.js";
import {
  ICONES_DE_SERVICO, aoMudar, apagarDadosDeTeste, cancelarData, carregar, carregarExemplo, criarAgendamento, criarAusencia,
  criarBloqueio, atualizarProduto, atualizarProfissional, atualizarServico, criarProduto, criarServico, encerrarRepeticao, entrar, removerAusencia,
  removerBloqueio, removerProduto, removerServico, sair, salvarExpediente, salvarTelefone, tornarRecorrente
} from "./dados.js";
import {
  $, aplicarIcones, avisar, capitalizar, confirmarNoBotao, el, formatarTelefone, icone, linkWhatsApp,
  mascararTelefone, preencherMarca
} from "./ui.js";
import { atualizarRelatorios, iniciarRelatorios } from "./relatorios.js";
import { gerarExemplo } from "./exemplo.js";

const DIAS_DA_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const ORDEM_DA_SEMANA = [1, 2, 3, 4, 5, 6, 0];

/* Entrar */

// Mostra a tela de entrar e só termina quando o login dá certo.
function pedirLogin(mensagem) {
  const form = $("#formEntrar");
  const erro = form.querySelector(".campo__erro");
  const botao = form.querySelector('[type="submit"]');
  document.body.dataset.entrar = "";
  $("#entrar").hidden = false;
  erro.textContent = mensagem;
  form.elements.usuario.focus();
  return new Promise(resolver => {
    form.onsubmit = async evento => {
      evento.preventDefault();
      if (botao.disabled) return;
      botao.disabled = true;
      const retorno = await entrar(form.elements.usuario.value.trim(), form.elements.senha.value);
      botao.disabled = false;
      erro.textContent = retorno.ok ? "" : retorno.erro;
      if (!retorno.ok) return;
      form.reset();
      resolver();
    };
  });
}

// O painel só começa a ser montado depois que o estado chega do servidor (o resto do arquivo espera aqui).
async function carregarPainel() {
  let resposta = await carregar();
  while (!resposta.ok) {
    await pedirLogin(resposta.status === 401 ? "" : resposta.erro);
    resposta = await carregar();
  }
  delete document.body.dataset.entrar;
  $("#entrar").hidden = true;
  return resposta;
}

let estado = await carregarPainel();
const visao = {
  filtro: null,
  // Dia escolhido: no celular a agenda mostra só ele; no computador, a semana dele.
  dia: hoje(),
  // Para que lado o quadro desliza ao trocar de dia ou de semana (-1, 0 ou 1).
  direcao: 0,
  // Mês mostrado no mini calendário (pode ser outro que o do dia escolhido).
  ano: new Date().getFullYear(),
  mes: new Date().getMonth(),
  profissionalExpediente: config.profissionais[0].id,
  profissionalPerfil: config.profissionais[0].id
};

const indiceProfissional = id => config.profissionais.findIndex(pessoa => pessoa.id === id);
const nomeProfissional = id => profissionalPorId(id)?.nome ?? "—";
const opcoesProfissionais = () => config.profissionais.map(pessoa => el("option", { value: pessoa.id }, pessoa.nome));

async function recarregar() {
  const novo = await carregar();
  if (novo.ok) estado = novo;
}

// Espera a resposta do servidor: no erro, mostra a mensagem; no acerto, recarrega o estado e avisa.
async function resultado(pedido, mensagem, alvoErro) {
  const retorno = await pedido;
  if (alvoErro) alvoErro.textContent = retorno.ok ? "" : retorno.erro;
  if (!retorno.ok) {
    avisar(retorno.erro, "erro");
    // A sessão acabou (expirou ou alguém saiu em outra aba): volta para a tela de entrar.
    if (retorno.status === 401) setTimeout(() => location.reload(), 1500);
    return false;
  }
  await recarregar();
  avisar(typeof mensagem === "function" ? mensagem(retorno) : mensagem);
  return true;
}

// Trava o botão de envio do formulário enquanto o servidor responde, contra toque duplo.
async function enviando(form, tarefa) {
  const botao = form.querySelector('[type="submit"]');
  if (botao.disabled) return;
  botao.disabled = true;
  try {
    await tarefa();
  } finally {
    botao.disabled = false;
  }
}

/* Abas */

function abrirAba(nome) {
  const aba = document.querySelector(`[data-secao="${nome}"]`) ? nome : "agenda";
  for (const secao of document.querySelectorAll("[data-secao]")) secao.hidden = secao.dataset.secao !== aba;
  for (const link of document.querySelectorAll("[data-aba]")) {
    if (link.dataset.aba === aba) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.body.dataset.aba = aba;
  // Escondido, o quadro não tem tamanho; a escala só pode ser calculada com a aba aberta.
  if (aba === "agenda") ajustarEscala();
  if (aba === "relatorios") atualizarRelatorios();
  window.scrollTo({ top: 0 });
}

window.addEventListener("hashchange", () => abrirAba(location.hash.slice(1)));

/* Agenda: no computador, a semana em colunas; no celular, um dia, com uma coluna por profissional */

const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const CELULAR = matchMedia("(max-width: 899px)");
const visaoDiaria = () => CELULAR.matches;
const ROTULOS_INDISPONIVEL = {
  "Dia de folga do profissional": "Folga",
  "Na pausa do profissional": "Pausa",
  "Profissional ausente": "Ausente"
};

const agoraEmMinutos = () => new Date().getHours() * 60 + new Date().getMinutes();
const idsDoFiltro = () => visao.filtro ? [visao.filtro] : config.profissionais.map(pessoa => pessoa.id);
const semanaEscolhida = () => inicioDaSemana(visao.dia);
const diasDaSemana = () => Array.from({ length: 7 }, (_, indice) => somarDias(semanaEscolhida(), indice));
const doFiltro = agendamento => !visao.filtro || agendamento.profissionalId === visao.filtro;
const doDia = data => atendimentosDoDia(estado, data).filter(doFiltro);
const daColuna = coluna => atendimentosDoDia(estado, coluna.data).filter(item => coluna.ids.includes(item.profissionalId));
// O servidor manda o valor só dos atendimentos de quem está logado: nos dos colegas, preco vem null.
const somaDosValores = atendimentos => atendimentos.reduce((soma, item) => soma + (item.preco ?? 0), 0);
const temValor = atendimentos => atendimentos.some(item => item.preco != null);

// Cada coluna do quadro é um dia e os profissionais que ela mostra.
const colunasDoQuadro = () => visaoDiaria()
  ? idsDoFiltro().map(id => ({ data: visao.dia, ids: [id] }))
  : diasDaSemana().map(data => ({ data, ids: idsDoFiltro() }));
const iconeDeServico = nome => icone(nome, `icone icone-servico icone-servico--${nome}`);
const pxPorMinuto = () => parseFloat(getComputedStyle($("#quadro")).getPropertyValue("--px-min")) || 1.6;

// Filtro de profissional: um seletor deslizante (Todos, um, outro). O cursor anda até a opção escolhida;
// dá para tocar, arrastar ou usar as setas do teclado.
const OPCOES_DO_FILTRO = [{ id: null, nome: "Todos" }, ...config.profissionais];

function escolherFiltro(id, focar = false) {
  if (visao.filtro !== id) {
    visao.filtro = id;
    desenharAgenda();
  }
  if (focar) $(`#filtroAgenda [aria-checked="true"]`).focus();
}

function montarFiltro() {
  const filtro = $("#filtroAgenda");
  filtro.style.setProperty("--opcoes", OPCOES_DO_FILTRO.length);
  filtro.replaceChildren(
    el("span", { class: "seletor__cursor", "aria-hidden": "true" }),
    ...OPCOES_DO_FILTRO.map(pessoa => el("button", {
      type: "button",
      class: "seletor__opcao",
      role: "radio",
      onclick: () => escolherFiltro(pessoa.id)
    },
    pessoa.id && el("span", { class: "chip__cor", "data-profissional": indiceProfissional(pessoa.id) % 4 }),
    el("span", { class: "seletor__nome" }, pessoa.nome))));

  const opcaoNoPonto = evento => {
    const caixa = filtro.getBoundingClientRect();
    const indice = Math.floor((evento.clientX - caixa.left) / caixa.width * OPCOES_DO_FILTRO.length);
    return OPCOES_DO_FILTRO[Math.min(OPCOES_DO_FILTRO.length - 1, Math.max(0, indice))].id;
  };
  let arrastando = false;
  // Com o ponteiro capturado, o clique não chega ao botão: a escolha já acontece no toque.
  filtro.addEventListener("pointerdown", evento => {
    arrastando = true;
    filtro.setPointerCapture(evento.pointerId);
    escolherFiltro(opcaoNoPonto(evento));
  });
  filtro.addEventListener("pointermove", evento => {
    if (arrastando) escolherFiltro(opcaoNoPonto(evento));
  });
  filtro.addEventListener("pointerup", () => { arrastando = false; });
  filtro.addEventListener("pointercancel", () => { arrastando = false; });

  filtro.addEventListener("keydown", evento => {
    const atual = OPCOES_DO_FILTRO.findIndex(pessoa => pessoa.id === visao.filtro);
    const ultimo = OPCOES_DO_FILTRO.length - 1;
    const alvo = { ArrowLeft: atual - 1, ArrowUp: atual - 1, ArrowRight: atual + 1, ArrowDown: atual + 1, Home: 0, End: ultimo }[evento.key];
    if (alvo === undefined) return;
    evento.preventDefault();
    escolherFiltro(OPCOES_DO_FILTRO[Math.min(ultimo, Math.max(0, alvo))].id, true);
  });
}

function desenharFiltro() {
  const escolhida = OPCOES_DO_FILTRO.findIndex(pessoa => pessoa.id === visao.filtro);
  $("#filtroAgenda").style.setProperty("--escolhida", escolhida);
  $("#filtroAgenda").querySelectorAll(".seletor__opcao").forEach((opcao, indice) => {
    opcao.setAttribute("aria-checked", String(indice === escolhida));
    opcao.tabIndex = indice === escolhida ? 0 : -1;
  });
}

function irPara(data) {
  visao.direcao = Math.sign(data.localeCompare(visao.dia));
  visao.dia = data;
  abrirMiniCalendario(false);
  desenharAgenda();
}

// Escolher outra semana mantém o dia da semana (de terça para terça), para o celular não pular de dia.
const irParaSemana = segunda => irPara(somarDias(segunda, (daChave(visao.dia).getDay() + 6) % 7));

// Calendário e lista da semana abrem por cima do quadro, um de cada vez, sem mudar o tamanho dele.
const estaAberto = id => !$(`#${id}`).hidden;

function mostrarSuspenso(botao, aberto) {
  botao.setAttribute("aria-expanded", String(aberto));
  $(`#${botao.getAttribute("aria-controls")}`).hidden = !aberto;
}

function abrirMiniCalendario(aberto) {
  if (aberto) mostrarSuspenso($("#semanaResumo"), false);
  mostrarSuspenso($("#mesTitulo"), aberto);
  // Ao fechar sem escolher, volta para o mês do dia (ou da semana) escolhido.
  if (!aberto) {
    const meio = daChave(visaoDiaria() ? visao.dia : somarDias(semanaEscolhida(), 3));
    visao.ano = meio.getFullYear();
    visao.mes = meio.getMonth();
  }
  desenharMiniCalendario();
}

function abrirListaSemana(aberto) {
  if (aberto) abrirMiniCalendario(false);
  mostrarSuspenso($("#semanaResumo"), aberto);
}

document.addEventListener("pointerdown", evento => {
  if (estaAberto("painelCalendario") && !evento.target.closest("#miniCalendario")) abrirMiniCalendario(false);
  if (estaAberto("listaSemana") && !evento.target.closest("#resumoSemana")) abrirListaSemana(false);
});
document.addEventListener("keydown", evento => {
  if (evento.key !== "Escape") return;
  if (estaAberto("painelCalendario")) {
    abrirMiniCalendario(false);
    $("#mesTitulo").focus();
  }
  if (estaAberto("listaSemana")) {
    abrirListaSemana(false);
    $("#semanaResumo").focus();
  }
});

// Com o calendário fechado, as setas andam de dia (celular) ou de semana; aberto, andam de mês.
const setasAndamNaAgenda = () => !estaAberto("painelCalendario");
const temConflito = data => data >= hoje() && doDia(data).some(item => conflitoDoAtendimento(estado, item, data));

// No computador, cada linha do calendário é uma semana para escolher; no celular, cada dia é um botão.
function desenharMiniCalendario() {
  const primeiro = new Date(visao.ano, visao.mes, 1);
  const ultimo = paraChave(new Date(visao.ano, visao.mes + 1, 0));
  const mes = new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(primeiro).replace(".", "");
  $("#mesNome").textContent = `${capitalizar(mes)} ${visao.ano}`;
  const naAgenda = setasAndamNaAgenda();
  const diaria = visaoDiaria();
  const passo = diaria ? ["Dia anterior", "Próximo dia"] : ["Semana anterior", "Próxima semana"];
  $("#mesAnterior").setAttribute("aria-label", naAgenda ? passo[0] : "Mês anterior");
  $("#mesSeguinte").setAttribute("aria-label", naAgenda ? passo[1] : "Próximo mês");

  const diaDoCalendario = data => {
    const classes = ["mini-calendario__dia"];
    if (daChave(data).getMonth() !== visao.mes) classes.push("mini-calendario__dia--fora");
    if (data === hoje()) classes.push("mini-calendario__dia--hoje");
    if (temConflito(data)) classes.push("mini-calendario__dia--conflito");
    if (!diaria) return el("span", { class: classes.join(" ") }, daChave(data).getDate());
    return el("button", {
      type: "button",
      class: classes.join(" "),
      "aria-pressed": String(data === visao.dia),
      "aria-label": capitalizar(formatarData(data, { weekday: "long", day: "numeric", month: "long" })),
      onclick: () => irPara(data)
    }, daChave(data).getDate());
  };

  const semanas = [];
  for (let segunda = inicioDaSemana(paraChave(primeiro)); segunda <= ultimo; segunda = somarDias(segunda, 7)) {
    const domingo = somarDias(segunda, 6);
    const dias = Array.from({ length: 7 }, (_, indice) => diaDoCalendario(somarDias(segunda, indice)));
    semanas.push(diaria ? el("div", { class: "mini-calendario__semana" }, dias) : el("button", {
      type: "button",
      class: "mini-calendario__semana",
      "aria-pressed": String(segunda === semanaEscolhida()),
      "aria-label": `Semana de ${formatarData(segunda, { day: "numeric", month: "long" })} a ${formatarData(domingo, { day: "numeric", month: "long" })}`,
      onclick: () => irParaSemana(segunda)
    }, dias));
  }
  $("#semanasDoMes").replaceChildren(...semanas);
}

// Celular: faixa com os sete dias da semana do dia escolhido, com quantos atendimentos cada um tem.
function desenharDias() {
  if (!visaoDiaria()) return;
  $("#diasSemana").replaceChildren(...diasDaSemana().map(data => {
    const quantos = doDia(data).length;
    const classes = ["dias__dia"];
    if (data === hoje()) classes.push("dias__dia--hoje");
    if (diaFechado(estado, data, visao.filtro) && !quantos) classes.push("dias__dia--fechado");
    if (temConflito(data)) classes.push("dias__dia--conflito");
    return el("button", {
      type: "button",
      class: classes.join(" "),
      "aria-pressed": String(data === visao.dia),
      "aria-label": `${capitalizar(formatarData(data, { weekday: "long", day: "numeric", month: "long" }))}: ` +
        (quantos ? `${quantos} ${quantos === 1 ? "atendimento" : "atendimentos"}` : "nenhum atendimento"),
      onclick: () => irPara(data)
    },
    el("span", { class: "dias__semana" }, DIAS_CURTOS[daChave(data).getDay()]),
    el("strong", { class: "dias__numero numeros" }, daChave(data).getDate()),
    el("span", { class: "dias__quantos numeros" }, quantos || ""));
  }));
}

// Faixa de horas do quadro: do primeiro início ao último fim das colunas, em horas cheias.
function faixaDoQuadro(colunas) {
  let inicio = Infinity;
  let fim = -Infinity;
  for (const coluna of colunas) {
    for (const id of coluna.ids) {
      const expediente = expedienteDoDia(estado, id, coluna.data);
      if (!expediente) continue;
      inicio = Math.min(inicio, minutos(expediente.inicio));
      fim = Math.max(fim, minutos(expediente.fim));
    }
    for (const agendamento of daColuna(coluna)) {
      inicio = Math.min(inicio, minutos(agendamento.inicio));
      fim = Math.max(fim, minutos(agendamento.inicio) + agendamento.duracao);
    }
  }
  if (inicio === Infinity) return { inicio: 8 * 60, fim: 18 * 60 };
  return { inicio: Math.floor(inicio / 60) * 60, fim: Math.ceil(fim / 60) * 60 };
}

// Trechos em que ninguém da coluna atende: fora do expediente, pausa, folga, ausência ou bloqueio.
function trechosIndisponiveis(coluna, faixa) {
  const passo = config.agenda.intervaloMinutos;
  const trechos = [];
  for (let inicio = faixa.inicio; inicio < faixa.fim; inicio += passo) {
    const motivos = coluna.ids.map(id => motivoIndisponivel(estado, id, coluna.data, inicio, passo));
    if (motivos.some(motivo => !motivo)) continue;
    const motivo = motivos.every(item => item === motivos[0]) ? motivos[0] : "";
    const rotulo = motivo.startsWith("Bloqueio: ") ? motivo.slice(10) : ROTULOS_INDISPONIVEL[motivo] ?? "";
    const anterior = trechos.at(-1);
    if (anterior && anterior.fim === inicio && anterior.rotulo === rotulo) anterior.fim += passo;
    else trechos.push({ inicio, fim: inicio + passo, rotulo });
  }
  return trechos;
}

// Escala mínima do quadro (pixels por minuto) e altura mínima de um bloco, para um serviço de 5 min
// continuar legível. A altura mínima também está no .bloco do barbeiros.css: mudou uma, mude a outra.
const ESCALA_MINIMA = { celular: 0.72, computador: 1 };
const ALTURA_MINIMA_BLOCO = 22;

// Atendimentos que se sobrepõem dividem a largura da coluna, lado a lado. Um bloco curto ocupa na tela
// mais que a sua duração (a altura mínima), então quem começa logo depois dele também vai para o lado.
function distribuirEmFaixas(atendimentos) {
  const escala = CELULAR.matches ? ESCALA_MINIMA.celular : ESCALA_MINIMA.computador;
  const minimo = Math.ceil(ALTURA_MINIMA_BLOCO / escala);
  const itens = atendimentos
    .map(agendamento => {
      const inicio = minutos(agendamento.inicio);
      return { agendamento, inicio, fim: inicio + agendamento.duracao, fimNaTela: inicio + Math.max(agendamento.duracao, minimo) };
    })
    .sort((a, b) => a.inicio - b.inicio || b.fim - a.fim);
  let grupo = [];
  let fimDoGrupo = -1;
  const fecharGrupo = () => {
    const faixas = Math.max(...grupo.map(item => item.faixa)) + 1;
    for (const item of grupo) item.faixas = faixas;
    grupo = [];
  };
  for (const item of itens) {
    if (grupo.length && item.inicio >= fimDoGrupo) fecharGrupo();
    let faixa = 0;
    while (grupo.some(outro => outro.faixa === faixa && outro.fimNaTela > item.inicio)) faixa++;
    item.faixa = faixa;
    grupo.push(item);
    fimDoGrupo = Math.max(fimDoGrupo, item.fimNaTela);
  }
  if (grupo.length) fecharGrupo();
  return itens;
}

function blocoDoAtendimento(item, coluna, faixa) {
  const { agendamento } = item;
  const { data } = coluna;
  const servicos = agendamento.servicos.map(id => servicoPorId(estado, id)).filter(Boolean);
  const repete = agendamento.repeticao.frequencia !== "nenhuma";
  const conflito = data >= hoje() && conflitoDoAtendimento(estado, agendamento, data);
  const passado = data < hoje() || (data === hoje() && item.fim <= agoraEmMinutos());
  const fim = horaTexto(item.fim);
  const classes = ["bloco"];
  if (conflito) classes.push("bloco--conflito");
  if (passado) classes.push("bloco--passado");
  // Dica do mouse no computador: o bloco corta o nome e só mostra os símbolos dos serviços.
  const dica = [
    agendamento.cliente.nome,
    `${agendamento.inicio}–${fim} · ${nomeProfissional(agendamento.profissionalId)}`,
    servicos.map(servico => servico.nome).join(" + "),
    repete && descreverRepeticao(agendamento.repeticao, agendamento.data),
    conflito && `⚠ ${conflito}`
  ].filter(Boolean).join("\n");

  return el("button", {
    type: "button",
    class: classes.join(" "),
    title: dica,
    "data-profissional": indiceProfissional(agendamento.profissionalId) % 4,
    style: `--inicio: ${item.inicio - faixa.inicio}; --duracao: ${agendamento.duracao}; --faixa: ${item.faixa}; --faixas: ${item.faixas}`,
    "aria-label": `${agendamento.inicio} a ${fim}, ${agendamento.cliente.nome}: ${servicos.map(servico => servico.nome).join(" + ")}, ` +
      `com ${nomeProfissional(agendamento.profissionalId)}${repete ? ", recorrente" : ""}${conflito ? `. ${conflito}` : ""}`,
    onclick: () => abrirDetalhe(agendamento.id, data)
  },
  el("span", { class: "bloco__linha" },
    // Na visão do dia a coluna é larga: cabe o nome inteiro.
    el("strong", { class: "bloco__nome" }, visaoDiaria() ? agendamento.cliente.nome : agendamento.cliente.nome.split(" ")[0]),
    el("span", { class: "bloco__simbolos" },
      conflito && icone("alerta", "icone icone--alerta"),
      repete && icone("repetir"),
      servicos.map(servico => iconeDeServico(servico.icone)))),
  el("span", { class: "bloco__hora numeros" },
    `${agendamento.inicio}–${fim}`, coluna.ids.length > 1 ? ` · ${nomeProfissional(agendamento.profissionalId)}` : ""));
}

function colunaDoQuadro(coluna, faixa, fechada) {
  const { data } = coluna;
  const agora = agoraEmMinutos();
  const classes = ["quadro__coluna"];
  if (data < hoje()) classes.push("quadro__coluna--passado");
  if (fechada) classes.push("quadro__coluna--fechada");
  return el("div", {
    class: classes.join(" "),
    "data-dia": data,
    // Coluna de um profissional só: o horário livre tocado já abre com ele escolhido.
    "data-profissional-id": coluna.ids.length === 1 ? coluna.ids[0] : null,
    style: `--minutos: ${faixa.fim - faixa.inicio}`
  },
  trechosIndisponiveis(coluna, faixa).map(trecho => el("div", {
    class: "quadro__fechado",
    style: `--inicio: ${trecho.inicio - faixa.inicio}; --duracao: ${trecho.fim - trecho.inicio}`
  }, trecho.rotulo && el("span", {}, trecho.rotulo))),
  data === hoje() && agora > faixa.inicio && agora < faixa.fim &&
    el("div", { class: "quadro__agora", style: `--inicio: ${agora - faixa.inicio}` }),
  distribuirEmFaixas(daColuna(coluna)).map(item => blocoDoAtendimento(item, coluna, faixa)));
}

function cabecalhoDoDia(data, atendimentos, fechada) {
  const classes = ["quadro__dia"];
  if (data === hoje()) classes.push("quadro__dia--hoje");
  if (fechada) classes.push("quadro__dia--fechado");
  return el("div", { class: classes.join(" ") },
    el("span", { class: "quadro__semana" }, DIAS_CURTOS[daChave(data).getDay()]),
    el("strong", { class: "quadro__numero numeros" }, daChave(data).getDate()),
    el("span", { class: "quadro__total numeros" }, atendimentos.length
      ? [String(atendimentos.length), temValor(atendimentos)
        ? el("span", { class: "quadro__valor" }, ` · ${formatarMoeda(somaDosValores(atendimentos))}`) : ""] : ""));
}

function cabecalhoDoProfissional(id, atendimentos, estreita) {
  return el("div", { class: `quadro__dia quadro__dia--profissional${estreita ? " quadro__dia--fechado" : ""}` },
    el("span", { class: "quadro__profissional" },
      el("span", { class: "chip__cor", "data-profissional": indiceProfissional(id) % 4 }), nomeProfissional(id)),
    el("span", { class: "quadro__total numeros" }, atendimentos.length
      ? `${atendimentos.length}${temValor(atendimentos) ? ` · ${formatarMoeda(somaDosValores(atendimentos))}` : ""}` : ""));
}

function desenharQuadro() {
  const colunas = colunasDoQuadro();
  const faixa = faixaDoQuadro(colunas);
  const fechadas = colunas.map(coluna =>
    coluna.ids.every(id => diaFechado(estado, coluna.data, id)) && !daColuna(coluna).length);
  // Coluna sem expediente fica só com a largura do cabeçalho. Se todas estão fechadas, dividem o espaço.
  const todasFechadas = fechadas.every(Boolean);
  const larguras = fechadas.map(fechada => fechada && !todasFechadas ? "max-content" : "minmax(0, 1fr)");
  const estreita = indice => fechadas[indice] && !todasFechadas;

  const cabecalhos = colunas.map((coluna, indice) => visaoDiaria()
    ? cabecalhoDoProfissional(coluna.ids[0], daColuna(coluna), estreita(indice))
    : cabecalhoDoDia(coluna.data, daColuna(coluna), estreita(indice)));

  const horas = [];
  for (let hora = faixa.inicio; hora < faixa.fim; hora += 60) {
    horas.push(el("span", { class: "numeros", style: `--inicio: ${hora - faixa.inicio}` }, horaTexto(hora)));
  }

  const classes = ["quadro__grade"];
  if (visao.direcao) classes.push(visao.direcao > 0 ? "quadro__grade--avanca" : "quadro__grade--volta");
  visao.direcao = 0;
  const grade = el("div", {
    class: classes.join(" "),
    style: `grid-template-columns: var(--coluna-horas) ${larguras.join(" ")}`
  },
  el("div", { class: "quadro__canto" }),
  cabecalhos,
  el("div", { class: "quadro__horas", style: `--minutos: ${faixa.fim - faixa.inicio}` }, horas),
  colunas.map((coluna, indice) => colunaDoQuadro(coluna, faixa, estreita(indice))));
  grade.dataset.inicio = faixa.inicio;
  grade.dataset.minutos = faixa.fim - faixa.inicio;

  $("#quadro").setAttribute("aria-label", visaoDiaria()
    ? `Atendimentos de ${formatarData(visao.dia, { weekday: "long", day: "numeric", month: "long" })}`
    : "Atendimentos da semana");
  $("#quadro").replaceChildren(grade);
  ajustarEscala();
}

// O quadro inteiro cabe na tela, sem rolar: os minutos se esticam ou encolhem conforme
// o espaço que sobra embaixo dele. Abaixo do mínimo, a página rola um pouco em vez de espremer os blocos.
function ajustarEscala() {
  const quadro = $("#quadro");
  const grade = quadro.querySelector(".quadro__grade");
  if (!grade || !quadro.offsetParent) return;
  const celular = CELULAR.matches;
  const topo = quadro.getBoundingClientRect().top + window.scrollY;
  const cabecalho = quadro.querySelector(".quadro__canto").offsetHeight;
  const abas = celular ? $(".abas").offsetHeight : 0;
  const sobra = window.innerHeight - topo - cabecalho - abas - 10;
  const px = Math.min(2.4, Math.max(celular ? ESCALA_MINIMA.celular : ESCALA_MINIMA.computador, sobra / Number(grade.dataset.minutos)));
  quadro.style.setProperty("--px-min", `${px}px`);
  for (const bloco of quadro.querySelectorAll(".bloco")) {
    const altura = Math.max(Number(bloco.style.getPropertyValue("--duracao")) * px, ALTURA_MINIMA_BLOCO);
    // Abaixo de duas linhas, nome e símbolos dividem uma linha só; abaixo de três, o horário sai.
    bloco.classList.toggle("bloco--mini", altura < 28);
    bloco.classList.toggle("bloco--curto", altura >= 28 && altura < 40);
  }
}

let ajustePendente = false;
window.addEventListener("resize", () => {
  if (ajustePendente) return;
  ajustePendente = true;
  requestAnimationFrame(() => {
    ajustePendente = false;
    ajustarEscala();
  });
});
window.addEventListener("load", ajustarEscala);
// Girar o celular ou redimensionar a janela pode trocar entre a visão do dia e a da semana.
CELULAR.addEventListener("change", () => {
  abrirMiniCalendario(false);
  abrirListaSemana(false);
  desenharAgenda();
});

// Horário livre sob o ponteiro, em passos da agenda. null = passado, fechado ou ocupado.
function horarioLivreNoPonto(evento) {
  const coluna = evento.target.closest(".quadro__coluna");
  if (!coluna || evento.target !== coluna) return null;
  const passo = config.agenda.intervaloMinutos;
  const inicio = Number(coluna.parentElement.dataset.inicio) + Math.floor(evento.offsetY / pxPorMinuto() / passo) * passo;
  const data = coluna.dataset.dia;
  if (data < hoje() || (data === hoje() && inicio <= agoraEmMinutos())) return null;
  return { coluna, data, inicio };
}

$("#quadro").addEventListener("click", evento => {
  const livre = horarioLivreNoPonto(evento);
  if (!livre) return;
  abrirNovo(livre.data, horaTexto(livre.inicio), livre.coluna.dataset.profissionalId);
});

// Celular: deslizar o dedo para o lado troca de dia.
let toqueInicial = null;
$("#quadro").addEventListener("touchstart", evento => {
  toqueInicial = evento.touches.length === 1 ? { x: evento.touches[0].clientX, y: evento.touches[0].clientY } : null;
}, { passive: true });
$("#quadro").addEventListener("touchend", evento => {
  if (!toqueInicial || !visaoDiaria()) return;
  const dx = evento.changedTouches[0].clientX - toqueInicial.x;
  const dy = evento.changedTouches[0].clientY - toqueInicial.y;
  toqueInicial = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) irPara(somarDias(visao.dia, dx < 0 ? 1 : -1));
}, { passive: true });

// No computador, um contorno mostra o horário livre antes do clique.
const fantasma = el("div", { class: "quadro__fantasma", "aria-hidden": "true" });
$("#quadro").addEventListener("pointermove", evento => {
  if (evento.pointerType !== "mouse") return;
  const livre = horarioLivreNoPonto(evento);
  if (!livre) {
    fantasma.remove();
    return;
  }
  const inicioQuadro = Number(livre.coluna.parentElement.dataset.inicio);
  fantasma.style.cssText = `--inicio: ${livre.inicio - inicioQuadro}; --duracao: ${config.agenda.intervaloMinutos}`;
  fantasma.textContent = `+ ${horaTexto(livre.inicio)}`;
  if (fantasma.parentElement !== livre.coluna) livre.coluna.append(fantasma);
});
$("#quadro").addEventListener("pointerleave", () => fantasma.remove());

// Atendimentos da semana (no celular, do dia): o botão mostra quantos e quanto; aberto, lista um por um, por dia.
function itemDaLista(agendamento, data) {
  const servicos = agendamento.servicos.map(id => servicoPorId(estado, id)).filter(Boolean);
  const conflito = data >= hoje() && conflitoDoAtendimento(estado, agendamento, data);
  return el("li", {}, el("button", {
    type: "button",
    class: `lista-semana__item${conflito ? " lista-semana__item--conflito" : ""}`,
    "data-profissional": indiceProfissional(agendamento.profissionalId) % 4,
    onclick: () => {
      abrirListaSemana(false);
      abrirDetalhe(agendamento.id, data);
    }
  },
  el("span", { class: "lista-semana__hora numeros" }, agendamento.inicio),
  el("span", { class: "lista-semana__texto" },
    el("strong", {}, agendamento.cliente.nome),
    el("span", {}, servicos.map(servico => servico.nome).join(" + "),
      visao.filtro ? "" : ` · ${nomeProfissional(agendamento.profissionalId)}`)),
  el("span", { class: "lista-semana__simbolos" },
    conflito && icone("alerta", "icone icone--alerta"),
    agendamento.repeticao.frequencia !== "nenhuma" && icone("repetir"))));
}

function desenharResumoDaSemana() {
  const diaria = visaoDiaria();
  const dias = diaria ? [visao.dia] : diasDaSemana();
  const atendimentos = dias.flatMap(data => doDia(data).map(agendamento => ({ agendamento, data })));
  const doPeriodo = atendimentos.map(item => item.agendamento);
  const total = somaDosValores(doPeriodo);
  const valor = temValor(doPeriodo) ? formatarMoeda(total) : "";
  const conflitos = atendimentos.filter(({ agendamento, data }) =>
    data >= hoje() && conflitoDoAtendimento(estado, agendamento, data)).length;
  const quantos = `${atendimentos.length} ${atendimentos.length === 1 ? "atendimento" : "atendimentos"}`;

  const botao = $("#semanaResumo");
  botao.setAttribute("aria-label", `${quantos} ${diaria ? "no dia" : "na semana"}${valor ? `, ${valor}` : ""}` +
    (conflitos ? `, ${conflitos} para remarcar` : "") + ". Ver lista");
  botao.replaceChildren(
    icone("lista", "icone resumo-semana__lista"),
    el("strong", {}, atendimentos.length),
    el("span", { class: "resumo-semana__rotulo" }, atendimentos.length === 1 ? " atendimento" : " atendimentos"),
    valor ? el("span", { class: "resumo-semana__valor" }, ` · ${valor}`) : "",
    conflitos ? icone("alerta", "icone icone--alerta") : "",
    icone("seta", "icone suspenso__seta"));

  const porDia = dias.map(data => ({ data, itens: doDia(data) })).filter(dia => dia.itens.length);
  $("#listaSemana").replaceChildren(
    el("p", { class: "lista-semana__total numeros" }, `${quantos}${valor ? ` · ${valor}` : ""}`,
      conflitos ? el("span", {}, ` · ${conflitos} para remarcar`) : ""),
    ...porDia.map(({ data, itens }) => el("section", { class: "lista-semana__dia" },
      el("h3", { class: "lista-semana__data" },
        capitalizar(formatarData(data, { weekday: "long", day: "numeric", month: "short" })),
        temValor(itens) ? el("span", { class: "numeros" }, formatarMoeda(somaDosValores(itens))) : ""),
      el("ul", {}, itens.map(agendamento => itemDaLista(agendamento, data))))),
    porDia.length ? "" : el("p", { class: "lista-semana__vazia" },
      `Nenhum atendimento ${diaria ? "neste dia" : "nesta semana"}. Toque num horário livre da agenda para marcar.`));
}

function desenharLegenda() {
  $("#legendaAgenda").replaceChildren(
    el("span", {}, icone("repetir"), "Recorrente"),
    ...servicosAtivos(estado).map(servico => el("span", {}, iconeDeServico(servico.icone), servico.nome)),
    el("span", {}, icone("alerta", "icone icone--alerta"), "Remarcar"),
    el("span", { class: "legenda__dica" }, icone("mais"),
      `Horário livre: ${matchMedia("(hover: hover)").matches ? "clique" : "toque"} para marcar`));
}

function desenharAgenda() {
  desenharFiltro();
  desenharMiniCalendario();
  desenharResumoDaSemana();
  desenharDias();
  desenharQuadro();
  desenharLegenda();
}

function mudarMes(diferenca) {
  const alvo = new Date(visao.ano, visao.mes + diferenca, 1);
  visao.ano = alvo.getFullYear();
  visao.mes = alvo.getMonth();
  desenharMiniCalendario();
}

const andar = direcao => setasAndamNaAgenda()
  ? irPara(somarDias(visao.dia, direcao * (visaoDiaria() ? 1 : 7)))
  : mudarMes(direcao);
$("#mesAnterior").addEventListener("click", () => andar(-1));
$("#mesSeguinte").addEventListener("click", () => andar(1));
$("#irHoje").addEventListener("click", () => irPara(hoje()));
$("#mesTitulo").addEventListener("click", () => abrirMiniCalendario(!estaAberto("painelCalendario")));
$("#semanaResumo").addEventListener("click", () => abrirListaSemana(!estaAberto("listaSemana")));

/* Detalhe de um atendimento */

function abrirDetalhe(id, data) {
  const agendamento = estado.agendamentos.find(item => item.id === id);
  if (!agendamento) return;

  const { nomes, duracao } = somarServicos(estado, agendamento.servicos);
  const profissional = nomeProfissional(agendamento.profissionalId);
  const fim = horaTexto(minutos(agendamento.inicio) + agendamento.duracao);
  const repete = agendamento.repeticao.frequencia !== "nenhuma";
  const lembrete =
    `Olá, ${agendamento.cliente.nome.split(" ")[0]}! Passando para lembrar do seu horário na ${config.nome}: ` +
    `${formatarData(data, { weekday: "long", day: "2-digit", month: "2-digit" })} às ${agendamento.inicio}, ` +
    `${nomes.toLowerCase()} com ${profissional}. Até lá!`;

  const cancelar = el("button", { type: "button", class: "botao botao--perigo botao--largo" },
    repete ? "Cancelar só este dia" : "Cancelar atendimento");
  confirmarNoBotao(cancelar, "Toque de novo para cancelar", async () => {
    if (await resultado(cancelarData(id, data), "Atendimento cancelado.")) fecharDetalhe();
  });

  let encerrar = null;
  if (repete) {
    encerrar = el("button", { type: "button", class: "botao botao--perigo botao--largo" }, "Encerrar repetição a partir deste dia");
    confirmarNoBotao(encerrar, "Toque de novo para encerrar", async () => {
      if (await resultado(encerrarRepeticao(id, data), "Repetição encerrada.")) fecharDetalhe();
    });
  }

  const conflito = data >= hoje() && conflitoDoAtendimento(estado, agendamento, data);
  $("#detalheConteudo").replaceChildren(
    conflito ? el("p", { class: "detalhe__conflito" }, icone("alerta"),
      el("span", {}, el("strong", {}, conflito), " Avise o cliente e remarque, ou cancele este dia.")) : "",
    el("p", { class: "detalhe__quando numeros" },
      `${capitalizar(formatarData(data, { weekday: "long", day: "numeric", month: "long" }))} · ${agendamento.inicio}–${fim}`),
    el("h2", { id: "detalheTitulo", class: "detalhe__nome" }, agendamento.cliente.nome),
    el("dl", { class: "detalhe__lista" },
      [["Serviços", `${nomes} · ${duracao} min`],
        ["Profissional", profissional],
        agendamento.preco != null && ["Valor", formatarMoeda(agendamento.preco)],
        ["WhatsApp", agendamento.cliente.telefone ? formatarTelefone(agendamento.cliente.telefone) : "Não informado"],
        ["Repetição", descreverRepeticao(agendamento.repeticao, agendamento.data)],
        ["Marcado", agendamento.origem === "cliente" ? "Pelo cliente, no site" : "Pelo painel"]
      ].filter(Boolean).map(([rotulo, valor]) => el("div", {}, el("dt", {}, rotulo), el("dd", {}, valor)))),
    el("div", { class: "detalhe__acoes" },
      agendamento.cliente.telefone
        ? el("a", {
          class: "botao botao--destaque botao--largo",
          href: linkWhatsApp(agendamento.cliente.telefone, lembrete),
          target: "_blank",
          rel: "noopener"
        }, icone("mensagem"), "Enviar lembrete no WhatsApp")
        : painelTelefone(agendamento, data),
      repete ? "" : painelRecorrencia(agendamento),
      cancelar,
      encerrar,
      el("button", { type: "button", class: "botao botao--contorno botao--largo", onclick: fecharDetalhe }, "Fechar")));

  $("#detalhe").showModal();
}

// Atendimento marcado sem número: no lugar do lembrete, um campo para pôr o WhatsApp
// (vale para todas as datas da série). Depois de salvo, o detalhe abre de novo, já com o lembrete.
function painelTelefone(agendamento, data) {
  const area = el("form", { class: "recorrencia", hidden: true, novalidate: true });
  const abrir = el("button", { type: "button", class: "botao botao--destaque botao--largo", "aria-expanded": "false" },
    icone("mais"), "Adicionar número");
  const campo = el("input", {
    name: "telefone", class: "entrada numeros", type: "tel", inputmode: "tel", placeholder: "(00) 00000-0000",
    maxlength: 15, autocomplete: "off", "aria-label": "WhatsApp com DDD"
  });
  const erro = el("p", { class: "campo__erro", role: "alert" });
  mascararTelefone(campo);

  area.append(
    el("label", { class: "campo" }, el("span", { class: "campo__rotulo" }, "WhatsApp com DDD"), campo),
    erro,
    el("button", { type: "submit", class: "botao botao--destaque botao--largo" }, "Salvar número"));
  area.addEventListener("submit", evento => {
    evento.preventDefault();
    enviando(area, async () => {
      if (await resultado(salvarTelefone(agendamento.id, campo.value), "Número salvo.", erro)) abrirDetalhe(agendamento.id, data);
    });
  });

  abrir.addEventListener("click", () => {
    area.hidden = !area.hidden;
    abrir.setAttribute("aria-expanded", String(!area.hidden));
    if (!area.hidden) {
      area.scrollIntoView({ block: "nearest", behavior: "smooth" });
      campo.focus();
    }
  });
  return [abrir, area];
}

// "Tornar recorrente": vale para atendimento avulso de qualquer data (passado, hoje ou futuro).
function painelRecorrencia(agendamento) {
  const area = el("div", { class: "recorrencia", hidden: true });
  const abrir = el("button", { type: "button", class: "botao botao--contorno botao--largo", "aria-expanded": "false" },
    icone("repetir"), "Tornar recorrente");
  const vezes = el("input", {
    class: "entrada numeros", type: "number", min: 2, max: config.agenda.maxAtendimentosRepetidos, value: 4,
    inputmode: "numeric", "aria-label": "Quantos atendimentos"
  });
  const semFim = el("input", { type: "checkbox" });
  const previa = el("p", { class: "recorrencia__previa numeros" });
  const erro = el("p", { class: "campo__erro", role: "alert" });

  const ler = () => ({
    frequencia: area.querySelector('input[name="recFrequencia"]:checked').value,
    vezes: semFim.checked ? null : Number(vezes.value)
  });

  const atualizar = () => {
    const regra = ler();
    vezes.disabled = semFim.checked;
    const primeira = inicioDaRecorrencia(agendamento, regra.frequencia);
    const datas = datasDaSerie(primeira, { ...regra, vezes: regra.vezes == null ? null : Math.max(2, regra.vezes || 2) });
    const lista = datas.slice(0, 4).map(data => formatarData(data, { weekday: "short", day: "2-digit", month: "2-digit" })).join(", ");
    previa.textContent =
      (primeira !== agendamento.data ? `Este já passou: a repetição começa em ${formatarData(primeira)}. ` : "") +
      (regra.frequencia === "mensal" ? `${descreverMensal(primeira)}: ` : "") +
      lista + (regra.vezes == null || datas.length > 4 ? "…" : ".");
  };

  const confirmar = el("button", {
    type: "button",
    class: "botao botao--destaque botao--largo",
    onclick: async evento => {
      const botao = evento.currentTarget;
      if (botao.disabled) return;
      botao.disabled = true;
      const pronto = await resultado(tornarRecorrente(agendamento.id, ler()), "Pronto, o horário agora se repete.", erro);
      botao.disabled = false;
      if (pronto) fecharDetalhe();
    }
  }, "Confirmar repetição");

  area.append(
    el("span", { class: "campo__rotulo" }, "De quanto em quanto tempo?"),
    el("div", { class: "chips", role: "radiogroup", "aria-label": "Frequência" },
      ["semanal", "quinzenal", "trissemanal", "mensal"].map((frequencia, indice) => el("label", { class: "chip" },
        el("input", { type: "radio", name: "recFrequencia", value: frequencia, checked: indice === 0 }), FREQUENCIAS[frequencia]))),
    el("span", { class: "campo__rotulo" }, "Quantos atendimentos?"),
    el("div", { class: "quantidade" }, vezes, el("label", { class: "chip" }, semFim, "Sem fim")),
    previa, erro, confirmar);
  area.addEventListener("input", atualizar);
  area.addEventListener("change", atualizar);

  abrir.addEventListener("click", () => {
    area.hidden = !area.hidden;
    abrir.setAttribute("aria-expanded", String(!area.hidden));
    if (!area.hidden) {
      atualizar();
      area.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
  return [abrir, area];
}

function fecharDetalhe() {
  $("#detalhe").close();
  desenharAgenda();
}

// Tocar fora da folha, ou no X, fecha.
for (const folha of document.querySelectorAll(".folha")) {
  folha.addEventListener("click", evento => {
    if (evento.target === folha || evento.target.closest("[data-fechar]")) folha.close();
  });
}

/* Novo agendamento pelo painel */

const formNovo = $("#formNovo");

// Mantém os serviços já marcados quando a lista muda; sem nenhum comum, marca o primeiro comum.
function desenharServicosNovo() {
  const ativos = servicosAtivos(estado);
  const marcados = new FormData(formNovo).getAll("servico").filter(id => ativos.some(servico => servico.id === id));
  if (!temServicoComum(estado, marcados)) marcados.push(ativos.find(servico => !servico.complementar)?.id);
  $("#novoServicos").replaceChildren(...ativos.map(servico => el("label", { class: "chip" },
    el("input", { type: "checkbox", name: "servico", value: servico.id, checked: marcados.includes(servico.id) }),
    `${servico.nome} · ${formatarMoeda(servico.preco)}`)));
  travarComplementaresNovo();
}

// Complementar só vale junto com um serviço comum: sem nenhum comum marcado, ele desmarca e trava.
function travarComplementaresNovo() {
  const comum = temServicoComum(estado, new FormData(formNovo).getAll("servico"));
  for (const caixa of $("#novoServicos").querySelectorAll('input[name="servico"]')) {
    if (!servicoPorId(estado, caixa.value)?.complementar) continue;
    if (!comum) caixa.checked = false;
    caixa.disabled = !comum;
  }
}

function desenharFormNovo() {
  desenharServicosNovo();
  $("#novoProfissional").replaceChildren(...opcoesProfissionais());
  $("#novoData").min = hoje();
  $("#novoData").value = proximoDiaAberto(hoje());
  $("#novoVezes").max = config.agenda.maxAtendimentosRepetidos;
}

function proximoDiaAberto(data) {
  for (let dia = 0; dia < 14 && diaFechado(estado, data); dia++) data = somarDias(data, 1);
  return data;
}

function lerFormNovo() {
  const valores = new FormData(formNovo);
  const frequencia = valores.get("frequencia");
  return {
    servicos: valores.getAll("servico"),
    profissionalId: valores.get("profissional"),
    data: valores.get("data"),
    repeticao: frequencia === "nenhuma"
      ? { frequencia, vezes: 1 }
      : { frequencia, vezes: $("#novoSemFim").checked ? null : Number(valores.get("vezes")) }
  };
}

function atualizarHorariosNovo() {
  travarComplementaresNovo();
  const { servicos, profissionalId, data, repeticao } = lerFormNovo();
  const { duracao, preco } = somarServicos(estado, servicos);
  const repete = repeticao.frequencia !== "nenhuma";

  $("#novoQuantidade").hidden = !repete;
  $("#novoVezes").disabled = $("#novoSemFim").checked;

  const anterior = horarioDesejado ?? $("#novoHorario").value;
  horarioDesejado = null;
  const quantidadeValida = repeticao.frequencia === "nenhuma" || repeticao.vezes == null || repeticao.vezes >= 2;
  const horarios = data && duracao && quantidadeValida
    ? horariosLivres(estado, { data, repeticao, duracao, profissionalId }) : [];
  $("#novoHorario").replaceChildren(...(horarios.length
    ? horarios.map(horario => el("option", { value: horario, selected: horario === anterior }, horario))
    : [el("option", { value: "" }, duracao ? "Nenhum horário livre neste dia" : "Escolha um serviço")]));
  $("#novoHorario").disabled = !horarios.length;
  atualizarQuandoNovo();

  const regra = repeticao.frequencia === "mensal" && data ? ` · ${descreverMensal(data)}` : "";
  $("#novoResumo").textContent = duracao
    ? `${duracao} min · ${formatarMoeda(preco)}${repete ? " por atendimento" : ""}${regra}` : "";
}

// Janela de novo atendimento: vem com o dia e a hora tocados no quadro e o profissional da coluna
// (ou do filtro).
let horarioDesejado = null;
function abrirNovo(data, horario = null, profissionalId = visao.filtro) {
  formNovo.elements.nome.value = "";
  formNovo.elements.telefone.value = "";
  $("#novoErro").textContent = "";
  $("#novoData").value = data;
  horarioDesejado = horario;
  if (profissionalId) $("#novoProfissional").value = profissionalId;
  atualizarHorariosNovo();
  $("#janelaNovo").showModal();
  // No celular, focar o nome já abriria o teclado por cima da janela.
  if (matchMedia("(hover: hover)").matches) formNovo.elements.nome.focus();
}

function atualizarQuandoNovo() {
  const data = $("#novoData").value;
  const horario = $("#novoHorario").value;
  $("#novoQuando").textContent = data
    ? capitalizar(formatarData(data, { weekday: "long", day: "numeric", month: "long" })) + (horario ? ` · ${horario}` : "")
    : "";
}

formNovo.addEventListener("input", atualizarHorariosNovo);
formNovo.addEventListener("change", atualizarHorariosNovo);

formNovo.addEventListener("submit", evento => {
  evento.preventDefault();
  enviando(formNovo, async () => {
    const valores = new FormData(formNovo);
    const dados = lerFormNovo();
    const pedido = criarAgendamento({
      ...dados,
      nome: valores.get("nome"),
      telefone: valores.get("telefone"),
      inicio: valores.get("horario"),
      origem: "painel"
    });
    if (!(await resultado(pedido, "Horário marcado.", $("#novoErro")))) return;

    $("#janelaNovo").close();
    irPara(dados.data);
  });
});

/* Aviso antes de mudanças que atingem quem já tem horário */

function limparImpacto(form) {
  const caixa = form.querySelector(".impacto");
  const botao = form.querySelector('[type="submit"]');
  caixa.hidden = true;
  delete form.dataset.confirmado;
  if (botao.dataset.rotulo) botao.textContent = botao.dataset.rotulo;
  delete botao.dataset.rotulo;
}

// Pede ao servidor para simular a mudança (nada é gravado) e, se ela deixar alguém marcado fora do
// horário de atendimento, mostra a lista e pede um segundo envio para confirmar. true = pode salvar.
async function podeSalvar(form, simular) {
  if (form.dataset.confirmado) return true;
  const previa = await simular();
  // Se a simulação falhar, o envio de verdade mostra o erro.
  if (!previa.ok || !previa.conflitos.length) return true;

  // Um cliente fixo aparece uma vez só, com a primeira data atingida e quantas vêm depois.
  const porCliente = new Map();
  for (const item of previa.conflitos) {
    const grupo = porCliente.get(item.id) ?? { ...item, datas: 0 };
    grupo.datas++;
    porCliente.set(item.id, grupo);
  }
  const grupos = [...porCliente.values()];

  const caixa = form.querySelector(".impacto");
  const botao = form.querySelector('[type="submit"]');
  caixa.replaceChildren(
    el("p", { class: "impacto__titulo" }, icone("alerta"),
      `Isso atinge ${grupos.length} ${grupos.length === 1 ? "cliente já marcado" : "clientes já marcados"}:`),
    el("ul", { class: "impacto__lista numeros" }, grupos.slice(0, 5).map(({ cliente, profissionalId, data, inicio, datas }) => el("li", {},
      `${cliente} (${nomeProfissional(profissionalId)}) · ` +
      `${formatarData(data, { weekday: "short", day: "2-digit", month: "2-digit" })} às ${inicio}` +
      (datas > 1 ? ` e mais ${datas - 1} ${datas === 2 ? "data" : "datas"}` : "")))),
    grupos.length > 5 ? el("p", {}, `e mais ${grupos.length - 5} clientes.`) : "",
    el("p", {}, "Se salvar, esses horários continuam na agenda com um alerta, para você avisar o cliente e remarcar ou cancelar."),
    el("button", { type: "button", class: "botao botao--contorno botao--pequeno", onclick: () => limparImpacto(form) }, "Revisar"));
  caixa.hidden = false;
  form.dataset.confirmado = "true";
  botao.dataset.rotulo = botao.textContent;
  botao.textContent = "Salvar mesmo assim";
  caixa.scrollIntoView({ block: "nearest" });
  return false;
}

for (const form of document.querySelectorAll("#formExpediente, #formAusencia, #formBloqueio")) {
  form.addEventListener("input", () => limparImpacto(form));
  form.addEventListener("change", () => limparImpacto(form));
}

/* Expediente */

function desenharExpediente() {
  $("#profExpediente").replaceChildren(...config.profissionais.map(pessoa => el("button", {
    type: "button",
    class: "chip",
    "aria-pressed": String(pessoa.id === visao.profissionalExpediente),
    onclick: () => {
      visao.profissionalExpediente = pessoa.id;
      desenharExpediente();
    }
  }, pessoa.nome)));

  const expediente = estado.expedientes[visao.profissionalExpediente];
  $("#semana").replaceChildren(...ORDEM_DA_SEMANA.map(dia => {
    const atual = expediente[dia];
    const hora = (nome, rotulo, valor) => el("label", { class: "campo" },
      el("span", { class: "campo__rotulo" }, rotulo),
      el("input", { class: "entrada numeros", type: "time", name: `${nome}-${dia}`, value: valor || "" }));
    const horas = el("div", { class: "semana__horas", hidden: !atual },
      hora("inicio", "Começa", atual?.inicio ?? "09:00"),
      hora("fim", "Termina", atual?.fim ?? "18:00"),
      hora("pausaInicio", "Pausa das", atual?.pausaInicio),
      hora("pausaFim", "até", atual?.pausaFim),
      hora("filaInicio", "Sequencial das", atual?.filaInicio),
      hora("filaFim", "até", atual?.filaFim));
    const estadoDia = el("small", { class: "semana__estado" }, atual ? "" : "folga");
    const ativo = el("input", { type: "checkbox", role: "switch", name: `ativo-${dia}`, checked: Boolean(atual) });
    ativo.addEventListener("change", () => {
      horas.hidden = !ativo.checked;
      estadoDia.textContent = ativo.checked ? "" : "folga";
    });

    return el("div", { class: "semana__dia" },
      el("label", { class: "alternador" }, el("span", {}, DIAS_DA_SEMANA[dia], estadoDia), ativo),
      horas);
  }));
  limparImpacto($("#formExpediente"));
  $("#salvarExpediente").textContent = `Salvar expediente de ${nomeProfissional(visao.profissionalExpediente)}`;
  $("#expedienteErro").textContent = "";
}

$("#formExpediente").addEventListener("submit", evento => {
  evento.preventDefault();
  const valores = new FormData(evento.currentTarget);
  const dias = {};
  for (let dia = 0; dia < 7; dia++) {
    dias[dia] = valores.get(`ativo-${dia}`) ? {
      inicio: valores.get(`inicio-${dia}`),
      fim: valores.get(`fim-${dia}`),
      pausaInicio: valores.get(`pausaInicio-${dia}`),
      pausaFim: valores.get(`pausaFim-${dia}`),
      filaInicio: valores.get(`filaInicio-${dia}`),
      filaFim: valores.get(`filaFim-${dia}`)
    } : null;
  }
  const id = visao.profissionalExpediente;
  const form = evento.currentTarget;
  enviando(form, async () => {
    if (!(await podeSalvar(form, () => salvarExpediente(id, dias, { simular: true })))) return;
    if (await resultado(salvarExpediente(id, dias), `Expediente de ${nomeProfissional(id)} salvo.`, $("#expedienteErro"))) {
      desenharExpediente();
      desenharAgenda();
    }
  });
});

/* Ausências e bloqueios */

const horasTexto = item => (item.horaInicio ? `${item.horaInicio}–${item.horaFim}` : "dia inteiro");

function registro(texto, detalhe, aoRemover) {
  const remover = el("button", { type: "button", class: "botao botao--perigo botao--pequeno" }, "Remover");
  confirmarNoBotao(remover, "Confirmar", aoRemover);
  return el("li", { class: "registro" },
    el("div", { class: "registro__texto" }, el("strong", {}, texto), el("span", { class: "numeros" }, detalhe)),
    remover);
}

function desenharAusencias() {
  const futuras = estado.ausencias.filter(item => item.fim >= hoje()).sort((a, b) => a.inicio.localeCompare(b.inicio));
  $("#listaAusencias").replaceChildren(...futuras.map(item => registro(
    nomeProfissional(item.profissionalId),
    `${item.inicio === item.fim ? formatarData(item.inicio) : `${formatarData(item.inicio)} a ${formatarData(item.fim)}`} · ${horasTexto(item)}`,
    async () => (await resultado(removerAusencia(item.id), "Ausência removida.")) && atualizarTudo())));
}

function desenharBloqueios() {
  const futuros = estado.bloqueios.filter(item => item.data >= hoje()).sort((a, b) => a.data.localeCompare(b.data));
  $("#listaBloqueios").replaceChildren(...futuros.map(item => registro(
    item.motivo,
    `${formatarData(item.data, { weekday: "short", day: "2-digit", month: "2-digit" })} · ${horasTexto(item)}`,
    async () => (await resultado(removerBloqueio(item.id), "Bloqueio removido.")) && atualizarTudo())));
}

function ligarFormulario(seletor, salvar, mensagem) {
  const form = $(seletor);
  form.addEventListener("submit", evento => {
    evento.preventDefault();
    const valores = Object.fromEntries(new FormData(form));
    enviando(form, async () => {
      if (!(await podeSalvar(form, () => salvar(valores, { simular: true })))) return;
      if (await resultado(salvar(valores), mensagem, form.querySelector(".campo__erro"))) {
        form.reset();
        limparImpacto(form);
        atualizarTudo();
      }
    });
  });
}

ligarFormulario("#formAusencia", criarAusencia, "Ausência registrada.");
ligarFormulario("#formBloqueio", criarBloqueio, "Bloqueio adicionado.");

/* Serviços */

const formServico = $("#formServico");
let servicoEditado = null;

// "45 min", "1h (60 min)", "1h15 (75 min)".
function rotuloDaDuracao(minutos) {
  if (minutos < 60) return `${minutos} min`;
  const resto = minutos % 60;
  return `${Math.floor(minutos / 60)}h${resto ? String(resto).padStart(2, "0") : ""} (${minutos} min)`;
}

function preencherDuracoes(atual = 30) {
  const { passoDuracaoMinutos: passo, duracaoMaximaMinutos: maxima } = config.agenda;
  const opcoes = Array.from({ length: maxima / passo }, (_, indice) => (indice + 1) * passo);
  if (!opcoes.includes(atual)) opcoes.push(atual);
  $("#servicoDuracao").replaceChildren(...opcoes.sort((a, b) => a - b).map(valor =>
    el("option", { value: valor, selected: valor === atual }, rotuloDaDuracao(valor))));
}

function desenharIconesDeServico() {
  $("#servicoIcones").replaceChildren(...Object.entries(ICONES_DE_SERVICO).map(([nome, rotulo], indice) =>
    el("label", { class: "chip" }, el("input", { type: "radio", name: "icone", value: nome, checked: indice === 0 }), iconeDeServico(nome), rotulo)));
}

function sairDaEdicaoServico() {
  servicoEditado = null;
  formServico.reset();
  formServico.querySelector(".campo__erro").textContent = "";
  preencherDuracoes();
  $("#servicoTitulo").textContent = "Novo serviço";
  $("#salvarServico").textContent = "Adicionar serviço";
  $("#cancelarEdicaoServico").hidden = true;
  desenharServicos();
}

function editarServico(servico) {
  servicoEditado = servico.id;
  formServico.querySelector(".campo__erro").textContent = "";
  formServico.elements.nome.value = servico.nome;
  formServico.elements.preco.value = servico.preco.toFixed(2).replace(".", ",");
  preencherDuracoes(servico.duracao);
  formServico.querySelector(`input[name="icone"][value="${servico.icone}"]`).checked = true;
  formServico.elements.complementar.checked = Boolean(servico.complementar);
  $("#servicoTitulo").textContent = "Editar serviço";
  $("#salvarServico").textContent = "Salvar alterações";
  $("#cancelarEdicaoServico").hidden = false;
  desenharServicos();
  formServico.scrollIntoView({ block: "start" });
  formServico.elements.preco.focus({ preventScroll: true });
}

$("#cancelarEdicaoServico").addEventListener("click", sairDaEdicaoServico);

formServico.addEventListener("submit", evento => {
  evento.preventDefault();
  const valores = new FormData(formServico);
  const dados = {
    nome: valores.get("nome"),
    preco: String(valores.get("preco")).replace(/\./g, "").replace(",", "."),
    duracao: valores.get("duracao"),
    icone: valores.get("icone"),
    complementar: valores.has("complementar")
  };
  enviando(formServico, async () => {
    const pedido = servicoEditado ? atualizarServico(servicoEditado, dados) : criarServico(dados);
    const mensagem = servicoEditado ? "Serviço atualizado." : "Serviço adicionado.";
    if (!(await resultado(pedido, mensagem, formServico.querySelector(".campo__erro")))) return;
    sairDaEdicaoServico();
    desenharServicosNovo();
    atualizarHorariosNovo();
    desenharAgenda();
  });
});

function desenharServicos() {
  $("#listaServicos").replaceChildren(...servicosAtivos(estado).map(servico => {
    const detalhe = `${servico.duracao} min · ${formatarMoeda(servico.preco)}${servico.complementar ? " · complementar" : ""}`;
    const item = registro(servico.nome, detalhe, async () => {
      if (!(await resultado(removerServico(servico.id), "Serviço removido."))) return;
      if (servicoEditado === servico.id) sairDaEdicaoServico();
      else desenharServicos();
      desenharServicosNovo();
      atualizarHorariosNovo();
      desenharAgenda();
    });
    item.classList.toggle("registro--editando", servicoEditado === servico.id);
    item.prepend(el("span", { class: `registro__icone icone-servico--${servico.icone}` }, iconeDeServico(servico.icone)));
    item.querySelector(".botao--perigo").before(el("button", {
      type: "button",
      class: "botao botao--contorno botao--pequeno",
      "aria-label": `Editar ${servico.nome}`,
      onclick: () => editarServico(servico)
    }, "Editar"));
    return item;
  }));
}

/* Produtos */

// Reduz a foto antes de guardar, para caber no armazenamento do navegador.
const TIPOS_DE_FOTO = ["image/jpeg", "image/png", "image/webp"];

// quadrada: corta no centro (retrato dos profissionais, que aparece redondo no /agendar).
function reduzirFoto(arquivo, lado = 900, { quadrada = false } = {}) {
  return new Promise((resolver, rejeitar) => {
    const imagem = new Image();
    const endereco = URL.createObjectURL(arquivo);
    imagem.onload = () => {
      const corte = Math.min(imagem.width, imagem.height);
      const [x, y, largura, altura] = quadrada
        ? [(imagem.width - corte) / 2, (imagem.height - corte) / 2, corte, corte]
        : [0, 0, imagem.width, imagem.height];
      const escala = Math.min(1, lado / Math.max(largura, altura));
      const tela = el("canvas", { width: Math.round(largura * escala), height: Math.round(altura * escala) });
      tela.getContext("2d").drawImage(imagem, x, y, largura, altura, 0, 0, tela.width, tela.height);
      URL.revokeObjectURL(endereco);
      resolver(tela.toDataURL("image/jpeg", .82));
    };
    imagem.onerror = () => {
      URL.revokeObjectURL(endereco);
      rejeitar(new Error("Não deu para abrir essa imagem."));
    };
    imagem.src = endereco;
  });
}

const formProduto = $("#formProduto");
// Na edição: id do produto e a foto que ele terá (undefined = continua a mesma).
const edicao = { id: null, foto: undefined };

function mostrarPrevia(endereco) {
  const previa = $("#produtoPrevia");
  if (previa.src.startsWith("blob:")) URL.revokeObjectURL(previa.src);
  previa.hidden = !endereco;
  if (endereco) previa.src = endereco;
  else previa.removeAttribute("src");
  $("#produtoFotoTexto").textContent = endereco ? "Trocar foto" : "Adicionar foto";
  $("#removerFoto").hidden = !endereco;
}

function sairDaEdicao() {
  edicao.id = null;
  edicao.foto = undefined;
  formProduto.reset();
  formProduto.querySelector(".campo__erro").textContent = "";
  mostrarPrevia(null);
  $("#produtoTitulo").textContent = "Novo produto";
  $("#salvarProduto").textContent = "Adicionar à loja";
  $("#cancelarEdicao").hidden = true;
  desenharProdutos();
}

function editarProduto(produto) {
  edicao.id = produto.id;
  edicao.foto = undefined;
  formProduto.reset();
  formProduto.querySelector(".campo__erro").textContent = "";
  formProduto.elements.nome.value = produto.nome;
  formProduto.elements.preco.value = produto.preco.toFixed(2).replace(".", ",");
  formProduto.elements.descricao.value = produto.descricao || "";
  mostrarPrevia(produto.foto);
  $("#produtoTitulo").textContent = "Editar produto";
  $("#salvarProduto").textContent = "Salvar alterações";
  $("#cancelarEdicao").hidden = false;
  desenharProdutos();
  formProduto.scrollIntoView({ block: "start" });
  formProduto.elements.preco.focus({ preventScroll: true });
}

$("#cancelarEdicao").addEventListener("click", sairDaEdicao);

$("#removerFoto").addEventListener("click", () => {
  $("#produtoFoto").value = "";
  if (edicao.id) edicao.foto = null;
  mostrarPrevia(null);
});

$("#produtoFoto").addEventListener("change", evento => {
  const arquivo = evento.target.files[0];
  if (arquivo) mostrarPrevia(URL.createObjectURL(arquivo));
});

formProduto.addEventListener("submit", evento => {
  evento.preventDefault();
  enviando(evento.currentTarget, salvarProduto);
});

async function salvarProduto() {
  const form = formProduto;
  const erro = form.querySelector(".campo__erro");
  const valores = new FormData(form);
  const arquivo = valores.get("foto");

  let foto = edicao.id ? edicao.foto : null;
  if (arquivo instanceof File && arquivo.size) {
    if (!TIPOS_DE_FOTO.includes(arquivo.type)) {
      erro.textContent = "Use uma foto JPG, PNG ou WebP.";
      return;
    }
    try {
      foto = await reduzirFoto(arquivo);
    } catch (falha) {
      erro.textContent = falha.message;
      return;
    }
  }

  const dados = {
    nome: valores.get("nome"),
    preco: String(valores.get("preco")).replace(/\./g, "").replace(",", "."),
    descricao: valores.get("descricao"),
    foto
  };
  const pedido = edicao.id ? atualizarProduto(edicao.id, dados) : criarProduto(dados);
  if (await resultado(pedido, edicao.id ? "Produto atualizado na loja." : "Produto adicionado à loja.", erro)) {
    sairDaEdicao();
  }
}

function desenharProdutos() {
  const lista = $("#listaProdutos");
  if (!estado.produtos.length) {
    lista.replaceChildren(el("li", { class: "vazio" }, icone("sacola"),
      el("strong", {}, "Nenhum produto na loja"), el("p", {}, "Os produtos que você adicionar aparecem aqui e na loja.")));
    return;
  }
  lista.replaceChildren(...estado.produtos.map(produto => {
    const item = registro(produto.nome, formatarMoeda(produto.preco), async () => {
      if (!(await resultado(removerProduto(produto.id), "Produto removido da loja."))) return;
      if (edicao.id === produto.id) sairDaEdicao();
      else desenharProdutos();
    });
    item.classList.toggle("registro--editando", edicao.id === produto.id);
    item.querySelector(".botao--perigo").before(el("button", {
      type: "button",
      class: "botao botao--contorno botao--pequeno",
      "aria-label": `Editar ${produto.nome}`,
      onclick: () => editarProduto(produto)
    }, "Editar"));
    item.prepend(produto.foto
      ? el("img", { class: "registro__foto", src: produto.foto, alt: "" })
      : el("span", { class: "registro__foto registro__foto--vazia", "aria-hidden": "true" }, produto.nome[0]));
    return item;
  }));
}

/* Perfil dos profissionais no /agendar */

const formPerfil = $("#formPerfil");
// Foto do profissional em edição: undefined = continua a mesma, null = tirar.
let fotoDoPerfil;

function mostrarPreviaPerfil(endereco, enviada) {
  const previa = $("#perfilPrevia");
  if (previa.src.startsWith("blob:")) URL.revokeObjectURL(previa.src);
  previa.hidden = !endereco;
  if (endereco) previa.src = endereco;
  else previa.removeAttribute("src");
  $("#perfilFotoTexto").textContent = enviada ? "Trocar foto" : "Adicionar foto";
  $("#removerFotoPerfil").hidden = !enviada;
}

function desenharPerfil() {
  const id = visao.profissionalPerfil;
  $("#profPerfil").replaceChildren(...config.profissionais.map(pessoa => el("button", {
    type: "button",
    class: "chip",
    "aria-pressed": String(pessoa.id === id),
    onclick: () => {
      visao.profissionalPerfil = pessoa.id;
      desenharPerfil();
    }
  }, pessoa.nome)));

  // estado.profissionais tem a foto enviada (ou vazio); config.profissionais já cai na provisória.
  const doServidor = estado.profissionais.find(pessoa => pessoa.id === id);
  formPerfil.reset();
  formPerfil.elements.nome.value = doServidor.nome;
  formPerfil.elements.descricao.value = doServidor.descricao;
  formPerfil.querySelector(".campo__erro").textContent = "";
  fotoDoPerfil = undefined;
  mostrarPreviaPerfil(profissionalPorId(id)?.foto, Boolean(doServidor.foto));
}

$("#perfilFoto").addEventListener("change", evento => {
  const arquivo = evento.target.files[0];
  if (arquivo) mostrarPreviaPerfil(URL.createObjectURL(arquivo), true);
});

$("#removerFotoPerfil").addEventListener("click", () => {
  $("#perfilFoto").value = "";
  fotoDoPerfil = null;
  mostrarPreviaPerfil(null, false);
});

formPerfil.addEventListener("submit", evento => {
  evento.preventDefault();
  enviando(formPerfil, async () => {
    const erro = formPerfil.querySelector(".campo__erro");
    const arquivo = formPerfil.elements.foto.files[0];
    let foto = fotoDoPerfil;
    if (arquivo) {
      if (!TIPOS_DE_FOTO.includes(arquivo.type)) {
        erro.textContent = "Use uma foto JPG, PNG ou WebP.";
        return;
      }
      try {
        foto = await reduzirFoto(arquivo, 400, { quadrada: true });
      } catch (falha) {
        erro.textContent = falha.message;
        return;
      }
    }
    const dados = { nome: formPerfil.elements.nome.value, descricao: formPerfil.elements.descricao.value };
    if (foto !== undefined) dados.foto = foto;
    const nome = dados.nome.trim() || "profissional";
    if (await resultado(atualizarProfissional(visao.profissionalPerfil, dados), `Perfil de ${nome} salvo.`, erro)) atualizarTudo();
  });
});

/* Sessão e dados de teste */

$("#sessaoNome").textContent = estado.eu.nome;
$("#sair").addEventListener("click", async () => {
  await sair();
  location.reload();
});

$("#ferramentasDeTeste").hidden = !estado.ferramentasDeTeste;

confirmarNoBotao($("#apagarTudo"), "Toque de novo: apaga atendimentos, ausências e bloqueios", async () => {
  if (await resultado(apagarDadosDeTeste(), "Dados de teste apagados.")) atualizarTudo();
});

confirmarNoBotao($("#gerarExemplo"), "Toque de novo: troca os atendimentos atuais", async () => {
  const mensagem = retorno => `${retorno.total} atendimentos de exemplo gerados (agosto a outubro e a semana atual lotada).`;
  if (!(await resultado(carregarExemplo(gerarExemplo(estado)), mensagem))) return;
  irPara(hoje());
  atualizarTudo();
});

/* Início */

function atualizarTudo() {
  desenharAgenda();
  desenharExpediente();
  desenharPerfil();
  desenharAusencias();
  desenharBloqueios();
  desenharServicos();
  desenharServicosNovo();
  desenharProdutos();
  atualizarHorariosNovo();
  atualizarRelatorios();
}

preencherMarca();
aplicarIcones();
mascararTelefone(formNovo.elements.telefone);
desenharFormNovo();
preencherDuracoes();
desenharIconesDeServico();
montarFiltro();
iniciarRelatorios(() => estado);
$("#ausenciaProfissional").replaceChildren(...opcoesProfissionais());
atualizarTudo();
abrirAba(location.hash.slice(1));

// Um cliente marcou pelo site, ou outro barbeiro mexeu no painel: a agenda se atualiza sozinha.
aoMudar(carregar, novo => {
  estado = novo;
  desenharAgenda();
  desenharServicos();
  desenharServicosNovo();
  desenharProdutos();
  atualizarRelatorios();
  if ($("#janelaNovo").open) atualizarHorariosNovo();
});
