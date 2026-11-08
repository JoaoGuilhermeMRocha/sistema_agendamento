import { config } from "./config.js";
import {
  formatarData, formatarMoeda, hoje, inicioDaSemana, paraChave, profissionalPorId, servicosAtivos, somarDias,
  somarServicos, temServicoComum
} from "./agenda.js";
import { aoMudar, carregarVitrine, criarAgendamento, horariosDisponiveis, linkDaAgenda } from "./dados.js";
import {
  $, aplicarIcones, capitalizar, el, formatarTelefone, icone, linkWhatsApp, mascararTelefone,
  mostrarErroCampo, preencherMarca, soDigitos
} from "./ui.js";

const campos = {
  nome: $("#nome"),
  telefone: $("#telefone")
};

const escolha = {
  servicos: [],
  profissionalId: null,
  data: null,
  horario: null
};
// Serviços, profissionais e produtos. Os horários livres o servidor calcula (horariosDisponiveis),
// sem mandar para cá os dados de quem já marcou.
let estado = await carregarVitrine();
// Cada busca de horários ganha um número; resposta de uma busca antiga é ignorada.
let buscaDeHorarios = 0;

const soma = () => somarServicos(estado, escolha.servicos);
const pronto = () => escolha.servicos.length && escolha.data && escolha.horario;

/* Etapa 1: serviços */

const botaoDeServico = servico => el("button", {
  type: "button",
  class: "servico",
  "data-servico": servico.id,
  "aria-pressed": String(escolha.servicos.includes(servico.id))
},
el("span", { class: "servico__marca" }, icone("check")),
el("span", { class: "servico__nome" }, servico.nome),
el("span", { class: "servico__info numeros" }, `${servico.duracao} min`),
el("strong", { class: "servico__preco numeros" }, formatarMoeda(servico.preco)));

// Sem serviço comum escolhido, os complementares (pezinho, sobrancelha...) saem da escolha.
function limparComplementares() {
  if (!temServicoComum(estado, escolha.servicos)) escolha.servicos = [];
}

// Os complementares só aparecem depois que o cliente escolhe um serviço comum.
function desenharServicos() {
  // O painel pode ter removido um serviço que estava escolhido.
  const ativos = servicosAtivos(estado);
  escolha.servicos = escolha.servicos.filter(id => ativos.some(servico => servico.id === id));
  limparComplementares();
  const complementares = ativos.filter(servico => servico.complementar);
  $("#servicos").replaceChildren(
    ...ativos.filter(servico => !servico.complementar).map(botaoDeServico),
    complementares.length ? el("div", { id: "complementos", class: "complementos", hidden: !escolha.servicos.length },
      el("p", { class: "complementos__titulo" }, "Quer completar?"),
      ...complementares.map(botaoDeServico)) : "");
}

$("#servicos").addEventListener("click", evento => {
  const botao = evento.target.closest("[data-servico]");
  if (!botao) return;
  const id = botao.dataset.servico;
  escolha.servicos = escolha.servicos.includes(id)
    ? escolha.servicos.filter(item => item !== id)
    : servicosAtivos(estado).map(servico => servico.id).filter(item => item === id || escolha.servicos.includes(item));
  limparComplementares();
  for (const opcao of $("#servicos").querySelectorAll("[data-servico]")) {
    opcao.setAttribute("aria-pressed", String(escolha.servicos.includes(opcao.dataset.servico)));
  }
  if ($("#complementos")) $("#complementos").hidden = !escolha.servicos.length;
  atualizarAgenda();
});

/* Etapa 2: profissional */

// Foto do profissional ou, sem foto, a inicial do nome.
const retrato = (pessoa, classe = "retrato") => pessoa.foto
  ? el("img", { class: classe, src: pessoa.foto, alt: "", loading: "lazy", decoding: "async" })
  : el("span", { class: `${classe} retrato--inicial`, "aria-hidden": "true" }, pessoa.nome[0]);

