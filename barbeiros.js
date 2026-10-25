import { config } from "./config.js";
import {
  FREQUENCIAS, atendimentosDoDia, conflitoDoAtendimento, conflitosFuturos, daChave, datasDaSerie, descreverMensal,
  descreverRepeticao, diaFechado, expedienteDoDia, formatarData, formatarMoeda, hoje, horaTexto, horariosLivres,
  inicioDaRecorrencia, inicioDaSemana, minutos, motivoIndisponivel, paraChave, profissionalPorId, servicoPorId,
  servicosAtivos, somarDias, somarServicos
} from "./agenda.js";
import {
  ICONES_DE_SERVICO, aoMudar, apagarTudo, cancelarData, carregar, carregarExemplo, criarAgendamento, criarAusencia, criarBloqueio,
  atualizarProduto, atualizarServico, criarProduto, criarServico, encerrarRepeticao, removerAusencia, removerBloqueio,
  removerProduto, removerServico, salvarExpediente, tornarRecorrente
} from "./dados.js";
import {
  $, aplicarIcones, avisar, capitalizar, confirmarNoBotao, el, formatarTelefone, icone, linkWhatsApp,
  mascararTelefone, preencherMarca
} from "./ui.js";
import { atualizarRelatorios, iniciarRelatorios } from "./relatorios.js";
import { gerarExemplo } from "./exemplo.js";

const DIAS_DA_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const ORDEM_DA_SEMANA = [1, 2, 3, 4, 5, 6, 0];

let estado = carregar();
const visao = {
  filtro: null,
  semana: inicioDaSemana(hoje()),
  // Mês mostrado no mini calendário (pode ser outro que o da semana escolhida).
  ano: new Date().getFullYear(),
  mes: new Date().getMonth(),
  profissionalExpediente: config.profissionais[0].id
};

const indiceProfissional = id => config.profissionais.findIndex(pessoa => pessoa.id === id);
const nomeProfissional = id => profissionalPorId(id)?.nome ?? "—";
const opcoesProfissionais = () => config.profissionais.map(pessoa => el("option", { value: pessoa.id }, pessoa.nome));

