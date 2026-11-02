import { config } from "./config.js";
import { formatarMoeda } from "./agenda.js";
import { aoMudar, carregar } from "./dados.js";
import { $, aplicarIcones, el, icone, linkWhatsApp, preencherMarca } from "./ui.js";

function cartao(produto, indice) {
  const imagem = produto.foto
    ? el("img", { class: "produto__foto", src: produto.foto, alt: produto.nome, loading: "lazy" })
    : el("div", { class: "produto__foto produto__foto--vazia", "aria-hidden": "true" }, produto.nome[0]);

  const reservar = config.whatsapp && el("a", {
    class: "produto__reservar",
    href: linkWhatsApp(config.whatsapp, `Olá! Vocês têm ${produto.nome} disponível?`),
    target: "_blank",
    rel: "noopener"
  }, icone("mensagem"), "Perguntar");

  return el("article", { class: "produto", style: `--atraso: ${Math.min(indice, 8) * 60}ms` },
    imagem,
    el("div", { class: "produto__corpo" },
      el("h2", { class: "produto__nome" }, produto.nome),
      produto.descricao && el("p", { class: "produto__descricao" }, produto.descricao),
      el("div", { class: "produto__rodape" },
        el("strong", { class: "produto__preco numeros" }, formatarMoeda(produto.preco)),
        reservar)));
}

function desenhar({ produtos }) {
  $("#produtos").replaceChildren(...(produtos.length
    ? produtos.map(cartao)
    : [el("div", { class: "vazio" },
        icone("sacola"),
        el("strong", {}, "A vitrine está sendo montada"),
        el("p", {}, "Em breve os produtos da casa aparecem aqui."))]));
}

preencherMarca();
aplicarIcones();
desenhar(carregar());
aoMudar(desenhar);