// Cartões com foto. "Sem preferência" mostra os retratos de todos, sobrepostos.
function desenharProfissionais() {
  const opcoes = [{ id: null, nome: "Sem preferência", descricao: "Quem estiver livre" }, ...config.profissionais];
  $("#profissionais").replaceChildren(...opcoes.map(pessoa => el("button", {
    type: "button",
    class: "profissional",
    "data-profissional": pessoa.id ?? "",
    "aria-pressed": String(escolha.profissionalId === pessoa.id)
  },
  el("span", { class: "profissional__foto" },
    pessoa.id ? retrato(pessoa) : el("span", { class: "retratos" }, config.profissionais.slice(0, 3).map(item => retrato(item))),
    el("span", { class: "profissional__marca", "aria-hidden": "true" }, icone("check"))),
  el("strong", { class: "profissional__nome" }, pessoa.nome),
  pessoa.descricao ? el("span", { class: "profissional__descricao" }, pessoa.descricao) : null)));
}

$("#profissionais").addEventListener("click", evento => {
  const botao = evento.target.closest("[data-profissional]");
  if (!botao) return;
  escolha.profissionalId = botao.dataset.profissional || null;
  for (const opcao of $("#profissionais").children) {
    opcao.setAttribute("aria-pressed", String(opcao === botao));
  }
  atualizarAgenda();
});

/* Etapa 3: dia e horário */

const { diasNaLista, diasParaAgendar } = config.agenda;
// Os primeiros dias ficam na lista; o resto, até diasParaAgendar, no calendário de "Ver mais datas".
// Os dias do calendário só são buscados depois que o cliente abre o calendário.
const vagas = {
  todos: false,
  dias: [],
  livres: new Map(),
  fechados: new Set(),
  // Período de horário sequencial (fila) do profissional escolhido em cada dia, ou null.
  sequencial: new Map(),
  erro: ""
};
// mes: primeiro dia do mês mostrado ("AAAA-MM-01"); null volta para o mês do dia escolhido.
const calendario = { aberto: false, mes: null };

function rotuloDia(data) {
  if (data === hoje()) return "Hoje";
  if (data === somarDias(hoje(), 1)) return "Amanhã";
  return formatarData(data, { weekday: "short" }).replace(".", "");
}

const nomeDoDia = data => formatarData(data, { weekday: "long", day: "numeric", month: "long" });
const temHorario = data => Boolean(vagas.livres.get(data)?.length);

// Sem serviço escolhido, o servidor usa o mais curto para os dias não aparecerem todos como lotados.
// Devolve false quando a resposta chegou atrasada (já há uma busca mais nova).
async function buscarDias() {
  const numero = ++buscaDeHorarios;
  const resposta = await horariosDisponiveis({
    servicos: escolha.servicos,
    profissionalId: escolha.profissionalId,
    dias: vagas.todos ? diasParaAgendar : diasNaLista
  });
  if (numero !== buscaDeHorarios) return false;
  vagas.erro = resposta.ok ? "" : resposta.erro;
  if (resposta.ok) {
    vagas.dias = resposta.dias.map(dia => dia.data);
    vagas.livres = new Map(resposta.dias.map(dia => [dia.data, dia.horarios]));
    vagas.fechados = new Set(resposta.dias.filter(dia => dia.fechado).map(dia => dia.data));
    vagas.sequencial = new Map(resposta.dias.map(dia => [dia.data, dia.sequencial]));
  }
  return true;
}

function botaoDia(data) {
  const disponivel = temHorario(data);
  return el("button", {
    type: "button",
    class: "dia",
    "data-dia": data,
    "aria-pressed": String(data === escolha.data),
    "aria-label": `${nomeDoDia(data)}${disponivel ? "" : ", sem horários"}`,
    disabled: !disponivel
  },
  el("span", { class: "dia__semana" }, rotuloDia(data)),
  el("strong", { class: "dia__numero numeros" }, formatarData(data, { day: "numeric" })),
  el("span", { class: "dia__mes" }, vagas.fechados.has(data) ? "fechado" : disponivel
    ? formatarData(data, { month: "short" }).replace(".", "") : "lotado"));
}