function resultado(retorno, mensagem, alvoErro) {
  if (alvoErro) alvoErro.textContent = retorno.ok ? "" : retorno.erro;
  if (!retorno.ok) {
    avisar(retorno.erro, "erro");
    return false;
  }
  estado = carregar();
  avisar(mensagem);
  return true;
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

/* Agenda: semana em colunas, com mini calendário do mês */

const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const ROTULOS_INDISPONIVEL = {
  "Dia de folga do profissional": "Folga",
  "Na pausa do profissional": "Pausa",
  "Profissional ausente": "Ausente"
};

const agoraEmMinutos = () => new Date().getHours() * 60 + new Date().getMinutes();
const idsDoFiltro = () => visao.filtro ? [visao.filtro] : config.profissionais.map(pessoa => pessoa.id);
const diasDaSemana = () => Array.from({ length: 7 }, (_, indice) => somarDias(visao.semana, indice));
const doFiltro = agendamento => !visao.filtro || agendamento.profissionalId === visao.filtro;
const doDia = data => atendimentosDoDia(estado, data).filter(doFiltro);
const iconeDeServico = nome => icone(nome, `icone icone-servico icone-servico--${nome}`);
const pxPorMinuto = () => parseFloat(getComputedStyle($("#quadro")).getPropertyValue("--px-min")) || 1.6;

function desenharFiltro() {
  const opcoes = [{ id: null, nome: "Todos" }, ...config.profissionais];
  $("#filtroAgenda").replaceChildren(...opcoes.map(pessoa => el("button", {
    type: "button",
    class: "chip",
    "aria-pressed": String(visao.filtro === pessoa.id),
    onclick: () => {
      visao.filtro = pessoa.id;
      desenharAgenda();
    }
  }, pessoa.id && el("span", { class: "chip__cor", "data-profissional": indiceProfissional(pessoa.id) % 4 }), pessoa.nome)));
}

function irParaSemana(segunda) {
  visao.semana = segunda;
  const meio = daChave(somarDias(segunda, 3));
  visao.ano = meio.getFullYear();
  visao.mes = meio.getMonth();
  abrirMiniCalendario(false);
  desenharAgenda();
}

function abrirMiniCalendario(aberto) {
  $("#miniCalendario").classList.toggle("mini-calendario--aberto", aberto);
  $("#mesTitulo").setAttribute("aria-expanded", String(aberto));
  // Ao fechar sem escolher, volta para o mês da semana escolhida, que é a linha que fica à mostra.
  if (!aberto) {
    const meio = daChave(somarDias(visao.semana, 3));
    visao.ano = meio.getFullYear();
    visao.mes = meio.getMonth();
  }
  desenharMiniCalendario();
  ajustarEscala();
}

// No celular, com o mini calendário fechado, não há mês à mostra: as setas andam de semana.
const setasAndamSemana = () =>
  matchMedia("(max-width: 899px)").matches && !$("#miniCalendario").classList.contains("mini-calendario--aberto");

function desenharMiniCalendario() {
  const primeiro = new Date(visao.ano, visao.mes, 1);
  const ultimo = paraChave(new Date(visao.ano, visao.mes + 1, 0));
  const mes = new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(primeiro).replace(".", "");
  $("#mesNome").textContent = `${capitalizar(mes)} ${visao.ano}`;
  const porSemana = setasAndamSemana();
  $("#mesAnterior").setAttribute("aria-label", porSemana ? "Semana anterior" : "Mês anterior");
  $("#mesSeguinte").setAttribute("aria-label", porSemana ? "Próxima semana" : "Próximo mês");

  const semanas = [];
  for (let segunda = inicioDaSemana(paraChave(primeiro)); segunda <= ultimo; segunda = somarDias(segunda, 7)) {
    const domingo = somarDias(segunda, 6);
    semanas.push(el("button", {
      type: "button",
      class: "mini-calendario__semana",
      "aria-pressed": String(segunda === visao.semana),
      "aria-label": `Semana de ${formatarData(segunda, { day: "numeric", month: "long" })} a ${formatarData(domingo, { day: "numeric", month: "long" })}`,
      onclick: () => irParaSemana(segunda)
    }, Array.from({ length: 7 }, (_, indice) => {
      const data = somarDias(segunda, indice);
      const classes = ["mini-calendario__dia"];
      if (daChave(data).getMonth() !== visao.mes) classes.push("mini-calendario__dia--fora");
      if (data === hoje()) classes.push("mini-calendario__dia--hoje");
      if (data >= hoje() && doDia(data).some(item => conflitoDoAtendimento(estado, item, data))) {
        classes.push("mini-calendario__dia--conflito");
      }
      return el("span", { class: classes.join(" ") }, daChave(data).getDate());
    })));
  }
  $("#semanasDoMes").replaceChildren(...semanas);
}

// Faixa de horas do quadro: do primeiro início ao último fim da semana, em horas cheias.
function faixaDaSemana(dias) {
  let inicio = Infinity;
  let fim = -Infinity;
  for (const data of dias) {
    for (const id of idsDoFiltro()) {
      const expediente = expedienteDoDia(estado, id, data);
      if (!expediente) continue;
      inicio = Math.min(inicio, minutos(expediente.inicio));
      fim = Math.max(fim, minutos(expediente.fim));
    }
    for (const agendamento of doDia(data)) {
      inicio = Math.min(inicio, minutos(agendamento.inicio));
      fim = Math.max(fim, minutos(agendamento.inicio) + agendamento.duracao);
    }
  }
  if (inicio === Infinity) return { inicio: 8 * 60, fim: 18 * 60 };
  return { inicio: Math.floor(inicio / 60) * 60, fim: Math.ceil(fim / 60) * 60 };
}

// Trechos em que ninguém do filtro atende: fora do expediente, pausa, folga, ausência ou bloqueio.
function trechosIndisponiveis(data, faixa) {
  const passo = config.agenda.intervaloMinutos;
  const trechos = [];
  for (let inicio = faixa.inicio; inicio < faixa.fim; inicio += passo) {
    const motivos = idsDoFiltro().map(id => motivoIndisponivel(estado, id, data, inicio, passo));
    if (motivos.some(motivo => !motivo)) continue;
    const motivo = motivos.every(item => item === motivos[0]) ? motivos[0] : "";
    const rotulo = motivo.startsWith("Bloqueio: ") ? motivo.slice(10) : ROTULOS_INDISPONIVEL[motivo] ?? "";
    const anterior = trechos.at(-1);
    if (anterior && anterior.fim === inicio && anterior.rotulo === rotulo) anterior.fim += passo;
    else trechos.push({ inicio, fim: inicio + passo, rotulo });
  }
  return trechos;
}

// Atendimentos que se sobrepõem dividem a largura da coluna, lado a lado.
function distribuirEmFaixas(atendimentos) {
  const itens = atendimentos
    .map(agendamento => ({ agendamento, inicio: minutos(agendamento.inicio), fim: minutos(agendamento.inicio) + agendamento.duracao }))
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
    while (grupo.some(outro => outro.faixa === faixa && outro.fim > item.inicio)) faixa++;
    item.faixa = faixa;
    grupo.push(item);
    fimDoGrupo = Math.max(fimDoGrupo, item.fim);
  }
  if (grupo.length) fecharGrupo();
  return itens;
}

