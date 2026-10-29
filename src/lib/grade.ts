// Grade balanceada: nenhuma grade de formulário deixa um campo sozinho na
// última linha (o "UF embaixo, o resto em cima").
//
// As grades do sistema usam `repeat(auto-fit, minmax(…))`: o navegador põe
// quantas colunas couberem e o que sobra cai na linha de baixo — 7 campos em 6
// colunas viram 6 + 1. Aqui, depois que o navegador decide quantas colunas
// CABEM, as linhas são redistribuídas por igual (7 em até 6 colunas = 4 + 3;
// 7 em até 3 = 3 + 2 + 2) e cada campo ocupa a fração da sua linha, de modo
// que toda linha vai de ponta a ponta.
//
// É ligado uma vez para o app inteiro (main.tsx) e vale para todo elemento com
// uma das classes de SELETOR ou com o atributo data-grade, inclusive telas que
// ainda não existem. Filho com a classe `largo` (ou grid-column 1 / -1) ocupa a
// linha inteira e separa a grade em blocos balanceados por conta própria.

const SELETOR = ".grade, .sa-campos, .lot-grade, .gleba-painel, .sa-kpis, .lot-opcoes-ruas, .grade-2, .grade-3, [data-grade]";
const MARCA = "gb"; // data-gb nos filhos que recebem span daqui

/** Tamanho de cada linha: n itens em linhas de até `max`, o mais iguais possível (maiores em cima). */
export function linhasBalanceadas(n: number, max: number): number[] {
  if (n <= 0) return [];
  const m = Math.max(1, Math.min(max, n));
  const linhas = Math.ceil(n / m);
  const base = Math.floor(n / linhas), extra = n % linhas;
  return Array.from({ length: linhas }, (_, i) => base + (i < extra ? 1 : 0));
}

const mdc = (a: number, b: number): number => (b ? mdc(b, a % b) : a);
const mmc = (a: number, b: number) => (a / mdc(a, b)) * b;

function ocupaLinhaInteira(el: HTMLElement): boolean {
  if (el.classList.contains("largo")) return true;
  const cs = getComputedStyle(el);
  return cs.gridColumnEnd === "-1" || /span\s+999/.test(cs.gridColumnEnd);
}

function forado(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  return cs.display === "none" || cs.position === "absolute" || cs.position === "fixed";
}

function balancear(grade: HTMLElement) {
  if (getComputedStyle(grade).display !== "grid") return;
  const filhos = [...grade.children] as HTMLElement[];
  // volta ao que o CSS manda para medir quantas colunas cabem
  grade.style.removeProperty("grid-template-columns");
  if (grade.dataset.gbTpl) grade.style.gridTemplateColumns = grade.dataset.gbTpl;
  for (const f of filhos) if (f.dataset[MARCA] !== undefined) { f.style.removeProperty("grid-column"); delete f.dataset[MARCA]; }

  const trilhas = getComputedStyle(grade).gridTemplateColumns.split(/\s+(?![^(]*\))/).filter(Boolean);
  const max = trilhas.length;
  if (max <= 1) return;

  // blocos de itens entre os que ocupam a linha inteira
  const blocos: HTMLElement[][] = [[]];
  for (const f of filhos) {
    if (forado(f)) continue;
    if (ocupaLinhaInteira(f)) { blocos.push([]); continue; }
    blocos[blocos.length - 1].push(f);
  }
  const plano = blocos.filter((b) => b.length).map((b) => ({ itens: b, linhas: linhasBalanceadas(b.length, max) }));
  // já fecha certinho (toda linha cheia na grade nativa): não mexe
  if (plano.every((p) => p.itens.length % max === 0)) return;

  let k = 1;
  for (const p of plano) for (const t of p.linhas) k = mmc(k, t);
  if (k > 120) return; // combinação absurda: melhor a grade nativa do que 120 trilhas
  // preserva a largura mínima que o CSS pedia: as trilhas são frações iguais
  grade.style.gridTemplateColumns = `repeat(${k}, minmax(0, 1fr))`;
  for (const p of plano) {
    let i = 0;
    for (const t of p.linhas) {
      for (let j = 0; j < t; j++, i++) {
        const f = p.itens[i];
        f.style.gridColumn = `span ${k / t}`;
        f.dataset[MARCA] = "";
      }
    }
  }
}

/** Liga o balanceamento em todas as grades, presentes e futuras. Chamar uma vez. */
export function ligarGradesBalanceadas(): void {
  if (typeof window === "undefined" || !("ResizeObserver" in window)) return;
  const vistas = new WeakSet<Element>();
  let pendente = 0;
  const pendentes = new Set<HTMLElement>();
  const agendar = (g: HTMLElement) => {
    pendentes.add(g);
    if (pendente) return;
    pendente = requestAnimationFrame(() => {
      pendente = 0;
      const lista = [...pendentes];
      pendentes.clear();
      for (const el of lista) if (el.isConnected) balancear(el);
    });
  };
  const ro = new ResizeObserver((es) => { for (const e of es) agendar(e.target as HTMLElement); });
  const varrer = () => {
    document.querySelectorAll<HTMLElement>(SELETOR).forEach((g) => {
      if (!vistas.has(g)) {
        vistas.add(g);
        // template inline posto pelo próprio componente: é o "CSS" dele
        if (g.style.gridTemplateColumns) g.dataset.gbTpl = g.style.gridTemplateColumns;
        ro.observe(g);
      }
      agendar(g);
    });
  };
  // só filhos entrando/saindo: os estilos que escrevemos não disparam de novo.
  // Grade nova na tela → varre; campo entrando/saindo de uma grade → só ela.
  new MutationObserver((ms) => {
    let nova = false;
    for (const m of ms) {
      const alvo = m.target as Element;
      if (alvo.nodeType === 1 && alvo.matches(SELETOR)) agendar(alvo as HTMLElement);
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && ((n as Element).matches(SELETOR) || (n as Element).querySelector(SELETOR))) nova = true;
      }
    }
    if (nova) varrer();
  }).observe(document.body, { childList: true, subtree: true });
  varrer();
}
