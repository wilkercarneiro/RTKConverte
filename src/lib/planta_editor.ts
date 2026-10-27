// Geometria do editor de planta: caixa, clique, mover e escalar as peças da cena.
//
// Tudo aqui trabalha nas coordenadas da TELA da planta (pontos PDF, y para
// cima), as mesmas da cena. A conversão para a tela do navegador (y para baixo,
// zoom, deslocamento) mora no componente.
import type { Cor, ItemCena, ObjetoCena } from "../../supabase/functions/_shared/planta_cena.ts";

export interface Caixa { x1: number; y1: number; x2: number; y2: number }

const rad = (g: number) => (g * Math.PI) / 180;

/** Os números de um caminho SVG, em pares (x, y). Basta para a caixa dos caminhos da planta. */
function paresDoCaminho(d: string): [number, number][] {
  const nums = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/** Cantos do retângulo de um texto (com a rotação), na tela da planta. */
function cantosTexto(it: Extract<ItemCena, { k: "texto" }>): [number, number][] {
  const a = rad(it.rot ?? 0), c = Math.cos(a), s = Math.sin(a);
  const desc = -0.21 * it.tam, asc = 0.72 * it.tam;
  return ([[0, desc], [it.w, desc], [it.w, asc], [0, asc]] as [number, number][])
    .map(([lx, ly]) => [it.x + lx * c - ly * s, it.y + lx * s + ly * c]);
}

export function caixaDe(it: ItemCena): Caixa {
  switch (it.k) {
    case "texto": {
      const p = cantosTexto(it);
      const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
      return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    }
    case "linha": {
      const m = it.esp / 2;
      return { x1: Math.min(it.x1, it.x2) - m, y1: Math.min(it.y1, it.y2) - m, x2: Math.max(it.x1, it.x2) + m, y2: Math.max(it.y1, it.y2) + m };
    }
    case "ret": case "imagem":
      return { x1: Math.min(it.x, it.x + it.w), y1: Math.min(it.y, it.y + it.h), x2: Math.max(it.x, it.x + it.w), y2: Math.max(it.y, it.y + it.h) };
    case "elipse":
      return { x1: it.x - it.rx, y1: it.y - it.ry, x2: it.x + it.rx, y2: it.y + it.ry };
    case "caminho": {
      const p = paresDoCaminho(it.d);
      if (!p.length) return { x1: it.x, y1: it.y, x2: it.x, y2: it.y };
      const xs = p.map((q) => it.x + q[0] * it.esc), ys = p.map((q) => it.y - q[1] * it.esc);
      return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    }
  }
}

export function uniao(cs: Caixa[]): Caixa | null {
  if (!cs.length) return null;
  return cs.reduce((a, b) => ({ x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) }));
}

function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/** O ponto (x, y) acerta a peça, com tolerância `tol` (unidades da tela da planta)? */
export function acerta(it: ItemCena, x: number, y: number, tol: number): boolean {
  switch (it.k) {
    case "texto": {
      const a = -rad(it.rot ?? 0), c = Math.cos(a), s = Math.sin(a);
      const dx = x - it.x, dy = y - it.y;
      const lx = dx * c - dy * s, ly = dx * s + dy * c;
      return lx >= -tol && lx <= it.w + tol && ly >= -0.21 * it.tam - tol && ly <= 0.72 * it.tam + tol;
    }
    case "linha":
      return distSeg(x, y, it.x1, it.y1, it.x2, it.y2) <= it.esp / 2 + tol;
    case "imagem": {
      const b = caixaDe(it);
      return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
    }
    case "ret": {
      const b = caixaDe(it);
      const m = tol + (it.esp ?? 0) / 2;
      const fora = x >= b.x1 - m && x <= b.x2 + m && y >= b.y1 - m && y <= b.y2 + m;
      if (!fora) return false;
      if (it.fundo) return true;
      return !(x > b.x1 + m && x < b.x2 - m && y > b.y1 + m && y < b.y2 - m);
    }
    case "elipse": {
      const nx = (x - it.x) / Math.max(it.rx, 1e-6), ny = (y - it.y) / Math.max(it.ry, 1e-6);
      const d = Math.hypot(nx, ny);
      if (it.fundo) return d <= 1 + tol / Math.min(it.rx, it.ry);
      return Math.abs(d - 1) * Math.min(it.rx, it.ry) <= tol + (it.esp ?? 0) / 2;
    }
    case "caminho": {
      const b = caixaDe(it);
      return x >= b.x1 - tol && x <= b.x2 + tol && y >= b.y1 - tol && y <= b.y2 + tol;
    }
  }
}

