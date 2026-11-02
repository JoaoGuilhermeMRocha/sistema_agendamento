// Camada de dados: conversa com a API do Django (/api/, em barbearia/api.py).
// Quem valida e decide é o servidor. As respostas são { ok: true, ... } ou { ok: false, erro },
// e nenhuma função lança erro: sem internet, a resposta também vem como { ok: false, erro }.
import { config } from "./config.js";

// Símbolos que um serviço pode ter na agenda (nomes dos ícones de ui.js).
export const ICONES_DE_SERVICO = {
  tesoura: "Corte", barba: "Barba", sobrancelha: "Sobrancelha", navalha: "Navalha",
  pente: "Penteado", gota: "Tratamento", estrela: "Outro"
};

const SEM_CONEXAO = "Não deu para falar com o servidor. Confira a internet e tente de novo.";

function cookie(nome) {
  return document.cookie.split("; ").find(item => item.startsWith(`${nome}=`))?.slice(nome.length + 1) ?? "";
}

async function pedir(metodo, caminho, corpo) {
  const opcoes = { method: metodo, headers: { Accept: "application/json" }, credentials: "same-origin" };
  if (metodo !== "GET") {
    // O Django só aceita alteração que devolve o código do cookie de CSRF.
    opcoes.headers["X-CSRFToken"] = cookie("csrftoken");
    if (corpo !== undefined) {
      opcoes.headers["Content-Type"] = "application/json";
      opcoes.body = JSON.stringify(corpo);
    }
  }
  try {
    const resposta = await fetch(`/api/${caminho}`, opcoes);
    const dados = await resposta.json().catch(() => null);
    if (!dados) return { ok: false, erro: "O servidor respondeu de um jeito inesperado. Tente de novo.", status: resposta.status };
    return { ...dados, status: resposta.status };
  } catch {
    return { ok: false, erro: SEM_CONEXAO, status: 0 };
  }
}

// Nome e descrição dos profissionais vêm do servidor. A foto do config.js vale enquanto
// não houver uma enviada pelo painel (guardada aqui antes da primeira troca da lista).
const FOTOS_PROVISORIAS = new Map(config.profissionais.map(pessoa => [pessoa.id, pessoa.foto]));

function aplicarProfissionais(resposta) {
  if (!resposta.ok || !Array.isArray(resposta.profissionais)) return resposta;
  config.profissionais = resposta.profissionais.map(pessoa =>
    ({ ...pessoa, foto: pessoa.foto || FOTOS_PROVISORIAS.get(pessoa.id) || "" }));
  return resposta;
}

// Outro aparelho mudou os dados: confere de tempos em tempos e quando a aba volta a aparecer.
// O callback só roda quando a resposta muda.
export function aoMudar(buscar, callback, intervalo = 30000) {
  let anterior = null;
  const conferir = async () => {
    if (document.hidden) return;
    const resposta = await buscar();
    if (!resposta.ok) return;
    const texto = JSON.stringify(resposta);
    if (anterior !== null && texto !== anterior) callback(resposta);
    anterior = texto;
  };
  conferir();
  setInterval(conferir, intervalo);
  document.addEventListener("visibilitychange", conferir);
}

/* Público: /agendar e /loja */

export const carregarVitrine = async () => aplicarProfissionais(await pedir("GET", "publico/vitrine"));

export function horariosDisponiveis({ servicos, profissionalId }) {
  const busca = new URLSearchParams({ servicos: servicos.join(","), profissional: profissionalId ?? "" });
  return pedir("GET", `publico/horarios?${busca}`);
}

// Pelo site vira um atendimento único; só o painel cria repetição (o servidor garante).
export function criarAgendamento({ nome, telefone, servicos, profissionalId, data, inicio, repeticao, origem }) {
  const corpo = { nome, telefone, servicos, profissionalId: profissionalId || null, data, inicio };
  return origem === "painel"
    ? pedir("POST", "painel/agendamentos", { ...corpo, repeticao })
    : pedir("POST", "publico/agendamentos", corpo);
}

/* Painel: login */

export const quemSou = () => pedir("GET", "painel/eu");
export const entrar = (usuario, senha) => pedir("POST", "painel/entrar", { usuario, senha });
export const sair = () => pedir("POST", "painel/sair");

// O estado inteiro (agendamentos, expedientes, serviços...). Sem login, vem com status 401.
export const carregar = async () => aplicarProfissionais(await pedir("GET", "painel/estado"));

/* Painel: agendamentos */

export const cancelarData = (id, data) => pedir("POST", `painel/agendamentos/${id}/cancelar`, { data });
export const tornarRecorrente = (id, repeticao) => pedir("POST", `painel/agendamentos/${id}/recorrente`, { repeticao });
export const encerrarRepeticao = (id, data) => pedir("POST", `painel/agendamentos/${id}/encerrar`, { data });

/* Painel: expediente, ausências e bloqueios. Com simular, o servidor só devolve os conflitos que a mudança causaria. */

export const salvarExpediente = (profissionalId, dias, { simular = false } = {}) =>
  pedir("PUT", `painel/expedientes/${profissionalId}`, { dias, simular });
export const criarAusencia = (valores, { simular = false } = {}) => pedir("POST", "painel/ausencias", { ...valores, simular });
export const criarBloqueio = (valores, { simular = false } = {}) => pedir("POST", "painel/bloqueios", { ...valores, simular });
export const removerAusencia = id => pedir("DELETE", `painel/ausencias/${id}`);
export const removerBloqueio = id => pedir("DELETE", `painel/bloqueios/${id}`);

/* Painel: perfil dos profissionais no /agendar. foto: undefined mantém, null tira, data URL troca. */

export const atualizarProfissional = (id, dados) => pedir("PUT", `painel/profissionais/${id}`, dados);

/* Painel: serviços e produtos */

const camposDoServico = ({ nome, preco, duracao, icone }) => ({ nome, preco, duracao: Number(duracao), icone });
export const criarServico = dados => pedir("POST", "painel/servicos", camposDoServico(dados));
export const atualizarServico = (id, dados) => pedir("PUT", `painel/servicos/${id}`, camposDoServico(dados));
export const removerServico = id => pedir("DELETE", `painel/servicos/${id}`);

// foto: undefined mantém a atual (o JSON nem leva o campo), null remove, data URL troca.
export const criarProduto = dados => pedir("POST", "painel/produtos", dados);
export const atualizarProduto = (id, dados) => pedir("PUT", `painel/produtos/${id}`, dados);
export const removerProduto = id => pedir("DELETE", `painel/produtos/${id}`);

/* Ferramentas de teste: só existem no computador (DJANGO_DEBUG=1) */

export const carregarExemplo = agendamentos => pedir("POST", "painel/exemplo", { agendamentos });
export const apagarDadosDeTeste = () => pedir("DELETE", "painel/dados-de-teste");
