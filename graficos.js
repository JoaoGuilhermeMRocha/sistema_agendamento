// Gráficos em SVG, sem biblioteca: colunas, barras, linha e rosca.
// As mesmas regras valem para todos: um eixo só, marcas finas (barra de até 24px, linha de 2px),
// grade em linha fina, número escrito só no ponto que importa (o resto fica na dica e na tabela)
// e dica ao passar o mouse, tocar ou focar pelo teclado.
import { el } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";
const FONTE_EIXO = 11;

function svg(tag, atributos = {}, ...filhos) {
  const elemento = document.createElementNS(NS, tag);
  for (const [nome, valor] of Object.entries(atributos)) {
    if (valor === false || valor == null) continue;
    if (nome.startsWith("on")) elemento.addEventListener(nome.slice(2), valor);
    else elemento.setAttribute(nome, valor);
  }
  // Grade, rótulos e marcas chegam em listas aninhadas: achata tudo.
  elemento.append(...filhos.flat(Infinity).filter(filho => filho != null && filho !== false));
  return elemento;
}

const regua = document.createElement("canvas").getContext("2d");
function medir(texto, tamanho, alvo) {
  regua.font = `600 ${tamanho}px ${getComputedStyle(alvo).fontFamily}`;
  return regua.measureText(texto).width;
}

// Corta o texto com reticências até caber na largura (o nome inteiro fica na dica e na tabela).
function caber(texto, largura, tamanho, alvo) {
  if (medir(texto, tamanho, alvo) <= largura) return texto;
  let corte = texto;
  while (corte.length > 1 && medir(`${corte}…`, tamanho, alvo) > largura) corte = corte.slice(0, -1);
  return `${corte}…`;
}

// Eixo com números redondos (0, 50, 100...). Contagens andam de 1 em 1 no mínimo.
function escala(maximo, inteiro) {
  if (maximo <= 0) return { passo: 1, topo: 4 };
  const bruto = maximo / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  let passo = [1, 2, 2.5, 5, 10].map(fator => fator * potencia).find(valor => valor >= bruto);
  if (inteiro) passo = Math.max(1, Math.ceil(passo));
  return { passo, topo: Math.ceil(maximo / passo) * passo };
}

const marcasDoEixo = ({ passo, topo }) => Array.from({ length: Math.round(topo / passo) + 1 }, (_, indice) => indice * passo);

// Coluna com a ponta de cima arredondada e a base reta.
function colunaArredondada(x, y, largura, altura) {
  const r = Math.min(4, largura / 2, altura);
  return `M${x},${y + altura}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + largura - r}A${r},${r} 0 0 1 ${x + largura},${y + r}V${y + altura}Z`;
}

// Barra deitada: base reta na esquerda, ponta arredondada na direita.
function barraArredondada(x, y, comprimento, grossura) {
  const r = Math.min(4, grossura / 2, comprimento);
  return `M${x},${y}H${x + comprimento - r}A${r},${r} 0 0 1 ${x + comprimento},${y + r}V${y + grossura - r}A${r},${r} 0 0 1 ${x + comprimento - r},${y + grossura}H${x}Z`;
}

function criarDica(alvo) {
  const dica = el("div", { class: "grafico__dica", hidden: true });
  alvo.append(dica);
  return {
    // O valor vem primeiro e em destaque; o nome do item vem depois, mais discreto.
    mostrar(marca, valor, rotulo, cor = null) {
      dica.replaceChildren(
        el("strong", {}, valor),
        el("span", {}, cor ? el("i", { class: "grafico__chave", style: `background: ${cor}` }) : "", rotulo));
      dica.hidden = false;
      const caixa = alvo.getBoundingClientRect();
      const ponto = marca.getBoundingClientRect();
      const meio = ponto.left + ponto.width / 2 - caixa.left;
      const metade = dica.offsetWidth / 2;
      dica.style.left = `${Math.min(Math.max(meio, metade), caixa.width - metade)}px`;
      dica.style.top = `${ponto.top - caixa.top}px`;
    },
    esconder() {
      dica.hidden = true;
    }
  };
}

// Liga a dica a um alvo de toque (maior que a marca): mouse, toque e foco mostram o mesmo.
// A dica aparece em cima da marca desenhada; sem marca (valor zero), em cima da área de toque.
function interativo(alvoDeToque, marca, dica, texto) {
  const mostrar = () => {
    marca.classList.add("grafico__marca--ativa");
    dica.mostrar(marca.getBBox?.().height ? marca : alvoDeToque, ...texto());
  };
  const esconder = () => {
    marca.classList.remove("grafico__marca--ativa");
    dica.esconder();
  };
  alvoDeToque.addEventListener("pointerenter", mostrar);
  alvoDeToque.addEventListener("pointerleave", esconder);
  alvoDeToque.addEventListener("focus", mostrar);
  alvoDeToque.addEventListener("blur", esconder);
}