function blocoDoAtendimento(item, data, faixa) {
  const { agendamento } = item;
  const servicos = agendamento.servicos.map(id => servicoPorId(estado, id)).filter(Boolean);
  const repete = agendamento.repeticao.frequencia !== "nenhuma";
  const conflito = data >= hoje() && conflitoDoAtendimento(estado, agendamento, data);
  const passado = data < hoje() || (data === hoje() && item.fim <= agoraEmMinutos());
  const fim = horaTexto(item.fim);
  const classes = ["bloco"];
  if (conflito) classes.push("bloco--conflito");
  if (passado) classes.push("bloco--passado");

  return el("button", {
    type: "button",
    class: classes.join(" "),
    "data-profissional": indiceProfissional(agendamento.profissionalId) % 4,
    style: `--inicio: ${item.inicio - faixa.inicio}; --duracao: ${agendamento.duracao}; --faixa: ${item.faixa}; --faixas: ${item.faixas}`,
    "aria-label": `${agendamento.inicio} a ${fim}, ${agendamento.cliente.nome}: ${servicos.map(servico => servico.nome).join(" + ")}, ` +
      `com ${nomeProfissional(agendamento.profissionalId)}${repete ? ", recorrente" : ""}${conflito ? `. ${conflito}` : ""}`,
    onclick: () => abrirDetalhe(agendamento.id, data)
  },
  el("span", { class: "bloco__linha" },
    el("strong", { class: "bloco__nome" }, agendamento.cliente.nome.split(" ")[0]),
    el("span", { class: "bloco__simbolos" },
      conflito && icone("alerta", "icone icone--alerta"),
      repete && icone("repetir"),
      servicos.map(servico => iconeDeServico(servico.icone)))),
  el("span", { class: "bloco__hora numeros" },
    `${agendamento.inicio}–${fim}`, visao.filtro ? "" : ` · ${nomeProfissional(agendamento.profissionalId)}`));
}

function colunaDoDia(data, faixa, fechada) {
  const agora = agoraEmMinutos();
  const classes = ["quadro__coluna"];
  if (data < hoje()) classes.push("quadro__coluna--passado");
  if (fechada) classes.push("quadro__coluna--fechada");
  return el("div", {
    class: classes.join(" "),
    "data-dia": data,
    style: `--minutos: ${faixa.fim - faixa.inicio}`
  },
  trechosIndisponiveis(data, faixa).map(trecho => el("div", {
    class: "quadro__fechado",
    style: `--inicio: ${trecho.inicio - faixa.inicio}; --duracao: ${trecho.fim - trecho.inicio}`
  }, trecho.rotulo && el("span", {}, trecho.rotulo))),
  data === hoje() && agora > faixa.inicio && agora < faixa.fim &&
    el("div", { class: "quadro__agora", style: `--inicio: ${agora - faixa.inicio}` }),
  distribuirEmFaixas(doDia(data)).map(item => blocoDoAtendimento(item, data, faixa)));
}

