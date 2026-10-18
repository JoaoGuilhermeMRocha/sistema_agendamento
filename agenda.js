// Regras de agenda compartilhadas pelo agendamento do cliente e pelo painel.
// Funções puras: recebem o estado e não gravam nada.
import { config } from "./config.js";

export const pad = valor => String(valor).padStart(2, "0");
export const paraChave = data => `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}`;
export const daChave = chave => {
  const [ano, mes, dia] = chave.split("-").map(Number);
  return new Date(ano, mes - 1, dia);
};
export const chaveValida = chave => /^\d{4}-\d{2}-\d{2}$/.test(chave) && paraChave(daChave(chave)) === chave;
export const hoje = () => paraChave(new Date());
export const minutos = hora => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
export const horaTexto = total => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
export const sobrepoe = (inicio, fim, outroInicio, outroFim) => inicio < outroFim && outroInicio < fim;

export function somarDias(chave, dias) {
  const data = daChave(chave);
  data.setDate(data.getDate() + dias);
  return paraChave(data);
}

function diasEntre(de, ate) {
  const [a, b] = [daChave(de), daChave(ate)];
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
    Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}

const formatadores = new Map();
export function formatarData(chave, opcoes = { day: "2-digit", month: "2-digit" }) {
  const id = JSON.stringify(opcoes);
  if (!formatadores.has(id)) formatadores.set(id, new Intl.DateTimeFormat("pt-BR", opcoes));
  return formatadores.get(id).format(daChave(chave));
}

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatarMoeda = valor => moeda.format(valor);

export const servicoPorId = id => config.servicos.find(servico => servico.id === id);
export const profissionalPorId = id => config.profissionais.find(pessoa => pessoa.id === id);

export function somarServicos(ids) {
  const lista = ids.map(servicoPorId).filter(Boolean);
  return {
    lista,
    nomes: lista.map(servico => servico.nome).join(" + "),
    duracao: lista.reduce((total, servico) => total + servico.duracao, 0),
    preco: lista.reduce((total, servico) => total + servico.preco, 0)
  };
}

const INTERVALO = { semanal: 7, quinzenal: 14 };
export const FREQUENCIAS = {
  nenhuma: "Só desta vez",
  semanal: "Toda semana",
  quinzenal: "A cada 15 dias",
  mensal: "Todo mês"
};

// A repetição mensal segue o dia da semana do mês ("toda 3ª terça"), para nunca cair
// num dia fechado nem num dia 31 que não existe. A 5ª ocorrência vira "a última do mês".
function regraMensal(chave) {
  const data = daChave(chave);
  const ordem = Math.ceil(data.getDate() / 7);
  return { diaSemana: data.getDay(), ordem: ordem === 5 ? -1 : ordem };
}

function dataMensal(ano, mes, { diaSemana, ordem }) {
  if (ordem === -1) {
    const ultimo = new Date(ano, mes + 1, 0);
    return paraChave(new Date(ano, mes, ultimo.getDate() - (ultimo.getDay() - diaSemana + 7) % 7));
  }
  const avanco = (diaSemana - new Date(ano, mes, 1).getDay() + 7) % 7;
  return paraChave(new Date(ano, mes, 1 + avanco + (ordem - 1) * 7));
}

const NOMES_DOS_DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function descreverMensal(chave) {
  const { diaSemana, ordem } = regraMensal(chave);
  const masculino = diaSemana === 0 || diaSemana === 6;
  const posicao = ordem === -1 ? (masculino ? "último" : "última") : `${ordem}${masculino ? "º" : "ª"}`;
  return `${masculino ? "Todo" : "Toda"} ${posicao} ${NOMES_DOS_DIAS[diaSemana]} do mês`;
}

export function descreverRepeticao({ frequencia, vezes }, primeira = null) {
  if (frequencia === "nenhuma") return FREQUENCIAS.nenhuma;
  const nome = frequencia === "mensal" && primeira ? descreverMensal(primeira) : FREQUENCIAS[frequencia];
  return `${nome} · ${vezes == null ? "sem data para terminar" : `${vezes} atendimentos`}`;
}

// Datas de uma série a partir da primeira. Sem número de vezes, vai até o horizonte configurado.
export function datasDaSerie(primeira, { frequencia, vezes }) {
  if (frequencia === "nenhuma") return [primeira];

  const limite = somarDias(primeira, config.agenda.horizonteRecorrenciaDias);
  const base = daChave(primeira);
  const regra = regraMensal(primeira);
  const datas = [];
  for (let indice = 0; vezes == null || indice < vezes; indice++) {
    const data = frequencia === "mensal"
      ? dataMensal(base.getFullYear(), base.getMonth() + indice, regra)
      : somarDias(primeira, indice * INTERVALO[frequencia]);
    if (vezes == null && data > limite) break;
    datas.push(data);
  }
  return datas;
}

export function ocorreEm(agendamento, data) {
  if (data < agendamento.data || (agendamento.ate && data >= agendamento.ate) ||
      agendamento.excecoes.includes(data)) return false;

  const { frequencia, vezes } = agendamento.repeticao;
  if (frequencia === "nenhuma") return data === agendamento.data;

  let indice;
  if (frequencia === "mensal") {
    const [primeira, atual] = [daChave(agendamento.data), daChave(data)];
    if (dataMensal(atual.getFullYear(), atual.getMonth(), regraMensal(agendamento.data)) !== data) return false;
    indice = (atual.getFullYear() - primeira.getFullYear()) * 12 + atual.getMonth() - primeira.getMonth();
  } else {
    const dias = diasEntre(agendamento.data, data);
    if (dias % INTERVALO[frequencia]) return false;
    indice = dias / INTERVALO[frequencia];
  }
  return vezes == null || indice < vezes;
}