function rotulosDoEixoX(itens, faixa, alvo) {
  const maior = Math.max(...itens.map(item => medir(item.rotulo, FONTE_EIXO, alvo))) + 8;
  return Math.max(1, Math.ceil(maior / faixa));
}

function colunas(alvo, itens, opcoes) {
  const { largura, formatar, formatarEixo, inteiro } = opcoes;
  const altura = largura < 520 ? 240 : 300;
  const maximo = Math.max(...itens.map(item => item.valor));
  const eixo = escala(maximo, inteiro);
  const marcas = marcasDoEixo(eixo);
  const margem = { cima: 24, direita: 8, baixo: 26, esquerda: Math.max(...marcas.map(valor => medir(formatarEixo(valor), FONTE_EIXO, alvo))) + 12 };
  const w = largura - margem.esquerda - margem.direita;
  const h = altura - margem.cima - margem.baixo;
  const y = valor => margem.cima + h - (valor / eixo.topo) * h;
  const faixa = w / itens.length;
  const grossura = Math.min(24, Math.max(2, faixa * 0.64));
  const pulo = rotulosDoEixoX(itens, faixa, alvo);
  const maior = itens.findIndex(item => item.valor === maximo);
  const dica = criarDica(alvo);

  const desenho = svg("svg", { viewBox: `0 0 ${largura} ${altura}`, width: largura, height: altura, role: "img", "aria-label": opcoes.descricao },
    marcas.map(valor => [
      svg("line", { class: valor ? "grafico__grade" : "grafico__base", x1: margem.esquerda, x2: largura - margem.direita, y1: y(valor), y2: y(valor) }),
      svg("text", { class: "grafico__eixo", x: margem.esquerda - 8, y: y(valor), "text-anchor": "end", "dominant-baseline": "middle" }, formatarEixo(valor))
    ]),
    itens.map((item, indice) => {
      const centro = margem.esquerda + faixa * (indice + 0.5);
      const topo = y(item.valor);
      const marca = svg("g", { class: "grafico__marca" },
        item.valor > 0 && svg("path", { d: colunaArredondada(centro - grossura / 2, topo, grossura, y(0) - topo) }));
      const toque = svg("rect", {
        class: "grafico__alvo", x: margem.esquerda + faixa * indice, y: margem.cima, width: faixa, height: h,
        tabindex: 0, "aria-label": `${item.rotuloLongo}: ${formatar(item.valor)}`
      });
      interativo(toque, marca, dica, () => [formatar(item.valor), item.rotuloLongo]);
      return [
        marca,
        indice % pulo === 0 && svg("text", { class: "grafico__eixo", x: centro, y: altura - 8, "text-anchor": "middle" }, item.rotulo),
        indice === maior && maximo > 0 &&
          svg("text", { class: "grafico__valor", x: centro, y: topo - 8, "text-anchor": "middle" }, formatar(item.valor)),
        toque
      ];
    }));
  alvo.prepend(desenho);
}

function barras(alvo, itens, opcoes) {
  const { largura, formatar, formatarEixo, inteiro } = opcoes;
  const linha = 34;
  const grossura = 14;
  const maximo = Math.max(...itens.map(item => item.valor));
  const eixo = escala(maximo, inteiro);
  const marcas = marcasDoEixo(eixo);
  const nomes = Math.min(Math.max(...itens.map(item => medir(item.rotulo, 12, alvo))) + 14, largura * 0.4);
  const ponta = medir(formatar(maximo), 12, alvo) + 12;
  const margem = { cima: 4, direita: Math.max(ponta, 16), baixo: 24, esquerda: nomes };
  const w = largura - margem.esquerda - margem.direita;
  const altura = margem.cima + itens.length * linha + margem.baixo;
  const x = valor => margem.esquerda + (valor / eixo.topo) * w;
  const base = margem.cima + itens.length * linha;
  const maior = itens.findIndex(item => item.valor === maximo);
  const dica = criarDica(alvo);
  const marcasVisiveis = marcas.filter((_, indice) => w / (marcas.length - 1) > 46 || indice % 2 === 0);

  const desenho = svg("svg", { viewBox: `0 0 ${largura} ${altura}`, width: largura, height: altura, role: "img", "aria-label": opcoes.descricao },
    marcasVisiveis.map(valor => [
      svg("line", { class: valor ? "grafico__grade" : "grafico__base", x1: x(valor), x2: x(valor), y1: margem.cima, y2: base }),
      svg("text", { class: "grafico__eixo", x: x(valor), y: altura - 6, "text-anchor": "middle" }, formatarEixo(valor))
    ]),
    itens.map((item, indice) => {
      const topo = margem.cima + indice * linha;
      const comprimento = x(item.valor) - x(0);
      const marca = svg("g", { class: "grafico__marca" },
        comprimento > 0 && svg("path", { d: barraArredondada(x(0), topo + (linha - grossura) / 2, comprimento, grossura) }));
      const toque = svg("rect", {
        class: "grafico__alvo", x: 0, y: topo, width: largura, height: linha,
        tabindex: 0, "aria-label": `${item.rotuloLongo}: ${formatar(item.valor)}`
      });
      interativo(toque, marca, dica, () => [formatar(item.valor), item.rotuloLongo]);
      return [
        svg("text", { class: "grafico__nome", x: margem.esquerda - 10, y: topo + linha / 2, "text-anchor": "end", "dominant-baseline": "middle" },
          caber(item.rotulo, margem.esquerda - 14, 12, alvo)),
        marca,
        indice === maior && maximo > 0 &&
          svg("text", { class: "grafico__valor", x: x(item.valor) + 8, y: topo + linha / 2, "dominant-baseline": "middle" }, formatar(item.valor)),
        toque
      ];
    }));
  alvo.prepend(desenho);
}

