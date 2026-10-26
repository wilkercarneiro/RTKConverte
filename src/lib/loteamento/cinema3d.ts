// Roteiro do voo de drone da maquete 3D — como o filme de lançamento de um
// loteamento: tomadas escolhidas a partir do próprio projeto (a rua de
// entrada, a maior área verde, o prédio institucional, uma quadra no miolo)
// e legendas com os números reais. Sem three.js: só posições e tempos.
//
// O mundo é o da maquete: x = leste, z = −norte, y = altura (já com o
// exagero); `xz` e `chao` vêm de quem desenha.
import type { Resultado } from "./calculo.ts";
import { fmt } from "./calculo.ts";
import type { Cena } from "./cena3d.ts";
import { areaPol, centroide, comprimento, dentroPol, dist, distAnel, pontoNaPolilinha } from "./geom.ts";
import type { Pt } from "./geom.ts";

export type V3 = [number, number, number];

export interface Chave {
  /** segundos desde o início */
  t: number;
  pos: V3;
  alvo: V3;
}

export interface Legenda {
  t0: number;
  t1: number;
  titulo: string;
  texto: string;
}

export interface Roteiro {
  chaves: Chave[];
  legendas: Legenda[];
  duracao: number;
  /** janela (s) da transformação hoje → projeto, se houver abertura */
  transformacao?: [number, number];
  /** janela (s) do voo propriamente dito (o timelapse do sol corre nela) */
  voo: [number, number];
}

export interface MundoRoteiro {
  res: Resultado;
  cena: Cena;
  raio: number;
  xz: (p: Pt) => [number, number];
  /** altura do chão no mundo (projeto pronto) */
  chao: (p: Pt) => number;
  /** proporção da tela (largura/altura): no celular em pé a câmera abre mais */
  aspecto: number;
}