function desenharQuadro() {
  const dias = diasDaSemana();
  const faixa = faixaDaSemana(dias);
  const fechadoSemNada = data => diaFechado(estado, data, visao.filtro) && !doDia(data).length;
  // Dia sem expediente fica só com a largura do nome do dia e da data.
  const colunas = dias.map(data => fechadoSemNada(data) ? "max-content" : "minmax(0, 1fr)");

  const cabecalhos = dias.map(data => {
    const atendimentos = doDia(data);
    const total = atendimentos.reduce((soma, item) => soma + item.preco, 0);
    const classes = ["quadro__dia"];
    if (data === hoje()) classes.push("quadro__dia--hoje");
    if (fechadoSemNada(data)) classes.push("quadro__dia--fechado");
    return el("div", { class: classes.join(" ") },
      el("span", { class: "quadro__semana" }, DIAS_CURTOS[daChave(data).getDay()]),
      el("strong", { class: "quadro__numero numeros" }, daChave(data).getDate()),
      el("span", { class: "quadro__total numeros" }, atendimentos.length
        ? [String(atendimentos.length), el("span", { class: "quadro__valor" }, ` · ${formatarMoeda(total)}`)] : ""));
  });

  const horas = [];
  for (let hora = faixa.inicio; hora < faixa.fim; hora += 60) {
    horas.push(el("span", { class: "numeros", style: `--inicio: ${hora - faixa.inicio}` }, horaTexto(hora)));
  }

  const grade = el("div", {
    class: "quadro__grade",
    style: `grid-template-columns: var(--coluna-horas) ${colunas.join(" ")}`
  },
  el("div", { class: "quadro__canto" }),
  cabecalhos,
  el("div", { class: "quadro__horas", style: `--minutos: ${faixa.fim - faixa.inicio}` }, horas),
  dias.map(data => colunaDoDia(data, faixa, fechadoSemNada(data))));
  grade.dataset.inicio = faixa.inicio;
  grade.dataset.minutos = faixa.fim - faixa.inicio;

  $("#quadro").replaceChildren(grade);
  ajustarEscala();
}

// A semana inteira cabe na tela, sem rolar o quadro: os minutos se esticam ou encolhem conforme
// o espaço que sobra embaixo dele. Abaixo do mínimo, a página rola um pouco em vez de espremer os blocos.
function ajustarEscala() {
  const quadro = $("#quadro");
  const grade = quadro.querySelector(".quadro__grade");
  if (!grade || !quadro.offsetParent) return;
  const celular = matchMedia("(max-width: 899px)").matches;
  const topo = quadro.getBoundingClientRect().top + window.scrollY;
  const cabecalho = quadro.querySelector(".quadro__dia").offsetHeight;
  const abas = celular ? $(".abas").offsetHeight : 0;
  const sobra = window.innerHeight - topo - cabecalho - abas - 10;
  const px = Math.min(2.4, Math.max(celular ? 0.72 : 1, sobra / Number(grade.dataset.minutos)));
  quadro.style.setProperty("--px-min", `${px}px`);
  for (const bloco of quadro.querySelectorAll(".bloco")) {
    const altura = Number(bloco.style.getPropertyValue("--duracao")) * px;
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
  abrirNovo(livre.data, horaTexto(livre.inicio));
});

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

function desenharResumoDaSemana() {
  const dias = diasDaSemana();
  const atendimentos = dias.flatMap(data => doDia(data).map(agendamento => ({ agendamento, data })));
  const total = atendimentos.reduce((soma, item) => soma + item.agendamento.preco, 0);
  const conflitos = atendimentos.filter(({ agendamento, data }) =>
    data >= hoje() && conflitoDoAtendimento(estado, agendamento, data)).length;
  $("#semanaResumo").textContent = atendimentos.length
    ? `${atendimentos.length} ${atendimentos.length === 1 ? "atendimento" : "atendimentos"} na semana · ${formatarMoeda(total)}` +
      (conflitos ? ` · ${conflitos} para remarcar` : "")
    : "Nenhum atendimento nesta semana. Toque num horário livre para marcar.";
}

function desenharLegenda() {
  $("#legendaAgenda").replaceChildren(
    el("span", {}, icone("repetir"), "Recorrente"),
    ...servicosAtivos(estado).map(servico => el("span", {}, iconeDeServico(servico.icone), servico.nome)),
    el("span", {}, icone("alerta", "icone icone--alerta"), "Remarcar"));
}

function desenharAgenda() {
  desenharFiltro();
  desenharMiniCalendario();
  desenharResumoDaSemana();
  desenharQuadro();
  desenharLegenda();
}

function mudarMes(diferenca) {
  const alvo = new Date(visao.ano, visao.mes + diferenca, 1);
  visao.ano = alvo.getFullYear();
  visao.mes = alvo.getMonth();
  desenharMiniCalendario();
}

