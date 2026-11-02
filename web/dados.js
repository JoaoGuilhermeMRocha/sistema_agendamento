// Camada de dados. Por enquanto grava no localStorage deste navegador; quando o
// PostgreSQL entrar, só este arquivo muda, trocando cada função por uma chamada à API.
// As validações daqui são as mesmas que o servidor vai ter que repetir.
import { config } from "./config.js";
import {
  chaveValida, datasDaSerie, escolherProfissional, formatarData, inicioDaRecorrencia, minutos, profissionalLivre,
  profissionalPorId, servicosAtivos, somarServicos
} from "./agenda.js";

const CHAVE = `agenda:${config.slug}:v1`;
const FREQUENCIAS_VALIDAS = ["nenhuma", "semanal", "quinzenal", "mensal"];
// Símbolos que um serviço pode ter na agenda (nomes dos ícones de ui.js).
export const ICONES_DE_SERVICO = {
  tesoura: "Corte", barba: "Barba", sobrancelha: "Sobrancelha", navalha: "Navalha",
  pente: "Penteado", gota: "Tratamento", estrela: "Outro"
};

function estadoInicial() {
  return {
    proximoId: config.produtosIniciais.length + 1,
    agendamentos: [],
    ausencias: [],
    bloqueios: [],
    expedientes: {},
    produtos: config.produtosIniciais.map((produto, indice) => ({ id: indice + 1, ...produto }))
  };
}

// Dados salvos antes de existir algo novo no modelo ganham o valor inicial do config.js.
function completar(estado) {
  estado.servicos ??= config.servicosIniciais.map(servico => ({ ...servico }));
  for (const servico of estado.servicos) {
    servico.icone ??= config.servicosIniciais.find(item => item.id === servico.id)?.icone ?? "tesoura";
  }
  for (const { id } of config.profissionais) {
    estado.expedientes[id] ??= structuredClone(config.expedientePadrao);
  }
  return estado;
}

export function carregar() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE));
    if (salvo) return completar(salvo);
  } catch {
    // Dados corrompidos ou armazenamento bloqueado: recomeça do zero.
  }
  return completar(estadoInicial());
}

function gravar(estado) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(estado));
    return { ok: true };
  } catch {
    return falha("Não deu para salvar: o armazenamento deste navegador está cheio ou bloqueado.");
  }
}

// Com simular, aplica a mudança numa cópia e devolve o estado resultante sem gravar.
function alterar(mudanca, simular = false) {
  const estado = carregar();
  const resultado = mudanca(estado);
  if (!resultado.ok || simular) return { ...resultado, estado };
  const gravacao = gravar(estado);
  return gravacao.ok ? resultado : gravacao;
}

const falha = erro => ({ ok: false, erro });
const proximoId = estado => estado.proximoId++;
const soDigitos = texto => String(texto ?? "").replace(/\D/g, "");
const horaValida = hora => /^\d{2}:\d{2}$/.test(hora ?? "");

export function aoMudar(callback) {
  window.addEventListener("storage", evento => {
    if (evento.key === CHAVE || evento.key === null) callback(carregar());
  });
}

export function apagarTudo() {
  localStorage.removeItem(CHAVE);
}

// Troca todos os atendimentos pelos de exemplo (exemplo.js). Ferramenta de teste e demonstração:
// grava direto, sem as travas de horário no passado, porque o exemplo inclui meses que já passaram.
export function carregarExemplo(agendamentos) {
  return alterar(estado => {
    estado.agendamentos = agendamentos.map(agendamento => ({ ...agendamento, id: proximoId(estado) }));
    return { ok: true, total: agendamentos.length };
  });
}

/* Agendamentos */

function normalizarRepeticao(repeticao = {}) {
  const frequencia = FREQUENCIAS_VALIDAS.includes(repeticao.frequencia) ? repeticao.frequencia : "nenhuma";
  if (frequencia === "nenhuma") return { frequencia, vezes: 1 };
  if (repeticao.vezes == null) return { frequencia, vezes: null };
  const vezes = Number(repeticao.vezes);
  if (!Number.isInteger(vezes) || vezes < 2 || vezes > config.agenda.maxAtendimentosRepetidos) return null;
  return { frequencia, vezes };
}

