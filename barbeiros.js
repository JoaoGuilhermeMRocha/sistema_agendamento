import { config } from "./config.js";
import {
  atendimentosDoDia, conflitoDoAtendimento, conflitosFuturos, daChave, descreverMensal, descreverRepeticao, diaFechado, formatarData, formatarMoeda,
  hoje, horaTexto, horariosLivres, minutos, paraChave, profissionalPorId, somarDias, somarServicos
} from "./agenda.js";
import {
  aoMudar, apagarTudo, cancelarData, carregar, criarAgendamento, criarAusencia, criarBloqueio,
  atualizarProduto, criarProduto, encerrarRepeticao, removerAusencia, removerBloqueio, removerProduto, salvarExpediente
} from "./dados.js";
import {
  $, aplicarIcones, avisar, capitalizar, confirmarNoBotao, el, formatarTelefone, icone, linkWhatsApp,
  mascararTelefone, preencherMarca
} from "./ui.js";

const DIAS_DA_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const ORDEM_DA_SEMANA = [1, 2, 3, 4, 5, 6, 0];

let estado = carregar();
const visao = {
  filtro: null,
  dia: hoje(),
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
  if (aba === "novo") atualizarHorariosNovo();
  window.scrollTo({ top: 0 });
}

window.addEventListener("hashchange", () => abrirAba(location.hash.slice(1)));

/* Agenda: filtro, calendário e lista do dia */

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
  }, pessoa.nome)));
}

const doFiltro = agendamento => !visao.filtro || agendamento.profissionalId === visao.filtro;

function desenharCalendario() {
  const primeiro = new Date(visao.ano, visao.mes, 1);
  const totalDias = new Date(visao.ano, visao.mes + 1, 0).getDate();
  $("#mesTitulo").textContent = capitalizar(new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(primeiro));

  const vazios = Array.from({ length: primeiro.getDay() }, () => el("span", { "aria-hidden": "true" }));
  const dias = Array.from({ length: totalDias }, (_, indice) => {
    const data = paraChave(new Date(visao.ano, visao.mes, indice + 1));
    const doDia = atendimentosDoDia(estado, data).filter(doFiltro);
    const quantidade = doDia.length;
    const temConflito = data >= hoje() && doDia.some(item => conflitoDoAtendimento(estado, item, data));
    const classes = ["calendario__dia"];
    if (data === hoje()) classes.push("calendario__dia--hoje");
    if (data < hoje()) classes.push("calendario__dia--passado");
    if (diaFechado(estado, data, visao.filtro)) classes.push("calendario__dia--fechado");
    if (temConflito) classes.push("calendario__dia--conflito");

    return el("button", {
      type: "button",
      class: classes.join(" "),
      "aria-pressed": String(data === visao.dia),
      "aria-label": `${formatarData(data, { day: "numeric", month: "long" })}: ${quantidade ? `${quantidade} atendimento(s)` : "nenhum atendimento"}${temConflito ? ", com conflito" : ""}`,
      onclick: () => {
        visao.dia = data;
        desenharAgenda();
        if (matchMedia("(max-width: 899px)").matches) $(".dia-agenda").scrollIntoView({ block: "start" });
      }
    },
    el("span", { class: "numeros" }, indice + 1),
    el("span", { class: "calendario__pontos", "aria-hidden": "true" },
      Array.from({ length: Math.min(quantidade, 3) }, () => el("i"))));
  });

  $("#calendario").replaceChildren(...vazios, ...dias);
}

function rotuloDoDia(data) {
  const extenso = formatarData(data, { weekday: "long", day: "numeric", month: "long" });
  return data === hoje() ? `Hoje, ${extenso}` : capitalizar(extenso);
}

function desenharDia() {
  const data = visao.dia;
  const atendimentos = atendimentosDoDia(estado, data).filter(doFiltro);
  const total = atendimentos.reduce((soma, item) => soma + item.preco, 0);
  const conflitos = data >= hoje()
    ? atendimentos.filter(item => conflitoDoAtendimento(estado, item, data)).length : 0;

  $("#diaTitulo").textContent = rotuloDoDia(data);
  $("#diaResumo").textContent = atendimentos.length
    ? `${atendimentos.length} ${atendimentos.length === 1 ? "atendimento" : "atendimentos"} · ${formatarMoeda(total)}` +
      (conflitos ? ` · ${conflitos} para remarcar` : "")
    : diaFechado(estado, data, visao.filtro) ? "Ninguém trabalha neste dia" : "Nenhum atendimento";

  const avisos = [
    ...estado.bloqueios.filter(item => item.data === data)
      .map(item => `${item.motivo} · ${item.horaInicio ? `${item.horaInicio}–${item.horaFim}` : "dia inteiro"}`),
    ...estado.ausencias
      .filter(item => data >= item.inicio && data <= item.fim && (!visao.filtro || item.profissionalId === visao.filtro))
      .map(item => `${nomeProfissional(item.profissionalId)} ausente · ${item.horaInicio ? `${item.horaInicio}–${item.horaFim}` : "dia inteiro"}`)
  ];
  $("#diaAvisos").replaceChildren(...avisos.map(texto => el("p", { class: "aviso-dia" }, texto)));

  if (!atendimentos.length) {
    const fechado = diaFechado(estado, data, visao.filtro);
    const podeMarcar = data >= hoje() && !fechado;
    $("#diaLista").replaceChildren(el("li", { class: "vazio" },
      icone("calendario"),
      el("strong", {}, data < hoje() ? "Nada registrado neste dia" : fechado ? "Dia de folga" : "Agenda livre"),
      podeMarcar && el("a", { class: "botao botao--contorno botao--pequeno", href: "#novo", onclick: () => prepararNovo(data) },
        icone("mais"), "Marcar horário")));
    return;
  }

  $("#diaLista").replaceChildren(...atendimentos.map((agendamento, indice) => {
    const { nomes } = somarServicos(agendamento.servicos);
    const fim = horaTexto(minutos(agendamento.inicio) + agendamento.duracao);
    const conflito = data >= hoje() && conflitoDoAtendimento(estado, agendamento, data);
    return el("li", { style: `--atraso: ${Math.min(indice, 10) * 30}ms` }, el("button", {
      type: "button",
      class: `atendimento${conflito ? " atendimento--conflito" : ""}`,
      "data-profissional": indiceProfissional(agendamento.profissionalId) % 4,
      onclick: () => abrirDetalhe(agendamento.id, data)
    },
    el("span", { class: "atendimento__hora numeros" }, agendamento.inicio, el("small", {}, fim)),
    el("span", { class: "atendimento__corpo" },
      el("strong", {}, agendamento.cliente.nome),
      el("span", {}, `${nomes} · ${nomeProfissional(agendamento.profissionalId)}`),
      conflito && el("span", { class: "atendimento__conflito" }, icone("alerta"), conflito)),
    el("span", { class: "atendimento__extra" },
      agendamento.repeticao.frequencia !== "nenhuma" && icone("repetir"),
      el("span", { class: "numeros" }, formatarMoeda(agendamento.preco)))));
  }));
}