// No lugar do 16º dia: abre o calendário. Com um dia do calendário escolhido, mostra esse dia.
function botaoMaisDatas() {
  const fora = escolha.data && !vagas.dias.slice(0, diasNaLista).includes(escolha.data);
  return el("button", {
    type: "button",
    id: "maisDatas",
    class: "dia dia--mais",
    "aria-expanded": String(calendario.aberto),
    "aria-controls": "calendario",
    "aria-pressed": fora ? "true" : null,
    "aria-label": fora ? `${nomeDoDia(escolha.data)}. Ver mais datas disponíveis` : "Ver mais datas disponíveis"
  }, fora ? [
    el("span", { class: "dia__semana" }, rotuloDia(escolha.data)),
    el("strong", { class: "dia__numero numeros" }, formatarData(escolha.data, { day: "numeric" })),
    el("span", { class: "dia__mes" }, icone("calendario"), formatarData(escolha.data, { month: "short" }).replace(".", ""))
  ] : [icone("calendario"), el("span", { class: "dia__mais" }, "Ver mais datas")]);
}

function desenharDias() {
  if (vagas.erro) {
    $("#horarios").replaceChildren(el("p", { class: "horarios__aviso" }, vagas.erro));
    return;
  }
  if (escolha.data && !temHorario(escolha.data)) escolha.data = null;
  escolha.data ??= vagas.dias.find(temHorario) || null;

  $("#dias").replaceChildren(...vagas.dias.slice(0, diasNaLista).map(botaoDia), botaoMaisDatas());
  desenharCalendario();
  desenharHorarios(vagas.livres.get(escolha.data) || []);
}

// Mês a mês, de segunda a domingo, como o mini calendário do painel. Só os dias com horário são botões.
function desenharCalendario() {
  const area = $("#calendario");
  area.hidden = !calendario.aberto;
  if (!calendario.aberto) return;
  if (!vagas.todos) {
    area.replaceChildren(el("p", { class: "calendario__aviso" }, "Carregando as datas…"));
    return;
  }

  const primeiro = hoje();
  const ultimo = somarDias(primeiro, diasParaAgendar - 1);
  const mesDe = data => `${data.slice(0, 8)}01`;
  calendario.mes ??= mesDe(escolha.data || primeiro);
  calendario.mes = [mesDe(primeiro), calendario.mes, mesDe(ultimo)].sort()[1];
  const [ano, mes] = calendario.mes.split("-").map(Number);
  const fimDoMes = paraChave(new Date(ano, mes, 0));

  const dias = [];
  for (let data = inicioDaSemana(calendario.mes); data <= fimDoMes || dias.length % 7; data = somarDias(data, 1)) {
    const numero = Number(data.slice(8));
    if (data.slice(0, 8) !== calendario.mes.slice(0, 8)) dias.push(el("span", { class: "calendario__dia calendario__dia--vazio" }));
    else if (data < primeiro || data > ultimo) dias.push(el("span", { class: "calendario__dia calendario__dia--fora" }, numero));
    else dias.push(el("button", {
      type: "button",
      class: `calendario__dia${data === primeiro ? " calendario__dia--hoje" : ""}`,
      "data-dia": data,
      "aria-pressed": String(data === escolha.data),
      "aria-label": `${nomeDoDia(data)}${temHorario(data) ? "" : vagas.fechados.has(data) ? ", fechado" : ", sem horários"}`,
      disabled: !temHorario(data)
    }, numero));
  }

  const titulo = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(ano, mes - 1, 1));
  const seta = (passo, rotulo, nome, limite) => el("button", {
    type: "button", class: "calendario__seta", "data-mes": passo, "aria-label": rotulo, disabled: calendario.mes === limite
  }, icone(nome));
  area.replaceChildren(
    el("div", { class: "calendario__topo" },
      seta(-1, "Mês anterior", "voltar", mesDe(primeiro)),
      el("strong", { class: "calendario__mes", "aria-live": "polite" }, capitalizar(titulo)),
      seta(1, "Próximo mês", "seta", mesDe(ultimo))),
    el("div", { class: "calendario__semana", "aria-hidden": "true" },
      ["S", "T", "Q", "Q", "S", "S", "D"].map(letra => el("span", {}, letra))),
    el("div", { class: "calendario__grade", role: "group", "aria-label": capitalizar(titulo) }, dias));
}

