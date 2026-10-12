"use strict";

// Dados independentes do painel: esta página não possui catálogo compartilhado.
const showcaseProducts = [
  {
    name: "Pomada modeladora",
    description: "Descrição ilustrativa. Substitua pelo produto que a barbearia realmente vende."
  },
  {
    name: "Óleo para barba",
    description: "Fotos, características e condições de venda precisam ser confirmadas antes da publicação."
  }
];

const gallery = document.querySelector("#productGallery");

for (const product of showcaseProducts) {
  const card = document.createElement("article");
  card.className = "product-card";

  const imagePlaceholder = document.createElement("div");
  imagePlaceholder.className = "product-card__image";
  imagePlaceholder.setAttribute("role", "img");
  imagePlaceholder.setAttribute("aria-label", `Espaço reservado para foto de ${product.name}`);
  imagePlaceholder.textContent = "Foto do produto";

  const body = document.createElement("div");
  body.className = "product-card__body";

  const title = document.createElement("h3");
  title.textContent = product.name;

  const description = document.createElement("p");
  description.textContent = product.description;

  const note = document.createElement("small");
  note.textContent = "Preço e disponibilidade a confirmar";

  body.append(title, description, note);
  card.append(imagePlaceholder, body);
  gallery.append(card);
}