export function criarAgendamento({ nome, telefone, servicos, profissionalId, data, inicio, repeticao, origem }) {
  return alterar(estado => {
    const cliente = { nome: String(nome ?? "").trim(), telefone: soDigitos(telefone) };
    if (cliente.nome.length < 2) return falha("Informe o nome do cliente.");
    if (!/^\d{10,11}$/.test(cliente.telefone)) return falha("Informe um WhatsApp com DDD.");

    const ids = Array.isArray(servicos) ? [...new Set(servicos)] : [];
    const ativos = new Set(servicosAtivos(estado).map(servico => servico.id));
    if (ids.some(id => !ativos.has(id))) return falha("Um dos serviços não está mais disponível. Recarregue a página.");
    const soma = somarServicos(estado, ids);
    if (!soma.lista.length) return falha("Escolha pelo menos um serviço.");
    if (profissionalId && !profissionalPorId(profissionalId)) return falha("Profissional inválido.");
    if (!chaveValida(data) || !horaValida(inicio)) return falha("Escolha o dia e o horário.");

    // Só o painel cria repetição: o que vier do site vira um atendimento único.
    const regra = normalizarRepeticao(origem === "painel" ? repeticao : undefined);
    if (!regra) return falha("Número de atendimentos inválido.");
    const datas = datasDaSerie(data, regra);

    const escolhido = escolherProfissional(estado, profissionalId || null, datas, minutos(inicio), soma.duracao);
    if (!escolhido) return falha("Esse horário não está mais livre. Escolha outro.");

    const agendamento = {
      id: proximoId(estado),
      cliente,
      servicos: soma.lista.map(servico => servico.id),
      profissionalId: escolhido,
      data,
      inicio,
      duracao: soma.duracao,
      preco: soma.preco,
      repeticao: regra,
      excecoes: [],
      ate: null,
      origem: origem === "painel" ? "painel" : "cliente",
      criadoEm: new Date().toISOString()
    };
    estado.agendamentos.push(agendamento);
    return { ok: true, agendamento, datas };
  });
}

// Cancela uma única data. Num agendamento avulso, isso apaga o registro.
export function cancelarData(id, data) {
  return alterar(estado => {
    const agendamento = estado.agendamentos.find(item => item.id === id);
    if (!agendamento) return falha("Agendamento não encontrado.");
    if (agendamento.repeticao.frequencia === "nenhuma") {
      estado.agendamentos.splice(estado.agendamentos.indexOf(agendamento), 1);
    } else {
      agendamento.excecoes.push(data);
    }
    return { ok: true };
  });
}

// Um atendimento avulso passa a se repetir com o mesmo cliente, serviços, profissional e horário.
// Se ele já passou, fica como está e a série nasce num novo agendamento, na próxima data da regra.
export function tornarRecorrente(id, repeticao) {
  return alterar(estado => {
    const original = estado.agendamentos.find(item => item.id === id);
    if (!original) return falha("Agendamento não encontrado.");
    if (original.repeticao.frequencia !== "nenhuma") return falha("Este atendimento já se repete.");
    const regra = normalizarRepeticao(repeticao);
    if (!regra) return falha("Número de atendimentos inválido.");
    if (regra.frequencia === "nenhuma") return falha("Escolha de quanto em quanto tempo ele se repete.");

    const ativos = new Set(servicosAtivos(estado).map(servico => servico.id));
    if (original.servicos.some(servico => !ativos.has(servico))) {
      return falha("Um dos serviços deste atendimento foi removido. Marque um novo horário pela aba Novo.");
    }

    const primeira = inicioDaRecorrencia(original, regra.frequencia);
    const noProprio = primeira === original.data;
    const datas = datasDaSerie(primeira, regra);
    const soma = somarServicos(estado, original.servicos);
    const duracao = noProprio ? original.duracao : soma.duracao;
    const ocupadas = (noProprio ? datas.slice(1) : datas).filter(data =>
      !profissionalLivre(estado, original.profissionalId, data, minutos(original.inicio), duracao));
    if (ocupadas.length) {
      const lista = ocupadas.slice(0, 3).map(data => formatarData(data)).join(", ");
      const resto = ocupadas.length > 3 ? ` e mais ${ocupadas.length - 3}` : "";
      return falha(`${profissionalPorId(original.profissionalId).nome} não está livre em ${lista}${resto}. ` +
        "Tente outra frequência ou menos atendimentos.");
    }

    if (noProprio) {
      original.repeticao = regra;
      return { ok: true, agendamento: original, datas };
    }
    const agendamento = {
      ...structuredClone(original),
      id: proximoId(estado),
      data: primeira,
      duracao: soma.duracao,
      preco: soma.preco,
      repeticao: regra,
      excecoes: [],
      ate: null,
      origem: "painel",
      criadoEm: new Date().toISOString()
    };
    estado.agendamentos.push(agendamento);
    return { ok: true, agendamento, datas };
  });
}

