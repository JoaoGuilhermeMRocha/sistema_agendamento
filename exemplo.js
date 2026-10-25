// Dados de exemplo para testar e demonstrar o painel: atendimentos de agosto a outubro do ano atual,
// com clientes que voltam, algumas séries recorrentes e mais movimento no fim de semana.
// Respeita as mesmas regras da agenda (expediente, pausa, bloqueio, ausência e um cliente por vez
// para cada barbeiro). É sempre igual: gerar de novo dá o mesmo resultado.
import { config } from "./config.js";
import {
  daChave, datasDaSerie, expedienteDoDia, horaTexto, minutos, motivoIndisponivel, servicosAtivos, somarDias, somarServicos
} from "./agenda.js";

// Atendimentos por mês (mês de 1 a 12), contando as ocorrências das séries.
const METAS = { 8: 150, 9: 150, 10: 100 };

const CLIENTES = [
  "Marcos Oliveira", "Bruno Alves", "Rafael Lima", "Diego Nunes", "João Pedro Santos", "Pedro Henrique Costa",
  "Carlos Eduardo Souza", "Thiago Rocha", "Felipe Martins", "Gustavo Reis", "André Luiz Pereira", "Lucas Prado",
  "Mateus Ferreira", "Vinícius Gomes", "Leonardo Barbosa", "Gabriel Ribeiro", "Rodrigo Carvalho", "Eduardo Lopes",
  "Henrique Moura", "Caio Fernandes", "Daniel Teixeira", "Fábio Cardoso", "Renato Araújo", "Sérgio Mendes",
  "Otávio Castro", "Igor Freitas", "Murilo Dias", "Samuel Correia", "Paulo Vieira", "Ricardo Monteiro",
  "Fernando Pires", "Alexandre Batista", "Julio César Ramos", "Wesley Moreira", "Kaique Nascimento", "Davi Rezende",
  "Enzo Cavalcanti", "Arthur Campos", "Heitor Duarte", "Bernardo Lacerda"
];

// Gerador de números com semente: mesma sequência toda vez.
function sorteador(semente) {
  let valor = semente;
  return () => (valor = (valor * 16807) % 2147483647) / 2147483647;
}

function escolherComPeso(sorte, itens, peso) {
  const total = itens.reduce((soma, item, indice) => soma + peso(item, indice), 0);
  let alvo = sorte() * total;
  for (const [indice, item] of itens.entries()) {
    alvo -= peso(item, indice);
    if (alvo <= 0) return item;
  }
  return itens.at(-1);
}

