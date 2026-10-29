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
  /** lente: abertura vertical (graus) e tilt-shift 0..1 */
  fov?: number;
  tilt?: number;
  /** folga mínima sobre o chão (m); sobre a rua o drone desce mais (não há casa) */
  folga?: number;
}

export interface Legenda {
  t0: number;
  t1: number;
  titulo: string;
  texto: string;
  /** capítulo do filme ("01", "02"…) */
  capitulo: string;
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
  /** lente da próxima chave (vale até mudar) */
  let lente: { fov: number; tilt: number; folga?: number } = { fov: 38, tilt: 0.45 };
  const por = (pos: V3, alvo: V3, segundos: number) => { t += segundos; chaves.push({ t, pos, alvo, ...lente }); };
  /** trecho com a velocidade de um drone (m/s), com folga mínima */
  const voar = (pos: V3, alvo: V3, vel: number, min = 2.5) => {
    const ult = chaves[chaves.length - 1];
    por(pos, alvo, Math.max(min, ult ? passo(ult.pos, pos) / vel : 0));
  };
  const legenda = (titulo: string, texto: string, dur: number) =>
    legendas.push({ t0: t + 0.6, t1: t + 0.6 + dur, titulo, texto, capitulo: String(legendas.length + 1).padStart(2, "0") });