function desenharAgenda() {
  desenharFiltro();
  desenharCalendario();
  desenharDia();
}

function mudarMes(diferenca) {
  const alvo = new Date(visao.ano, visao.mes + diferenca, 1);
  visao.ano = alvo.getFullYear();
  visao.mes = alvo.getMonth();
  desenharCalendario();
}

$("#mesAnterior").addEventListener("click", () => mudarMes(-1));
$("#mesSeguinte").addEventListener("click", () => mudarMes(1));
$("#irHoje").addEventListener("click", () => {
  visao.dia = hoje();
  visao.ano = new Date().getFullYear();
  visao.mes = new Date().getMonth();
  desenharAgenda();
});

/* Detalhe de um atendimento */

function abrirDetalhe(id, data) {
  const agendamento = estado.agendamentos.find(item => item.id === id);
  if (!agendamento) return;

  const { nomes, duracao } = somarServicos(agendamento.servicos);
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
      cancelar,
      encerrar,
      el("button", { type: "button", class: "botao botao--contorno botao--largo", onclick: fecharDetalhe }, "Fechar")));

  $("#detalhe").showModal();
}

function fecharDetalhe() {
  $("#detalhe").close();
  desenharAgenda();
}

// Tocar fora da folha fecha.
$("#detalhe").addEventListener("click", evento => {
  if (evento.target === evento.currentTarget) $("#detalhe").close();
});

/* Novo agendamento pelo painel */

const formNovo = $("#formNovo");

function desenharFormNovo() {
  $("#novoServicos").replaceChildren(...config.servicos.map((servico, indice) => el("label", { class: "chip" },
    el("input", { type: "checkbox", name: "servico", value: servico.id, checked: indice === 0 }),
    `${servico.nome} · ${formatarMoeda(servico.preco)}`)));
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
  const { duracao, preco } = somarServicos(servicos);
  const repete = repeticao.frequencia !== "nenhuma";

  $("#novoQuantidade").hidden = !repete;
  $("#novoVezes").disabled = $("#novoSemFim").checked;

  const anterior = $("#novoHorario").value;
  const horarios = data && duracao && (repeticao.vezes == null || repeticao.vezes >= 2)
    ? horariosLivres(estado, { data, repeticao, duracao, profissionalId }) : [];
  $("#novoHorario").replaceChildren(...(horarios.length
    ? horarios.map(horario => el("option", { value: horario, selected: horario === anterior }, horario))
    : [el("option", { value: "" }, duracao ? "Nenhum horário livre neste dia" : "Escolha um serviço")]));
  $("#novoHorario").disabled = !horarios.length;

  const regra = repeticao.frequencia === "mensal" && data ? ` · ${descreverMensal(data)}` : "";
  $("#novoResumo").textContent = duracao
    ? `${duracao} min · ${formatarMoeda(preco)}${repete ? " por atendimento" : ""}${regra}` : "";
}

function prepararNovo(data) {
  $("#novoData").value = data;
  if (visao.filtro) $("#novoProfissional").value = visao.filtro;
}

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

  formNovo.elements.nome.value = "";
  formNovo.elements.telefone.value = "";
  visao.dia = dados.data;
  visao.ano = daChave(dados.data).getFullYear();
  visao.mes = daChave(dados.data).getMonth();
  desenharAgenda();
  location.hash = "agenda";
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

/* Início */

function atualizarTudo() {
  desenharAgenda();
  desenharExpediente();
  desenharAusencias();
  desenharBloqueios();
  desenharProdutos();
  atualizarHorariosNovo();
}

preencherMarca();
aplicarIcones();
mascararTelefone(formNovo.elements.telefone);
desenharFormNovo();
$("#ausenciaProfissional").replaceChildren(...opcoesProfissionais());
atualizarTudo();
abrirAba(location.hash.slice(1));

// Um cliente marcou pelo site em outra aba: a agenda se atualiza sozinha.
aoMudar(novo => {
  estado = novo;
  desenharAgenda();
  desenharProdutos();
  if (!$('[data-secao="novo"]').hidden) atualizarHorariosNovo();
});