function linha(alvo, itens, opcoes) {
  const { largura, formatar, formatarEixo, inteiro } = opcoes;
  const altura = largura < 520 ? 240 : 300;
  const maximo = Math.max(...itens.map(item => item.valor));
  const eixo = escala(maximo, inteiro);
  const marcas = marcasDoEixo(eixo);
  const ultimoValor = formatar(itens.at(-1).valor);
  const margem = {
    cima: 24, baixo: 26,
    esquerda: Math.max(...marcas.map(valor => medir(formatarEixo(valor), FONTE_EIXO, alvo))) + 12,
    direita: 12
  };
  const w = largura - margem.esquerda - margem.direita;
  const h = altura - margem.cima - margem.baixo;
  const passo = itens.length > 1 ? w / (itens.length - 1) : 0;
  const px = indice => margem.esquerda + (itens.length > 1 ? indice * passo : w / 2);
  const y = valor => margem.cima + h - (valor / eixo.topo) * h;
  const pontos = itens.map((item, indice) => [px(indice), y(item.valor)]);
  const caminho = pontos.map(([a, b], indice) => `${indice ? "L" : "M"}${a},${b}`).join("");
  const pulo = rotulosDoEixoX(itens, Math.max(passo, 1), alvo);
  const dica = criarDica(alvo);
  const [fimX, fimY] = pontos.at(-1);

  const mira = svg("line", { class: "grafico__mira", y1: margem.cima, y2: margem.cima + h, visibility: "hidden" });
  const marcador = svg("circle", { class: "grafico__ponto", r: 4, visibility: "hidden" });
  let atual = itens.length - 1;
  const mostrar = indice => {
    atual = indice;
    const [a, b] = pontos[indice];
    mira.setAttribute("x1", a);
    mira.setAttribute("x2", a);
    marcador.setAttribute("cx", a);
    marcador.setAttribute("cy", b);
    mira.removeAttribute("visibility");
    marcador.removeAttribute("visibility");
    dica.mostrar(marcador, formatar(itens[indice].valor), itens[indice].rotuloLongo);
  };
  const esconder = () => {
    mira.setAttribute("visibility", "hidden");
    marcador.setAttribute("visibility", "hidden");
    dica.esconder();
  };
  // A mira acha o ponto mais próximo do dedo ou do mouse; no teclado, as setas andam de ponto em ponto.
  const camada = svg("rect", {
    class: "grafico__alvo", x: margem.esquerda - Math.max(passo / 2, 8), y: margem.cima, width: w + Math.max(passo, 16), height: h,
    tabindex: 0, "aria-label": `${opcoes.descricao}. Use as setas para ver cada ponto.`,
    onpointermove: evento => {
      const caixa = desenho.getBoundingClientRect();
      const posicao = (evento.clientX - caixa.left) * (largura / caixa.width);
      mostrar(Math.min(itens.length - 1, Math.max(0, Math.round((posicao - margem.esquerda) / (passo || 1)))));
    },
    onpointerleave: esconder,
    onfocus: () => mostrar(atual),
    onblur: esconder,
    onkeydown: evento => {
      if (evento.key === "ArrowLeft" || evento.key === "ArrowRight") {
        evento.preventDefault();
        mostrar(Math.min(itens.length - 1, Math.max(0, atual + (evento.key === "ArrowRight" ? 1 : -1))));
      }
    }
  });

  const desenho = svg("svg", { viewBox: `0 0 ${largura} ${altura}`, width: largura, height: altura, role: "img", "aria-label": opcoes.descricao },
    marcas.map(valor => [
      svg("line", { class: valor ? "grafico__grade" : "grafico__base", x1: margem.esquerda, x2: largura - margem.direita, y1: y(valor), y2: y(valor) }),
      svg("text", { class: "grafico__eixo", x: margem.esquerda - 8, y: y(valor), "text-anchor": "end", "dominant-baseline": "middle" }, formatarEixo(valor))
    ]),
    itens.map((item, indice) => indice % pulo === 0 &&
      svg("text", { class: "grafico__eixo", x: px(indice), y: altura - 8, "text-anchor": "middle" }, item.rotulo)),
    svg("path", { class: "grafico__area", d: `${caminho}L${fimX},${y(0)}L${pontos[0][0]},${y(0)}Z` }),
    svg("path", { class: "grafico__linha", d: caminho }),
    // Só o último ponto leva marcador e número; os outros aparecem na mira e na tabela.
    svg("circle", { class: "grafico__ponto", cx: fimX, cy: fimY, r: 4 }),
    svg("text", { class: "grafico__valor", x: fimX, y: fimY - 12, "text-anchor": "end" }, ultimoValor),
    mira, marcador, camada);
  alvo.prepend(desenho);
}