export function atendimentosDoDia(estado, data) {
  return estado.agendamentos
    .filter(agendamento => ocorreEm(agendamento, data))
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
}

export function expedienteDoDia(estado, profissionalId, data) {
  return estado.expedientes[profissionalId]?.[daChave(data).getDay()] || null;
}

function intervaloLivre(item, inicio, fim) {
  return !item.horaInicio || !sobrepoe(inicio, fim, minutos(item.horaInicio), minutos(item.horaFim));
}

// Por que o profissional não atende nesse intervalo, sem contar outros clientes. null = pode atender.
export function motivoIndisponivel(estado, profissionalId, data, inicio, duracao) {
  const expediente = expedienteDoDia(estado, profissionalId, data);
  if (!expediente) return "Dia de folga do profissional";

  const fim = inicio + duracao;
  if (inicio < minutos(expediente.inicio) || fim > minutos(expediente.fim)) return "Fora do expediente";
  if (expediente.pausaInicio &&
      sobrepoe(inicio, fim, minutos(expediente.pausaInicio), minutos(expediente.pausaFim))) return "Na pausa do profissional";

  const bloqueio = estado.bloqueios.find(item => item.data === data && !intervaloLivre(item, inicio, fim));
  if (bloqueio) return `Bloqueio: ${bloqueio.motivo}`;

  if (estado.ausencias.some(ausencia =>
      ausencia.profissionalId === profissionalId && data >= ausencia.inicio && data <= ausencia.fim &&
      !intervaloLivre(ausencia, inicio, fim))) return "Profissional ausente";
  return null;
}

export const conflitoDoAtendimento = (estado, agendamento, data) =>
  motivoIndisponivel(estado, agendamento.profissionalId, data, minutos(agendamento.inicio), agendamento.duracao);

// Atendimentos já marcados, de hoje até o horizonte, que caíram fora do horário de atendimento.
export function conflitosFuturos(estado) {
  const conflitos = [];
  for (let dia = 0; dia <= config.agenda.horizonteRecorrenciaDias; dia++) {
    const data = somarDias(hoje(), dia);
    for (const agendamento of atendimentosDoDia(estado, data)) {
      const motivo = conflitoDoAtendimento(estado, agendamento, data);
      if (motivo) conflitos.push({ agendamento, data, motivo });
    }
  }
  return conflitos;
}

export function profissionalLivre(estado, profissionalId, data, inicio, duracao, ignorarId = null) {
  if (motivoIndisponivel(estado, profissionalId, data, inicio, duracao)) return false;

  const agora = new Date();
  if (data < hoje() || (data === hoje() && inicio <= agora.getHours() * 60 + agora.getMinutes())) return false;

  const fim = inicio + duracao;
  return !estado.agendamentos.some(agendamento =>
    agendamento.id !== ignorarId && agendamento.profissionalId === profissionalId &&
    ocorreEm(agendamento, data) &&
    sobrepoe(inicio, fim, minutos(agendamento.inicio), minutos(agendamento.inicio) + agendamento.duracao)
  );
}

// Com profissional definido, só ele serve. Sem preferência, escolhe quem está livre
// em todas as datas e tem menos atendimentos no primeiro dia, para dividir os clientes.
export function escolherProfissional(estado, preferidoId, datas, inicio, duracao) {
  if (!datas.length) return null;
  const candidatos = preferidoId ? [preferidoId] : config.profissionais.map(pessoa => pessoa.id);
  const livres = candidatos.filter(id =>
    datas.every(data => profissionalLivre(estado, id, data, inicio, duracao)));
  if (livres.length < 2) return livres[0] || null;

  const ocupacao = id => atendimentosDoDia(estado, datas[0])
    .filter(agendamento => agendamento.profissionalId === id).length;
  return livres.sort((a, b) => ocupacao(a) - ocupacao(b))[0];
}

export function horariosLivres(estado, { data, repeticao, duracao, profissionalId }) {
  if (!duracao) return [];
  const ids = profissionalId ? [profissionalId] : config.profissionais.map(pessoa => pessoa.id);
  const expedientes = ids.map(id => expedienteDoDia(estado, id, data)).filter(Boolean);
  if (!expedientes.length) return [];

  const datas = datasDaSerie(data, repeticao);
  const primeiro = Math.min(...expedientes.map(item => minutos(item.inicio)));
  const ultimo = Math.max(...expedientes.map(item => minutos(item.fim)));
  const horarios = [];
  for (let inicio = primeiro; inicio + duracao <= ultimo; inicio += config.agenda.intervaloMinutos) {
    if (escolherProfissional(estado, profissionalId, datas, inicio, duracao)) horarios.push(horaTexto(inicio));
  }
  return horarios;
}

export function diaFechado(estado, data, profissionalId = null) {
  const ids = profissionalId ? [profissionalId] : config.profissionais.map(pessoa => pessoa.id);
  return ids.every(id => !expedienteDoDia(estado, id, data)) ||
    estado.bloqueios.some(bloqueio => bloqueio.data === data && !bloqueio.horaInicio);
}
