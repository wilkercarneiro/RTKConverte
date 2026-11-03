// O lote ocupado na maquete: muros (divisa com pingadeira, frente com mureta,
// pilares e gradil), portões (garagem de correr e social), o padrão de entrada
// de energia, a piscina do quintal e o que fica em cima das casas (caixa
// d'água, placas solares, condensadoras de ar). Os dados vêm de
// lib/loteamento/ocupacao3d.ts; a altura é a da cota real (elevar3d.ts).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Casa, Cena } from "../../lib/loteamento/cena3d.ts";
import { PLATIBANDA, sorteio } from "../../lib/loteamento/cena3d.ts";
import type { Pt } from "../../lib/loteamento/geom.ts";
import { dist, esquerda } from "../../lib/loteamento/geom.ts";
import { elevar, sombraDe, type Uniforms } from "./elevar3d";

export interface CtxLote {
  xz: (p: Pt) => [number, number];
  cota: (p: Pt) => number;
  U: Uniforms;
  centro: Pt;
  raio: number;
  /** material das paredes das casas (reboco): os muros usam o mesmo */
  matParede: THREE.Material | null;
}

/** Acumula triângulos de uma malha "objeto" (cota de base e atraso por vértice). */
class Malha {
  P: number[] = []; N: number[] = []; C: number[] = []; UV: number[] = []; B: number[] = []; A: number[] = [];
  base = 0; atraso = 0; cor = new THREE.Color(1, 1, 1);
  /** uv fixo (o material das paredes tem as janelas na textura: o muro fica no liso) */
  constructor(private uvFixo: [number, number] | null = null) {}
  quad(q: THREE.Vector3[], uv: number[][]): void {
    const n = new THREE.Vector3().subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[2], q[0])).normalize();
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.P.push(q[i].x, q[i].y, q[i].z);
      this.N.push(n.x, n.y, n.z);
      this.C.push(this.cor.r, this.cor.g, this.cor.b);
      if (this.uvFixo) this.UV.push(...this.uvFixo); else this.UV.push(uv[i][0], uv[i][1]);
      this.B.push(this.base);
      this.A.push(this.atraso);
    }
  }
  geometria(): THREE.BufferGeometry | null {
    if (!this.P.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.UV, 2));
    g.setAttribute("aBase", new THREE.Float32BufferAttribute(this.B, 1));
    g.setAttribute("aAtraso", new THREE.Float32BufferAttribute(this.A, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    return g;
  }
}

/**
 * Caixa orientada na planta: começa em p0, anda L ao longo de u e W ao longo
 * de n (perpendicular), de y0 a y1 (relativos à base). uv em metros.
 */
function caixa(m: Malha, xz: CtxLote["xz"], p0: Pt, u: Pt, L: number, n: Pt, W: number, y0: number, y1: number, semFundo = true): void {
  const pt = (s: number, t: number): Pt => [p0[0] + u[0] * s + n[0] * t, p0[1] + u[1] * s + n[1] * t];
  const V = (s: number, t: number, y: number) => { const [x, z] = xz(pt(s, t)); return new THREE.Vector3(x, y, z); };
  const cs: [number, number][] = [[0, 0], [L, 0], [L, W], [0, W]];
  // lados: a ordem garante a normal para fora qualquer que seja a orientação de (u, n)
  const c0 = V(L / 2, W / 2, (y0 + y1) / 2);
  for (let f = 0; f < 4; f++) {
    const [s1, t1] = cs[f], [s2, t2] = cs[(f + 1) % 4];
    const comp = Math.hypot(s2 - s1, t2 - t1);
    let q = [V(s1, t1, y0), V(s2, t2, y0), V(s2, t2, y1), V(s1, t1, y1)];
    const nn = new THREE.Vector3().subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[2], q[0]));
    if (nn.dot(new THREE.Vector3().subVectors(q[0], c0)) < 0) q = [q[1], q[0], q[3], q[2]];
    m.quad(q, [[0, y0], [comp, y0], [comp, y1], [0, y1]]);
  }
  let topo = [V(0, 0, y1), V(L, 0, y1), V(L, W, y1), V(0, W, y1)];
  const nt = new THREE.Vector3().subVectors(topo[1], topo[0]).cross(new THREE.Vector3().subVectors(topo[2], topo[0]));
  if (nt.y < 0) topo = [topo[1], topo[0], topo[3], topo[2]];
  m.quad(topo, [[0, 0], [L, 0], [L, W], [0, W]]);
  if (!semFundo) {
    let fundo = [V(0, 0, y0), V(L, 0, y0), V(L, W, y0), V(0, W, y0)];
    const nb = new THREE.Vector3().subVectors(fundo[1], fundo[0]).cross(new THREE.Vector3().subVectors(fundo[2], fundo[0]));
    if (nb.y > 0) fundo = [fundo[1], fundo[0], fundo[3], fundo[2]];
    m.quad(fundo, [[0, 0], [L, 0], [L, W], [0, W]]);
  }
}

