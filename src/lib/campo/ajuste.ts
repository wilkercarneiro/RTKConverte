// "Ajustar a cerca" (Medir no campo): o maior ganho de precisão sem equipamento.
//
// Andando pela cerca, o modo Caminhar põe um vértice a cada 5 m, cada um com o
// ruído de UMA leitura. E o canto de verdade nunca é gravado: o vértice de
// "direção" só nasce alguns metros DEPOIS do canto, e o contorno sai chanfrado,
// sempre com área a menos.
//
// O ajuste:
//  1. a limpeza (simplificar.ts) acha os cantos: o que sobra do Douglas–Peucker;
//  2. cada lado (de um canto ao outro) ganha uma RETA MÉDIA de todos os vértices
//     dele — mínimos quadrados totais, ponderados por 1/precisão², com uma volta
//     robusta que tira o vértice que fugiu da reta;
//  3. lado curto entre dois cantos do Caminhar (o chanfro) sai: os lados
//     vizinhos se encontram num canto só;
//  4. o canto vira o CRUZAMENTO das retas vizinhas.
//
// O que foi marcado de propósito ("Marcar ponto aqui", tocado no mapa) não sai
// do lugar: a reta do lado passa por ele. O canto ajustado guarda a precisão do
// lado (a mediana das leituras: o ajuste não inventa precisão) e `ajustado`.
// Cantos que mudariam demais, contorno que passaria a se cruzar ou área que
// mudaria mais de 10%: o ajuste não é oferecido. Puro: a tela e os testes usam igual.
import { geoParaUtm, utmParaGeo } from "../exportar/coordenadas.ts";
import { aplicarDeslocamento } from "./calibracao.ts";
import { contornoSeCruza, fusoDaMedicao, medir } from "./geometria.ts";
import { limparLinhaReta, toleranciaPadrao } from "./simplificar.ts";
import type { VerticeCampo } from "./tipos.ts";

type XY = [number, number];

export interface AjusteCerca {
  vertices: VerticeCampo[];
  antes: number;
  depois: number;
  areaAntesM2: number;
  areaDepoisM2: number;
  /** quantos cantos foram recolocados no cruzamento das retas */
  cantosAjustados: number;
  /** o maior deslocamento de canto (m) */
  deslocMaxM: number;
}

interface Reta { c: XY; d: XY }

const mediana = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN;
};

/** Reta de mínimos quadrados totais ponderada (centro + direção unitária). */
function ajustarReta(pts: XY[], pesos: number[]): Reta {
  const W = pesos.reduce((s, w) => s + w, 0);
  const cx = pts.reduce((s, p, i) => s + p[0] * pesos[i], 0) / W;
  const cy = pts.reduce((s, p, i) => s + p[1] * pesos[i], 0) / W;
  let sxx = 0, syy = 0, sxy = 0;
  pts.forEach((p, i) => {
    const dx = p[0] - cx, dy = p[1] - cy;
    sxx += pesos[i] * dx * dx; syy += pesos[i] * dy * dy; sxy += pesos[i] * dx * dy;
  });
  // eixo principal
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { c: [cx, cy], d: [Math.cos(ang), Math.sin(ang)] };
}

const distReta = (p: XY, r: Reta): number => Math.abs((p[0] - r.c[0]) * r.d[1] - (p[1] - r.c[1]) * r.d[0]);

function cruzamento(a: Reta, b: Reta): XY | null {
  const den = a.d[0] * b.d[1] - a.d[1] * b.d[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b.c[0] - a.c[0]) * b.d[1] - (b.c[1] - a.c[1]) * b.d[0]) / den;
  return [a.c[0] + t * a.d[0], a.c[1] + t * a.d[1]];
}

const anguloEntre = (a: Reta, b: Reta): number =>
  (Math.acos(Math.min(1, Math.abs(a.d[0] * b.d[0] + a.d[1] * b.d[1]))) * 180) / Math.PI;

