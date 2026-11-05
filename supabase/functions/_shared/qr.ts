// Gerador de QR Code (ISO/IEC 18004) em código, sem dependência: roda igual no
// Deno (edge functions), no Node (testes) e no navegador.
//
// Só o necessário para o selo de autenticidade da planta: modo BYTE (UTF-8),
// versões 1 a 10 e os quatro níveis de correção. A versão é a menor em que o
// texto cabe; a máscara é a de menor penalidade (as quatro regras da norma).
// Algoritmo segundo a referência pública de Project Nayuki (MIT), reescrito.
//
// A saída é a matriz de módulos (true = escuro). Quem desenha decide a escala e
// a zona de silêncio (4 módulos, pela norma) — a planta desenha vetor no PDF.

export type NivelCorrecao = "L" | "M" | "Q" | "H";

export interface MatrizQr {
  versao: number;
  tamanho: number;
  nivel: NivelCorrecao;
  mascara: number;
  /** módulos[y][x] — true = escuro */
  modulos: boolean[][];
}

const ORDEM: Record<NivelCorrecao, number> = { L: 0, M: 1, Q: 2, H: 3 };
const BITS_FORMATO: Record<NivelCorrecao, number> = { L: 1, M: 0, Q: 3, H: 2 };

// índice 0 = sem uso; versões 1..10
const ECC_POR_BLOCO: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
];
const NUM_BLOCOS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
];
export const VERSAO_MAX = 10;

