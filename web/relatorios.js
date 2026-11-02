// Aba Relatórios do painel: filtros, indicadores, gráfico escolhido pelo barbeiro, tabela e
// exportação (PDF pela impressão do navegador e CSV com os atendimentos filtrados).
// Tudo sai das ocorrências dos atendimentos no período, com as repetições abertas dia a dia.
import { config } from "./config.js";
import {
  atendimentosDoDia, daChave, expedienteDoDia, formatarData, formatarMoeda, hoje, horaTexto, inicioDaSemana,
  minutos, motivoIndisponivel, paraChave, profissionalPorId, servicoPorId, somarDias
} from "./agenda.js";
import { $, capitalizar, el, formatarTelefone, icone } from "./ui.js";
import { desenharGrafico } from "./graficos.js";

const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const DIAS_LONGOS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const MAXIMO_DE_DIAS = 732;
const CLIENTES_NO_GRAFICO = 10;
const FATIAS = 6;

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const moedaCurta = valor => valor >= 1000 ? `R$ ${numero.format(valor / 1000)} mil` : `R$ ${numero.format(valor)}`;
const horas = valor => `${numero.format(valor)} h`;

const MEDIDAS = {
  faturamento: { nome: "Faturamento", formatar: formatarMoeda, eixo: moedaCurta, soma: true },
  atendimentos: { nome: "Atendimentos", formatar: valor => numero.format(valor), eixo: valor => numero.format(valor), soma: true, inteiro: true },
  horas: { nome: "Horas ocupadas", formatar: horas, eixo: horas, soma: true },
  ticket: { nome: "Ticket médio", formatar: formatarMoeda, eixo: moedaCurta, soma: false }
};

// "tempo": grupos em ordem cronológica (aceitam linha). Os outros são categorias (aceitam rosca).
const GRUPOS = {
  dia: { nome: "Dia", tempo: true },
  semana: { nome: "Semana", tempo: true },
  mes: { nome: "Mês", tempo: true },
  diaSemana: { nome: "Dia da semana", tempo: true },
  hora: { nome: "Horário", tempo: true },
  profissional: { nome: "Profissional" },
  servico: { nome: "Serviço" },
  origem: { nome: "Origem" },
  tipo: { nome: "Tipo" },
  cliente: { nome: "Cliente" }
};

const GRAFICOS = {
  colunas: "Colunas",
  barras: "Barras",
  linha: "Linha",
  rosca: "Rosca",
  tabela: "Só tabela"
};

const ORIGENS = { cliente: "Pelo site", painel: "Pelo painel" };

let obterEstado = () => null;
const visual = { medida: "faturamento", grupo: "dia", grafico: "colunas" };
let ultimo = null;
let larguraDeImpressao = null;

/* Período */

const diasEntre = (de, ate) => {
  const [a, b] = [daChave(de), daChave(ate)];
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
};
const mesInteiro = (ano, mes) => [paraChave(new Date(ano, mes, 1)), paraChave(new Date(ano, mes + 1, 0))];