/** Painel vertical (duas faces) ao longo de u, deslocado `off` em n. uv: metros. */
function painel(m: Malha, xz: CtxLote["xz"], p0: Pt, u: Pt, L: number, n: Pt, off: number, y0: number, y1: number): void {
  const V = (s: number, y: number) => { const [x, z] = xz([p0[0] + u[0] * s + n[0] * off, p0[1] + u[1] * s + n[1] * off]); return new THREE.Vector3(x, y, z); };
  const q = [V(0, y0), V(L, y0), V(L, y1), V(0, y1)];
  m.quad(q, [[0, y0], [L, y0], [L, y1], [0, y1]]);
  m.quad([q[1], q[0], q[3], q[2]], [[L, y0], [0, y0], [0, y1], [L, y1]]);
}

function canvasTex(w: number, h: number, pinta: (x: CanvasRenderingContext2D) => void, cor = true): THREE.CanvasTexture {
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
  pinta(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = cor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Gradil: barras verticais de 2 cm a cada 11 cm (alfa) — uv.x em metros / 0,11. */
function texGradil(): THREE.CanvasTexture {
  return canvasTex(32, 32, (x) => {
    x.clearRect(0, 0, 32, 32);
    x.fillStyle = "#fff";
    x.fillRect(13, 0, 6, 32);
  });
}

/** Portão de alumínio em lâminas horizontais (lambri) — uv.y em metros / 0,15. */
function texLambri(): THREE.CanvasTexture {
  return canvasTex(8, 64, (x) => {
    const g = x.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, "#9a9a9a"); g.addColorStop(0.12, "#e6e6e6"); g.addColorStop(0.8, "#cfcfcf"); g.addColorStop(0.92, "#7c7c7c"); g.addColorStop(1, "#505050");
    x.fillStyle = g;
    x.fillRect(0, 0, 8, 64);
  });
}

/** Água da piscina: mais clara na borda (o raso e o reflexo do azulejo). */
function texAgua(): THREE.CanvasTexture {
  return canvasTex(128, 128, (x) => {
    const g = x.createRadialGradient(64, 64, 6, 64, 64, 90);
    g.addColorStop(0, "#1a8fb4"); g.addColorStop(0.65, "#27a9c8"); g.addColorStop(1, "#6fd3e0");
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    // cáusticas leves
    x.strokeStyle = "rgba(255,255,255,0.10)";
    x.lineWidth = 1.2;
    const r = sorteio("agua");
    for (let i = 0; i < 70; i++) {
      x.beginPath();
      const cx = r() * 128, cy = r() * 128, rr = 3 + r() * 8;
      x.ellipse(cx, cy, rr, rr * (0.5 + r() * 0.5), r() * 3, 0, Math.PI * 2);
      x.stroke();
    }
  });
}

/** Placa solar: células azul-escuras com o quadro de alumínio. */
function texSolar(): THREE.CanvasTexture {
  return canvasTex(64, 128, (x) => {
    x.fillStyle = "#c8ccd0";
    x.fillRect(0, 0, 64, 128);
    x.fillStyle = "#14223d";
    x.fillRect(2, 2, 60, 124);
    x.strokeStyle = "rgba(150,170,200,0.45)";
    x.lineWidth = 1;
    for (let i = 1; i < 6; i++) { x.beginPath(); x.moveTo(2 + i * 10, 2); x.lineTo(2 + i * 10, 126); x.stroke(); }
    for (let j = 1; j < 10; j++) { x.beginPath(); x.moveTo(2, 2 + j * 12.4); x.lineTo(62, 2 + j * 12.4); x.stroke(); }
  });
}

/**
 * Folhagem de cerca viva podada (pingo-de-ouro, buxinho): milhares de folhinhas em
 * verdes variados; a normal sai do relevo das folhas (as de cima mais claras).
 */
function texFolhagem(): { cor: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const T = 256, r = sorteio("folhagem");
  const alt = new Float32Array(T * T);
  const cor = canvasTex(T, T, (x) => {
    x.fillStyle = "#1f3a17";
    x.fillRect(0, 0, T, T);
    const verdes = [[58, 98, 38], [74, 118, 44], [92, 134, 52], [48, 84, 34], [108, 146, 60]];
    for (let i = 0; i < 5200; i++) {
      const cx = r() * T, cy = r() * T, rr = 2.2 + r() * 3.2, h = r();
      const verde = verdes[Math.floor(r() * 5)];
      const k = 0.7 + h * 0.5;
      x.fillStyle = "rgb(" + ((verde[0] * k) | 0) + "," + ((verde[1] * k) | 0) + "," + ((verde[2] * k) | 0) + ")";
      const giro = r() * Math.PI;
      x.beginPath();
      for (const dx of [-T, 0, T]) for (const dy of [-T, 0, T]) {
        if (cx + dx < -8 || cx + dx > T + 8 || cy + dy < -8 || cy + dy > T + 8) continue;
        x.moveTo(cx + dx + rr, cy + dy);
        x.ellipse(cx + dx, cy + dy, rr, rr * 0.55, giro, 0, Math.PI * 2);
      }
      x.fill();
      // relevo: a folha é um domo de altura h
      for (let y = Math.floor(cy - rr); y <= cy + rr; y++) for (let xx = Math.floor(cx - rr); xx <= cx + rr; xx++) {
        const d = Math.hypot(xx - cx, y - cy) / rr;
        if (d > 1) continue;
        const kk = (((y % T) + T) % T) * T + (((xx % T) + T) % T);
        alt[kk] = Math.max(alt[kk], h * 0.6 + (1 - d * d) * 0.4);
      }
    }
  });
  const normal = canvasTex(T, T, (x) => {
    const img = x.createImageData(T, T);
    const A = (i: number, j: number) => alt[((j + T) % T) * T + ((i + T) % T)];
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
      const dx = (A(i + 1, j) - A(i - 1, j)) * 2.2, dy = (A(i, j + 1) - A(i, j - 1)) * 2.2;
      const l = Math.hypot(dx, dy, 1);
      const o = (j * T + i) * 4;
      img.data[o] = ((-dx / l) * 0.5 + 0.5) * 255; img.data[o + 1] = ((dy / l) * 0.5 + 0.5) * 255; img.data[o + 2] = ((1 / l) * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
  }, false);
  return { cor, normal };
}

/** Perfil da cerca viva podada (t para dentro do lote, y para cima), topo arredondado. */
const PERFIL_CERCA: [number, number][] = [[0, -0.3], [0, 0.72], [0.05, 0.86], [0.16, 0.95], [0.36, 0.95], [0.47, 0.86], [0.52, 0.72], [0.52, -0.3]];

const atrasoDe = (ctx: CtxLote, c: Casa) => Math.min(1, dist(c.c, ctx.centro) / ctx.raio) * 0.85 + ((c.lote * 0.6180339) % 1) * 0.15;

/** Monta o grupo do lote ocupado (fica no grupo das casas: a camada "casas" liga e desliga tudo). */
export function montarLotes(cena: Cena, ctx: CtxLote): THREE.Group {
  const grupo = new THREE.Group();
  const { xz, cota, U } = ctx;
  const oc = cena.ocupacao?.lotes ?? [];
  const cerca = new Malha(), muro = new Malha([0.1, 0.5]), metal = new Malha(), gradil = new Malha(), lambri = new Malha(), borda = new Malha(), agua = new Malha();
  const corMuro = new THREE.Color(0xe9e6df), corPinga = new THREE.Color(0xc9c5bc), corPilar = new THREE.Color(0xdedad2);
  const ESP = 0.14, H_DIV = 1.9, H_MURETA = 0.55, H_FRENTE = 1.85;
  // muro por painéis de até 3 m: cada um assenta na cota mais alta das pontas (degraus
  // no terreno inclinado, como se faz) e a fundação desce até o chão
  const trecho = (a: Pt, b: Pt, n: Pt, atraso: number, f: (p0: Pt, u: Pt, L: number, fund: number) => void) => {
    const L = dist(a, b);
    const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const k = Math.max(1, Math.ceil(L / 3));
    for (let i = 0; i < k; i++) {
      const s0 = (L * i) / k, s1 = (L * (i + 1)) / k;
      const p0: Pt = [a[0] + u[0] * s0, a[1] + u[1] * s0], p1: Pt = [a[0] + u[0] * s1, a[1] + u[1] * s1];
      const z0 = cota(p0), z1 = cota(p1), zb = Math.max(z0, z1);
      for (const m of [muro, metal, gradil, lambri]) { m.base = zb; m.atraso = atraso; }
      f(p0, u, s1 - s0, Math.min(z0, z1) - zb - 0.3);
    }
    void n;
  };
  for (const o of oc) {
    const c = cena.casas[o.casa];
    const at = atrasoDe(ctx, c);
    for (const w of o.muros) {
      if (w.tipo === "divisa") {
        trecho(w.a, w.b, w.n, at, (p0, u, L, fund) => {
          muro.cor.copy(corMuro);
          caixa(muro, xz, p0, u, L, w.n, ESP, fund, H_DIV);
          muro.cor.copy(corPinga);
          caixa(muro, xz, [p0[0] - w.n[0] * 0.03, p0[1] - w.n[1] * 0.03], u, L, w.n, ESP + 0.06, H_DIV, H_DIV + 0.05);
        });
        continue;
      }
      // cerca viva podada por dentro do gradil (perfil varrido ao longo do trecho)
      {
        const L = dist(w.a, w.b);
        if (L > 1.2) {
          const u: Pt = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
          const hC = 0.85 + ((o.lote * 0.731) % 1) * 0.35;
          const nP = Math.max(1, Math.ceil((L - 0.7) / 3));
          for (let i = 0; i < nP; i++) {
            const s0 = 0.35 + ((L - 0.7) * i) / nP, s1 = 0.35 + ((L - 0.7) * (i + 1)) / nP;
            const p0: Pt = [w.a[0] + u[0] * s0 + w.n[0] * 0.24, w.a[1] + u[1] * s0 + w.n[1] * 0.24];
            const p1: Pt = [w.a[0] + u[0] * s1 + w.n[0] * 0.24, w.a[1] + u[1] * s1 + w.n[1] * 0.24];
            const z0 = cota(p0), z1 = cota(p1);
            cerca.base = Math.max(z0, z1); cerca.atraso = at;
            const fundC = Math.min(z0, z1) - cerca.base;
            const V = (p: Pt, t: number, y: number) => { const [x, z] = xz([p[0] + w.n[0] * t, p[1] + w.n[1] * t]); return new THREE.Vector3(x, y, z); };
            const alt = (y: number) => (y < 0 ? y + fundC : y * hC);
            const meio = V([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], 0.26, 0.4 * hC);
            let arco = 0;
            for (let k = 0; k < PERFIL_CERCA.length - 1; k++) {
              const [ta, ya] = PERFIL_CERCA[k], [tb, yb] = PERFIL_CERCA[k + 1];
              const ha = alt(ya), hb = alt(yb);
              const da = Math.hypot(tb - ta, hb - ha);
              let q = [V(p0, ta, ha), V(p1, ta, ha), V(p1, tb, hb), V(p0, tb, hb)];
              // normal para fora do perfil
              const nn = new THREE.Vector3().subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[2], q[0]));
              const fora = new THREE.Vector3().subVectors(q[0], meio).add(new THREE.Vector3().subVectors(q[2], meio));
              if (nn.dot(fora) < 0) q = [q[1], q[0], q[3], q[2]];
              cerca.quad(q, [[s0, arco], [s1, arco], [s1, arco + da], [s0, arco + da]]);
              arco += da;
            }
            // tampas nas pontas da cerca
            for (const [pp, ponta] of [[p0, i === 0], [p1, i === nP - 1]] as const) {
              if (!ponta) continue;
              const anel = PERFIL_CERCA.map(([t, y]) => V(pp, t, alt(y)));
              for (let k = 1; k < anel.length - 2; k++) {
                cerca.quad([anel[0], anel[k], anel[k + 1], anel[k + 1]], [[0, 0], [PERFIL_CERCA[k][0], PERFIL_CERCA[k][1]], [PERFIL_CERCA[k + 1][0], PERFIL_CERCA[k + 1][1]], [PERFIL_CERCA[k + 1][0], PERFIL_CERCA[k + 1][1]]]);
              }
            }
          }
        }
      }
      // frente: mureta, pilares a cada ~2,5 m e o gradil entre eles
      trecho(w.a, w.b, w.n, at, (p0, u, L, fund) => {
        muro.cor.copy(corMuro);
        caixa(muro, xz, p0, u, L, w.n, ESP + 0.04, fund, H_MURETA);
        muro.cor.copy(corPinga);
        caixa(muro, xz, [p0[0] - w.n[0] * 0.03, p0[1] - w.n[1] * 0.03], u, L, w.n, ESP + 0.1, H_MURETA, H_MURETA + 0.05);
        muro.cor.copy(corPilar);
        caixa(muro, xz, [p0[0] - w.n[0] * 0.04, p0[1] - w.n[1] * 0.04], u, Math.min(0.3, L), w.n, 0.3, fund, H_FRENTE + 0.12);
        if (L > 0.5) {
          // gradil: barras (alfa) e os dois tubos horizontais
          painel(gradil, xz, [p0[0] + u[0] * 0.3, p0[1] + u[1] * 0.3], u, L - 0.3, w.n, 0.09, H_MURETA + 0.05, H_FRENTE);
          for (const y of [H_MURETA + 0.12, H_FRENTE - 0.06]) caixa(metal, xz, [p0[0] + u[0] * 0.3 + w.n[0] * 0.07, p0[1] + u[1] * 0.3 + w.n[1] * 0.07], u, L - 0.3, w.n, 0.04, y - 0.025, y + 0.025);
        }
      });
      // pilar no fim do trecho
      const L = dist(w.a, w.b);
      if (L > 0.3) {
        const u: Pt = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
        const zb = cota(w.b);
        muro.base = zb; muro.atraso = at; muro.cor.copy(corPilar);
        caixa(muro, xz, [w.b[0] - u[0] * 0.3 - w.n[0] * 0.04, w.b[1] - u[1] * 0.3 - w.n[1] * 0.04], u, 0.3, w.n, 0.3, -0.4, H_FRENTE + 0.12);
      }
    }
    // portões: garagem (de correr, lambri) e social (de abrir), entre pilares
    for (const p of o.portoes) {
      const L = dist(p.a, p.b);
      if (L < 0.4) continue;
      const u: Pt = [(p.b[0] - p.a[0]) / L, (p.b[1] - p.a[1]) / L];
      const zb = Math.max(cota(p.a), cota(p.b));
      for (const m of [muro, lambri, metal]) { m.base = zb; m.atraso = at; }
      muro.cor.copy(corPilar);
      for (const s of [0, L - 0.3]) caixa(muro, xz, [p.a[0] + u[0] * s - p.n[0] * 0.04, p.a[1] + u[1] * s - p.n[1] * 0.04], u, 0.3, p.n, 0.3, -0.4, H_FRENTE + 0.12);
      const h = p.tipo === "garagem" ? H_FRENTE - 0.02 : H_FRENTE - 0.05;
      // o portão de correr fica um pouco aberto em parte das casas (vida na rua)
      const aberto = p.tipo === "garagem" && ((o.lote * 0.37) % 1) < 0.18 ? 0.45 : 0;
      const L2 = L - 0.6 - (p.tipo === "garagem" ? (L - 0.6) * aberto : 0);
      caixa(lambri, xz, [p.a[0] + u[0] * 0.3 + p.n[0] * 0.08, p.a[1] + u[1] * 0.3 + p.n[1] * 0.08], u, L2, p.n, 0.05, 0.06, h);
      // trilho no chão
      if (p.tipo === "garagem") caixa(metal, xz, [p.a[0] + u[0] * 0.3 + p.n[0] * 0.09, p.a[1] + u[1] * 0.3 + p.n[1] * 0.09], u, L - 0.6, p.n, 0.04, -0.02, 0.03);
    }
    // piscina: borda de pedra (com a base descendo até o chão) e a água
    const pi = o.piscina;
    if (pi) {
      const v = esquerda(pi.u);
      const P = (a: number, b: number): Pt => [pi.c[0] + pi.u[0] * a + v[0] * b, pi.c[1] + pi.u[1] * a + v[1] * b];
      borda.base = pi.z; borda.atraso = at; borda.cor.set(0xece6d8);
      const a = pi.comp / 2, b = pi.larg / 2, e = 0.32;
      const zMin = Math.min(...[P(-a, -b), P(a, -b), P(a, b), P(-a, b)].map(cota));
      const fund = zMin - pi.z - 0.3;
      caixa(borda, xz, P(-a - e, -b - e), pi.u, 2 * (a + e), v, e, fund, 0.04);
      caixa(borda, xz, P(-a - e, b), pi.u, 2 * (a + e), v, e, fund, 0.04);
      caixa(borda, xz, P(-a - e, -b), pi.u, e, v, 2 * b, fund, 0.04);
      caixa(borda, xz, P(a, -b), pi.u, e, v, 2 * b, fund, 0.04);
      // laje sob a água (o terreno inclinado não aparece por baixo)
      borda.cor.set(0x7fc6d6);
      caixa(borda, xz, P(-a, -b), pi.u, 2 * a, v, 2 * b, fund, -0.12);
      agua.base = pi.z; agua.atraso = at;
      const W = (x: number, y: number, h: number) => { const [X, Z] = xz(P(x, y)); return new THREE.Vector3(X, h, Z); };
      let q = [W(-a, -b, -0.08), W(a, -b, -0.08), W(a, b, -0.08), W(-a, b, -0.08)];
      const nn = new THREE.Vector3().subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[2], q[0]));
      if (nn.y < 0) q = [q[1], q[0], q[3], q[2]];
      agua.quad(q, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  }
  const malha = (m: Malha, mat: THREE.Material, sombra = true, depth?: THREE.Material) => {
    const g = m.geometria();
    if (!g) return null;
    const me = new THREE.Mesh(g, mat);
    me.receiveShadow = true;
    me.castShadow = sombra;
    if (sombra) me.customDepthMaterial = (depth as THREE.MeshDepthMaterial) ?? sombraDe("objeto", U);
    me.frustumCulled = false;
    grupo.add(me);
    return me;
  };
  {
    const f = texFolhagem();
    for (const t of [f.cor, f.normal]) t.repeat.set(1 / 0.7, 1 / 0.7);
    const matCerca = elevar(new THREE.MeshStandardMaterial({ map: f.cor, normalMap: f.normal, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.92, side: THREE.DoubleSide }), "objeto", U);
    matCerca.customProgramCacheKey = () => "elevar-objeto-cerca";
    malha(cerca, matCerca);
  }
  malha(muro, ctx.matParede ?? elevar(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), "objeto", U));
  malha(metal, elevar(new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.45, metalness: 0.7 }), "objeto", U));
  const tG = texGradil();
  tG.repeat.set(1 / 0.11, 1);
  const matGradil = elevar(new THREE.MeshStandardMaterial({ color: 0x24262a, alphaMap: tG, alphaTest: 0.5, roughness: 0.45, metalness: 0.65, side: THREE.DoubleSide }), "objeto", U);
  matGradil.customProgramCacheKey = () => "elevar-objeto-gradil";
  const sombraGradil = elevar(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: tG, alphaTest: 0.5 }), "objeto", U);
  sombraGradil.customProgramCacheKey = () => "elevar-objeto-gradil-sombra";
  malha(gradil, matGradil, true, sombraGradil);
  const tL = texLambri();
  tL.repeat.set(1, 1 / 0.15);
  malha(lambri, elevar(new THREE.MeshStandardMaterial({ color: 0x3a3c40, map: tL, roughness: 0.38, metalness: 0.75 }), "objeto", U));
  malha(borda, elevar(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), "objeto", U));
  const matAgua = elevar(new THREE.MeshStandardMaterial({ map: texAgua(), roughness: 0.04, metalness: 0.15, envMapIntensity: 1.6 }), "objeto", U);
  matAgua.customProgramCacheKey = () => "elevar-objeto-agua";
  malha(agua, matAgua, false);

  // ---- telhado e fachadas: caixa d'água, placas solares, condensadoras; padrão de entrada
  const tanque: { m: THREE.Matrix4; base: number; at: number }[] = [];
  const solar: { m: THREE.Matrix4; base: number; at: number }[] = [];
  const ar: { m: THREE.Matrix4; base: number; at: number }[] = [];
  const padrao: { m: THREE.Matrix4; base: number; at: number }[] = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler(), um = new THREE.Vector3(1, 1, 1);
  const pos = (c: Casa, a: number, b: number, y: number) => {
    const V = esquerda(c.u);
    const [x, z] = xz([c.c[0] + c.u[0] * a + V[0] * b, c.c[1] + c.u[1] * a + V[1] * b]);
    return new THREE.Vector3(x, y, z);
  };
  // giro da casa no mundo: o eixo a (u) da planta vira (u0, −u1)
  const giro = (c: Casa, extra = 0) => Math.atan2(c.u[1], c.u[0]) + extra;
  cena.casas.forEach((c) => {
    if (!c.volumes || c.lote < 0) return;
    const rnd = sorteio(`telhado-${c.lote}`);
    const at = atrasoDe(ctx, c);
    // a laje mais alta com platibanda recebe a caixa d'água; a maior, as placas
    const comPlat = c.volumes.filter((v) => v.platibanda);
    if (!comPlat.length) return;
    const alta = comPlat.reduce((m, v) => (v.y1 > m.y1 ? v : m), comPlat[0]);
    const maior = comPlat.reduce((m, v) => ((v.a1 - v.a0) * (v.b1 - v.b0) > (m.a1 - m.a0) * (m.b1 - m.b0) ? v : m), comPlat[0]);
    const yA = alta.y1 - PLATIBANDA + 0.1;
    // caixa d'água de 1000 L no canto do fundo da laje mais alta (nas outras, embutida)
    if (rnd() < 0.45) {
      const a = alta.a1 - 1.05 - rnd() * Math.max(0, alta.a1 - alta.a0 - 2.2), b = alta.b1 - 1.0;
      e.set(0, giro(c), 0); q.setFromEuler(e);
      tanque.push({ m: new THREE.Matrix4().compose(pos(c, a, b, yA), q, um), base: c.piso, at });
    }
    // placas solares (metade das casas): fileiras inclinadas 15°, alinhadas com a casa e
    // viradas para o lado dela mais perto do norte (hemisfério sul)
    if (rnd() < 0.55) {
      const yM = maior.y1 - PLATIBANDA + 0.1;
      // o módulo olha para o −z local; girado por ψ, olha para (−sen ψ, −cos ψ) no mundo
      let k = 0, melhor = -2;
      for (let kk = 0; kk < 4; kk++) { const cz = Math.cos(giro(c, (kk * Math.PI) / 2)); if (cz > melhor) { melhor = cz; k = kk; } }
      const deitado = k % 2 === 1; // o lado comprido do módulo ao longo de a
      const pa = deitado ? 2.2 : 1.08, pb = deitado ? 1.08 : 2.2;
      const la = maior.a1 - maior.a0 - 0.8, lb = maior.b1 - maior.b0 - 0.8 - (maior === alta ? 2.2 : 0);
      const nA = Math.min(deitado ? 3 : 6, Math.floor(la / pa)), nB = Math.min(deitado ? 4 : 2, Math.floor(lb / pb));
      e.set(0, giro(c, (k * Math.PI) / 2), 0); q.setFromEuler(e);
      for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) {
        const a = maior.a0 + 0.4 + pa / 2 + i * pa, b = maior.b0 + 0.4 + pb / 2 + j * pb;
        solar.push({ m: new THREE.Matrix4().compose(pos(c, a, b, yM), q, um), base: c.piso, at });
      }
    }
    // condensadora do ar na lateral (face a0 ou a1 do primeiro volume)
    if (rnd() < 0.7) {
      const v0 = c.volumes[0];
      const lado = rnd() < 0.5 ? -1 : 1;
      const a = lado < 0 ? v0.a0 - 0.22 : v0.a1 + 0.22;
      const b = v0.b0 + (v0.b1 - v0.b0) * (0.35 + rnd() * 0.4);
      e.set(0, giro(c, lado < 0 ? -Math.PI / 2 : Math.PI / 2), 0); q.setFromEuler(e);
      ar.push({ m: new THREE.Matrix4().compose(pos(c, a, b, 2.2), q, um), base: c.piso, at });
    }
  });
  for (const o of oc) {
    if (!o.padrao) continue;
    const c = cena.casas[o.casa];
    const [x, z] = xz(o.padrao.p);
    e.set(0, Math.atan2(o.padrao.n[1], o.padrao.n[0]), 0); q.setFromEuler(e);
    padrao.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, um), base: o.padrao.z, at: atrasoDe(ctx, c) });
  }
  const instancias = (geo: THREE.BufferGeometry, mat: THREE.Material, lista: { m: THREE.Matrix4; base: number; at: number }[]) => {
    if (!lista.length) return;
    const im = new THREE.InstancedMesh(geo, mat, lista.length);
    const base = new Float32Array(lista.length), atraso = new Float32Array(lista.length);
    lista.forEach((it, i) => { im.setMatrixAt(i, it.m); base[i] = it.base; atraso[i] = it.at; });
    geo.setAttribute("aBase", new THREE.InstancedBufferAttribute(base, 1));
    geo.setAttribute("aAtraso", new THREE.InstancedBufferAttribute(atraso, 1));
    im.castShadow = im.receiveShadow = true;
    im.customDepthMaterial = sombraDe("instancia", U);
    im.frustumCulled = false;
    grupo.add(im);
  };
  const pinta = (g: THREE.BufferGeometry, cor: number) => {
    const n = g.getAttribute("position").count, c = new THREE.Color(cor), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    g.deleteAttribute("uv");
    return g;
  };
  const junta = (partes: [THREE.BufferGeometry, number][]) => mergeGeometries(partes.map(([g, cor]) => pinta(g.toNonIndexed(), cor)))!;
  const matCor = (rough: number, metal = 0) => elevar(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal }), "instancia", U);
  // caixa d'água azul de fibra (tampa cônica) sobre a base
  instancias(junta([
    [new THREE.CylinderGeometry(0.66, 0.6, 0.72, 24).translate(0, 0.36, 0), 0x2b63b0],
    [new THREE.CylinderGeometry(0.2, 0.7, 0.2, 24).translate(0, 0.82, 0), 0x2b63b0],
    [new THREE.CylinderGeometry(0.71, 0.71, 0.05, 24).translate(0, 0.72, 0), 0x234f8f],
    [new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6).rotateZ(Math.PI / 2).translate(-0.9, 0.12, 0), 0xe8e8e8],
  ]), matCor(0.5), tanque);
  // módulo solar inclinado 15° com o quadro
  const tS = texSolar();
  const modulo = new THREE.BoxGeometry(1.0, 0.04, 1.7).rotateX(-0.26).translate(0, 0.45, 0);
  const pes = mergeGeometries([
    new THREE.BoxGeometry(0.04, 0.5, 0.04).translate(-0.45, 0.25, 0.7).toNonIndexed(),
    new THREE.BoxGeometry(0.04, 0.5, 0.04).translate(0.45, 0.25, 0.7).toNonIndexed(),
    new THREE.BoxGeometry(0.04, 0.25, 0.04).translate(-0.45, 0.12, -0.7).toNonIndexed(),
    new THREE.BoxGeometry(0.04, 0.25, 0.04).translate(0.45, 0.12, -0.7).toNonIndexed(),
  ])!;
  const matSolar = elevar(new THREE.MeshStandardMaterial({ map: tS, roughness: 0.12, metalness: 0.5, envMapIntensity: 1.4 }), "instancia", U);
  matSolar.customProgramCacheKey = () => "elevar-instancia-solar";
  instancias(modulo, matSolar, solar);
  instancias(pinta(pes, 0x9aa0a6), matCor(0.5, 0.6), solar);
  // condensadora: caixa clara com a grade do ventilador escura
  instancias(junta([
    [new THREE.BoxGeometry(0.82, 0.56, 0.3).translate(0, 0, 0), 0xe9e9e6],
    [new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20).rotateX(Math.PI / 2).translate(-0.1, 0, 0.16), 0x2d2f33],
    [new THREE.BoxGeometry(0.7, 0.03, 0.36).translate(0, -0.3, 0), 0x6d7177],
  ]), matCor(0.55), ar);
  // padrão de entrada: caixa do medidor (com visor) e o pontalete com a armação do ramal
  instancias(junta([
    [new THREE.BoxGeometry(0.42, 1.25, 0.5).translate(0, 0.62, 0), 0xd9d6cf],
    [new THREE.BoxGeometry(0.3, 0.42, 0.04).translate(0.0, 1.0, 0.0).rotateY(Math.PI / 2).translate(0.21, 0, 0), 0x9ea5ab],
    [new THREE.CylinderGeometry(0.03, 0.03, 2.6, 8).translate(0, 2.55, 0), 0x8b9096],
    [new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(Math.PI / 2).translate(0.03, 3.82, 0), 0x2a2a2a],
    [new THREE.CylinderGeometry(0.035, 0.045, 0.1, 8).translate(0.06, 3.65, 0), 0xf2f2f2],
  ]), matCor(0.6, 0.2), padrao);
  return grupo;
}