async function abrirCalendario(aberto) {
  calendario.aberto = aberto;
  calendario.mes = null;
  desenharDias();
  if (aberto && !vagas.todos) {
    vagas.todos = true;
    await atualizarAgenda();
  }
  if (aberto) $("#calendario").scrollIntoView({ block: "nearest" });
}

function escolherDia(data) {
  escolha.data = data;
  escolha.horario = null;
  calendario.aberto = false;
  desenharDias();
  desenharResumo();
}

function grupoDoHorario(horario) {
  const hora = Number(horario.slice(0, 2));
  return hora < 12 ? "Manhã" : hora < 18 ? "Tarde" : "Noite";
}

function desenharHorarios(horarios) {
  const area = $("#horarios");
  if (!horarios.includes(escolha.horario)) escolha.horario = null;

  if (!escolha.servicos.length) {
    area.replaceChildren(el("p", { class: "horarios__aviso" }, "Escolha pelo menos um serviço para ver os horários."));
    return;
  }
  if (!escolha.data) {
    area.replaceChildren(el("p", { class: "horarios__aviso" },
      `Nenhum horário livre nos próximos ${vagas.todos ? diasParaAgendar : diasNaLista} dias. Tente outro profissional.`));
    return;
  }

  // Horário sequencial: nesse período do dia, o profissional mostra só o próximo horário livre.
  const fila = vagas.sequencial.get(escolha.data);

  const grupos = new Map();
  for (const horario of horarios) {
    const grupo = grupoDoHorario(horario);
    grupos.set(grupo, [...(grupos.get(grupo) || []), horario]);
  }
  area.replaceChildren(
    el("p", { class: "horarios__dia" }, capitalizar(nomeDoDia(escolha.data))),
    fila ? el("p", { class: "horarios__fila" }, icone("relogio"),
      `Das ${fila.inicio} às ${fila.fim}, ${profissionalPorId(escolha.profissionalId)?.nome} atende em sequência: aparece só o próximo horário livre desse período.`) : "",
    ...[...grupos].map(([nome, lista]) => el("div", { class: "horarios__grupo" },
      el("h3", {}, nome),
      el("div", { class: "horarios__grade" }, lista.map((horario, indice) => el("button", {
        type: "button",
        class: "horario numeros",
        "data-horario": horario,
        "aria-pressed": String(horario === escolha.horario),
        style: `--atraso: ${Math.min(indice, 12) * 18}ms`
      }, horario))))));
}

$("#dias").addEventListener("click", evento => {
  if (evento.target.closest("#maisDatas")) {
    abrirCalendario(!calendario.aberto);
    return;
  }
  const botao = evento.target.closest("[data-dia]");
  if (botao && !botao.disabled) escolherDia(botao.dataset.dia);
});

$("#calendario").addEventListener("click", evento => {
  const seta = evento.target.closest("[data-mes]");
  if (seta && !seta.disabled) {
    const [ano, mes] = calendario.mes.split("-").map(Number);
    calendario.mes = paraChave(new Date(ano, mes - 1 + Number(seta.dataset.mes), 1));
    desenharCalendario();
    return;
  }
  const botao = evento.target.closest("[data-dia]");
  if (!botao || botao.disabled) return;
  escolherDia(botao.dataset.dia);
  $("#maisDatas").focus({ preventScroll: true });
  $("#etapaHorario").scrollIntoView({ block: "start" });
});

document.addEventListener("keydown", evento => {
  if (evento.key !== "Escape") return;
  if (calendario.aberto) {
    abrirCalendario(false);
    $("#maisDatas").focus();
  }
  if (!$("#lembrete").hidden) fecharLembrete();
});

$("#horarios").addEventListener("click", evento => {
  const botao = evento.target.closest("[data-horario]");
  if (!botao) return;
  escolha.horario = botao.dataset.horario;
  for (const opcao of $("#horarios").querySelectorAll("[data-horario]")) {
    opcao.setAttribute("aria-pressed", String(opcao === botao));
  }
  desenharResumo();
});

/* Resumo e confirmação */

function proximaPendencia() {
  if (!escolha.servicos.length) return { texto: "Escolha um serviço", alvo: "#etapaServicos" };
  if (!escolha.data || !escolha.horario) return { texto: "Escolha um horário", alvo: "#etapaHorario" };
  return null;
}