/** O contorno FECHADO com a cerca ajustada (retas médias por lado, cantos no cruzamento). */
export function ajustarCerca(vertices: VerticeCampo[]): AjusteCerca {
  const n = vertices.length;
  const md = medir(vertices);
  const igual: AjusteCerca = { vertices, antes: n, depois: n, areaAntesM2: md.areaM2, areaDepoisM2: md.areaM2, cantosAjustados: 0, deslocMaxM: 0 };
  if (n < 4 || !vertices.some((v) => v.modo === "caminhar")) return igual;

  // os cantos: a limpeza com uma tolerância da ordem da precisão (no celular o erro
  // "passeia" ±1 a 2 m ao longo da cerca e a tolerância da limpeza deixaria
  // zigue-zague como se fosse canto). Entre a da limpeza e 3 m.
  const precsT = vertices.map((v) => v.precisao).filter((p): p is number => p != null && Number.isFinite(p));
  const precT = precsT.length ? mediana(precsT) : 1;
  const tol = Math.min(3, Math.max(toleranciaPadrao(vertices), 0.8 * precT));
  const limpos = limparLinhaReta(vertices, tol).vertices;
  let cantos = limpos.map((v) => vertices.indexOf(v)).filter((i) => i >= 0).sort((a, b) => a - b);
  if (cantos.length < 3) return igual;

  const fuso = fusoDaMedicao(vertices);
  const xy = vertices.map((v) => geoParaUtm([v.lon, v.lat], fuso) as XY);
  const precs = vertices.map((v) => v.precisao).filter((p): p is number => p != null && Number.isFinite(p));
  const precMed = precs.length ? mediana(precs) : 1;
  const fixo = (i: number) => vertices[i].modo !== "caminhar";
  const peso = (i: number) => (fixo(i) ? 1e6 : 1 / Math.max(0.005, vertices[i].precisao ?? precMed) ** 2);

  // índices de um lado (do canto a ao canto b, dando a volta)
  const doLado = (a: number, b: number): number[] => {
    const out: number[] = [];
    for (let i = a; ; i = (i + 1) % n) { out.push(i); if (i === b && out.length > 1) break; }
    return out;
  };
  const retaDoLado = (idx: number[]): Reta => {
    // perto dos cantos, quem anda arredonda a esquina: esses vértices não são de
    // nenhuma das duas retas. Ficam de fora os que estão a menos de 5 m (ou 2× a
    // precisão) de cada ponta — no máximo 20% do lado de cada lado — se sobrarem 3+
    const a = xy[idx[0]], b = xy[idx[idx.length - 1]];
    const comp = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let usar = idx;
    if (comp > 0) {
      const margem = Math.min(0.2 * comp, Math.max(5, 2 * precMed));
      const ux = (b[0] - a[0]) / comp, uy = (b[1] - a[1]) / comp;
      const meio = idx.filter((i) => {
        if (fixo(i)) return true;
        const s = (xy[i][0] - a[0]) * ux + (xy[i][1] - a[1]) * uy;
        return s >= margem && s <= comp - margem;
      });
      if (meio.filter((i) => !fixo(i)).length >= 3) usar = meio;
    }
    let r = ajustarReta(usar.map((i) => xy[i]), usar.map(peso));
    // uma volta robusta: fora o que fugiu mais que 3 desvios (MAD) e mais que a precisão
    const res = usar.filter((i) => !fixo(i)).map((i) => distReta(xy[i], r));
    if (res.length >= 4) {
      const corte = Math.max(precMed, 3 * 1.4826 * mediana(res));
      const fica = usar.filter((i) => fixo(i) || distReta(xy[i], r) <= corte);
      if (fica.length >= 2 && fica.length < usar.length) { usar = fica; r = ajustarReta(usar.map((i) => xy[i]), usar.map(peso)); }
    }
    return r;
  };

  const lados = () => cantos.map((a, j) => doLado(a, cantos[(j + 1) % cantos.length]));
  const longeMax = Math.max(10, 4 * precMed);
  const posCanto = (j: number, retas: Reta[]): XY => {
    const i = cantos[j];
    if (fixo(i)) return xy[i];
    const m = cantos.length;
    const r1 = retas[(j - 1 + m) % m], r2 = retas[j];
    // retas que se cruzam em ângulo raso: o cruzamento fica instável (1° de erro na
    // direção leva o canto metros adiante). Abaixo de 30°, o vértice fica onde está
    if (anguloEntre(r1, r2) < 30) return xy[i];
    const x = cruzamento(r1, r2);
    if (!x || Math.hypot(x[0] - xy[i][0], x[1] - xy[i][1]) > longeMax) return xy[i];
    return x;
  };

  // Duas limpezas, repetidas até nada mudar (some um canto por vez, e as retas
  // são refeitas a cada volta):
  //  • lados quase alinhados: o "canto" entre duas retas que diferem pouco é o
  //    GPS passeando, não a cerca virando. O ângulo aceito cresce no lado curto
  //    (o mesmo passeio de ±2 m vira 5° num lado de 50 m e 17° num de 15 m):
  //    o maior entre 12° e atan(3 × precisão / lado mais curto), teto de 30°;
  //  • lado curto (até 4× a precisão, entre 7,5 m — 1,5 passo do Caminhar — e 15 m) entre dois cantos do
  //    Caminhar: é a esquina cortada (chanfro) ou dois "cantos" do mesmo passeio.
  //    Fica um canto só, que vira o encontro dos lados vizinhos.
  const comprimento = (a: number, b: number) => Math.hypot(xy[b][0] - xy[a][0], xy[b][1] - xy[a][1]);
  const curto = Math.min(15, Math.max(7.5, 4 * precMed));
  for (let volta = 0; volta < 2 * n && cantos.length > 3; volta++) {
    const retas = lados().map(retaDoLado);
    const m = cantos.length;
    let alvo = -1, folga = 0;
    for (let j = 0; j < m; j++) {
      if (fixo(cantos[j])) continue;
      const ladoMin = Math.min(comprimento(cantos[(j - 1 + m) % m], cantos[j]), comprimento(cantos[j], cantos[(j + 1) % m]));
      const limite = Math.min(30, Math.max(12, (Math.atan2(3 * precMed, Math.max(1, ladoMin)) * 180) / Math.PI));
      const f = limite - anguloEntre(retas[(j - 1 + m) % m], retas[j]);
      if (f > folga) { folga = f; alvo = j; }
    }
    if (alvo >= 0) { cantos = cantos.filter((_, j) => j !== alvo); continue; }
    let menor = Infinity;
    for (let j = 0; j < m; j++) {
      const a = cantos[j], b = cantos[(j + 1) % m];
      if (fixo(a) || fixo(b)) continue;
      const comp = comprimento(a, b);
      if (comp >= curto || comp >= menor) continue;
      alvo = j; menor = comp;
    }
    if (alvo < 0) break;
    // o lado alvo some: fica o canto do começo dele, que passa a ser o encontro dos vizinhos
    cantos = cantos.filter((_, j) => j !== (alvo + 1) % m);
  }

  const retas = lados().map(retaDoLado);
  let deslocMaxM = 0, ajustados = 0;
  const saida = cantos.map((i, j) => {
    const p = posCanto(j, retas);
    const d = Math.hypot(p[0] - xy[i][0], p[1] - xy[i][1]);
    const v = vertices[i];
    if (d < 0.005) return v;
    deslocMaxM = Math.max(deslocMaxM, d);
    ajustados++;
    const [lon, lat] = utmParaGeo(p, fuso);
    const novo: VerticeCampo = { ...v, lon, lat, ajustado: true, precisao: v.precisao == null ? null : Math.max(v.precisao, precMed) };
    // o bruto (sem calibração) acompanha o canto novo: recalibrar continua certo
    if (v.correcao) novo.bruto = aplicarDeslocamento({ lon, lat }, { dE: -v.correcao.dE, dN: -v.correcao.dN });
    else delete novo.bruto;
    return novo;
  });

  if (saida.length < 3 || contornoSeCruza(saida)) return igual;
  const areaDepoisM2 = medir(saida).areaM2;
  if (md.areaM2 > 0 && Math.abs(areaDepoisM2 - md.areaM2) / md.areaM2 > 0.1) return igual;
  if (saida.length === n && ajustados === 0) return igual;
  return { vertices: saida, antes: n, depois: saida.length, areaAntesM2: md.areaM2, areaDepoisM2, cantosAjustados: ajustados, deslocMaxM };
}

/** Vale oferecer? Saíram 5+ vértices (e 20%), ou algum canto foi recolocado. */
export function valeAjustar(a: AjusteCerca): boolean {
  const tirados = a.antes - a.depois;
  return (tirados >= 5 && tirados >= a.antes * 0.2) || a.cantosAjustados > 0;
}