// Encerra a repetição: a data informada e as seguintes deixam de existir.
export function encerrarRepeticao(id, data) {
  return alterar(estado => {
    const agendamento = estado.agendamentos.find(item => item.id === id);
    if (!agendamento) return falha("Agendamento não encontrado.");
    if (data <= agendamento.data) {
      estado.agendamentos.splice(estado.agendamentos.indexOf(agendamento), 1);
    } else {
      agendamento.ate = data;
    }
    return { ok: true };
  });
}

/* Expediente, ausências e bloqueios */

export function salvarExpediente(profissionalId, dias, { simular = false } = {}) {
  return alterar(estado => {
    if (!profissionalPorId(profissionalId)) return falha("Profissional inválido.");
    const expediente = {};
    for (let dia = 0; dia < 7; dia++) {
      const item = dias[dia];
      if (!item) {
        expediente[dia] = null;
        continue;
      }
      const { inicio, fim, pausaInicio = "", pausaFim = "" } = item;
      if (!horaValida(inicio) || !horaValida(fim) || inicio >= fim) {
        return falha("Confira o início e o fim de cada dia de trabalho.");
      }
      if (Boolean(pausaInicio) !== Boolean(pausaFim) ||
          (pausaInicio && !(inicio < pausaInicio && pausaInicio < pausaFim && pausaFim < fim))) {
        return falha("A pausa precisa ter início e fim dentro do expediente.");
      }
      expediente[dia] = { inicio, fim, pausaInicio, pausaFim };
    }
    estado.expedientes[profissionalId] = expediente;
    return { ok: true };
  }, simular);
}

function intervaloDeHoras(horaInicio = "", horaFim = "") {
  if (Boolean(horaInicio) !== Boolean(horaFim)) return null;
  if (horaInicio && (!horaValida(horaInicio) || !horaValida(horaFim) || horaInicio >= horaFim)) return null;
  return { horaInicio, horaFim };
}

export function criarAusencia({ profissionalId, inicio, fim, horaInicio, horaFim }, { simular = false } = {}) {
  return alterar(estado => {
    const horas = intervaloDeHoras(horaInicio, horaFim);
    if (!profissionalPorId(profissionalId)) return falha("Escolha o profissional.");
    if (!chaveValida(inicio) || !chaveValida(fim) || fim < inicio) return falha("Confira o primeiro e o último dia.");
    if (!horas) return falha("Para ausência parcial, informe as duas horas em ordem.");
    estado.ausencias.push({ id: proximoId(estado), profissionalId, inicio, fim, ...horas });
    return { ok: true };
  }, simular);
}

export function criarBloqueio({ data, motivo, horaInicio, horaFim }, { simular = false } = {}) {
  return alterar(estado => {
    const horas = intervaloDeHoras(horaInicio, horaFim);
    const texto = String(motivo ?? "").trim();
    if (!chaveValida(data)) return falha("Escolha a data.");
    if (!texto) return falha("Informe o motivo.");
    if (!horas) return falha("Para bloqueio parcial, informe as duas horas em ordem.");
    estado.bloqueios.push({ id: proximoId(estado), data, motivo: texto.slice(0, 60), ...horas });
    return { ok: true };
  }, simular);
}

