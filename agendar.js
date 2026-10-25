import { config } from "./config.js";
import {
  diaFechado, formatarData, formatarMoeda, hoje,
  horariosLivres, profissionalPorId, servicosAtivos, somarDias, somarServicos
} from "./agenda.js";
import { aoMudar, carregar, criarAgendamento } from "./dados.js";
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
// Repetição só se cria pelo painel; pelo site o cliente marca um atendimento por vez.
const SEM_REPETICAO = { frequencia: "nenhuma", vezes: 1 };
let estado = carregar();

const soma = () => somarServicos(estado, escolha.servicos);
const pronto = () => escolha.servicos.length && escolha.data && escolha.horario;

/* Etapa 1: serviços */

function desenharServicos() {
  // O painel pode ter removido um serviço que estava escolhido.
  const ativos = servicosAtivos(estado);
  escolha.servicos = escolha.servicos.filter(id => ativos.some(servico => servico.id === id));
  $("#servicos").replaceChildren(...ativos.map(servico => el("button", {
    type: "button",
    class: "servico",
    "data-servico": servico.id,
    "aria-pressed": String(escolha.servicos.includes(servico.id))
  },
  el("span", { class: "servico__marca" }, icone("check")),
  el("span", { class: "servico__nome" }, servico.nome),
  el("span", { class: "servico__info numeros" }, `${servico.duracao} min`),
  el("strong", { class: "servico__preco numeros" }, formatarMoeda(servico.preco)))));
}

$("#servicos").addEventListener("click", evento => {
  const botao = evento.target.closest("[data-servico]");
  if (!botao) return;
  const id = botao.dataset.servico;
  escolha.servicos = escolha.servicos.includes(id)
    ? escolha.servicos.filter(item => item !== id)
    : servicosAtivos(estado).map(servico => servico.id).filter(item => item === id || escolha.servicos.includes(item));
  botao.setAttribute("aria-pressed", String(escolha.servicos.includes(id)));
  atualizarAgenda();
});

/* Etapa 2: profissional */

