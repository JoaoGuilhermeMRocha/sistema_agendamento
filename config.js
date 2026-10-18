// Tudo o que muda de uma barbearia para outra fica aqui (as cores e fontes ficam em tema.css).

const diaUtil = { inicio: "09:00", fim: "18:00", pausaInicio: "12:00", pausaFim: "13:00" };

export const config = {
  // Identificador curto e único; separa os dados salvos de cada barbearia.
  slug: "santiago",
  nome: "Santiago Barbearia",
  nomeCurto: "Santiago",
  complemento: "Barbearia",
  // Texto da faixa do logo (vazio esconde a faixa).
  selo: "Since 2017",
  slogan: "Você sempre pronto!",
  chamada: "Marque já o seu horário",
  endereco: "Rua Ideal Perez, 631 · Arapoti, PR",
  // Só dígitos, com DDI e DDD (ex.: 5543999998888). Vazio esconde os botões de WhatsApp.
  whatsapp: "5543998369534",
  // Usuário sem o @. Vazio esconde o link.
  instagram: "santiago_barbearia1",

  servicos: [
    { id: "cabelo", nome: "Cabelo", preco: 30, duracao: 30 },
    { id: "barba", nome: "Barba", preco: 25, duracao: 30 },
    { id: "sobrancelha", nome: "Sobrancelha", preco: 20, duracao: 15 }
  ],

  profissionais: [
    { id: "santiago", nome: "Santiago" },
    { id: "damigo", nome: "Damigo" }
  ],

  // Expediente inicial de cada profissional (0 = domingo, null = folga).
  // Depois, cada barbeiro ajusta o seu no painel.
  expedientePadrao: {
    0: null,
    1: null,
    2: diaUtil,
    3: diaUtil,
    4: diaUtil,
    5: diaUtil,
    6: { inicio: "09:00", fim: "16:00", pausaInicio: "", pausaFim: "" }
  },

  agenda: {
    intervaloMinutos: 15,
    diasParaAgendar: 14,
    // Até onde conferir conflitos de uma repetição sem data para terminar.
    horizonteRecorrenciaDias: 180,
    maxAtendimentosRepetidos: 52
  },

  produtosIniciais: [
    { nome: "Pomada modeladora", preco: 35, descricao: "Fixação média e acabamento seco, sem brilho.", foto: null },
    { nome: "Óleo para barba", preco: 42, descricao: "Hidrata os fios e acalma a pele depois do barbear.", foto: null }
  ]
};