  // --- 1. abertura: alto, o terreno de hoje vira o projeto
  let transformacao: [number, number] | undefined;
  if (abertura) {
    chaves.push({ t: 0, pos: orbita(-2.55, R * 2.5, 0.66), alvo: C, ...lente });
    por(orbita(-2.05, R * 2.2, 0.6), C, 6);
    transformacao = [1.2, 8.2];
    por(orbita(-1.55, R * 1.85, 0.52), C, 4.5);
  } else {
    chaves.push({ t: 0, pos: orbita(-1.9, R * 2.1, 0.58), alvo: C, ...lente });
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
    // descida: lente mais aberta, sem desfoque (é a tomada "de dentro")
    lente = { fov: 46, tilt: 0.1, folga: 6 };
    voar(P(s0 - 45, 42), P(s0 + 50, 2), 60, 3.4);
    const extras = [cena.arvores.length ? "calçadas arborizadas" : "calçadas", cena.postes.length ? "iluminação pública" : ""].filter(Boolean).join(" e ");
    legenda(`Ruas de ${fmt(rua.largura, rua.largura % 1 ? 1 : 0)} m`, `pista de ${fmt(cena.larguraPista, cena.larguraPista % 1 ? 1 : 0)} m, ${extras}`, 6.5);
    lente = { fov: 48, tilt: 0, folga: 4.5 };
    voar(P(s0 + (s1 - s0) * 0.35, 8), P(s0 + (s1 - s0) * 0.35 + 45, 2.5), 22, 3.6);
    // casa modelo: um sobrado de frente para esta rua, mais adiante; o drone passa rente à fachada
    const casa = casaNaRua(cena, eixo, rua.largura, s0 + (s1 - s0) * 0.35 + 50, Math.min(L - 22, s0 + 320));
    if (casa) {
      const { s, lado } = casa;
      const k = casa.casa;
      const alvoCasa = W(k.c, 3.6);
      const fora = (sd: number, h: number): V3 => {
        const { pt, dir } = pontoNaPolilinha(eixo, Math.max(0, Math.min(L, sd)));
        // do outro lado da pista, para enquadrar a fachada inteira
        const o = -lado * rua.largura * 0.18;
        return W([pt[0] - dir[1] * o, pt[1] + dir[0] * o], h);
      };
      lente = { fov: 40, tilt: 0.15, folga: 4.5 };
      voar(fora(s - 30, 8.5), alvoCasa, 16, 3.4);
      legenda("Casas simuladas", `padrão contemporâneo · ${k.andares > 1 ? "sobrado" : "térrea"} com recuo frontal de 4 m · ocupação ilustrativa`, 6);
      por(fora(s + 9, 7), alvoCasa, 5.5);
      lente = { fov: 42, tilt: 0.35, folga: 8 };
      voar(P(s + 30, 22), P(s + 90, 0), 22, 3.4);
    } else {
      voar(P(s1, 12), P(s1 + 40, 3), 24, 3.6);
    }
    lente = { fov: 38, tilt: 0.45 };
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
    lente = { fov: 38, tilt: 0.5 };
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

  // --- 5. o miolo: vista zenital girando devagar sobre a quadra mais central (efeito maquete)
  const qd = [...res.quadras].filter((x) => x.lotes.length >= 4)
    .sort((a, b) => dist(a.centro, cena.centro) - dist(b.centro, cena.centro))[0];
  if (qd) {
    const c = qd.centro;
    const ult = chaves[chaves.length - 1].pos;
    const [qx, qz] = m.xz(c);
    const ang = Math.atan2(ult[0] - qx, ult[2] - qz);
    const pt = (a: number, d: number, h: number): V3 => W([c[0] + Math.sin(a) * d, c[1] - Math.cos(a) * d], h);
    const alto = Math.max(95, Math.sqrt(qd.lotes.reduce((s2, l) => s2 + l.area, 0)) * 1.25);
    lente = { fov: 36, tilt: 0.9 };
    // a câmera chega quase na vertical (3 m de desvio: o "para cima" da tela gira com ele)
    voar(pt(ang, 3, alto), W(c, 0), 45, 3.2);
    const frentes = qd.lotes.map((l) => l.frente).sort((a, b) => a - b);
    legenda(`Quadra ${qd.nome}`, `${qd.lotes.length} lotes · frente de ${fmt(frentes[Math.floor(frentes.length / 2)], 0)} m · casas simuladas com recuo de 4 m`, 6);
    por(pt(ang + 0.35, 2.5, alto * 0.92), W(c, 0), 3.4);
    por(pt(ang + 0.7, 2.5, alto * 0.86), W(c, 0), 3.4);
  }

  // --- 6. sobe para a vista geral e respira
  const ult = chaves[chaves.length - 1].pos;
  const azF = Math.atan2(ult[0], ult[2]) + 0.6;
  lente = { fov: 36, tilt: 0.55 };
  voar(orbita(azF, R * 1.9, 0.62), C, 60, 4.5);
  const fimVoo = t;
  // respiro final: a câmera quase parada enquanto as luzes acendem (lente de volta à normal)
  lente = { fov: 42, tilt: 0.4 };
  por(orbita(azF + 0.3, R * 2.0, 0.64), C, 6);

  // folga: 9 m sobre o chão em todo o caminho (as casas têm até ~7 m; a curva entre
  // as chaves afunda, então mede-se a curva, não só as chaves)
  const chaoMundo = (x: number, z: number) => m.chao([x + cena.centro[0], -z + cena.centro[1]]);
  for (const k of chaves) k.pos[1] = Math.max(k.pos[1], chaoMundo(k.pos[0], k.pos[2]) + (k.folga ?? 9));
  const rot: Roteiro = { chaves, legendas, duracao: t, transformacao, voo: [inicioVoo, fimVoo] };
  for (let volta = 0; volta < 6; volta++) {
    let mexeu = false;
    for (let i = 0; i + 1 < chaves.length; i++) {
      let falta = 0;
      // entre duas chaves baixas (sobre a rua) vale a folga delas; senão os 9 m
      const fol = Math.max(chaves[i].folga ?? 9, chaves[i + 1].folga ?? 9);
      for (let s = 1; s < 24; s++) {
        const tt = chaves[i].t + ((chaves[i + 1].t - chaves[i].t) * s) / 24;
        const p = camNoTempo(rot, tt).pos;
        falta = Math.max(falta, chaoMundo(p[0], p[2]) + fol - p[1]);
      }
      if (falta > 0.05) { chaves[i].pos[1] += falta + 0.5; chaves[i + 1].pos[1] += falta + 0.5; mexeu = true; }
    }
    if (!mexeu) break;
  }
  return rot;
}

/** Posição, alvo e lente da câmera no tempo `t` (Catmull-Rom entre as chaves, com o tempo de cada trecho). */
export function camNoTempo(r: Roteiro, t: number): { pos: V3; alvo: V3; fov: number; tilt: number } {
  const ks = r.chaves;
  const lenteDe = (k: Chave) => ({ fov: k.fov ?? 38, tilt: k.tilt ?? 0 });
  if (t <= ks[0].t) return { pos: [...ks[0].pos], alvo: [...ks[0].alvo], ...lenteDe(ks[0]) };
  if (t >= ks[ks.length - 1].t) { const k = ks[ks.length - 1]; return { pos: [...k.pos], alvo: [...k.alvo], ...lenteDe(k) }; }
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
  // lente: troca suave (smoothstep) entre as chaves
  const a = lenteDe(ks[i]), b = lenteDe(ks[i + 1]), e = f * f * (3 - 2 * f);
  return { pos: cr((k) => k.pos), alvo: cr((k) => k.alvo), fov: a.fov + (b.fov - a.fov) * e, tilt: a.tilt + (b.tilt - a.tilt) * e };
}

type CasaDaCena = Cena["casas"][number];

/**
 * Sobrado (de preferência) com a fachada para o eixo da rua, entre `sMin` e
 * `sMax` (m ao longo do eixo). `lado`: de que lado do eixo a casa fica.
 */
export function casaNaRua(cena: Cena, eixo: Pt[], largura: number, sMin: number, sMax: number): { casa: CasaDaCena; s: number; lado: number } | null {
  if (sMax <= sMin) return null;
  const L = comprimento(eixo);
  const amostras: { s: number; p: Pt; d: Pt }[] = [];
  for (let s = 0; s <= L; s += 2) { const { pt, dir } = pontoNaPolilinha(eixo, s); amostras.push({ s, p: pt, d: dir }); }
  let melhor: { casa: CasaDaCena; s: number; lado: number; nota: number } | null = null;
  const meio = (sMin + sMax) / 2;
  for (const k of cena.casas) {
    if (k.lote < 0) continue;
    // fachada = c − esquerda(u)·prof/2
    const fr: Pt = [k.c[0] + k.u[1] * k.prof / 2, k.c[1] - k.u[0] * k.prof / 2];
    let a = amostras[0], dm = Infinity;
    for (const x of amostras) { const d = dist(x.p, fr); if (d < dm) { dm = d; a = x; } }
    if (a.s < sMin || a.s > sMax || dm > largura / 2 + 7) continue;
    // árvore da calçada na frente da fachada taparia a casa (a câmera passa baixo)
    if (cena.arvores.some((x) => dist(x.p, fr) < Math.max(7, k.larg / 2 + 3))) continue;
    // a fachada olha para o eixo: −esquerda(u) aponta para a rua
    const olha: Pt = [k.u[1], -k.u[0]];
    const para: Pt = [a.p[0] - k.c[0], a.p[1] - k.c[1]];
    if (olha[0] * para[0] + olha[1] * para[1] <= 0) continue;
    const lado = Math.sign(a.d[0] * (k.c[1] - a.p[1]) - a.d[1] * (k.c[0] - a.p[0])) || 1;
    const nota = Math.abs(a.s - meio) + (k.andares > 1 ? 0 : 60);
    if (!melhor || nota < melhor.nota) melhor = { casa: k, s: a.s, lado, nota };
  }
  return melhor && { casa: melhor.casa, s: melhor.s, lado: melhor.lado };
}

/** Legenda no ar em `t`, com a opacidade (entra e sai em 0,5 s). */
export function legendaNoTempo(r: Roteiro, t: number): { legenda: Legenda; alfa: number } | null {
  for (const l of r.legendas) {
    if (t < l.t0 || t > l.t1) continue;
    return { legenda: l, alfa: Math.min(1, (t - l.t0) / 0.5, (l.t1 - t) / 0.5) };
  }
  return null;
}