function desenharProfissionais() {
  const opcoes = [{ id: null, nome: "Sem preferência" }, ...config.profissionais];
  $("#profissionais").replaceChildren(...opcoes.map(pessoa => el("button", {
    type: "button",
    class: "chip",
    "data-profissional": pessoa.id ?? "",
    "aria-pressed": String(escolha.profissionalId === pessoa.id)
  }, pessoa.id ? el("span", { class: "chip__inicial", "aria-hidden": "true" }, pessoa.nome[0]) : null, pessoa.nome)));
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

function rotuloDia(data) {
  if (data === hoje()) return "Hoje";
  if (data === somarDias(hoje(), 1)) return "Amanhã";
  return formatarData(data, { weekday: "short" }).replace(".", "");
}

function desenharDias() {
  // Sem serviço escolhido, os dias usam o serviço mais curto para não aparecerem todos como lotados.
  const duracao = soma().duracao || Math.min(...servicosAtivos(estado).map(servico => servico.duracao));
  const dias = Array.from({ length: config.agenda.diasParaAgendar }, (_, indice) => somarDias(hoje(), indice));
  const livres = new Map(dias.map(data => [data, horariosLivres(estado, {
    data, repeticao: SEM_REPETICAO, duracao, profissionalId: escolha.profissionalId
  })]));

  if (escolha.data && !livres.get(escolha.data)?.length) escolha.data = null;
  escolha.data ??= dias.find(data => livres.get(data).length) || null;

  $("#dias").replaceChildren(...dias.map(data => {
    const disponivel = livres.get(data).length > 0;
    const fechado = diaFechado(estado, data, escolha.profissionalId);
    return el("button", {
      type: "button",
      class: "dia",
      "data-dia": data,
      "aria-pressed": String(data === escolha.data),
      "aria-label": `${formatarData(data, { weekday: "long", day: "numeric", month: "long" })}${disponivel ? "" : ", sem horários"}`,
      disabled: !disponivel
    },
    el("span", { class: "dia__semana" }, rotuloDia(data)),
    el("strong", { class: "dia__numero numeros" }, formatarData(data, { day: "numeric" })),
    el("span", { class: "dia__mes" }, fechado ? "fechado" : disponivel
      ? formatarData(data, { month: "short" }).replace(".", "") : "lotado"));
  }));

  desenharHorarios(livres.get(escolha.data) || []);
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
    area.replaceChildren(el("p", { class: "horarios__aviso" }, "Nenhum horário livre nos próximos dias. Tente outro profissional."));
    return;
  }

  const grupos = new Map();
  for (const horario of horarios) {
    const grupo = grupoDoHorario(horario);
    grupos.set(grupo, [...(grupos.get(grupo) || []), horario]);
  }
  area.replaceChildren(
    el("p", { class: "horarios__dia" }, capitalizar(formatarData(escolha.data, { weekday: "long", day: "numeric", month: "long" }))),
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
  const botao = evento.target.closest("[data-dia]");
  if (!botao || botao.disabled) return;
  escolha.data = botao.dataset.dia;
  escolha.horario = null;
  atualizarAgenda();
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
  $("#resumoProfissional").textContent = profissional?.nome || "Sem preferência";
  $("#resumoQuando").textContent = escolha.data
    ? `${formatarData(escolha.data, { weekday: "short", day: "2-digit", month: "2-digit" })}${escolha.horario ? ` às ${escolha.horario}` : ""}`
    : "—";
  $("#resumoPreco").textContent = formatarMoeda(preco);
  $("#resumoDuracao").textContent = duracao ? `${duracao} min` : "";

  const pendencia = proximaPendencia();
  $("#confirmar").textContent = pendencia ? pendencia.texto : "Confirmar agendamento";
  $("#confirmar").classList.toggle("resumo__botao--pendente", Boolean(pendencia));
}

function atualizarAgenda() {
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

$("#agendar").addEventListener("submit", evento => {
  evento.preventDefault();
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

  const resultado = criarAgendamento({
    nome: campos.nome.value,
    telefone: campos.telefone.value,
    servicos: escolha.servicos,
    profissionalId: escolha.profissionalId,
    data: escolha.data,
    inicio: escolha.horario,
    origem: "cliente"
  });

  if (!resultado.ok) {
    $("#erroEnvio").textContent = resultado.erro;
    estado = carregar();
    desenharServicos();
    atualizarAgenda();
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
  const profissional = profissionalPorId(agendamento.profissionalId).nome;
  const quando = formatarData(agendamento.data, { weekday: "long", day: "numeric", month: "long" });

  $("#confirmadoTexto").textContent =
    `Te esperamos ${agendamento.data === hoje() ? "hoje" : quando}, às ${agendamento.inicio}, com ${profissional}.`;
  $("#confirmadoDetalhes").replaceChildren(...[
    ["Cliente", `${agendamento.cliente.nome} · ${formatarTelefone(agendamento.cliente.telefone)}`],
    ["Serviços", `${nomes} · ${duracao} min`],
    ["Valor", formatarMoeda(agendamento.preco)]
  ].map(([rotulo, valor]) => el("div", {}, el("dt", {}, rotulo), el("dd", {}, valor))));

  if (config.whatsapp) {
    $("#falarBarbearia").href = linkWhatsApp(config.whatsapp,
      `Olá! Acabei de marcar ${nomes} para ${formatarData(agendamento.data)} às ${agendamento.inicio}.`);
    $("#falarBarbearia").hidden = false;
  }

  $("#areaAgendamento").hidden = true;
  $("#confirmado").hidden = false;
  document.body.classList.add("concluido");
  $("#confirmado").focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

$("#novoAgendamento").addEventListener("click", () => {
  escolha.data = null;
  escolha.horario = null;
  estado = carregar();
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
desenharServicos();
desenharProfissionais();
atualizarAgenda();

// Outra aba (o painel, por exemplo) mudou a agenda: atualiza os horários livres.
aoMudar(novo => {
  estado = novo;
  if ($("#areaAgendamento").hidden) return;
  desenharServicos();
  atualizarAgenda();
});