export function removerAusencia(id) {
  return alterar(estado => {
    estado.ausencias = estado.ausencias.filter(item => item.id !== id);
    return { ok: true };
  });
}

export function removerBloqueio(id) {
  return alterar(estado => {
    estado.bloqueios = estado.bloqueios.filter(item => item.id !== id);
    return { ok: true };
  });
}

/* Serviços */

function camposDoServico(estado, id, { nome, preco, duracao, icone }) {
  const texto = String(nome ?? "").trim();
  const valor = String(preco ?? "").trim() === "" ? NaN : Number(preco);
  const minutosServico = Number(duracao);
  const passo = config.agenda.intervaloMinutos;
  if (!texto) return falha("Informe o nome do serviço.");
  if (servicosAtivos(estado).some(servico => servico.id !== id && servico.nome.toLowerCase() === texto.toLowerCase())) {
    return falha("Já existe um serviço com esse nome.");
  }
  if (!Number.isFinite(valor) || valor < 0) return falha("Informe o preço do serviço.");
  if (!Number.isInteger(minutosServico) || minutosServico < passo || minutosServico > 480 || minutosServico % passo) {
    return falha("Escolha a duração do serviço.");
  }
  return {
    ok: true,
    campos: {
      nome: texto.slice(0, 60),
      preco: Math.round(valor * 100) / 100,
      duracao: minutosServico,
      icone: Object.hasOwn(ICONES_DE_SERVICO, icone) ? icone : "tesoura"
    }
  };
}

export function criarServico(dados) {
  return alterar(estado => {
    const validacao = camposDoServico(estado, null, dados);
    if (!validacao.ok) return validacao;
    estado.servicos.push({ id: String(proximoId(estado)), ...validacao.campos });
    return { ok: true };
  });
}

// Vale para os próximos agendamentos: os já marcados guardam o preço e a duração da época.
export function atualizarServico(id, dados) {
  return alterar(estado => {
    const servico = servicosAtivos(estado).find(item => item.id === id);
    if (!servico) return falha("Esse serviço não existe mais.");
    const validacao = camposDoServico(estado, id, dados);
    if (!validacao.ok) return validacao;
    Object.assign(servico, validacao.campos);
    return { ok: true };
  });
}

// Só marca como removido, para os atendimentos antigos continuarem mostrando o nome.
export function removerServico(id) {
  return alterar(estado => {
    const ativos = servicosAtivos(estado);
    const servico = ativos.find(item => item.id === id);
    if (!servico) return falha("Esse serviço não existe mais.");
    if (ativos.length === 1) return falha("Mantenha pelo menos um serviço para os clientes escolherem.");
    servico.removido = true;
    return { ok: true };
  });
}

/* Produtos */

function camposDoProduto({ nome, preco, descricao }) {
  const texto = String(nome ?? "").trim();
  const valor = Number(preco);
  if (!texto) return falha("Informe o nome do produto.");
  if (!Number.isFinite(valor) || valor <= 0) return falha("Informe um preço maior que zero.");
  return {
    ok: true,
    campos: {
      nome: texto.slice(0, 80),
      preco: Math.round(valor * 100) / 100,
      descricao: String(descricao ?? "").trim().slice(0, 200)
    }
  };
}

export function criarProduto({ foto, ...dados }) {
  return alterar(estado => {
    const validacao = camposDoProduto(dados);
    if (!validacao.ok) return validacao;
    estado.produtos.push({ id: proximoId(estado), ...validacao.campos, foto: foto || null });
    return { ok: true };
  });
}

// foto: undefined mantém a atual, null remove, texto troca.
export function atualizarProduto(id, { foto, ...dados }) {
  return alterar(estado => {
    const produto = estado.produtos.find(item => item.id === id);
    if (!produto) return falha("Esse produto não existe mais.");
    const validacao = camposDoProduto(dados);
    if (!validacao.ok) return validacao;
    Object.assign(produto, validacao.campos);
    if (foto !== undefined) produto.foto = foto || null;
    return { ok: true };
  });
}

export function removerProduto(id) {
  return alterar(estado => {
    estado.produtos = estado.produtos.filter(item => item.id !== id);
    return { ok: true };
  });
}
