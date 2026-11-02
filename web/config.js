// Tudo o que muda de uma barbearia para outra fica aqui (as cores e fontes ficam em tema.css).
// Profissionais, expedientes, serviços e produtos ficam no banco: os iniciais estão em
// clientes/<slug>/dados_iniciais.json, e depois a barbearia mexe pelo painel.

export const config = {
  // Identificador curto e único (o mesmo da pasta em clientes/). Vai no nome dos arquivos exportados.
  slug: "santiago",
  nome: "Santiago Barbearia",
  nomeCurto: "Santiago",
  complemento: "Barbearia",
  // Texto da faixa do logo (vazio esconde a faixa).
  selo: "Since 2017",
  slogan: "Você sempre pronto!",
  chamada: "Marque já o seu horário",
  endereco: "Rua Ideal Perez, 631 · Arapoti, PR",
  // Link da barbearia no Google Maps (botão "Compartilhar" do Maps). Vazio busca pelo endereço.
  mapa: "https://maps.app.goo.gl/pLXhurzpsGxL8J289",
  // Só dígitos, com DDI e DDD (ex.: 5543999998888). Vazio esconde os botões de WhatsApp.
  whatsapp: "5543998369534",
  // Usuário sem o @. Vazio esconde o link.
  instagram: "santiago_barbearia1",

  // Retrato de cada profissional enquanto não houver uma foto enviada pelo painel (vazio mostra a inicial).
  // O nome, a descrição e a ordem vêm do servidor, que substitui esta lista ao carregar a página.
  // As silhuetas são provisórias, até chegarem as fotos do Santiago.
  profissionais: [
    { id: "santiago", foto: "/imagens/santiago.svg" },
    { id: "damigo", foto: "/imagens/damigo.svg" }
  ],

  // Os mesmos de AGENDA em arsystems/settings.py: mudou um, mude o outro.
  agenda: {
    intervaloMinutos: 15,
    diasParaAgendar: 14,
    // Até onde conferir conflitos de uma repetição sem data para terminar.
    horizonteRecorrenciaDias: 180,
    maxAtendimentosRepetidos: 52
  }
};