const passo = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Monta o roteiro. `abertura`: começa no terreno de hoje com a transformação (a apresentação e o vídeo). */
export function roteiroDoVoo(m: MundoRoteiro, abertura: boolean): Roteiro {
  const { res, cena, raio: R } = m;
  const W = (p: Pt, h: number): V3 => { const [x, z] = m.xz(p); return [x, m.chao(p) + h, z]; };
  const yC = m.chao(cena.centro);
  const C: V3 = [0, yC, 0];
  const longe = m.aspecto < 0.8 ? 1.5 : 1;
  const orbita = (az: number, dist0: number, elev: number): V3 => {
    const d = dist0 * longe;
    return [Math.sin(az) * Math.cos(elev) * d, yC + Math.sin(elev) * d, Math.cos(az) * Math.cos(elev) * d];
  };
  const chaves: Chave[] = [];
  const legendas: Legenda[] = [];
  let t = 0;
  const por = (pos: V3, alvo: V3, segundos: number) => { t += segundos; chaves.push({ t, pos, alvo }); };
  /** trecho com a velocidade de um drone (m/s), com folga mínima */
  const voar = (pos: V3, alvo: V3, vel: number, min = 2.5) => {
    const ult = chaves[chaves.length - 1];
    por(pos, alvo, Math.max(min, ult ? passo(ult.pos, pos) / vel : 0));
  };
  const legenda = (titulo: string, texto: string, dur: number) => legendas.push({ t0: t + 0.6, t1: t + 0.6 + dur, titulo, texto });

  // --- 1. abertura: alto, o terreno de hoje vira o projeto
  let transformacao: [number, number] | undefined;
  if (abertura) {
    chaves.push({ t: 0, pos: orbita(-2.55, R * 2.5, 0.66), alvo: C });
    por(orbita(-2.05, R * 2.2, 0.6), C, 6);
    transformacao = [1.2, 8.2];
    por(orbita(-1.55, R * 1.85, 0.52), C, 4.5);
  } else {
    chaves.push({ t: 0, pos: orbita(-1.9, R * 2.1, 0.58), alvo: C });
    por(orbita(-1.5, R * 1.8, 0.5), C, 3);
  }
  const inicioVoo = t;
  const lotes = res.lotes;
  if (lotes.length) {
    const areas = lotes.map((l) => l.area).sort((a, b) => a - b);
    legenda(`${lotes.length} lotes`, `de ${fmt(areas[0], 0)} a ${fmt(areas[areas.length - 1], 0)} m² · ${res.quadras.length} quadras · ${fmt(res.quadro.gleba / 1e4, 2)} ha`, 4.2);
  }

  // --- 2. a rua de entrada: o drone desce e corre a 10 m do asfalto
  const ruas = [...res.ruas].filter((r) => comprimento(r.eixo) > 70).sort((a, b) => comprimento(b.eixo) - comprimento(a.eixo));
  const rua = ruas[0];
  if (rua) {
    // começa pela ponta que encosta na divisa (é por onde se chega)
    const a = rua.eixo[0], b = rua.eixo[rua.eixo.length - 1];
    const eixo = distAnel(a, res.gleba.ext) <= distAnel(b, res.gleba.ext) ? rua.eixo : [...rua.eixo].reverse();
    const L = comprimento(eixo);
    const s0 = Math.min(18, L * 0.08), s1 = Math.min(L - 25, s0 + 230);
    const P = (s: number, h: number, frente = 0): V3 => {
      const { pt, dir } = pontoNaPolilinha(eixo, Math.max(0, Math.min(L, s)));
      return W([pt[0] + dir[0] * frente, pt[1] + dir[1] * frente], h);
    };
    voar(P(s0 - 45, 42), P(s0 + 50, 2), 60, 3.4);
    const extras = [cena.arvores.length ? "calçadas arborizadas" : "calçadas", cena.postes.length ? "iluminação pública" : ""].filter(Boolean).join(" e ");
    legenda(`Ruas de ${fmt(rua.largura, rua.largura % 1 ? 1 : 0)} m`, `pista de ${fmt(cena.larguraPista, cena.larguraPista % 1 ? 1 : 0)} m, ${extras}`, 6.5);
    voar(P(s0 + (s1 - s0) * 0.35, 10), P(s0 + (s1 - s0) * 0.35 + 45, 2.5), 24, 3.6);
    voar(P(s1, 12), P(s1 + 40, 3), 24, 3.6);
  }

  // --- 3. a maior área verde: órbita baixa com as árvores
  const verdes = res.areas.filter((x) => (x.tipo === "verde" || x.tipo === "lazer") && x.area > 500)
    .flatMap((x) => x.pols.map((pol) => ({ pol, area: areaPol(pol) }))).sort((a, b) => b.area - a.area);
  const verde = verdes[0];
  if (verde) {
    const c = centroide(verde.pol.ext);
    const rg = Math.min(70, Math.sqrt(verde.area / Math.PI));
    const arvs = cena.arvores.filter((x) => dentroPol(x.p, verde.pol)).length;
    const ult = chaves[chaves.length - 1].pos;
    const [cx, cz] = m.xz(c);
    const a0 = Math.atan2(ult[0] - cx, ult[2] - cz);
    const pt = (a: number, d: number, h: number): V3 => { const p: Pt = [c[0] + Math.sin(a) * d, c[1] - Math.cos(a) * d]; return W(p, h); };
    const alvo = W(c, 2);
    voar(pt(a0, rg + 38, 30), alvo, 50, 3);
    legenda("Área verde", `${fmt(verde.area, 0)} m²${arvs ? ` · ${arvs} árvores` : ""} · praça e passeio para os moradores`, 6.5);
    por(pt(a0 + 0.9, rg + 30, 22), alvo, 3.2);
    por(pt(a0 + 1.8, rg + 34, 26), alvo, 3.2);
  }

  // --- 4. o prédio institucional: passa por cima
  const inst = cena.casas.find((x) => x.telhado === "laje");
  const areaInst = res.areas.filter((x) => x.tipo === "institucional").reduce((s, x) => s + x.area, 0);
  if (inst) {
    const ult = chaves[chaves.length - 1].pos;
    const [ix, iz] = m.xz(inst.c);
    const ang = Math.atan2(ult[0] - ix, ult[2] - iz);
    const pt = (a: number, d: number, h: number): V3 => W([inst.c[0] + Math.sin(a) * d, inst.c[1] - Math.cos(a) * d], h);
    const alvo = W(inst.c, 6);
    voar(pt(ang, 70, 34), alvo, 55, 3);
    legenda("Área institucional", `${fmt(areaInst, 0)} m² reservados para escola, creche ou posto de saúde`, 5.5);
    por(pt(ang + 1.2, 58, 30), alvo, 3.6);
  }

  // --- 5. o miolo: rasante sobre a quadra mais central
  const qd = [...res.quadras].filter((x) => x.lotes.length >= 4)
    .sort((a, b) => dist(a.centro, cena.centro) - dist(b.centro, cena.centro))[0];
  if (qd) {
    const c = qd.centro;
    const ult = chaves[chaves.length - 1].pos;
    const [qx, qz] = m.xz(c);
    const ang = Math.atan2(ult[0] - qx, ult[2] - qz);
    const pt = (a: number, d: number, h: number): V3 => W([c[0] + Math.sin(a) * d, c[1] - Math.cos(a) * d], h);
    voar(pt(ang, 85, 40), W(c, 0), 55, 3);
    const frentes = qd.lotes.map((l) => l.frente).sort((a, b) => a - b);
    legenda(`Quadra ${qd.nome}`, `${qd.lotes.length} lotes · frente de ${fmt(frentes[Math.floor(frentes.length / 2)], 0)} m · casas simuladas com recuo de 4 m`, 6);
    por(pt(ang + 1.0, 70, 32), W(c, 0), 3.8);
  }

  // --- 6. sobe para a vista geral e respira
  const ult = chaves[chaves.length - 1].pos;
  const azF = Math.atan2(ult[0], ult[2]) + 0.6;
  voar(orbita(azF, R * 1.9, 0.62), C, 60, 4.5);
  const fimVoo = t;
  // respiro final: a câmera quase parada enquanto as luzes acendem
  por(orbita(azF + 0.3, R * 2.0, 0.64), C, 6);

  // folga: 9 m sobre o chão em todo o caminho (as casas têm até ~7 m; a curva entre
  // as chaves afunda, então mede-se a curva, não só as chaves)
  const chaoMundo = (x: number, z: number) => m.chao([x + cena.centro[0], -z + cena.centro[1]]);
  for (const k of chaves) k.pos[1] = Math.max(k.pos[1], chaoMundo(k.pos[0], k.pos[2]) + 9);
  const rot: Roteiro = { chaves, legendas, duracao: t, transformacao, voo: [inicioVoo, fimVoo] };
  for (let volta = 0; volta < 6; volta++) {
    let mexeu = false;
    for (let i = 0; i + 1 < chaves.length; i++) {
      let falta = 0;
      for (let s = 1; s < 24; s++) {
        const tt = chaves[i].t + ((chaves[i + 1].t - chaves[i].t) * s) / 24;
        const p = camNoTempo(rot, tt).pos;
        falta = Math.max(falta, chaoMundo(p[0], p[2]) + 9 - p[1]);
      }
      if (falta > 0.05) { chaves[i].pos[1] += falta + 0.5; chaves[i + 1].pos[1] += falta + 0.5; mexeu = true; }
    }
    if (!mexeu) break;
  }
  return rot;
}