const andar = direcao => setasAndamSemana() ? irParaSemana(somarDias(visao.semana, direcao * 7)) : mudarMes(direcao);
$("#mesAnterior").addEventListener("click", () => andar(-1));
$("#mesSeguinte").addEventListener("click", () => andar(1));
$("#irHoje").addEventListener("click", () => irParaSemana(inicioDaSemana(hoje())));
$("#mesTitulo").addEventListener("click", () =>
  abrirMiniCalendario(!$("#miniCalendario").classList.contains("mini-calendario--aberto")));

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
  confirmarNoBotao(cancelar, "Toque de novo para cancelar", () => {
    if (resultado(cancelarData(id, data), "Atendimento cancelado.")) fecharDetalhe();
  });

  let encerrar = null;
  if (repete) {
    encerrar = el("button", { type: "button", class: "botao botao--perigo botao--largo" }, "Encerrar repetição a partir deste dia");
    confirmarNoBotao(encerrar, "Toque de novo para encerrar", () => {
      if (resultado(encerrarRepeticao(id, data), "Repetição encerrada.")) fecharDetalhe();
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
        ["Valor", formatarMoeda(agendamento.preco)],
        ["WhatsApp", formatarTelefone(agendamento.cliente.telefone)],
        ["Repetição", descreverRepeticao(agendamento.repeticao, agendamento.data)],
        ["Marcado", agendamento.origem === "cliente" ? "Pelo cliente, no site" : "Pelo painel"]
      ].map(([rotulo, valor]) => el("div", {}, el("dt", {}, rotulo), el("dd", {}, valor)))),
    el("div", { class: "detalhe__acoes" },
      el("a", {
        class: "botao botao--destaque botao--largo",
        href: linkWhatsApp(agendamento.cliente.telefone, lembrete),
        target: "_blank",
        rel: "noopener"
      }, icone("mensagem"), "Enviar lembrete no WhatsApp"),
      repete ? "" : painelRecorrencia(agendamento),
      cancelar,
      encerrar,
      el("button", { type: "button", class: "botao botao--contorno botao--largo", onclick: fecharDetalhe }, "Fechar")));

  $("#detalhe").showModal();
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
    onclick: () => {
      if (resultado(tornarRecorrente(agendamento.id, ler()), "Pronto, o horário agora se repete.", erro)) fecharDetalhe();
    }
  }, "Confirmar repetição");

  area.append(
    el("span", { class: "campo__rotulo" }, "De quanto em quanto tempo?"),
    el("div", { class: "chips", role: "radiogroup", "aria-label": "Frequência" },
      ["semanal", "quinzenal", "mensal"].map((frequencia, indice) => el("label", { class: "chip" },
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

// Mantém os serviços já marcados quando a lista muda; sem nenhum, marca o primeiro.
function desenharServicosNovo() {
  const ativos = servicosAtivos(estado);
  const marcados = new FormData(formNovo).getAll("servico").filter(id => ativos.some(servico => servico.id === id));
  if (!marcados.length) marcados.push(ativos[0].id);
  $("#novoServicos").replaceChildren(...ativos.map(servico => el("label", { class: "chip" },
    el("input", { type: "checkbox", name: "servico", value: servico.id, checked: marcados.includes(servico.id) }),
    `${servico.nome} · ${formatarMoeda(servico.preco)}`)));
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

// Janela de novo atendimento: vem com o dia e a hora tocados no quadro e o profissional do filtro.
let horarioDesejado = null;
function abrirNovo(data, horario = null) {
  formNovo.elements.nome.value = "";
  formNovo.elements.telefone.value = "";
  $("#novoErro").textContent = "";
  $("#novoData").value = data;
  horarioDesejado = horario;
  if (visao.filtro) $("#novoProfissional").value = visao.filtro;
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

$("#novoAtendimento").addEventListener("click", () => abrirNovo(proximoDiaAberto(visao.semana > hoje() ? visao.semana : hoje())));

formNovo.addEventListener("input", atualizarHorariosNovo);
formNovo.addEventListener("change", atualizarHorariosNovo);

formNovo.addEventListener("submit", evento => {
  evento.preventDefault();
  const valores = new FormData(formNovo);
  const dados = lerFormNovo();
  const retorno = criarAgendamento({
    ...dados,
    nome: valores.get("nome"),
    telefone: valores.get("telefone"),
    inicio: valores.get("horario"),
    origem: "painel"
  });
  if (!resultado(retorno, "Horário marcado.", $("#novoErro"))) return;

  $("#janelaNovo").close();
  irParaSemana(inicioDaSemana(dados.data));
});

/* Aviso antes de mudanças que atingem quem já tem horário */

const chaveConflito = item => `${item.agendamento.id}|${item.data}`;

function limparImpacto(form) {
  const caixa = form.querySelector(".impacto");
  const botao = form.querySelector('[type="submit"]');
  caixa.hidden = true;
  delete form.dataset.confirmado;
  if (botao.dataset.rotulo) botao.textContent = botao.dataset.rotulo;
  delete botao.dataset.rotulo;
}

// Simula a mudança e, se ela deixar alguém marcado fora do horário de atendimento,
// mostra a lista e pede um segundo envio para confirmar. Devolve true quando pode salvar.
function podeSalvar(form, simular) {
  if (form.dataset.confirmado) return true;
  const previa = simular();
  if (!previa.ok) return true;

  const atuais = new Set(conflitosFuturos(estado).map(chaveConflito));
  const novos = conflitosFuturos(previa.estado).filter(item => !atuais.has(chaveConflito(item)));
  if (!novos.length) return true;

  // Um cliente fixo aparece uma vez só, com a primeira data atingida e quantas vêm depois.
  const porCliente = new Map();
  for (const item of novos) {
    const grupo = porCliente.get(item.agendamento.id) ?? { ...item, datas: 0 };
    grupo.datas++;
    porCliente.set(item.agendamento.id, grupo);
  }
  const grupos = [...porCliente.values()];

  const caixa = form.querySelector(".impacto");
  const botao = form.querySelector('[type="submit"]');
  caixa.replaceChildren(
    el("p", { class: "impacto__titulo" }, icone("alerta"),
      `Isso atinge ${grupos.length} ${grupos.length === 1 ? "cliente já marcado" : "clientes já marcados"}:`),
    el("ul", { class: "impacto__lista numeros" }, grupos.slice(0, 5).map(({ agendamento, data, datas }) => el("li", {},
      `${agendamento.cliente.nome} (${nomeProfissional(agendamento.profissionalId)}) · ` +
      `${formatarData(data, { weekday: "short", day: "2-digit", month: "2-digit" })} às ${agendamento.inicio}` +
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
      hora("pausaFim", "até", atual?.pausaFim));
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
      pausaFim: valores.get(`pausaFim-${dia}`)
    } : null;
  }
  const id = visao.profissionalExpediente;
  if (!podeSalvar(evento.currentTarget, () => salvarExpediente(id, dias, { simular: true }))) return;
  if (resultado(salvarExpediente(id, dias), `Expediente de ${nomeProfissional(id)} salvo.`, $("#expedienteErro"))) {
    desenharExpediente();
    desenharAgenda();
  }
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
    () => resultado(removerAusencia(item.id), "Ausência removida.") && atualizarTudo())));
}

function desenharBloqueios() {
  const futuros = estado.bloqueios.filter(item => item.data >= hoje()).sort((a, b) => a.data.localeCompare(b.data));
  $("#listaBloqueios").replaceChildren(...futuros.map(item => registro(
    item.motivo,
    `${formatarData(item.data, { weekday: "short", day: "2-digit", month: "2-digit" })} · ${horasTexto(item)}`,
    () => resultado(removerBloqueio(item.id), "Bloqueio removido.") && atualizarTudo())));
}

function ligarFormulario(seletor, salvar, mensagem) {
  const form = $(seletor);
  form.addEventListener("submit", evento => {
    evento.preventDefault();
    const valores = Object.fromEntries(new FormData(form));
    if (!podeSalvar(form, () => salvar(valores, { simular: true }))) return;
    if (resultado(salvar(valores), mensagem, form.querySelector(".campo__erro"))) {
      form.reset();
      limparImpacto(form);
      atualizarTudo();
    }
  });
}

ligarFormulario("#formAusencia", criarAusencia, "Ausência registrada.");
ligarFormulario("#formBloqueio", criarBloqueio, "Bloqueio adicionado.");

/* Serviços */

const formServico = $("#formServico");
let servicoEditado = null;

function preencherDuracoes(atual = 30) {
  const passo = config.agenda.intervaloMinutos;
  const opcoes = Array.from({ length: 240 / passo }, (_, indice) => (indice + 1) * passo);
  if (!opcoes.includes(atual)) opcoes.push(atual);
  $("#servicoDuracao").replaceChildren(...opcoes.sort((a, b) => a - b).map(valor =>
    el("option", { value: valor, selected: valor === atual }, `${valor} min`)));
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
    icone: valores.get("icone")
  };
  const retorno = servicoEditado ? atualizarServico(servicoEditado, dados) : criarServico(dados);
  if (!resultado(retorno, servicoEditado ? "Serviço atualizado." : "Serviço adicionado.", formServico.querySelector(".campo__erro"))) return;
  sairDaEdicaoServico();
  desenharServicosNovo();
  atualizarHorariosNovo();
  desenharAgenda();
});

function desenharServicos() {
  $("#listaServicos").replaceChildren(...servicosAtivos(estado).map(servico => {
    const item = registro(servico.nome, `${servico.duracao} min · ${formatarMoeda(servico.preco)}`, () => {
      if (!resultado(removerServico(servico.id), "Serviço removido.")) return;
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
function reduzirFoto(arquivo, lado = 900) {
  return new Promise((resolver, rejeitar) => {
    const imagem = new Image();
    const endereco = URL.createObjectURL(arquivo);
    imagem.onload = () => {
      const escala = Math.min(1, lado / Math.max(imagem.width, imagem.height));
      const tela = el("canvas", { width: Math.round(imagem.width * escala), height: Math.round(imagem.height * escala) });
      tela.getContext("2d").drawImage(imagem, 0, 0, tela.width, tela.height);
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

formProduto.addEventListener("submit", async evento => {
  evento.preventDefault();
  const form = evento.currentTarget;
  const erro = form.querySelector(".campo__erro");
  const valores = new FormData(form);
  const arquivo = valores.get("foto");

  let foto = edicao.id ? edicao.foto : null;
  if (arquivo instanceof File && arquivo.size) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(arquivo.type)) {
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
  const retorno = edicao.id ? atualizarProduto(edicao.id, dados) : criarProduto(dados);
  if (resultado(retorno, edicao.id ? "Produto atualizado na loja." : "Produto adicionado à loja.", erro)) {
    sairDaEdicao();
  }
});

function desenharProdutos() {
  const lista = $("#listaProdutos");
  if (!estado.produtos.length) {
    lista.replaceChildren(el("li", { class: "vazio" }, icone("sacola"),
      el("strong", {}, "Nenhum produto na loja"), el("p", {}, "Os produtos que você adicionar aparecem aqui e na loja.")));
    return;
  }
  lista.replaceChildren(...estado.produtos.map(produto => {
    const item = registro(produto.nome, formatarMoeda(produto.preco), () => {
      if (!resultado(removerProduto(produto.id), "Produto removido da loja.")) return;
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

/* Dados de teste */

confirmarNoBotao($("#apagarTudo"), "Toque de novo para apagar tudo", () => {
  apagarTudo();
  estado = carregar();
  atualizarTudo();
  avisar("Dados de teste apagados.");
});

confirmarNoBotao($("#gerarExemplo"), "Toque de novo: troca os atendimentos atuais", () => {
  const retorno = carregarExemplo(gerarExemplo(carregar()));
  if (!resultado(retorno, `${retorno.total} atendimentos de exemplo gerados (agosto a outubro).`)) return;
  irParaSemana(inicioDaSemana(hoje()));
  atualizarTudo();
});

/* Início */

function atualizarTudo() {
  desenharAgenda();
  desenharExpediente();
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
iniciarRelatorios(() => estado);
$("#ausenciaProfissional").replaceChildren(...opcoesProfissionais());
atualizarTudo();
abrirAba(location.hash.slice(1));

// Um cliente marcou pelo site em outra aba: a agenda se atualiza sozinha.
aoMudar(novo => {
  estado = novo;
  desenharAgenda();
  desenharServicos();
  desenharServicosNovo();
  desenharProdutos();
  atualizarRelatorios();
  if ($("#janelaNovo").open) atualizarHorariosNovo();
});