// Devolve o período escolhido e o anterior a ele, para os indicadores compararem.
function lerPeriodo(filtros) {
  const dia = hoje();
  const data = daChave(dia);
  const [ano, mes] = [data.getFullYear(), data.getMonth()];
  const deslocado = (de, ate, nome) => {
    const tamanho = diasEntre(de, ate) + 1;
    return { de, ate, anterior: [somarDias(de, -tamanho), somarDias(de, -1)], nomeAnterior: nome };
  };
  switch (filtros.periodo) {
    case "esta-semana": {
      const segunda = inicioDaSemana(dia);
      return deslocado(segunda, somarDias(segunda, 6), "semana anterior");
    }
    case "este-mes": {
      const [de, ate] = mesInteiro(ano, mes);
      return { de, ate, anterior: mesInteiro(ano, mes - 1), nomeAnterior: "mês anterior" };
    }
    case "mes-passado": {
      const [de, ate] = mesInteiro(ano, mes - 1);
      return { de, ate, anterior: mesInteiro(ano, mes - 2), nomeAnterior: "mês anterior" };
    }
    case "ultimos-30": return deslocado(somarDias(dia, -29), dia, "30 dias anteriores");
    case "proximos-30": return deslocado(dia, somarDias(dia, 29), "30 dias anteriores");
    case "este-ano": return { de: `${ano}-01-01`, ate: `${ano}-12-31`, anterior: [`${ano - 1}-01-01`, `${ano - 1}-12-31`], nomeAnterior: "ano anterior" };
    default: {
      if (!filtros.de || !filtros.ate) return { erro: "Escolha as duas datas." };
      if (filtros.de > filtros.ate) return { erro: "A data inicial precisa vir antes da final." };
      if (diasEntre(filtros.de, filtros.ate) >= MAXIMO_DE_DIAS) return { erro: "Escolha um período de até dois anos." };
      return deslocado(filtros.de, filtros.ate, "período anterior");
    }
  }
}

function descreverPeriodo(de, ate) {
  const longa = { day: "numeric", month: "long", year: "numeric" };
  if (de === ate) return formatarData(de, longa);
  const [a, b] = [daChave(de), daChave(ate)];
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return `${a.getDate()} a ${formatarData(ate, longa)}`;
  if (a.getFullYear() === b.getFullYear()) return `${formatarData(de, { day: "numeric", month: "long" })} a ${formatarData(ate, longa)}`;
  return `${formatarData(de, longa)} a ${formatarData(ate, longa)}`;
}

/* Linhas: uma por atendimento em cada dia que ele acontece */

function linhasDoPeriodo(estado, de, ate, filtros) {
  const agora = new Date();
  const agoraEmMinutos = agora.getHours() * 60 + agora.getMinutes();
  const linhas = [];
  for (let data = de; data <= ate; data = somarDias(data, 1)) {
    for (const agendamento of atendimentosDoDia(estado, data)) {
      const servicos = agendamento.servicos.map(id => servicoPorId(estado, id)).filter(Boolean);
      const fim = minutos(agendamento.inicio) + agendamento.duracao;
      const linha = {
        data,
        inicio: agendamento.inicio,
        fim: horaTexto(fim),
        cliente: agendamento.cliente.nome,
        telefone: agendamento.cliente.telefone,
        profissionalId: agendamento.profissionalId,
        servicos,
        duracao: agendamento.duracao,
        valor: agendamento.preco,
        origem: agendamento.origem,
        recorrente: agendamento.repeticao.frequencia !== "nenhuma",
        aconteceu: data < hoje() || (data === hoje() && fim <= agoraEmMinutos)
      };
      if (filtros.profissional && linha.profissionalId !== filtros.profissional) continue;
      if (filtros.servico && !servicos.some(servico => servico.id === filtros.servico)) continue;
      if (filtros.origem && linha.origem !== filtros.origem) continue;
      if (filtros.tipo && (filtros.tipo === "recorrente") !== linha.recorrente) continue;
      linhas.push(linha);
    }
  }
  return linhas;
}

// Divide o valor e o tempo de um atendimento entre os serviços dele, na proporção do preço e da duração.
function partes(linha) {
  const precos = linha.servicos.reduce((soma, servico) => soma + servico.preco, 0);
  const duracoes = linha.servicos.reduce((soma, servico) => soma + servico.duracao, 0);
  return linha.servicos.map(servico => ({
    servico,
    valor: linha.valor * (precos ? servico.preco / precos : 1 / linha.servicos.length),
    minutos: linha.duracao * (duracoes ? servico.duracao / duracoes : 1 / linha.servicos.length)
  }));
}

// Com filtro de serviço, só a parte daquele serviço entra no valor e no tempo.
function contribuicao(linha, filtros) {
  if (!filtros.servico) return { valor: linha.valor, minutos: linha.duracao };
  return partes(linha).find(parte => parte.servico.id === filtros.servico) ?? { valor: 0, minutos: 0 };
}

