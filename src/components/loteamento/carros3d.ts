// Carros da maquete: carrocerias modeladas por seções (hatch, sedã e SUV) —
// caixa de roda recortada, capô e tampa com a linha certa, cabine com vidro
// escuro, colunas e retrovisores, rodas com pneu e aro, grade, placa e faróis
// que acendem à noite. A cor de cada carro vem da instância (pintura com verniz).
// Referencial: x para a frente, y para cima, z para o lado; chão em y = 0.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

interface Perfil {
  L: number; W: number; r: number; eixoF: number; eixoT: number; vao: number;
  /** linha de cima da carroceria (capô, cintura, tampa): (x, y) da frente para trás */
  topo: [number, number][];
  /** cabine: (x, y) do pé do para-brisa ao pé do vidro traseiro */
  cabine: [number, number][];
  /** onde o teto (pintado) começa e termina */
  tetoI: number; tetoF: number;
}

const F = (L: number) => L / 2;

/** hatch (Onix, HB20), sedã (Virtus, Corolla) e SUV (Creta, Compass) */
export const PERFIS: Perfil[] = (() => {
  const h = 3.95, s = 4.55, u = 4.4;
  return [
    {
      L: h, W: 1.73, r: 0.31, eixoF: F(h) - 0.82, eixoT: F(h) - 0.82 - 2.53, vao: 0.2,
      topo: [[F(h), 0.6], [F(h) - 0.12, 0.74], [F(h) - 0.9, 0.88], [F(h) - 1.32, 0.97], [-F(h) + 0.14, 0.99], [-F(h), 0.84]],
      cabine: [[F(h) - 1.32, 0.97], [F(h) - 2.05, 1.47], [-F(h) + 0.6, 1.45], [-F(h) + 0.16, 0.99]],
      tetoI: F(h) - 2.0, tetoF: -F(h) + 0.62,
    },
    {
      L: s, W: 1.76, r: 0.31, eixoF: F(s) - 0.9, eixoT: F(s) - 0.9 - 2.65, vao: 0.19,
      topo: [[F(s), 0.6], [F(s) - 0.12, 0.74], [F(s) - 1.0, 0.89], [F(s) - 1.42, 0.97], [-F(s) + 1.05, 0.99], [-F(s) + 0.18, 1.01], [-F(s), 0.84]],
      cabine: [[F(s) - 1.42, 0.97], [F(s) - 2.2, 1.45], [-F(s) + 1.62, 1.43], [-F(s) + 1.05, 0.99]],
      tetoI: F(s) - 2.15, tetoF: -F(s) + 1.64,
    },
    {
      L: u, W: 1.83, r: 0.35, eixoF: F(u) - 0.88, eixoT: F(u) - 0.88 - 2.64, vao: 0.25,
      topo: [[F(u), 0.72], [F(u) - 0.12, 0.92], [F(u) - 0.95, 1.04], [F(u) - 1.3, 1.1], [-F(u) + 0.12, 1.12], [-F(u), 0.92]],
      cabine: [[F(u) - 1.3, 1.1], [F(u) - 2.0, 1.66], [-F(u) + 0.38, 1.64], [-F(u) + 0.1, 1.12]],
      tetoI: F(u) - 1.95, tetoF: -F(u) + 0.4,
    },
  ];
})();

function interp(pts: [number, number][], x: number): number {
  // pts em x decrescente (da frente para trás)
  if (x >= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (x <= x0 && x >= x1) {
      const t = (x0 - x) / (x0 - x1 || 1);
      // suave entre os nós (o capô e o para-brisa não ficam quebrados)
      const s = t * t * (3 - 2 * t);
      return y0 + (y1 - y0) * (0.35 * t + 0.65 * s);
    }
  }
  return pts[pts.length - 1][1];
}