function desenharResumo() {
  const { nomes, duracao, preco } = soma();
  const profissional = profissionalPorId(escolha.profissionalId);

  $("#resumoServicos").textContent = nomes || "—";
  $("#resumoProfissional").replaceChildren(
    profissional ? retrato(profissional, "retrato retrato--mini") : "", profissional?.nome || "Sem preferência");
  $("#resumoQuando").textContent = escolha.data
    ? `${formatarData(escolha.data, { weekday: "short", day: "2-digit", month: "2-digit" })}${escolha.horario ? ` às ${escolha.horario}` : ""}`
    : "—";
  $("#resumoPreco").textContent = formatarMoeda(preco);
  $("#resumoDuracao").textContent = duracao ? `${duracao} min` : "";

  const pendencia = proximaPendencia();
  $("#confirmar").textContent = pendencia ? pendencia.texto : "Confirmar agendamento";
  $("#confirmar").classList.toggle("resumo__botao--pendente", Boolean(pendencia));
}

async function atualizarAgenda() {
  desenharResumo();
  if (!(await buscarDias())) return;
  // Nada livre na lista: já busca os dias do calendário.
  if (!vagas.erro && !vagas.todos && !vagas.dias.some(temHorario)) {
    vagas.todos = true;
    if (!(await buscarDias())) return;
  }
  desenharDias();
  desenharResumo();
}

function validarContato() {
  const nome = campos.nome.value.trim();
  const telefone = soDigitos(campos.telefone.value);
  mostrarErroCampo(campos.nome, nome.length < 2 ? "Conta pra gente o seu nome." : "");
  mostrarErroCampo(campos.telefone, /^\d{10,11}$/.test(telefone) ? "" : "Informe o WhatsApp com DDD.");
  if (nome.length < 2) return campos.nome;
  if (!/^\d{10,11}$/.test(telefone)) return campos.telefone;
  return null;
}

$("#agendar").addEventListener("submit", async evento => {
  evento.preventDefault();
  if ($("#confirmar").disabled) return;
  $("#erroEnvio").textContent = "";

  const pendencia = proximaPendencia();
  if (pendencia) {
    $(pendencia.alvo).scrollIntoView({ block: "start" });
    return;
  }
  const campoComErro = validarContato();
  if (campoComErro) {
    campoComErro.focus({ preventScroll: true });
    $("#etapaDados").scrollIntoView({ block: "start" });
    return;
  }

  // Travado enquanto o servidor responde: um toque duplo não marca dois horários.
  $("#confirmar").disabled = true;
  $("#confirmar").textContent = "Confirmando…";
  const resultado = await criarAgendamento({
    nome: campos.nome.value,
    telefone: campos.telefone.value,
    servicos: escolha.servicos,
    profissionalId: escolha.profissionalId,
    data: escolha.data,
    inicio: escolha.horario,
    origem: "cliente"
  });
  $("#confirmar").disabled = false;

  if (!resultado.ok) {
    $("#erroEnvio").textContent = resultado.erro;
    const novo = await carregarVitrine();
    if (novo.ok) estado = novo;
    desenharServicos();
    await atualizarAgenda();
    return;
  }
  mostrarConfirmacao(resultado.agendamento);
});

for (const campo of [campos.nome, campos.telefone]) {
  campo.addEventListener("input", () => {
    if (campo.getAttribute("aria-invalid") === "true") validarContato();
  });
}