/* Indicadores */

function minutosDisponiveis(estado, de, ate, filtros) {
  const passo = config.agenda.intervaloMinutos;
  const ids = filtros.profissional ? [filtros.profissional] : config.profissionais.map(pessoa => pessoa.id);
  let total = 0;
  for (let data = de; data <= ate; data = somarDias(data, 1)) {
    for (const id of ids) {
      const expediente = expedienteDoDia(estado, id, data);
      if (!expediente) continue;
      for (let inicio = minutos(expediente.inicio); inicio < minutos(expediente.fim); inicio += passo) {
        if (!motivoIndisponivel(estado, id, data, inicio, passo)) total += passo;
      }
    }
  }
  return total;
}

function indicadores(estado, linhas, de, ate, filtros) {
  let faturamento = 0;
  let ocupados = 0;
  let previsto = 0;
  for (const linha of linhas) {
    const { valor, minutos: tempo } = contribuicao(linha, filtros);
    faturamento += valor;
    ocupados += tempo;
    if (!linha.aconteceu) previsto += valor;
  }
  const disponivel = minutosDisponiveis(estado, de, ate, filtros);
  return {
    faturamento,
    previsto,
    atendimentos: linhas.length,
    ticket: linhas.length ? faturamento / linhas.length : 0,
    clientes: new Set(linhas.map(linha => linha.telefone)).size,
    ocupacao: disponivel ? ocupados / disponivel : null
  };
}

// Variação contra o período anterior. Subir é bom em todos os indicadores daqui.
function variacao(atual, anterior, emPontos = false) {
  if (atual == null || anterior == null) return null;
  if (emPontos) {
    const pontos = Math.round((atual - anterior) * 100);
    return { direcao: Math.sign(pontos), texto: `${pontos > 0 ? "+" : ""}${pontos} p.p.` };
  }
  if (!anterior) return null;
  const porcento = Math.round(((atual - anterior) / anterior) * 100);
  return { direcao: Math.sign(porcento), texto: `${porcento > 0 ? "+" : ""}${porcento}%` };
}

function desenharIndicadores(atual, anterior, nomeAnterior) {
  const cartoes = [
    ["Faturamento", formatarMoeda(atual.faturamento), variacao(atual.faturamento, anterior.faturamento)],
    ["Atendimentos", numero.format(atual.atendimentos), variacao(atual.atendimentos, anterior.atendimentos)],
    ["Ticket médio", atual.atendimentos ? formatarMoeda(atual.ticket) : "—", atual.atendimentos && anterior.atendimentos ? variacao(atual.ticket, anterior.ticket) : null],
    ["Clientes", numero.format(atual.clientes), variacao(atual.clientes, anterior.clientes)],
    ["Ocupação da agenda", atual.ocupacao == null ? "—" : `${Math.round(atual.ocupacao * 100)}%`, variacao(atual.ocupacao, anterior.ocupacao, true)]
  ];
  $("#relIndicadores").replaceChildren(...cartoes.map(([rotulo, valor, delta]) => el("div", { class: "indicador" },
    el("span", { class: "indicador__rotulo" }, rotulo),
    el("strong", { class: "indicador__valor" }, valor),
    el("span", {
      class: `indicador__variacao${delta?.direcao > 0 ? " indicador__variacao--sobe" : delta?.direcao < 0 ? " indicador__variacao--desce" : ""}`
    }, delta
      ? `${delta.direcao > 0 ? "▲" : delta.direcao < 0 ? "▼" : "="} ${delta.texto} vs ${nomeAnterior}`
      : `sem base no ${nomeAnterior}`))));
}

/* Agrupamento */