/** Malha indexada por anéis (seções) com cor por vértice. */
function loft(aneis: { p: THREE.Vector3; c: number }[][], fechar: boolean, tampas: boolean): THREE.BufferGeometry {
  const P: number[] = [], C: number[] = [], I: number[] = [];
  const M = aneis[0].length;
  for (const a of aneis) for (const v of a) { P.push(v.p.x, v.p.y, v.p.z); C.push(v.c, v.c, v.c); }
  for (let i = 0; i < aneis.length - 1; i++) for (let k = 0; k < (fechar ? M : M - 1); k++) {
    const a = i * M + k, b = i * M + ((k + 1) % M), c = (i + 1) * M + k, d = (i + 1) * M + ((k + 1) % M);
    I.push(a, c, b, b, c, d);
  }
  if (tampas) for (const [i, sinal] of [[0, 1], [aneis.length - 1, -1]] as const) {
    // tampa: leque a partir do centro do anel
    const centro = new THREE.Vector3();
    for (const v of aneis[i]) centro.add(v.p);
    centro.divideScalar(M);
    const ci = P.length / 3;
    P.push(centro.x, centro.y, centro.z);
    C.push(aneis[i][0].c, aneis[i][0].c, aneis[i][0].c);
    for (let k = 0; k < M; k++) {
      const a = i * M + k, b = i * M + ((k + 1) % M);
      if (sinal > 0) I.push(ci, a, b); else I.push(ci, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

const PINTURA = 1, VIDRO = 0.035, PRETO = 0.06, PLASTICO = 0.12;

function corpo(pf: Perfil): THREE.BufferGeometry {
  const { L, W, r } = pf;
  const RF = 0.42, RT = 0.32, M = 20, n = 5;
  // seções densas onde a forma muda (caixas de roda e as pontas arredondadas), ralas no resto
  const xs: number[] = [];
  for (let x = F(L); x > -F(L); ) {
    xs.push(x);
    const perto = Math.min(F(L) - x, x + F(L)) < 0.45 || [pf.eixoF, pf.eixoT].some((e) => Math.abs(x - e) < r + 0.14);
    x -= perto ? 0.07 : 0.2;
  }
  xs.push(-F(L));
  const larg = (x: number) => {
    const eF = F(L) - x, eT = x + F(L);
    const R = eF < eT ? RF : RT, e = Math.min(eF, eT);
    const plano = e < R ? W / 2 - R + Math.sqrt(Math.max(0, R * R - (R - e) * (R - e))) : W / 2;
    return Math.max(0.05, plano);
  };
  const fundo = (x: number) => {
    let y = pf.vao;
    for (const xe of [pf.eixoF, pf.eixoT]) {
      const dx = Math.abs(x - xe), R = r + 0.08;
      if (dx < R) y = Math.max(y, r + Math.sqrt(R * R - dx * dx) * 0.92);
    }
    // para-choques sobem um pouco nas pontas
    const e = Math.min(F(L) - x, x + F(L));
    if (e < 0.25) y = Math.max(y, pf.vao + (0.25 - e) * 0.5);
    return y;
  };
  const aneis = xs.map((x) => {
    const w = larg(x), y0 = fundo(x), y1 = interp(pf.topo, x);
    const yc = (y0 + y1) / 2, hh = Math.max(0.02, (y1 - y0) / 2);
    const anel: { p: THREE.Vector3; c: number }[] = [];
    for (let k = 0; k < M; k++) {
      // sentido: de baixo para o lado −z, o teto e o lado +z (normais para fora)
      const t = -(k / M) * Math.PI * 2 - Math.PI / 2;
      const c = Math.cos(t), s = Math.sin(t);
      const z = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const y = yc + hh * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      // embaixo e a saia: plástico escuro
      const cor = y < y0 + 0.1 ? PLASTICO : PINTURA;
      anel.push({ p: new THREE.Vector3(x, y, z), c: cor });
    }
    return anel;
  });
  return loft(aneis, true, true);
}

function cabine(pf: Perfil): THREE.BufferGeometry {
  const { L, W } = pf;
  const x0 = pf.cabine[0][0], x1 = pf.cabine[pf.cabine.length - 1][0];
  const xs: number[] = [];
  for (let x = x0; x >= x1 - 1e-6; x -= 0.11) xs.push(Math.max(x1, x));
  if (xs[xs.length - 1] > x1 + 1e-6) xs.push(x1);
  const pilarB = (pf.tetoI + pf.tetoF) / 2 + 0.12;
  const aneis = xs.map((x) => {
    const yb = interp(pf.topo, x);
    const yt = Math.max(yb + 0.001, interp(pf.cabine, x));
    const wb = W / 2 - 0.05 - Math.max(0, Math.min(F(L) - x, x + F(L)) < 0.3 ? 0.2 : 0);
    const wt = wb - 0.17;
    // seção: lateral inclinada e o teto arredondado (8 pontos de um lado ao outro)
    const R = Math.min(0.1, (yt - yb) * 0.4);
    const pts: [number, number, "lado" | "canto" | "teto"][] = [
      [-wb, yb, "lado"], [-wt - 0.02, yt - R, "canto"], [-wt + R * 0.4, yt - R * 0.15, "canto"], [-wt + R, yt, "teto"],
      [wt - R, yt, "teto"], [wt - R * 0.4, yt - R * 0.15, "canto"], [wt + 0.02, yt - R, "canto"], [wb, yb, "lado"],
    ];
    const teto = x < pf.tetoI - 0.06 && x > pf.tetoF + 0.06;
    const colunaA = x > pf.tetoI - 0.06, colunaC = x < pf.tetoF + 0.06;
    return pts.map(([z, y, k]) => {
      let c = VIDRO;
      if (k === "teto" && teto) c = PINTURA;
      else if (k === "canto" && (colunaA || colunaC)) c = PINTURA;
      else if (k === "canto" && teto) c = PINTURA;
      if (k !== "teto" && Math.abs(x - pilarB) < 0.075) c = PRETO;
      return { p: new THREE.Vector3(x, y, z), c };
    });
  });
  return loft(aneis, false, false);
}

function caixa(w: number, h: number, d: number, x: number, y: number, z: number, cor: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
  const n = g.getAttribute("position").count;
  g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(cor), 3));
  g.deleteAttribute("uv");
  return g;
}

function semUv(g: THREE.BufferGeometry, cor: number): THREE.BufferGeometry {
  const n = (g.index ? g.toNonIndexed() : g);
  n.deleteAttribute("uv");
  n.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n.getAttribute("position").count * 3).fill(cor), 3));
  return n;
}

