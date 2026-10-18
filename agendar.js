import { config } from "./config.js";
import {
  datasDaSerie, descreverMensal, descreverRepeticao, diaFechado, formatarData, formatarMoeda, hoje,
  horariosLivres, profissionalPorId, somarDias, somarServicos
} from "./agenda.js";
import { aoMudar, carregar, criarAgendamento } from "./dados.js";
import {
  $, aplicarIcones, capitalizar, el, formatarTelefone, icone, linkWhatsApp, mascararTelefone,
  mostrarErroCampo, preencherMarca, soDigitos
} from "./ui.js";

const campos = {
  nome: $("#nome"),
  telefone: $("#telefone"),
  repetir: $("#repetir"),
  semFim: $("#semFim")
};

const escolha = {
  servicos: [config.servicos[0].id],
  profissionalId: null,
  data: null,
  horario: null,
  repeticao: { frequencia: "nenhuma", vezes: 1 }
};
let vezesEscolhidas = 4;
let estado = carregar();

const soma = () => somarServicos(escolha.servicos);
const pronto = () => escolha.servicos.length && escolha.data && escolha.horario;

/* Etapa 1: serviços */

function desenharServicos() {
  $("#servicos").replaceChildren(...config.servicos.map(servico => el("button", {
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
    : config.servicos.map(servico => servico.id).filter(item => item === id || escolha.servicos.includes(item));
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

/* Etapa 3: dia, horário e repetição */

function rotuloDia(data) {
  if (data === hoje()) return "Hoje";
  if (data === somarDias(hoje(), 1)) return "Amanhã";
  return formatarData(data, { weekday: "short" }).replace(".", "");
}

function desenharDias() {
  const { duracao } = soma();
  const dias = Array.from({ length: config.agenda.diasParaAgendar }, (_, indice) => somarDias(hoje(), indice));
  const livres = new Map(dias.map(data => [data, horariosLivres(estado, {
    data, repeticao: escolha.repeticao, duracao, profissionalId: escolha.profissionalId
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
    const repetindo = escolha.repeticao.frequencia !== "nenhuma";
    area.replaceChildren(el("p", { class: "horarios__aviso" }, repetindo
      ? "Nenhum horário fica livre em todas as datas dessa repetição. Tente outra frequência, menos atendimentos ou outro profissional."
      : "Nenhum horário livre nos próximos dias. Tente outro profissional."));
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

function lerRepeticao() {
  const frequencia = campos.repetir.checked
    ? document.querySelector('input[name="frequencia"]:checked').value : "nenhuma";
  escolha.repeticao = frequencia === "nenhuma"
    ? { frequencia, vezes: 1 }
    : { frequencia, vezes: campos.semFim.checked ? null : vezesEscolhidas };

  $("#opcoesRepeticao").hidden = !campos.repetir.checked;
  $("#vezes").textContent = campos.semFim.checked ? "∞" : vezesEscolhidas;
  $("#menosVezes").disabled = campos.semFim.checked || vezesEscolhidas <= 2;
  $("#maisVezes").disabled = campos.semFim.checked || vezesEscolhidas >= config.agenda.maxAtendimentosRepetidos;
  atualizarAgenda();
}

function alterarVezes(diferenca) {
  vezesEscolhidas = Math.min(config.agenda.maxAtendimentosRepetidos, Math.max(2, vezesEscolhidas + diferenca));
  lerRepeticao();
}

campos.repetir.addEventListener("change", lerRepeticao);
campos.semFim.addEventListener("change", lerRepeticao);
$("#opcoesRepeticao").addEventListener("change", evento => {
  if (evento.target.name === "frequencia") lerRepeticao();
});
$("#menosVezes").addEventListener("click", () => alterarVezes(-1));
$("#maisVezes").addEventListener("click", () => alterarVezes(1));

function desenharDatasRepeticao() {
  const alvo = $("#datasRepeticao");
  if (escolha.repeticao.frequencia === "nenhuma" || !escolha.data) {
    alvo.textContent = "";
    return;
  }
  const datas = datasDaSerie(escolha.data, escolha.repeticao);
  const mostradas = datas.slice(0, 4).map(data => formatarData(data)).join(", ");
  const regra = escolha.repeticao.frequencia === "mensal" ? `${descreverMensal(escolha.data)}: ` : "";
  alvo.textContent = regra + (escolha.repeticao.vezes == null
    ? `${mostradas} e assim por diante.`
    : `${mostradas}${datas.length > 4 ? ` … até ${formatarData(datas.at(-1))}` : ""}.`);
}

/* Resumo e confirmação */

function proximaPendencia() {
  if (!escolha.servicos.length) return { texto: "Escolha um serviço", alvo: "#etapaServicos" };
  if (!escolha.data || !escolha.horario) return { texto: "Escolha um horário", alvo: "#etapaHorario" };
  return null;
}

function desenharResumo() {
  const { nomes, duracao, preco } = soma();
  const repetindo = escolha.repeticao.frequencia !== "nenhuma";
  const profissional = profissionalPorId(escolha.profissionalId);

  $("#resumoServicos").textContent = nomes || "—";
  $("#resumoProfissional").textContent = profissional?.nome || "Sem preferência";
  $("#resumoQuando").textContent = escolha.data
    ? `${formatarData(escolha.data, { weekday: "short", day: "2-digit", month: "2-digit" })}${escolha.horario ? ` às ${escolha.horario}` : ""}`
    : "—";
  $("#resumoRepeticao").textContent = descreverRepeticao(escolha.repeticao, escolha.data);
  $("#resumoPreco").textContent = formatarMoeda(preco);
  $("#resumoDuracao").textContent = duracao ? `${duracao} min${repetindo ? " · por atendimento" : ""}` : "";

  const pendencia = proximaPendencia();
  $("#confirmar").textContent = pendencia ? pendencia.texto : "Confirmar agendamento";
  $("#confirmar").classList.toggle("resumo__botao--pendente", Boolean(pendencia));
}

function atualizarAgenda() {
  desenharDias();
  desenharDatasRepeticao();
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
    repeticao: escolha.repeticao,
    origem: "cliente"
  });

  if (!resultado.ok) {
    $("#erroEnvio").textContent = resultado.erro;
    estado = carregar();
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
  const { nomes, duracao } = somarServicos(agendamento.servicos);
  const profissional = profissionalPorId(agendamento.profissionalId).nome;
  const quando = formatarData(agendamento.data, { weekday: "long", day: "numeric", month: "long" });

  $("#confirmadoTexto").textContent =
    `Te esperamos ${agendamento.data === hoje() ? "hoje" : quando}, às ${agendamento.inicio}, com ${profissional}.`;
  $("#confirmadoDetalhes").replaceChildren(...[
    ["Cliente", `${agendamento.cliente.nome} · ${formatarTelefone(agendamento.cliente.telefone)}`],
    ["Serviços", `${nomes} · ${duracao} min`],
    ["Valor", formatarMoeda(agendamento.preco)],
    ["Repetição", descreverRepeticao(agendamento.repeticao, agendamento.data)]
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
  if (!$("#areaAgendamento").hidden) atualizarAgenda();
});