const telefoneDe = indice => `439${String(91000000 + indice * 7919).slice(0, 8)}`;
const primeiroDia = (ano, mes, diaSemana) => {
  const data = new Date(ano, mes - 1, 1);
  data.setDate(1 + ((diaSemana - data.getDay() + 7) % 7));
  return `${ano}-${String(mes).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
};

export function gerarExemplo(estado) {
  const sorte = sorteador(20260801);
  const ano = new Date().getFullYear();
  const ativos = servicosAtivos(estado);
  const porId = id => ativos.find(servico => servico.id === id);
  // Combinações mais pedidas primeiro; serviço que não existir mais fica de fora.
  const combinacoes = [
    [["cabelo"], 34], [["cabelo", "barba"], 24], [["barba"], 18], [["sobrancelha"], 6], [["cabelo", "sobrancelha"], 8],
    [["cabelo", "barba", "sobrancelha"], 4], ...ativos.filter(servico => !["cabelo", "barba", "sobrancelha"].includes(servico.id))
      .map(servico => [[servico.id], 4])
  ].filter(([ids]) => ids.every(porId));
  if (!combinacoes.length) combinacoes.push([[ativos[0].id], 1]);

  const ocupado = new Map();
  const chave = (data, id) => `${data}|${id}`;
  const livre = (data, id, inicio, duracao) => !motivoIndisponivel(estado, id, data, inicio, duracao) &&
    !(ocupado.get(chave(data, id)) ?? []).some(([de, ate]) => inicio < ate && de < inicio + duracao);
  const ocupar = (data, id, inicio, duracao) => {
    const lista = ocupado.get(chave(data, id)) ?? [];
    lista.push([inicio, inicio + duracao]);
    ocupado.set(chave(data, id), lista);
  };

  const agendamentos = [];
  const novo = (cliente, servicos, profissionalId, data, inicio, repeticao, origem) => {
    const soma = somarServicos(estado, servicos);
    const criado = new Date(`${somarDias(data, -1 - Math.floor(sorte() * 6))}T${String(8 + Math.floor(sorte() * 12)).padStart(2, "0")}:00:00`);
    agendamentos.push({
      cliente: { nome: CLIENTES[cliente], telefone: telefoneDe(cliente) },
      servicos, profissionalId, data, inicio,
      duracao: soma.duracao, preco: soma.preco,
      repeticao, excecoes: [], ate: null, origem,
      criadoEm: criado.toISOString()
    });
    return agendamentos.at(-1);
  };

  // Clientes de horário fixo. As séries sem fim seguem para os próximos meses.
  const [santiago, damigo] = [config.profissionais[0].id, config.profissionais[1]?.id ?? config.profissionais[0].id];
  const series = [
    [0, ["barba"], santiago, primeiroDia(ano, 8, 2), "09:00", { frequencia: "semanal", vezes: null }],
    [1, ["cabelo"], santiago, primeiroDia(ano, 8, 4), "11:00", { frequencia: "quinzenal", vezes: null }],
    [2, ["cabelo", "barba"], damigo, primeiroDia(ano, 8, 3), "10:00", { frequencia: "semanal", vezes: 8 }],
    [3, ["cabelo"], damigo, primeiroDia(ano, 8, 5), "16:00", { frequencia: "mensal", vezes: null }]
  ].filter(([, servicos]) => servicos.every(porId));
  for (const [cliente, servicos, profissionalId, data, inicio, repeticao] of series) {
    const agendamento = novo(cliente, servicos, profissionalId, data, inicio, repeticao, "painel");
    for (const dia of datasDaSerie(data, repeticao)) {
      if (livre(dia, profissionalId, minutos(inicio), agendamento.duracao)) ocupar(dia, profissionalId, minutos(inicio), agendamento.duracao);
      else agendamento.excecoes.push(dia);
    }
  }
  // O Marcos faltou uma semana e avisou: esse dia foi cancelado.
  if (agendamentos[0]) agendamentos[0].excecoes.push(somarDias(agendamentos[0].data, 21));

  const ocorrenciasNoMes = mes => agendamentos.reduce((total, agendamento) => total + datasDaSerie(agendamento.data, agendamento.repeticao)
    .filter(dia => Number(dia.slice(5, 7)) === mes && !agendamento.excecoes.includes(dia) && dia.startsWith(String(ano))).length, 0);

  const passo = config.agenda.intervaloMinutos;
  // Sexta e sábado têm mais movimento; terça é o dia mais calmo.
  const pesoDoDia = [0, 0.6, 0.8, 1, 1.1, 1.5, 1.6];
  for (const [mes, meta] of Object.entries(METAS).map(([mes, meta]) => [Number(mes), meta])) {
    const dias = [];
    for (let dia = `${ano}-${String(mes).padStart(2, "0")}-01`; Number(dia.slice(5, 7)) === mes; dia = somarDias(dia, 1)) {
      if (config.profissionais.some(pessoa => expedienteDoDia(estado, pessoa.id, dia))) dias.push(dia);
    }
    let faltam = meta - ocorrenciasNoMes(mes);
    for (let tentativa = 0; faltam > 0 && tentativa < meta * 40; tentativa++) {
      const data = escolherComPeso(sorte, dias, dia => pesoDoDia[daChave(dia).getDay()] || 0.5);
      const profissionalId = sorte() < 0.55 ? santiago : damigo;
      const expediente = expedienteDoDia(estado, profissionalId, data);
      if (!expediente) continue;
      const [servicos] = escolherComPeso(sorte, combinacoes, ([, peso]) => peso);
      const duracao = somarServicos(estado, servicos).duracao;
      const horarios = [];
      for (let inicio = minutos(expediente.inicio); inicio + duracao <= minutos(expediente.fim); inicio += passo) {
        if (livre(data, profissionalId, inicio, duracao)) horarios.push(inicio);
      }
      if (!horarios.length) continue;
      // Horário cheio ou meia hora é o mais comum.
      const inicio = escolherComPeso(sorte, horarios, valor => valor % 30 ? 0.3 : 1);
      // Os primeiros da lista são clientes da casa e voltam mais vezes.
      const cliente = escolherComPeso(sorte, CLIENTES.map((_, indice) => indice), indice => 1 / (indice + 3));
      novo(cliente, servicos, profissionalId, data, horaTexto(inicio), { frequencia: "nenhuma", vezes: 1 }, sorte() < 0.4 ? "cliente" : "painel");
      ocupar(data, profissionalId, inicio, duracao);
      faltam--;
    }
  }
  return agendamentos;
}