/** Módulos de dados (sem padrões de função) da versão. */
function modulosDeDados(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

/** Palavras de dados (sem as de correção) da versão/nível. */
export function capacidadeBytes(ver: number, nivel: NivelCorrecao): number {
  const e = ORDEM[nivel];
  const palavras = Math.floor(modulosDeDados(ver) / 8) - ECC_POR_BLOCO[e][ver] * NUM_BLOCOS[e][ver];
  // modo byte: 4 bits de modo + 8 (v1–9) ou 16 (v10+) de contagem
  const cabecalho = 4 + (ver <= 9 ? 8 : 16);
  return Math.floor((palavras * 8 - cabecalho) / 8);
}

// ---------------------------------------------------------------- Reed-Solomon
function mulGF(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function divisorRS(grau: number): number[] {
  const r = new Array<number>(grau).fill(0);
  r[grau - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grau; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = mulGF(r[j], raiz);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    raiz = mulGF(raiz, 0x02);
  }
  return r;
}

function restoRS(dados: number[], divisor: number[]): number[] {
  const r = new Array<number>(divisor.length).fill(0);
  for (const b of dados) {
    const fator = b ^ (r.shift() as number);
    r.push(0);
    divisor.forEach((coef, i) => { r[i] ^= mulGF(coef, fator); });
  }
  return r;
}

// ---------------------------------------------------------------- codificação
function utf8(texto: string): number[] {
  return Array.from(new TextEncoder().encode(texto));
}

function palavrasDeDados(bytes: number[], ver: number, nivel: NivelCorrecao): number[] {
  const e = ORDEM[nivel];
  const capacidade = Math.floor(modulosDeDados(ver) / 8) - ECC_POR_BLOCO[e][ver] * NUM_BLOCOS[e][ver];
  const bits: number[] = [];
  const por = (val: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  por(0x4, 4);
  por(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) por(b, 8);
  const limite = capacidade * 8;
  por(0, Math.min(4, limite - bits.length));
  por(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < limite; pad ^= 0xec ^ 0x11) por(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
    out.push(v);
  }
  return out;
}

function intercalarComCorrecao(dados: number[], ver: number, nivel: NivelCorrecao): number[] {
  const e = ORDEM[nivel];
  const nBlocos = NUM_BLOCOS[e][ver];
  const eccLen = ECC_POR_BLOCO[e][ver];
  const brutos = Math.floor(modulosDeDados(ver) / 8);
  const curtos = nBlocos - (brutos % nBlocos);
  const lenCurto = Math.floor(brutos / nBlocos);
  const div = divisorRS(eccLen);
  const blocos: number[][] = [];
  for (let i = 0, k = 0; i < nBlocos; i++) {
    const dat = dados.slice(k, k + lenCurto - eccLen + (i < curtos ? 0 : 1));
    k += dat.length;
    const ecc = restoRS(dat, div);
    if (i < curtos) dat.push(0);
    blocos.push(dat.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < blocos[0].length; i++) {
    for (let j = 0; j < blocos.length; j++) {
      if (i !== lenCurto - eccLen || j >= curtos) out.push(blocos[j][i]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- matriz
function posicoesAlinhamento(ver: number, tamanho: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const passo = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = tamanho - 7; r.length < n; pos -= passo) r.splice(1, 0, pos);
  return r;
}

class Grade {
  m: boolean[][];
  funcao: boolean[][];
  n: number;
  constructor(n: number) {
    this.n = n;
    this.m = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
    this.funcao = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  }
  f(x: number, y: number, escuro: boolean) { this.m[y][x] = escuro; this.funcao[y][x] = true; }
}

function bitsFormato(nivel: NivelCorrecao, mascara: number): number {
  const dado = (BITS_FORMATO[nivel] << 3) | mascara;
  let rem = dado;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((dado << 10) | rem) ^ 0x5412;
}

function desenharFormato(g: Grade, nivel: NivelCorrecao, mascara: number) {
  const bits = bitsFormato(nivel, mascara);
  const b = (i: number) => ((bits >>> i) & 1) !== 0;
  const n = g.n;
  for (let i = 0; i <= 5; i++) g.f(8, i, b(i));
  g.f(8, 7, b(6));
  g.f(8, 8, b(7));
  g.f(7, 8, b(8));
  for (let i = 9; i < 15; i++) g.f(14 - i, 8, b(i));
  for (let i = 0; i < 8; i++) g.f(n - 1 - i, 8, b(i));
  for (let i = 8; i < 15; i++) g.f(8, n - 15 + i, b(i));
  g.f(8, n - 8, true); // módulo escuro fixo
}

function desenharFuncoes(g: Grade, ver: number) {
  const n = g.n;
  for (let i = 0; i < n; i++) { g.f(6, i, i % 2 === 0); g.f(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        g.f(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const al = posicoesAlinhamento(ver, n);
  for (let i = 0; i < al.length; i++) {
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) g.f(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  desenharFormato(g, "L", 0); // reserva as posições; o definitivo entra depois da máscara
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) !== 0;
      const a = n - 11 + (i % 3), b = Math.floor(i / 3);
      g.f(a, b, bit);
      g.f(b, a, bit);
    }
  }
}

function desenharPalavras(g: Grade, palavras: number[]) {
  const n = g.n;
  let i = 0;
  for (let dir = n - 1; dir >= 1; dir -= 2) {
    if (dir === 6) dir = 5;
    for (let v = 0; v < n; v++) {
      for (let j = 0; j < 2; j++) {
        const x = dir - j;
        const subindo = ((dir + 1) & 2) === 0;
        const y = subindo ? n - 1 - v : v;
        if (!g.funcao[y][x] && i < palavras.length * 8) {
          g.m[y][x] = ((palavras[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
}

function inverte(mascara: number, x: number, y: number): boolean {
  switch (mascara) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function aplicarMascara(g: Grade, mascara: number) {
  for (let y = 0; y < g.n; y++) {
    for (let x = 0; x < g.n; x++) if (!g.funcao[y][x] && inverte(mascara, x, y)) g.m[y][x] = !g.m[y][x];
  }
}

/** Penalidade da norma (regras 1–4). Menor = mais fácil de ler. */
export function penalidade(m: boolean[][]): number {
  const n = m.length;
  let p = 0;
  const linhas = (get: (a: number, b: number) => boolean) => {
    for (let a = 0; a < n; a++) {
      let corrida = 1;
      const seq: number[] = [];
      for (let b = 0; b < n; b++) seq.push(get(a, b) ? 1 : 0);
      for (let b = 1; b <= n; b++) {
        if (b < n && seq[b] === seq[b - 1]) { corrida++; continue; }
        if (corrida >= 5) p += 3 + (corrida - 5);
        corrida = 1;
      }
      // regra 3: 1:1:3:1:1 com 4 claros de um lado
      const s = [0, 0, 0, 0, ...seq, 0, 0, 0, 0];
      for (let b = 0; b + 11 <= s.length; b++) {
        const w = s.slice(b, b + 11).join("");
        if (w === "10111010000" || w === "00001011101") p += 40;
      }
    }
  };
  linhas((a, b) => m[a][b]);
  linhas((a, b) => m[b][a]);
  for (let y = 0; y + 1 < n; y++) {
    for (let x = 0; x + 1 < n; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
  }
  let escuros = 0;
  for (const l of m) for (const c of l) if (c) escuros++;
  const total = n * n;
  const k = Math.ceil(Math.abs(escuros * 20 - total * 10) / total) - 1;
  p += Math.max(0, k) * 10;
  return p;
}

/**
 * Codifica `texto` (UTF-8, modo byte). Usa a menor versão em que cabe no nível
 * pedido e, se sobrar espaço na mesma versão, sobe o nível de correção.
 */
export function gerarQr(texto: string, nivelMin: NivelCorrecao = "M"): MatrizQr {
  const bytes = utf8(texto);
  let ver = 1;
  while (ver <= VERSAO_MAX && capacidadeBytes(ver, nivelMin) < bytes.length) ver++;
  if (ver > VERSAO_MAX) throw new Error(`Texto longo demais para o QR (${bytes.length} bytes)`);
  let nivel = nivelMin;
  for (const n of ["M", "Q", "H"] as NivelCorrecao[]) {
    if (ORDEM[n] > ORDEM[nivel] && capacidadeBytes(ver, n) >= bytes.length) nivel = n;
  }
  const palavras = intercalarComCorrecao(palavrasDeDados(bytes, ver, nivel), ver, nivel);
  const tamanho = ver * 4 + 17;
  let melhor: { g: Grade; mascara: number; p: number } | null = null;
  for (let mascara = 0; mascara < 8; mascara++) {
    const g = new Grade(tamanho);
    desenharFuncoes(g, ver);
    desenharPalavras(g, palavras);
    aplicarMascara(g, mascara);
    desenharFormato(g, nivel, mascara);
    const p = penalidade(g.m);
    if (!melhor || p < melhor.p) melhor = { g, mascara, p };
  }
  return { versao: ver, tamanho, nivel, mascara: melhor!.mascara, modulos: melhor!.g.m };
}

/**
 * Retângulos dos módulos escuros, uma corrida horizontal por retângulo (poucos
 * objetos no PDF). Coordenadas em módulos, origem no canto SUPERIOR esquerdo.
 */
export function retangulosQr(q: MatrizQr): { x: number; y: number; w: number }[] {
  const out: { x: number; y: number; w: number }[] = [];
  for (let y = 0; y < q.tamanho; y++) {
    let x = 0;
    while (x < q.tamanho) {
      if (!q.modulos[y][x]) { x++; continue; }
      const ini = x;
      while (x < q.tamanho && q.modulos[y][x]) x++;
      out.push({ x: ini, y, w: x - ini });
    }
  }
  return out;
}
