// Peças de interface usadas pelas três páginas.
import { config } from "./config.js";

export const $ = seletor => document.querySelector(seletor);

// Cria um elemento: el("p", { class: "nota" }, "texto", outroElemento)
export function el(tag, atributos = {}, ...filhos) {
  const elemento = document.createElement(tag);
  for (const [nome, valor] of Object.entries(atributos)) {
    if (valor === false || valor == null) continue;
    if (nome === "class") elemento.className = valor;
    else if (nome.startsWith("on")) elemento.addEventListener(nome.slice(2), valor);
    else elemento.setAttribute(nome, valor === true ? "" : valor);
  }
  elemento.append(...filhos.flat().filter(filho => filho != null && filho !== false));
  return elemento;
}

const caminhos = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  seta: '<path d="M9 6l6 6-6 6"/>',
  voltar: '<path d="M15 6l-6 6 6 6"/>',
  repetir: '<path d="M4.5 12a7.5 7.5 0 0113-5.1L19.5 9"/><path d="M19.5 4.5V9H15"/><path d="M19.5 12a7.5 7.5 0 01-13 5.1L4.5 15"/><path d="M4.5 19.5V15H9"/>',
  calendario: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  relogio: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  sacola: '<path d="M5.5 8h13l-1 12.5h-11z"/><path d="M9 8V6.5a3 3 0 016 0V8"/>',
  fechar: '<path d="M6 6l12 12M18 6L6 18"/>',
  mensagem: '<path d="M20 11.5a8 8 0 01-11.6 7.1L4 20l1.4-4.2A8 8 0 1120 11.5z"/>',
  tesoura: '<circle cx="6" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><path d="M8.2 8l11.3 9.5M8.2 16L19.5 6.5"/>',
  alerta: '<path d="M10.3 4.3a2 2 0 013.4 0l7.4 12.8a2 2 0 01-1.7 3H4.6a2 2 0 01-1.7-3z"/><path d="M12 9.5v4M12 16.8v.01"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.2 6.8v.01"/>',
  local: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'
};

export function icone(nome, classe = "icone") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", classe);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = caminhos[nome];
  return svg;
}

// Troca <span data-icone="nome"></span> pelo ícone correspondente.
export function aplicarIcones(raiz = document) {
  for (const marcador of raiz.querySelectorAll("[data-icone]")) {
    marcador.replaceWith(icone(marcador.dataset.icone, marcador.className || "icone"));
  }
}

// Preenche nome, endereço etc. a partir do config.js, para cada barbearia ter só um lugar a editar.
export function preencherMarca() {
  for (const elemento of document.querySelectorAll("[data-marca]")) {
    const valor = config[elemento.dataset.marca];
    if (valor) elemento.textContent = valor;
    else elemento.hidden = true;
  }
  for (const link of document.querySelectorAll("[data-link]")) {
    const tipo = link.dataset.link;
    if (tipo === "whatsapp" && config.whatsapp) {
      link.href = linkWhatsApp(config.whatsapp, "Olá! Vim pelo site.");
      link.querySelector("[data-texto]").textContent = formatarTelefone(config.whatsapp.replace(/^55/, ""));
    } else if (tipo === "instagram" && config.instagram) {
      link.href = `https://instagram.com/${config.instagram}`;
      link.querySelector("[data-texto]").textContent = `@${config.instagram}`;
    } else {
      link.hidden = true;
    }
  }
  const pagina = document.body.dataset.pagina;
  document.title = pagina ? `${pagina} · ${config.nome}` : config.nome;
}

export const capitalizar = texto => texto.charAt(0).toUpperCase() + texto.slice(1);

export const soDigitos = texto => String(texto ?? "").replace(/\D/g, "");

export function formatarTelefone(digitos) {
  const numero = soDigitos(digitos).slice(0, 11);
  if (numero.length <= 2) return numero.length ? `(${numero}` : "";
  const corte = numero.length === 11 ? 7 : 6;
  return numero.length <= corte
    ? `(${numero.slice(0, 2)}) ${numero.slice(2)}`
    : `(${numero.slice(0, 2)}) ${numero.slice(2, corte)}-${numero.slice(corte)}`;
}

export function mascararTelefone(campo) {
  campo.addEventListener("input", () => {
    campo.value = formatarTelefone(campo.value);
  });
}

// Link do WhatsApp. Números com 10 ou 11 dígitos recebem o DDI do Brasil.
export function linkWhatsApp(numero, texto = "") {
  let digitos = soDigitos(numero);
  if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;
  return `https://wa.me/${digitos}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}

let temporizadorAviso;
export function avisar(texto, tipo = "info") {
  let aviso = $(".aviso");
  if (!aviso) {
    aviso = el("div", { class: "aviso", role: "status", "aria-live": "polite" });
    document.body.append(aviso);
  }
  aviso.textContent = texto;
  aviso.dataset.tipo = tipo;
  aviso.classList.remove("aviso--visivel");
  void aviso.offsetWidth;
  aviso.classList.add("aviso--visivel");
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => aviso.classList.remove("aviso--visivel"), 3200);
}

// Ações destrutivas pedem um segundo toque no mesmo botão, sem janela de confirmação.
export function confirmarNoBotao(botao, rotuloConfirmar, acao) {
  const rotuloOriginal = botao.textContent;
  let temporizador;
  const voltar = () => {
    clearTimeout(temporizador);
    delete botao.dataset.confirmando;
    botao.textContent = rotuloOriginal;
  };
  botao.addEventListener("click", () => {
    if (botao.dataset.confirmando) {
      voltar();
      acao();
      return;
    }
    botao.dataset.confirmando = "true";
    botao.textContent = rotuloConfirmar;
    temporizador = setTimeout(voltar, 4000);
  });
}

export function mostrarErroCampo(campo, mensagem) {
  const erro = campo.closest(".campo")?.querySelector(".campo__erro");
  campo.setAttribute("aria-invalid", String(Boolean(mensagem)));
  if (erro) erro.textContent = mensagem || "";
}