/** Posição e alvo da câmera no tempo `t` (Catmull-Rom entre as chaves, com o tempo de cada trecho). */
export function camNoTempo(r: Roteiro, t: number): { pos: V3; alvo: V3 } {
  const ks = r.chaves;
  if (t <= ks[0].t) return { pos: [...ks[0].pos], alvo: [...ks[0].alvo] };
  if (t >= ks[ks.length - 1].t) { const k = ks[ks.length - 1]; return { pos: [...k.pos], alvo: [...k.alvo] }; }
  let i = 0;
  while (i < ks.length - 2 && t > ks[i + 1].t) i++;
  const f = (t - ks[i].t) / (ks[i + 1].t - ks[i].t);
  const cr = (sel: (k: Chave) => V3): V3 => {
    const p0 = sel(ks[Math.max(0, i - 1)]), p1 = sel(ks[i]), p2 = sel(ks[i + 1]), p3 = sel(ks[Math.min(ks.length - 1, i + 2)]);
    const out: V3 = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const a = p0[c], b = p1[c], d = p2[c], e = p3[c];
      out[c] = b + 0.5 * f * (d - a + f * (2 * a - 5 * b + 4 * d - e + f * (3 * (b - d) + e - a)));
    }
    return out;
  };
  return { pos: cr((k) => k.pos), alvo: cr((k) => k.alvo) };
}

/** Legenda no ar em `t`, com a opacidade (entra e sai em 0,5 s). */
export function legendaNoTempo(r: Roteiro, t: number): { legenda: Legenda; alfa: number } | null {
  for (const l of r.legendas) {
    if (t < l.t0 || t > l.t1) continue;
    return { legenda: l, alfa: Math.min(1, (t - l.t0) / 0.5, (l.t1 - t) / 0.5) };
  }
  return null;
}