function grupoDaLinha(linha, grupo) {
  const data = daChave(linha.data);
  switch (grupo) {
    case "dia": return linha.data;
    case "semana": return inicioDaSemana(linha.data);
    case "mes": return linha.data.slice(0, 7);
    case "diaSemana": return (data.getDay() + 6) % 7;
    case "hora": return Number(linha.inicio.slice(0, 2));
    case "profissional": return linha.profissionalId;
    case "origem": return linha.origem;
    case "tipo": return linha.recorrente ? "recorrente" : "avulso";
    case "cliente": return linha.telefone;
    default: return null;
  }
}

// Grupos de tempo vêm completos e em ordem, inclusive os vazios, para o gráfico não pular dias.
function gruposVazios(estado, grupo, de, ate, linhas) {
  const lista = [];
  const novo = (chave, rotulo, rotuloLongo, extra = {}) => lista.push({ chave, rotulo, rotuloLongo, atendimentos: 0, faturamento: 0, minutos: 0, ...extra });
  if (grupo === "dia") {
    for (let data = de; data <= ate; data = somarDias(data, 1)) {
      novo(data, formatarData(data), capitalizar(formatarData(data, { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "")));
    }
  } else if (grupo === "semana") {
    for (let segunda = inicioDaSemana(de); segunda <= ate; segunda = somarDias(segunda, 7)) {
      novo(segunda, formatarData(segunda), `Semana de ${formatarData(segunda)} a ${formatarData(somarDias(segunda, 6))}`);
    }
  } else if (grupo === "mes") {
    for (let data = daChave(de); paraChave(data) <= ate; data = new Date(data.getFullYear(), data.getMonth() + 1, 1)) {
      const mes = new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(data).replace(".", "");
      novo(paraChave(data).slice(0, 7), `${capitalizar(mes)}/${String(data.getFullYear()).slice(2)}`,
        capitalizar(new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(data)));
    }
  } else if (grupo === "diaSemana") {
    DIAS.forEach((dia, indice) => novo(indice, dia, DIAS_LONGOS[indice]));
  } else if (grupo === "hora") {
    const horasDasLinhas = linhas.map(linha => Number(linha.inicio.slice(0, 2)));
    const inicioDoDia = Math.min(9, ...horasDasLinhas);
    const fimDoDia = Math.max(17, ...horasDasLinhas);
    for (let hora = inicioDoDia; hora <= fimDoDia; hora++) novo(hora, `${hora}h`, `${hora}h às ${hora + 1}h`);
  } else if (grupo === "profissional") {
    config.profissionais.forEach((pessoa, indice) => novo(pessoa.id, pessoa.nome, pessoa.nome, { cor: indice }));
  } else if (grupo === "servico") {
    estado.servicos.forEach((servico, indice) => novo(servico.id, servico.nome,
      servico.removido ? `${servico.nome} (removido)` : servico.nome, { cor: indice, icone: servico.icone }));
  } else if (grupo === "origem") {
    Object.entries(ORIGENS).forEach(([chave, nome], indice) => novo(chave, nome, nome, { cor: indice }));
  } else if (grupo === "tipo") {
    novo("recorrente", "Recorrentes", "Recorrentes", { cor: 0 });
    novo("avulso", "Avulsos", "Avulsos", { cor: 1 });
  }
  return lista;
}

function agrupar(estado, linhas, grupo, de, ate, filtros) {
  const lista = gruposVazios(estado, grupo, de, ate, linhas);
  const porChave = new Map(lista.map(item => [item.chave, item]));
  const somar = (chave, criar, valor, tempo) => {
    if (!porChave.has(chave)) {
      const item = { chave, atendimentos: 0, faturamento: 0, minutos: 0, ...criar() };
      porChave.set(chave, item);
      lista.push(item);
    }
    const item = porChave.get(chave);
    item.atendimentos += 1;
    item.faturamento += valor;
    item.minutos += tempo;
  };

  for (const linha of linhas) {
    if (grupo === "servico") {
      for (const parte of partes(linha)) {
        if (filtros.servico && parte.servico.id !== filtros.servico) continue;
        somar(parte.servico.id, () => ({ rotulo: parte.servico.nome, rotuloLongo: parte.servico.nome }), parte.valor, parte.minutos);
      }
      continue;
    }
    const { valor, minutos: tempo } = contribuicao(linha, filtros);
    // Cliente: o nome mais recente do período, com o WhatsApp para não confundir homônimos.
    somar(grupoDaLinha(linha, grupo), () => ({
      rotulo: linha.cliente,
      rotuloLongo: `${linha.cliente} · ${formatarTelefone(linha.telefone)}`
    }), valor, tempo);
  }

  const comValores = lista.map(item => ({
    ...item,
    horas: item.minutos / 60,
    ticket: item.atendimentos ? item.faturamento / item.atendimentos : 0
  }));
  if (GRUPOS[grupo].tempo) return comValores;
  // Categorias: só as que têm atendimento, da maior para a menor na medida escolhida.
  return comValores.filter(item => item.atendimentos)
    .sort((a, b) => b[visual.medida] - a[visual.medida] || String(a.rotulo).localeCompare(String(b.rotulo)));
}

/* Gráfico e tabela */

const graficoPermitido = (tipo, grupo = visual.grupo, medida = visual.medida) => {
  if (tipo === "linha") return Boolean(GRUPOS[grupo].tempo);
  if (tipo === "rosca") return !GRUPOS[grupo].tempo && grupo !== "cliente" && MEDIDAS[medida].soma;
  return true;
};

const motivoBloqueio = tipo => tipo === "linha"
  ? "A linha mostra evolução: agrupe por dia, semana, mês, dia da semana ou horário."
  : "A rosca mostra partes de um todo: agrupe por profissional, serviço, origem ou tipo, e mostre uma soma (não o ticket médio).";

function desenharTipos() {
  $("#relTipos").replaceChildren(...Object.entries(GRAFICOS).map(([tipo, nome]) => {
    const permitido = graficoPermitido(tipo);
    return el("label", { class: "chip", title: permitido ? null : motivoBloqueio(tipo) },
      el("input", { type: "radio", name: "relTipo", value: tipo, checked: visual.grafico === tipo, disabled: !permitido }), nome);
  }));
}

// O gráfico mostra no máximo 10 clientes e 6 fatias; o restante soma em "Outros" (a tabela traz tudo).
function itensDoGrafico(grupos) {
  const medida = visual.medida;
  const valor = item => item[medida];
  if (visual.grafico === "rosca") {
    const comCor = grupos.filter(item => item.cor != null && item.cor < FATIAS - 1 && valor(item) > 0);
    const resto = grupos.filter(item => !comCor.includes(item));
    const itens = comCor.map(item => ({ rotulo: item.rotulo, rotuloLongo: item.rotuloLongo, valor: valor(item), cor: `var(--cor-grafico-${item.cor + 1})` }));
    const somaResto = resto.reduce((soma, item) => soma + valor(item), 0);
    if (somaResto > 0) itens.push({ rotulo: "Outros", rotuloLongo: "Outros", valor: somaResto, cor: "var(--cor-grafico-outros)" });
    return itens;
  }
  if (visual.grupo === "cliente" && grupos.length > CLIENTES_NO_GRAFICO) {
    const primeiros = grupos.slice(0, CLIENTES_NO_GRAFICO - 1);
    const resto = grupos.slice(CLIENTES_NO_GRAFICO - 1);
    const outros = resto.reduce((soma, item) => ({
      atendimentos: soma.atendimentos + item.atendimentos, faturamento: soma.faturamento + item.faturamento, horas: soma.horas + item.horas
    }), { atendimentos: 0, faturamento: 0, horas: 0 });
    outros.ticket = outros.atendimentos ? outros.faturamento / outros.atendimentos : 0;
    return [...primeiros.map(item => ({ rotulo: item.rotulo, rotuloLongo: item.rotuloLongo, valor: valor(item) })),
      { rotulo: `Outros ${resto.length}`, rotuloLongo: `Outros ${resto.length} clientes`, valor: outros[medida] }];
  }
  return grupos.map(item => ({ rotulo: item.rotulo, rotuloLongo: item.rotuloLongo, valor: valor(item) }));
}

function desenharGraficoAtual() {
  if (!ultimo) return;
  const area = $("#relGrafico");
  area.hidden = visual.grafico === "tabela";
  if (area.hidden) return;
  const medida = MEDIDAS[visual.medida];
  desenharGrafico(area, {
    tipo: visual.grafico,
    itens: itensDoGrafico(ultimo.grupos),
    formatar: medida.formatar,
    formatarEixo: medida.eixo,
    inteiro: medida.inteiro,
    total: visual.medida === "faturamento" ? ultimo.atual.faturamento : null,
    largura: larguraDeImpressao,
    descricao: `${$("#relTitulo").textContent}, ${descreverPeriodo(ultimo.de, ultimo.ate)}`,
    vazio: "Nenhum atendimento com esses filtros."
  });
}

function desenharTabela(grupos) {
  const grupo = GRUPOS[visual.grupo];
  const medida = MEDIDAS[visual.medida];
  const total = grupos.reduce((soma, item) => ({
    atendimentos: soma.atendimentos + item.atendimentos,
    faturamento: soma.faturamento + item.faturamento,
    horas: soma.horas + item.horas
  }), { atendimentos: 0, faturamento: 0, horas: 0 });
  total.ticket = total.atendimentos ? total.faturamento / total.atendimentos : 0;
  const parte = item => medida.soma && total[visual.medida] ? `${Math.round((item[visual.medida] / total[visual.medida]) * 100)}%` : "—";
  const comRosca = visual.grafico === "rosca";

  const celulas = item => [
    el("td", { class: "numeros" }, numero.format(item.atendimentos)),
    el("td", { class: "numeros" }, formatarMoeda(item.faturamento)),
    el("td", { class: "numeros" }, horas(item.horas)),
    el("td", { class: "numeros" }, item.atendimentos ? formatarMoeda(item.ticket) : "—"),
    el("td", { class: "numeros" }, parte(item))
  ];
  const nome = item => {
    const chave = comRosca && item.cor != null
      ? el("i", { class: "grafico__chave", style: `background: var(--cor-grafico-${item.cor < FATIAS - 1 ? item.cor + 1 : "outros"})` }) : "";
    const simbolo = item.icone ? icone(item.icone, `icone icone-servico icone-servico--${item.icone}`) : "";
    return el("th", { scope: "row" }, el("span", { class: "tabela__nome" }, chave, simbolo, item.rotuloLongo));
  };

  $("#relTabela").replaceChildren(
    el("thead", {}, el("tr", {}, ...[grupo.nome, "Atend.", "Faturamento", "Horas", "Ticket médio", `% ${medida.nome.toLowerCase()}`]
      .map((titulo, indice) => el("th", { scope: "col", class: indice ? "numeros" : "" }, titulo)))),
    el("tbody", {}, grupos.length
      ? grupos.map(item => el("tr", {}, nome(item), ...celulas(item)))
      : el("tr", {}, el("td", { colspan: 6, class: "tabela__vazia" }, "Nenhum atendimento com esses filtros."))),
    el("tfoot", {}, el("tr", {}, el("th", { scope: "row" }, "Total"), ...celulas(total).slice(0, 4),
      el("td", { class: "numeros" }, medida.soma ? "100%" : "—"))));
}

/* Montagem */

function lerFiltros() {
  const valores = new FormData($("#filtrosRelatorio"));
  return Object.fromEntries(["periodo", "de", "ate", "profissional", "servico", "origem", "tipo"].map(nome => [nome, valores.get(nome) || ""]));
}

function descreverFiltros(filtros) {
  const servico = filtros.servico && servicoPorId(obterEstado(), filtros.servico);
  return [
    `Profissional: ${filtros.profissional ? profissionalPorId(filtros.profissional)?.nome : "todos"}`,
    `Serviço: ${servico ? servico.nome : "todos"}`,
    `Origem: ${filtros.origem ? ORIGENS[filtros.origem].toLowerCase() : "todas"}`,
    `Tipo: ${filtros.tipo === "recorrente" ? "recorrentes" : filtros.tipo === "avulso" ? "avulsos" : "todos"}`
  ].join(" · ");
}

function preencherOpcoes() {
  const estado = obterEstado();
  const form = $("#filtrosRelatorio");
  const manter = (select, opcoes) => {
    const anterior = select.value;
    select.replaceChildren(...opcoes.map(([valor, nome]) => el("option", { value: valor }, nome)));
    select.value = opcoes.some(([valor]) => valor === anterior) ? anterior : opcoes[0][0];
  };
  manter(form.elements.profissional, [["", "Todos"], ...config.profissionais.map(pessoa => [pessoa.id, pessoa.nome])]);
  manter(form.elements.servico, [["", "Todos"], ...estado.servicos.map(servico => [servico.id, servico.removido ? `${servico.nome} (removido)` : servico.nome])]);
  manter($("#relMedida"), Object.entries(MEDIDAS).map(([chave, medida]) => [chave, medida.nome]));
  manter($("#relGrupo"), Object.entries(GRUPOS).map(([chave, grupo]) => [chave, grupo.nome]));
  $("#relMedida").value = visual.medida;
  $("#relGrupo").value = visual.grupo;
}

export function atualizarRelatorios() {
  const secao = $('[data-secao="relatorios"]');
  if (!secao || secao.hidden) return;
  const estado = obterEstado();
  preencherOpcoes();

  const filtros = lerFiltros();
  const personalizado = filtros.periodo === "personalizado";
  for (const campo of document.querySelectorAll(".relatorio__data")) campo.hidden = !personalizado;
  const periodo = lerPeriodo(filtros);
  $("#relErro").textContent = periodo.erro ?? "";
  if (periodo.erro) return;

  const linhas = linhasDoPeriodo(estado, periodo.de, periodo.ate, filtros);
  const anteriores = linhasDoPeriodo(estado, ...periodo.anterior, filtros);
  const atual = indicadores(estado, linhas, periodo.de, periodo.ate, filtros);
  const anterior = indicadores(estado, anteriores, ...periodo.anterior, filtros);
  const grupos = agrupar(estado, linhas, visual.grupo, periodo.de, periodo.ate, filtros);
  ultimo = { linhas, grupos, atual, de: periodo.de, ate: periodo.ate, filtros };

  const textoPeriodo = descreverPeriodo(periodo.de, periodo.ate);
  $("#relPeriodo").replaceChildren(
    el("strong", {}, capitalizar(textoPeriodo)),
    atual.previsto ? ` · ${formatarMoeda(atual.faturamento - atual.previsto)} já atendidos e ${formatarMoeda(atual.previsto)} ainda agendados` : "");
  $("#relImpressao").textContent = `Relatório de ${textoPeriodo} · ${descreverFiltros(filtros)} · gerado em ${formatarData(hoje(), { day: "2-digit", month: "2-digit", year: "numeric" })}`;
  desenharIndicadores(atual, anterior, periodo.nomeAnterior);

  const titulo = `${MEDIDAS[visual.medida].nome} por ${GRUPOS[visual.grupo].nome.toLowerCase()}`;
  $("#relTitulo").textContent = titulo;
  $("#relTituloTabela").textContent = visual.grafico === "tabela" ? titulo : "Os números do gráfico";
  desenharTipos();
  desenharGraficoAtual();
  desenharTabela(grupos);
}

/* Exportação */

// CSV no padrão do Excel em português: ponto e vírgula, vírgula decimal e BOM para os acentos.
function celulaCsv(valor) {
  let texto = String(valor ?? "");
  // Nome digitado no site começando com = + - @ viraria fórmula na planilha.
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[;"\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

function baixarCsv() {
  if (!ultimo) return;
  const decimal = valor => valor.toFixed(2).replace(".", ",");
  const cabecalho = ["Data", "Dia da semana", "Início", "Fim", "Cliente", "WhatsApp", "Profissional", "Serviços",
    "Duração (min)", "Valor (R$)", "Origem", "Recorrente", "Situação"];
  const linhas = ultimo.linhas.map(linha => [
    formatarData(linha.data, { day: "2-digit", month: "2-digit", year: "numeric" }),
    DIAS_LONGOS[(daChave(linha.data).getDay() + 6) % 7],
    linha.inicio,
    linha.fim,
    linha.cliente,
    formatarTelefone(linha.telefone),
    profissionalPorId(linha.profissionalId)?.nome ?? "",
    linha.servicos.map(servico => servico.nome).join(" + "),
    linha.duracao,
    decimal(linha.valor),
    ORIGENS[linha.origem] ?? linha.origem,
    linha.recorrente ? "Sim" : "Não",
    linha.aconteceu ? "Já aconteceu" : "Agendado"
  ]);
  const conteudo = "﻿" + [cabecalho, ...linhas].map(colunas => colunas.map(celulaCsv).join(";")).join("\r\n");
  const endereco = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8" }));
  const link = el("a", { href: endereco, download: `relatorio-${config.slug}-${ultimo.de}-a-${ultimo.ate}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(endereco), 1000);
}

// O PDF sai da impressão do navegador ("Salvar como PDF"). O título vira o nome sugerido do arquivo,
// e o gráfico é redesenhado na largura da folha.
function baixarPdf() {
  if (!ultimo) return;
  window.print();
}

let tituloDaPagina = "";
window.addEventListener("beforeprint", () => {
  if (!ultimo || $('[data-secao="relatorios"]').hidden) return;
  tituloDaPagina = document.title;
  document.title = `Relatório ${config.nomeCurto} ${ultimo.de} a ${ultimo.ate}`;
  larguraDeImpressao = 680;
  desenharGraficoAtual();
});
window.addEventListener("afterprint", () => {
  if (!tituloDaPagina) return;
  document.title = tituloDaPagina;
  tituloDaPagina = "";
  larguraDeImpressao = null;
  desenharGraficoAtual();
});

export function iniciarRelatorios(lerEstado) {
  obterEstado = lerEstado;
  const form = $("#filtrosRelatorio");
  // Datas do "Escolher datas" começam no mês atual.
  const [de, ate] = mesInteiro(new Date().getFullYear(), new Date().getMonth());
  form.elements.de.value = de;
  form.elements.ate.value = ate;
  form.addEventListener("change", atualizarRelatorios);
  form.addEventListener("submit", evento => evento.preventDefault());

  $("#relMedida").addEventListener("change", evento => {
    visual.medida = evento.target.value;
    if (!graficoPermitido(visual.grafico)) visual.grafico = GRUPOS[visual.grupo].tempo ? "colunas" : "barras";
    atualizarRelatorios();
  });
  $("#relGrupo").addEventListener("change", evento => {
    visual.grupo = evento.target.value;
    // Ao trocar o agrupamento, o gráfico que não serve mais vira o padrão: colunas no tempo, barras nas categorias.
    if (!graficoPermitido(visual.grafico)) visual.grafico = GRUPOS[visual.grupo].tempo ? "colunas" : "barras";
    atualizarRelatorios();
  });
  $("#relTipos").addEventListener("change", evento => {
    visual.grafico = evento.target.value;
    atualizarRelatorios();
  });
  $("#baixarCsv").addEventListener("click", baixarCsv);
  $("#baixarPdf").addEventListener("click", baixarPdf);

  // Redesenha só o gráfico quando a largura da área muda (girar o celular, redimensionar a janela).
  let largura = 0;
  new ResizeObserver(([entrada]) => {
    const nova = Math.round(entrada.contentRect.width);
    if (nova === largura || larguraDeImpressao) return;
    largura = nova;
    desenharGraficoAtual();
  }).observe($("#relGrafico"));
}