function mostrarConfirmacao(agendamento) {
  const { nomes, duracao } = somarServicos(estado, agendamento.servicos);
  const pessoa = profissionalPorId(agendamento.profissionalId);
  const profissional = pessoa.nome;
  const quando = formatarData(agendamento.data, { weekday: "long", day: "numeric", month: "long" });

  $("#confirmadoTexto").textContent =
    `Te esperamos ${agendamento.data === hoje() ? "hoje" : quando}, às ${agendamento.inicio}, com ${profissional}.`;
  $("#confirmadoDetalhes").replaceChildren(...[
    ["Cliente", `${agendamento.cliente.nome} · ${formatarTelefone(agendamento.cliente.telefone)}`],
    ["Profissional", [retrato(pessoa, "retrato retrato--mini"), profissional]],
    ["Serviços", `${nomes} · ${duracao} min`],
    ["Valor", formatarMoeda(agendamento.preco)]
  ].map(([rotulo, valor]) => el("div", {}, el("dt", {}, rotulo), el("dd", {}, valor))));

  const agenda = linkDaAgenda({
    titulo: `${nomes} · ${config.nome}`,
    local: config.endereco,
    detalhes: [`Com ${profissional}.`,
      config.whatsapp && `Precisa remarcar? WhatsApp da barbearia: ${formatarTelefone(config.whatsapp.replace(/^55/, ""))}`
    ].filter(Boolean).join("\n"),
    data: agendamento.data,
    inicio: agendamento.inicio,
    duracao: agendamento.duracao
  });
  for (const link of document.querySelectorAll("[data-agenda]")) link.href = agenda;

  if (config.whatsapp) {
    const link = linkWhatsApp(config.whatsapp, mensagemDeConfirmacao(agendamento, nomes, profissional));
    $("#falarBarbearia").href = link;
    $("#falarBarbearia").hidden = false;
    mostrarLembrete(link);
  }

  $("#areaAgendamento").hidden = true;
  $("#confirmado").hidden = false;
  document.body.classList.add("concluido");
  $("#confirmado").focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

/* Lembrete: popup que convida o cliente a confirmar pelo WhatsApp e some sozinho */

const DURACAO_DO_LEMBRETE = 30000;
let temporizadorDoLembrete;

function mensagemDeConfirmacao(agendamento, nomes, profissional) {
  return [
    "Olá! Acabei de agendar pelo site e quero confirmar meu horário:",
    `• Serviço: ${nomes}`,
    `• Dia: ${formatarData(agendamento.data, { weekday: "long", day: "2-digit", month: "2-digit" })}, às ${agendamento.inicio}`,
    `• Profissional: ${profissional}`,
    `• Nome: ${agendamento.cliente.nome}`
  ].join("\n");
}

function mostrarLembrete(link) {
  const lembrete = $("#lembrete");
  $("#lembreteLink").href = link;
  lembrete.style.setProperty("--duracao-lembrete", `${DURACAO_DO_LEMBRETE}ms`);
  lembrete.hidden = false;
  clearTimeout(temporizadorDoLembrete);
  temporizadorDoLembrete = setTimeout(fecharLembrete, DURACAO_DO_LEMBRETE);
}

function fecharLembrete() {
  clearTimeout(temporizadorDoLembrete);
  $("#lembrete").hidden = true;
}

$("#fecharLembrete").addEventListener("click", fecharLembrete);
// Fecha depois que o WhatsApp abre (na mesma volta, cancelaria a abertura do link).
$("#lembreteLink").addEventListener("click", () => setTimeout(fecharLembrete));

$("#novoAgendamento").addEventListener("click", async () => {
  fecharLembrete();
  escolha.data = null;
  escolha.horario = null;
  calendario.aberto = false;
  const novo = await carregarVitrine();
  if (novo.ok) estado = novo;
  $("#confirmado").hidden = true;
  $("#areaAgendamento").hidden = false;
  document.body.classList.remove("concluido");
  desenharServicos();
  atualizarAgenda();
  $("#etapaServicos").scrollIntoView({ block: "start" });
});

/* Início */

preencherMarca();
aplicarIcones();
mascararTelefone(campos.telefone);
if (estado.ok) {
  desenharServicos();
  desenharProfissionais();
  atualizarAgenda();

  // O painel mudou serviços ou profissionais: redesenha. Os horários são conferidos a cada minuto,
  // porque outros clientes estão marcando ao mesmo tempo.
  const visivel = () => !document.hidden && !$("#areaAgendamento").hidden;
  aoMudar(carregarVitrine, novo => {
    estado = novo;
    if (!visivel()) return;
    desenharServicos();
    desenharProfissionais();
    atualizarAgenda();
  });
  setInterval(() => visivel() && atualizarAgenda(), 60000);
} else {
  $("#servicos").replaceChildren(el("p", { class: "horarios__aviso" }, estado.erro));
}