/** A peça de cima no ponto, ignorando as ocultas e as dos objetos travados. */
export function pecaNoPonto(itens: ItemCena[], objetos: Record<string, ObjetoCena>, x: number, y: number, tol: number, travadas = false): ItemCena | null {
  for (let i = itens.length - 1; i >= 0; i--) {
    const it = itens[i];
    if (it.oculto) continue;
    if (!!objetos[it.obj]?.travado !== travadas) continue;
    if (acerta(it, x, y, tol)) return it;
  }
  return null;
}

export function mover(it: ItemCena, dx: number, dy: number): ItemCena {
  if (it.k === "linha") return { ...it, x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy };
  return { ...it, x: it.x + dx, y: it.y + dy };
}

/** Escala uniforme em torno de (ax, ay): posições, corpos, espessuras e tamanhos. */
export function escalar(it: ItemCena, s: number, ax: number, ay: number): ItemCena {
  const P = (x: number, y: number): [number, number] => [ax + (x - ax) * s, ay + (y - ay) * s];
  switch (it.k) {
    case "linha": {
      const [x1, y1] = P(it.x1, it.y1), [x2, y2] = P(it.x2, it.y2);
      return { ...it, x1, y1, x2, y2, esp: it.esp * s, ...(it.tracejado ? { tracejado: it.tracejado.map((v) => v * s) } : {}) };
    }
    case "texto": { const [x, y] = P(it.x, it.y); return { ...it, x, y, tam: it.tam * s, w: it.w * s }; }
    case "ret": { const [x, y] = P(it.x, it.y); return { ...it, x, y, w: it.w * s, h: it.h * s, ...(it.esp ? { esp: it.esp * s } : {}) }; }
    case "imagem": { const [x, y] = P(it.x, it.y); return { ...it, x, y, w: it.w * s, h: it.h * s }; }
    case "elipse": { const [x, y] = P(it.x, it.y); return { ...it, x, y, rx: it.rx * s, ry: it.ry * s, ...(it.esp ? { esp: it.esp * s } : {}) }; }
    // no caminho a escala leva o traço junto (é assim que o PDF desenha)
    case "caminho": { const [x, y] = P(it.x, it.y); return { ...it, x, y, esc: it.esc * s }; }
  }
}

// ---------------------------------------------------------------------------
// cores
// ---------------------------------------------------------------------------
export const corCss = (c: Cor): string => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;
export const corHex = (c: Cor): string => "#" + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
export const deHex = (h: string): Cor => {
  const n = parseInt(h.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
export const mesmaCor = (a?: Cor, b?: Cor): boolean => !!a && !!b && corHex(a) === corHex(b);

/** As cores do desenho da planta, para o operador repetir sem adivinhar o tom. */
export const PALETA: { nome: string; cor: Cor }[] = [
  { nome: "Preto", cor: [0, 0, 0] },
  { nome: "Cinza da malha", cor: [0.45, 0.45, 0.45] },
  { nome: "Vermelho da estrada", cor: [0.85, 0.05, 0.05] },
  { nome: "Verde das divisões", cor: [0.05, 0.65, 0.15] },
  { nome: "Azul da poligonal", cor: [0, 0.2, 0.85] },
  { nome: "Azul do rio", cor: [0.05, 0.6, 0.9] },
  { nome: "Laranja", cor: [0.95, 0.55, 0.12] },
  { nome: "Branco", cor: [1, 1, 1] },
];

// ---------------------------------------------------------------------------
// blocos de texto
// ---------------------------------------------------------------------------
/**
 * Textos empilhados de um bloco (nome do confrontante, identificação do
 * imóvel): de cima para baixo, com o espaçamento entre linhas. `null` quando a
 * seleção não forma um bloco — textos girados ou em colunas diferentes.
 */
export function blocoDeTexto(itens: ItemCena[]): { linhas: Extract<ItemCena, { k: "texto" }>[]; passo: number } | null {
  const ts = itens.filter((i): i is Extract<ItemCena, { k: "texto" }> => i.k === "texto");
  if (ts.length < 2 || ts.length !== itens.length) return null;
  if (ts.some((t) => (t.rot ?? 0) !== 0)) return null;
  const x0 = Math.min(...ts.map((t) => t.x));
  if (ts.some((t) => Math.abs(t.x - x0) > 2)) return null;
  const linhas = [...ts].sort((a, b) => b.y - a.y);
  const passo = linhas.length > 1 ? (linhas[0].y - linhas[linhas.length - 1].y) / (linhas.length - 1) : linhas[0].tam * 1.25;
  return { linhas, passo: passo || linhas[0].tam * 1.25 };
}