export interface GeoCarro { corpo: THREE.BufferGeometry; escuro: THREE.BufferGeometry; luzes: THREE.BufferGeometry }

/** As três peças de um modelo: carroceria pintada (com vidros), peças escuras/rodas e luzes. */
export function geometriaCarro(modelo: number): GeoCarro {
  const pf = PERFIS[modelo % PERFIS.length];
  const { L, W, r } = pf;
  const cb = cabine(pf).toNonIndexed();
  const cp = corpo(pf).toNonIndexed();
  // retrovisores (pintados) no pé da coluna A
  const yR = interp(pf.topo, pf.cabine[0][0] - 0.3) + 0.12;
  const retro = [-1, 1].map((sz) => caixa(0.16, 0.11, 0.2, pf.cabine[0][0] - 0.28, yR, sz * (W / 2 + 0.06), PINTURA));
  const corpoG = mergeGeometries([cp, cb, ...retro])!;
  // rodas: pneu (preto) e aro (prata), um pouco para dentro da carroceria
  const partes: THREE.BufferGeometry[] = [];
  for (const xe of [pf.eixoF, pf.eixoT]) for (const sz of [-1, 1]) {
    const zc = sz * (W / 2 - 0.13);
    partes.push(semUv(new THREE.CylinderGeometry(r, r, 0.22, 18).rotateX(Math.PI / 2).translate(xe, r, zc), 0.03));
    partes.push(semUv(new THREE.CylinderGeometry(r * 0.64, r * 0.64, 0.225, 16).rotateX(Math.PI / 2).translate(xe, r, zc + sz * 0.003), 0.62));
    partes.push(semUv(new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.23, 12).rotateX(Math.PI / 2).translate(xe, r, zc + sz * 0.004), 0.25));
  }
  // grade, placas e frisos
  const yG = interp(pf.topo, F(L)) - 0.16;
  partes.push(caixa(0.06, 0.16, W * 0.48, F(L) - 0.03, yG, 0, 0.02));
  partes.push(caixa(0.04, 0.13, 0.4, F(L) + 0.0, pf.vao + 0.2, 0, 0.85));
  partes.push(caixa(0.04, 0.13, 0.4, -F(L) - 0.0, interp(pf.topo, -F(L) + 0.2) - 0.32, 0, 0.85));
  const escuro = mergeGeometries(partes)!;
  // luzes: faróis (brancos) e lanternas (vermelhas): a cor do vértice é a da luz
  const luz = (w: number, h: number, d: number, x: number, y: number, z: number, cor: [number, number, number]) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
    g.deleteAttribute("uv");
    const n = g.getAttribute("position").count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set(cor, i * 3);
    g.setAttribute("color", new THREE.Float32BufferAttribute(a, 3));
    return g;
  };
  const yF = interp(pf.topo, F(L) - 0.1) - 0.07, yT = interp(pf.topo, -F(L) + 0.1) - 0.1;
  const luzes = mergeGeometries([
    ...[-1, 1].map((sz) => luz(0.22, 0.09, 0.36, F(L) - 0.1, yF, sz * (W / 2 - 0.3), [1, 0.97, 0.9])),
    ...[-1, 1].map((sz) => luz(0.14, 0.1, 0.38, -F(L) + 0.08, yT, sz * (W / 2 - 0.28), [0.85, 0.06, 0.04])),
  ])!;
  return { corpo: corpoG, escuro, luzes };
}