// Fatia da rosca entre dois ângulos (em radianos, a partir do topo, no sentido do relógio).
function fatia(cx, cy, fora, dentro, inicio, fim) {
  const ponto = (raio, angulo) => `${cx + raio * Math.sin(angulo)},${cy - raio * Math.cos(angulo)}`;
  const grande = fim - inicio > Math.PI ? 1 : 0;
  return `M${ponto(fora, inicio)}A${fora},${fora} 0 ${grande} 1 ${ponto(fora, fim)}` +
    `L${ponto(dentro, fim)}A${dentro},${dentro} 0 ${grande} 0 ${ponto(dentro, inicio)}Z`;
}

function rosca(alvo, itens, opcoes) {
  const { formatar, total } = opcoes;
  const tamanho = 220;
  const centro = tamanho / 2;
  const fora = centro - 4;
  const dentro = fora * 0.62;
  const soma = itens.reduce((acumulado, item) => acumulado + item.valor, 0);
  const dica = criarDica(alvo);
  const porcento = valor => `${Math.round((valor / soma) * 100)}%`;

  let angulo = 0;
  const fatias = itens.map(item => {
    const parte = (item.valor / soma) * Math.PI * 2;
    // Uma fatia só seria um círculo inteiro, que o arco do SVG não desenha.
    const fim = angulo + Math.min(parte, Math.PI * 2 - 0.0001);
    const marca = svg("path", { class: "grafico__fatia", d: fatia(centro, centro, fora, dentro, angulo, fim), style: `fill: ${item.cor}` });
    const grupo = svg("g", { class: "grafico__marca", tabindex: 0, "aria-label": `${item.rotuloLongo}: ${formatar(item.valor)} (${porcento(item.valor)})` }, marca);
    interativo(grupo, grupo, dica, () => [`${formatar(item.valor)} · ${porcento(item.valor)}`, item.rotuloLongo, item.cor]);
    angulo += parte;
    return grupo;
  });

  const desenho = svg("svg", { viewBox: `0 0 ${tamanho} ${tamanho}`, width: tamanho, height: tamanho, role: "img", "aria-label": opcoes.descricao },
    fatias,
    svg("text", { class: "grafico__total", x: centro, y: centro - 4, "text-anchor": "middle" }, formatar(total ?? soma)),
    svg("text", { class: "grafico__eixo", x: centro, y: centro + 16, "text-anchor": "middle" }, "no total"));

  // Com duas ou mais fatias a legenda é obrigatória: a cor nunca é a única forma de saber quem é quem.
  const legenda = el("ul", { class: "grafico__legenda" }, itens.map(item => el("li", {},
    el("i", { class: "grafico__chave", style: `background: ${item.cor}` }),
    el("span", { class: "grafico__legenda-nome" }, item.rotuloLongo),
    el("strong", { class: "numeros" }, formatar(item.valor)),
    el("span", { class: "grafico__legenda-parte numeros" }, porcento(item.valor)))));

  alvo.classList.add("grafico--rosca");
  alvo.prepend(desenho, legenda);
}

const TIPOS = { colunas, barras, linha, rosca };

// itens: [{ rotulo, rotuloLongo, valor, cor? }]. A largura vem do próprio alvo, ou da página impressa.
export function desenharGrafico(alvo, { tipo, itens, vazio = "Nada para mostrar.", largura, ...opcoes }) {
  alvo.replaceChildren();
  alvo.classList.remove("grafico--rosca");
  if (!itens.length || itens.every(item => !item.valor)) {
    alvo.append(el("p", { class: "grafico__vazio" }, vazio));
    return;
  }
  TIPOS[tipo](alvo, itens, { largura: Math.max(260, largura ?? alvo.clientWidth), ...opcoes });
}
