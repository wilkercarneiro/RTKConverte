// Loteamento pronto (DXF, KML/KMZ, GeoJSON) → projeto do sistema.
//
// O arquivo vira o MESMO modelo do loteamento gerado aqui, para a prancheta, a
// edição, as entregas e o servidor continuarem funcionando sem caso especial:
//   • cada quadra vira uma `QuadraCfg` desenhada à mão (`lotes` = os anéis UTM
//     do arquivo, na ordem da numeração dele; `LoteDesenhado.numero` quando a
//     numeração não é 1..n);
//   • as áreas públicas viram `AreaDesenhada`;
//   • o viário é o que sobra: gleba − (quadras ∪ áreas), repartido em ruas com
//     o corpo pronto (`Rua.corpo`); o eixo, quando o arquivo traz;
//   • a terra larga demais para ser rua e sem nada desenhado (o arquivo cobre só
//     parte da gleba) fica como área remanescente (quadra sem lote).
// O cálculo (calculo.ts) reconhece o projeto importado (`Projeto.importado`) e
// não parte nem arredonda essas quadras: a área de cada lote sai igual à do
// arquivo.
//
// Tudo é feito num plano local (UTM menos o centro da gleba, sem fator de
// escala) — o mesmo do cálculo com "medidas de terreno" desligado, que é como o
// projeto importado fica: as áreas são as do CAD, no plano UTM.
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../../../supabase/functions/_shared/geo.ts";
import {
  antiHorario, areaAssinada, areaPol, bufferLinha, caixa, centroide, cross, dentroPol, diferenca, dist, distSegmento,
  intersecao, limparAnel, offsetPols, perimetro as perimetroAnel, quinasAviso, recortarLinha, sub, uniao, uniaoFechada, unit,
} from "../geom.ts";
import type { Poligono, Pt } from "../geom.ts";
import { calcular, fmt, frentePrincipal, letraQuadra, profundidadeDe } from "../calculo.ts";
import type { Perimetro, Resultado } from "../calculo.ts";
import { criarPlano, paraPlano, paraUtm } from "../plano.ts";
import { completarFaixas } from "../modelo.ts";
import type { AreaDesenhada, LoteDesenhado, Parametros, Projeto, QuadraCfg, Rua, TipoArea } from "../modelo.ts";
import { pontoInterno } from "../auto.ts";
import { nomeDaArea, nomeDaQuadra, nomeDaRua, numeroDoLote } from "./texto.ts";
import type { Classe, PapelTexto } from "./texto.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

/** Uma feição do arquivo, já em UTM do fuso do serviço. */
export interface Feicao {
  geo: "poligono" | "linha" | "texto";
  /** UTM: contorno sem repetir o 1º ponto, linha, ou [ponto do texto] */
  pts: Pt[];
  classe: Classe;
  /** de onde a classe veio (camada do DXF, pasta do KML…), para os avisos */
  origem: string;
  /** texto do DXF / rótulo do Placemark / propriedade */
  texto?: string;
  papel?: PapelTexto;
  altura?: number;
  /** rotação do texto (graus): o nome da rua vai deitado ao longo dela */
  rot?: number;
  /** o rótulo é o do próprio objeto (KML/GeoJSON): "A-01" é quadra A, lote 1 */
  curto?: boolean;
  numero?: number;
  quadra?: string;
  nome?: string;
}

export interface DesenhoImportado {
  arquivo: string;
  formato: "DXF" | "KML" | "KMZ" | "GeoJSON";
  feicoes: Feicao[];
  avisos: string[];
  /** coordenadas projetadas como vieram (DXF, GeoJSON em UTM): podem estar noutro fuso */
  projetado: boolean;
}

export interface ResumoImportacao {
  gleba: number;
  quadras: number;
  lotes: number;
  areaLotes: number;
  viario: number;
  ruas: number;
  verde: number;
  institucional: number;
  app: number;
  remanescente: number;
  publicas: { nome: string; tipo: TipoArea; area: number }[];
}

export interface Importacao {
  projeto: Projeto;
  res: Resultado;
  resumo: ResumoImportacao;
  avisos: string[];
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
const somaArea = (pgs: Poligono[]) => pgs.reduce((s, x) => s + areaPol(x), 0);
const maiorPeca = (pgs: Poligono[]) => [...pgs].sort((a, b) => areaPol(b) - areaPol(a))[0];
const perimetroPol = (pg: Poligono) => perimetroAnel(pg.ext) + pg.furos.reduce((s, f) => s + perimetroAnel(f), 0);
/** espessura média: 2 × área ÷ perímetro (a largura de uma faixa comprida) */
const espessura = (pg: Poligono) => (2 * areaPol(pg)) / Math.max(1e-9, perimetroPol(pg));
const caixaSobrepoe = (a: { min: Pt; max: Pt }, b: { min: Pt; max: Pt }, folga = 0) =>
  a.min[0] <= b.max[0] + folga && a.max[0] >= b.min[0] - folga && a.min[1] <= b.max[1] + folga && a.max[1] >= b.min[1] - folga;

/** Índice de polígonos por grade (a pergunta "em que lote está este ponto?" é feita milhares de vezes). */
class Grade {
  private cel = new Map<string, number[]>();
  private pols: Poligono[];
  private tam: number;
  constructor(pols: Poligono[], tam = 30) {
    this.pols = pols;
    this.tam = tam;
    pols.forEach((pg, i) => {
      const b = caixa(pg.ext);
      for (let x = Math.floor(b.min[0] / tam); x <= Math.floor(b.max[0] / tam); x++) {
        for (let y = Math.floor(b.min[1] / tam); y <= Math.floor(b.max[1] / tam); y++) {
          const k = `${x},${y}`;
          const l = this.cel.get(k);
          if (l) l.push(i); else this.cel.set(k, [i]);
        }
      }
    });
  }
  achar(p: Pt): number[] {
    return (this.cel.get(`${Math.floor(p[0] / this.tam)},${Math.floor(p[1] / this.tam)}`) ?? []).filter((i) => dentroPol(p, this.pols[i]));
  }
}

/**
 * Largura típica de uma faixa de rua: do meio de cada lado dela, quanto se anda
 * para dentro até o outro lado do viário (mediana pelo comprimento). O raio
 * bate no contorno do viário INTEIRO (`viario`): o corte entre duas ruas no
 * cruzamento não conta como lado.
 */
export function larguraTipica(pgs: Poligono[], viario: Poligono[] = pgs): number {
  const arestasDe = (ps: Poligono[]) => { const out: [Pt, Pt][] = []; for (const pg of ps) for (const an of [pg.ext, ...pg.furos]) for (let i = 0; i < an.length; i++) out.push([an[i], an[(i + 1) % an.length]]); return out; };
  const proprias = arestasDe(pgs);
  const arestas = viario === pgs ? proprias : arestasDe(viario);
  const naBorda = (m: Pt) => viario === pgs || arestas.some(([c, e]) => distSegmento(m, c, e).d < 0.01);
  const amostras: { w: number; peso: number }[] = [];
  const dentro = (p: Pt) => viario.some((pg) => dentroPol(p, pg));
  // um raio a cada 2 m do lado (o lado comprido da rua passa pela boca da rua que cruza),
  // até uns 240 raios por rua (loteamento grande não trava a importação)
  const passo = Math.max(2, proprias.reduce((s, [a, b]) => s + dist(a, b), 0) / 240);
  for (const [a, b] of proprias) {
    const L = dist(a, b);
    if (L < 1) continue;
    const d = unit(sub(b, a));
    const n0 = Math.max(1, Math.round(L / passo));
    for (let k = 0; k < n0; k++) {
      const t0 = (k + 0.5) / n0;
      const m: Pt = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      if (!naBorda(m)) continue;
      let n: Pt = [-d[1], d[0]];
      if (!dentro([m[0] + n[0] * 0.02, m[1] + n[1] * 0.02])) n = [d[1], -d[0]];
      let melhor = Infinity;
      for (const [c, e] of arestas) {
        const s = sub(e, c);
        const den = cross(n, s);
        if (Math.abs(den) < 1e-12) continue;
        const w = sub(c, m);
        const t = cross(w, s) / den, u = cross(w, n) / den;
        if (t > 0.05 && u >= 0 && u <= 1 && t < melhor) melhor = t;
      }
      if (Number.isFinite(melhor) && melhor < 200) amostras.push({ w: melhor, peso: L / n0 });
    }
  }
  if (!amostras.length) return Math.max(1, Math.round(espessura(pgs[0] ?? { ext: [], furos: [] }) * 100) / 100);
  amostras.sort((x, y) => x.w - y.w);
  const total = amostras.reduce((s, x) => s + x.peso, 0);
  let acc = 0;
  for (const x of amostras) { acc += x.peso; if (acc >= total / 2) return Math.round(x.w * 100) / 100; }
  return Math.round(amostras[amostras.length - 1].w * 100) / 100;
}

/** Polígono → anéis UTM do corpo da rua (contorno anti-horário, furo horário). */
function aneisUtm(pgs: Poligono[], U: (p: Pt) => Pt): Pt[][] {
  const out: Pt[][] = [];
  for (const pg of pgs) {
    out.push(antiHorario(pg.ext).map(U));
    for (const f of pg.furos) out.push([...antiHorario(f)].reverse().map(U));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Georreferência
// ---------------------------------------------------------------------------

/** Quantas feições de polígono caem na gleba (ou a até 30 m dela). */
function quantasNaGleba(fs: Feicao[], gleba: Poligono, L: (p: Pt) => Pt): number {
  const bb = caixa(gleba.ext);
  let n = 0;
  for (const f of fs) {
    if (f.geo !== "poligono" || f.pts.length < 3) continue;
    const c = L(centroide(f.pts));
    if (c[0] < bb.min[0] - 30 || c[0] > bb.max[0] + 30 || c[1] < bb.min[1] - 30 || c[1] > bb.max[1] + 30) continue;
    if (dentroPol(c, gleba) || gleba.ext.some((p, i) => distSegmento(c, p, gleba.ext[(i + 1) % gleba.ext.length]).d < 30)) n++;
  }
  return n;
}

function trocarFuso(fs: Feicao[], de: number, para: number): Feicao[] {
  const a = utmDef(de), b = utmDef(para);
  const conv = (p: Pt): Pt => { try { return proj(GEO_DEF, b, proj(a, GEO_DEF, p)); } catch { return [NaN, NaN]; } };
  return fs.map((f) => ({ ...f, pts: f.pts.map(conv) }));
}

/**
 * O desenho tem de estar sobre a gleba do serviço. DXF/GeoJSON no fuso vizinho
 * é convertido (com aviso); coordenadas locais ou de outro lugar são recusadas
 * com o motivo.
 */
function georreferenciar(d: DesenhoImportado, gleba: Poligono, L: (p: Pt) => Pt, fuso: number, avisos: string[]): Feicao[] {
  const pols = d.feicoes.filter((f) => f.geo === "poligono" && f.pts.length >= 3);
  if (!pols.length) {
    throw new Error(d.formato === "DXF"
      ? "Não achei nenhum polígono fechado no DXF. Os lotes precisam ser polilinhas fechadas (LWPOLYLINE/POLYLINE com \"fechada\" marcada) ou linhas que se encontram nas quinas."
      : `Não achei nenhum polígono no ${d.formato}. Os lotes precisam ser polígonos.`);
  }
  if (quantasNaGleba(pols, gleba, L)) return d.feicoes;
  if (d.projetado) {
    for (const f of [fuso - 1, fuso + 1]) {
      if (f < 18 || f > 25) continue;
      const conv = trocarFuso(d.feicoes, f, fuso);
      if (quantasNaGleba(conv.filter((x) => x.geo === "poligono"), gleba, L)) {
        avisos.push(`As coordenadas do arquivo estavam no fuso ${f} e foram convertidas para o fuso ${fuso} do serviço.`);
        return conv;
      }
    }
  }
  const todos = pols.flatMap((f) => f.pts);
  const cb = caixa(todos);
  if (d.projetado && Math.max(Math.abs(cb.min[0]), Math.abs(cb.max[0]), Math.abs(cb.min[1]), Math.abs(cb.max[1])) < 100000) {
    throw new Error(`O desenho está em coordenadas locais (perto de 0,0), não em UTM. Exporte o ${d.formato} georreferenciado em SIRGAS 2000 / UTM fuso ${fuso}S e importe de novo.`);
  }
  const c = L([(cb.min[0] + cb.max[0]) / 2, (cb.min[1] + cb.max[1]) / 2]);
  const km = Number.isFinite(c[0]) ? Math.hypot(c[0], c[1]) / 1000 : NaN;
  throw new Error(`O loteamento do arquivo não cai na gleba deste serviço${Number.isFinite(km) ? ` (fica a ${fmt(km, km < 10 ? 1 : 0)} km dela)` : ""}. ${d.projetado ? `Confira se o arquivo está em SIRGAS 2000 / UTM fuso ${fuso}S` : "Confira se o arquivo é deste imóvel"} — ou se é a gleba certa.`);
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

interface PolArq { pol: Poligono; f: Feicao; classe: Classe; area: number; caixa: { min: Pt; max: Pt } }
interface TextoArq { f: Feicao; p: Pt }
interface LoteArq {
  pol: Poligono;
  /** ordem no arquivo (desempate e avisos) */
  k: number;
  numero?: number;
  quadra?: string;
  /** número escolhido do texto/rótulo: de onde veio (prioridade) */
  prio: number;
  grupo: number;
}

const AREA_DA_CLASSE: Partial<Record<Classe, TipoArea>> = { verde: "verde", lazer: "lazer", institucional: "institucional", app: "app" };

/**
 * Monta o projeto a partir do desenho. `base` é o projeto do serviço (as
 * respostas das Perguntas: lados do terreno, relevo, infraestrutura): fica tudo,
 * menos ruas, áreas e quadras, que passam a ser as do arquivo.
 */
export function montarLoteamento(d: DesenhoImportado, base: Projeto, perimetro: Perimetro, fuso: number): Importacao {
  const avisos: string[] = [...d.avisos];
  const plano = criarPlano(perimetro.pts, perimetro.altitudes, false);
  const L = (p: Pt) => paraPlano(plano, p);
  const U = (p: Pt) => paraUtm(plano, p);
  const gleba: Poligono = { ext: antiHorario(perimetro.pts.map(L)), furos: [] };
  const areaGleba = areaPol(gleba);
  const feicoes = georreferenciar(d, gleba, L, fuso, avisos);

  // ---------------------------------------------------------------- polígonos, linhas e textos no plano
  const pols: PolArq[] = [];
  let tortos = 0;
  for (const f of feicoes) {
    if (f.geo !== "poligono" || f.pts.length < 3) continue;
    const ext = limparAnel(f.pts.map(L), 0.0005);
    if (ext.length < 3 || Math.abs(areaAssinada(ext)) < 0.05) continue;
    // o contorno que se cruza (o "laço" do CAD) é desfeito: fica o maior pedaço
    const norm = uniao([{ ext: antiHorario(ext), furos: [] }]).filter((x) => areaPol(x) > 0.01);
    if (!norm.length) continue;
    if (norm.length > 1) tortos++;
    const pol = maiorPeca(norm);
    pols.push({ pol: { ext: pol.ext, furos: [] }, f, classe: f.classe, area: areaPol({ ext: pol.ext, furos: [] }), caixa: caixa(pol.ext) });
  }
  if (tortos) avisos.push(`${tortos} polígono(s) do arquivo se cruzavam (laço no contorno): ficou o maior pedaço de cada um.`);
  const textos: TextoArq[] = feicoes.filter((f) => f.geo === "texto" && f.texto).map((f) => ({ f, p: L(f.pts[0]) }));
  const linhas = feicoes.filter((f) => f.geo === "linha" && f.pts.length >= 2).map((f) => ({ f, pts: f.pts.map(L) }));

  // ---------------------------------------------------------------- classe pelo texto de dentro e pela posição
  // (camada desconhecida: o texto "ÁREA VERDE" de dentro diz a área; o polígono do tamanho da gleba é o perímetro;
  // o que contém outros é quadra; o que está dentro de uma quadra ou encosta em lote é lote)
  for (const p of pols) {
    if (p.classe !== "?" && p.classe !== "nada") continue;
    const dentro = textos.filter((t) => t.p[0] >= p.caixa.min[0] && t.p[0] <= p.caixa.max[0] && t.p[1] >= p.caixa.min[1] && t.p[1] <= p.caixa.max[1] && dentroPol(t.p, p.pol));
    const area = dentro.map((t) => nomeDaArea(t.f.texto!)).find(Boolean);
    if (area && p.classe === "?") { p.classe = area.classe; p.f = { ...p.f, nome: p.f.nome ?? area.nome }; continue; }
    if (p.classe === "?" && p.area > 0.6 * areaGleba) p.classe = "contorno";
  }
  const contem = (a: PolArq, b: PolArq) => a !== b && a.area > b.area && caixaSobrepoe(a.caixa, b.caixa) && dentroPol(pontoInterno(b.pol), a.pol)
    && somaArea(intersecao([b.pol], [a.pol])) > 0.95 * b.area;
  const desconhecidos = pols.filter((p) => p.classe === "?");
  if (desconhecidos.length) {
    for (const p of desconhecidos) if (pols.filter((q) => q.classe !== "contorno" && contem(p, q)).length >= 2) p.classe = "quadra";
    const quadras0 = pols.filter((p) => p.classe === "quadra");
    for (const p of desconhecidos) if (p.classe === "?" && quadras0.some((q) => contem(q, p))) p.classe = "lote";
    // encosta (lado em comum de 50 cm ou mais) num lote — repete até parar de crescer
    const encosta = (a: PolArq, b: PolArq) => caixaSobrepoe(a.caixa, b.caixa, 0.05) && (perimetroPol(a.pol) + perimetroPol(b.pol) - perimetroPol(maiorPeca(uniaoFechada([a.pol, b.pol], 0.025)) ?? a.pol)) / 2 > 0.5;
    for (let volta = 0; volta < 50; volta++) {
      let mudou = false;
      for (const p of desconhecidos) {
        if (p.classe !== "?") continue;
        if (pols.some((q) => q.classe === "lote" && encosta(p, q))) { p.classe = "lote"; mudou = true; }
      }
      if (!mudou) break;
    }
    // sem nenhum lote na camada certa: os desconhecidos que se encostam entre si (de tamanho parecido) são os lotes
    if (!pols.some((p) => p.classe === "lote")) {
      for (const p of desconhecidos) {
        if (p.classe !== "?") continue;
        if (desconhecidos.some((q) => q !== p && (q.classe === "?" || q.classe === "lote") && q.area < 10 * p.area && p.area < 10 * q.area && encosta(p, q))) p.classe = "lote";
      }
    }
    const sobrou = desconhecidos.filter((p) => p.classe === "?");
    if (sobrou.length) {
      const porCamada = new Map<string, number>();
      for (const p of sobrou) porCamada.set(p.f.origem, (porCamada.get(p.f.origem) ?? 0) + 1);
      avisos.push(`${sobrou.length} polígono(s) não foram reconhecidos e ficaram de fora (${[...porCamada].map(([c, n]) => `${n} em "${c}"`).join(", ")}). Se forem lotes, ponha-os numa camada LOTE (ou QUADRA, AREA_VERDE…) e importe de novo.`);
    }
  }

  // ---------------------------------------------------------------- contorno do arquivo × gleba
  const contorno = pols.filter((p) => p.classe === "contorno").sort((a, b) => b.area - a.area)[0];
  if (contorno) {
    const dif = somaArea(diferenca([contorno.pol], [gleba])) + somaArea(diferenca([gleba], [contorno.pol]));
    if (dif > Math.max(50, 0.01 * areaGleba)) {
      avisos.push(`O perímetro do arquivo difere da gleba do serviço em ${fmt(dif)} m² (${fmt((100 * dif) / areaGleba, 1)}% da área). Vale a gleba do serviço: o que passa dela foi recortado.`);
    }
  }

  // ---------------------------------------------------------------- lotes: dentro da gleba e sem sobreposição
  const lotes: LoteArq[] = [];
  let foraTotal = 0, recortados = 0, foraArea = 0, repetidos = 0;
  const vistos = new Set<string>();
  for (const [k, p] of pols.filter((x) => x.classe === "lote").entries()) {
    const assinatura = p.pol.ext.map((q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`).sort().join(";");
    if (vistos.has(assinatura)) { repetidos++; continue; }
    vistos.add(assinatura);
    const dentro = intersecao([p.pol], [gleba]).filter((x) => areaPol(x) > 0.05);
    const aDentro = somaArea(dentro);
    if (aDentro < Math.min(1, 0.05 * p.area)) { foraTotal++; continue; }
    let pol = p.pol;
    if (p.area - aDentro > 0.01) { recortados++; foraArea += p.area - aDentro; pol = maiorPeca(dentro); }
    lotes.push({ pol, k, numero: p.f.numero, quadra: p.f.quadra, prio: p.f.numero !== undefined ? 3 : 0, grupo: -1 });
  }
  if (repetidos) avisos.push(`${repetidos} lote(s) apareciam duas vezes no arquivo (o mesmo contorno): ficou um de cada.`);
  if (foraTotal) avisos.push(`${foraTotal} lote(s) do arquivo ficam fora da gleba do serviço e não entraram.`);
  // (o recorte de centímetro quadrado é arredondamento do CAD na divisa: recorta calado)
  if (recortados && foraArea >= 0.05) avisos.push(`${recortados} lote(s) passavam da gleba do serviço e foram recortados por ela (${fmt(foraArea)} m² no total ficaram de fora).`);
  if (!lotes.length) throw new Error("Não achei lotes no arquivo. Os lotes precisam ser polígonos fechados numa camada LOTE (ou dentro de uma quadra).");
  // sobreposição: o lote que vem depois no arquivo cede
  const sobrepostos: [number, number, number][] = [];
  for (let i = 0; i < lotes.length; i++) {
    const bi = caixa(lotes[i].pol.ext);
    for (let j = 0; j < i; j++) {
      if (!caixaSobrepoe(bi, caixa(lotes[j].pol.ext))) continue;
      const a = somaArea(intersecao([lotes[i].pol], [lotes[j].pol]));
      if (a <= 0.05) continue;
      const resto = diferenca([lotes[i].pol], [lotes[j].pol]).filter((x) => areaPol(x) > 0.05);
      if (!resto.length) break;
      lotes[i].pol = { ext: limparAnel(maiorPeca(resto).ext, 0.0005), furos: [] };
      sobrepostos.push([i, j, a]);
    }
  }
  const lotesValidos = lotes.filter((l) => areaPol(l.pol) > 0.5);
  const uniaoLotes = uniao(lotesValidos.map((l) => l.pol));

  // ---------------------------------------------------------------- áreas públicas (e o remanescente desenhado)
  const areas: { tipo: TipoArea; nome?: string; pol: Poligono }[] = [];
  const remanescentesArq: Poligono[] = [];
  let ocupado = [...uniaoLotes];
  let areaSobreLote = 0;
  for (const p of pols) {
    const tipo = AREA_DA_CLASSE[p.classe];
    if (!tipo && p.classe !== "remanescente") continue;
    let pecas = intersecao([p.pol], [gleba]);
    const antes = somaArea(pecas);
    pecas = diferenca(pecas, ocupado).filter((x) => areaPol(x) > 1);
    const sobreLote = antes - somaArea(pecas);
    if (sobreLote > 0.5) areaSobreLote += sobreLote;
    for (const pc of pecas) {
      const pg: Poligono = { ext: limparAnel(pc.ext, 0.0005), furos: [] };
      if (tipo) areas.push({ tipo, nome: p.f.nome, pol: pg }); else remanescentesArq.push(pg);
    }
    ocupado = uniao([...ocupado, ...pecas]);
  }
  if (areaSobreLote > 0.5) avisos.push(`Áreas públicas do arquivo passavam por cima de lotes (${fmt(areaSobreLote)} m²): o lote ficou com a terra e a área foi recortada.`);
  const textosLivres = textos.filter((t) => t.f.papel !== "nada");
  // nome da área pelo texto de dentro dela
  for (const a of areas) {
    if (a.nome) continue;
    const t = textosLivres.find((x) => dentroPol(x.p, a.pol) && nomeDaArea(x.f.texto!));
    if (t) a.nome = nomeDaArea(t.f.texto!)!.nome;
  }

  // ---------------------------------------------------------------- número de cada lote (texto de dentro ou rótulo do objeto)
  const grade = new Grade(lotesValidos.map((l) => l.pol));
  const rotuloDe = new Map<LoteArq, { numero: number; quadra?: string; nota: number }>();
  for (const t of textosLivres) {
    if (t.f.papel !== "lote" && t.f.papel !== "?") continue;
    const r = numeroDoLote(t.f.texto!, !!t.f.curto);
    if (!r) continue;
    for (const i of grade.achar(t.p)) {
      const l = lotesValidos[i];
      if (l.prio >= 3) continue;
      // camada de lote vale mais; depois o texto maior; depois o mais perto do meio do lote
      const nota = (t.f.papel === "lote" ? 1e6 : 0) + (t.f.altura ?? 1) * 1e3 - dist(t.p, pontoInterno(l.pol));
      const atual = rotuloDe.get(l);
      if (!atual || nota > atual.nota) rotuloDe.set(l, { ...r, nota });
    }
  }
  for (const [l, r] of rotuloDe) { l.numero = r.numero; l.quadra ??= r.quadra; l.prio = 2; }

  // ---------------------------------------------------------------- quadras: a do arquivo ou os lotes que se encostam
  const quadrasArq = pols.filter((p) => p.classe === "quadra");
  interface GrupoQ { lotes: LoteArq[]; poligono?: PolArq; nome?: string }
  const grupos: GrupoQ[] = quadrasArq.map((q) => ({ lotes: [], poligono: q, nome: q.f.quadra ?? (q.f.texto ? nomeDaQuadra(q.f.texto) ?? undefined : undefined) ?? (q.f.nome ? nomeDaQuadra(q.f.nome) ?? undefined : undefined) }));
  const semQuadra: LoteArq[] = [];
  for (const l of lotesValidos) {
    const a = areaPol(l.pol);
    let melhor = -1, mx = 0.5 * a;
    grupos.forEach((g, gi) => {
      if (!g.poligono || !caixaSobrepoe(caixa(l.pol.ext), g.poligono.caixa)) return;
      const ov = somaArea(intersecao([l.pol], [g.poligono.pol]));
      if (ov > mx) { mx = ov; melhor = gi; }
    });
    if (melhor >= 0) { grupos[melhor].lotes.push(l); l.grupo = melhor; } else semQuadra.push(l);
  }
  // lote sem polígono de quadra: quadra pela quadra dita no rótulo ("A-01") ou pelos lotes que se encostam
  if (semQuadra.length) {
    const blocos = uniaoFechada(semQuadra.map((l) => l.pol), 0.025);
    const porBloco = new Map<number, LoteArq[]>();
    for (const l of semQuadra) {
      const c = pontoInterno(l.pol);
      let bi = blocos.findIndex((b) => dentroPol(c, b));
      if (bi < 0) bi = blocos.map((b, i) => ({ i, d: Math.min(...b.ext.map((q, j) => distSegmento(c, q, b.ext[(j + 1) % b.ext.length]).d)) })).sort((x, y) => x.d - y.d)[0]?.i ?? 0;
      porBloco.set(bi, [...(porBloco.get(bi) ?? []), l]);
    }
    for (const ls of porBloco.values()) {
      // o rótulo diz quadras diferentes no mesmo bloco (duas quadras encostadas): uma quadra por nome
      const nomes = new Set(ls.map((l) => l.quadra).filter(Boolean));
      if (nomes.size > 1) {
        for (const n of nomes) grupos.push({ lotes: ls.filter((l) => l.quadra === n), nome: n });
        const sem = ls.filter((l) => !l.quadra);
        if (sem.length) grupos.push({ lotes: sem });
      } else grupos.push({ lotes: ls });
    }
  }
  const comLotes = grupos.filter((g) => g.lotes.length);
  const quadrasVazias = grupos.filter((g) => !g.lotes.length && g.poligono);
  if (quadrasVazias.length) avisos.push(`${quadrasVazias.length} quadra(s) do arquivo não têm lote dentro: a terra delas ficou como área livre.`);

  // terra de cada quadra: os lotes (frestas de até 5 cm fechadas) e, se o arquivo traz o polígono da quadra,
  // o que dele sobrar com corpo (não fresta) — vira área livre da quadra
  const terraQuadra = (g: GrupoQ): Poligono[] => {
    // (o fechamento das frestas apara a ponta muito aguda de um lote: os lotes entram inteiros de novo)
    const ls = g.lotes.map((l) => l.pol);
    let t = intersecao(uniao([...uniaoFechada(ls, 0.025), ...ls]), [gleba]);
    if (g.poligono) {
      const livres = diferenca(intersecao([g.poligono.pol], [gleba]), [...t, ...uniaoLotes, ...areas.map((a) => a.pol)])
        .filter((x) => areaPol(x) > 2 && espessura(x) > 0.3);
      if (livres.length) t = uniaoFechada([...t, ...livres], 0.005);
    }
    return t.filter((x) => areaPol(x) > 0.5);
  };
  const terras = comLotes.map(terraQuadra);
  const livreQuadra = comLotes.reduce((s, g, i) => s + Math.max(0, somaArea(terras[i]) - g.lotes.reduce((s2, l) => s2 + areaPol(l.pol), 0)), 0);
  if (livreQuadra > 2) avisos.push(`${fmt(livreQuadra)} m² das quadras do arquivo não têm lote (área livre, em rosa na prancheta): desenhe um lote nela ou deixe como está.`);
  for (const g of quadrasVazias) remanescentesArq.push(...diferenca(intersecao([g.poligono!.pol], [gleba]), ocupado).filter((x) => areaPol(x) > 2));

  // ---------------------------------------------------------------- nomes das quadras
  const nomesQ: (string | undefined)[] = comLotes.map((g, gi) => {
    if (g.nome) return g.nome;
    // rótulo dos lotes ("Q-A L-12", "A-01", propriedade quadra): o mais citado
    const cont = new Map<string, number>();
    for (const l of g.lotes) if (l.quadra) cont.set(l.quadra, (cont.get(l.quadra) ?? 0) + 1);
    const doLote = [...cont].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (doLote) return doLote;
    // texto dentro da quadra (ou do polígono dela no arquivo): "QUADRA A" em qualquer lugar; "A" solto só fora dos lotes
    for (const t of textosLivres) {
      if (t.f.papel !== "quadra" && t.f.papel !== "?") continue;
      if (!terras[gi].some((pg) => dentroPol(t.p, pg)) && !(g.poligono && dentroPol(t.p, g.poligono.pol))) continue;
      const foraDosLotes = !grade.achar(t.p).length;
      const n = nomeDaQuadra(t.f.texto!, foraDosLotes && t.f.papel === "quadra");
      if (n) return n;
    }
    return undefined;
  });
  // repetido ou sem nome: letra pela posição (de cima para baixo, da esquerda para a direita)
  const usados = new Set<string>();
  const repetidosQ: string[] = [];
  nomesQ.forEach((n, i) => { if (!n) return; if (usados.has(n)) { repetidosQ.push(n); nomesQ[i] = undefined; } else usados.add(n); });
  if (repetidosQ.length) avisos.push(`Quadra com nome repetido no arquivo (${[...new Set(repetidosQ)].join(", ")}): a segunda ganhou outra letra.`);
  const ordem = comLotes.map((_, i) => ({ i, c: centroide(maiorPeca(terras[i]).ext) }))
    .sort((a, b) => (Math.abs(a.c[1] - b.c[1]) > 25 ? b.c[1] - a.c[1] : a.c[0] - b.c[0]));
  let proxima = 0;
  const numeros = base.params.numeracaoQuadras === "numeros";
  const semNome = ordem.filter(({ i }) => !nomesQ[i]).length;
  for (const { i } of ordem) {
    if (nomesQ[i]) continue;
    let n: string;
    do { n = numeros ? pad(proxima + 1) : letraQuadra(proxima); proxima++; } while (usados.has(n));
    usados.add(n);
    nomesQ[i] = n;
  }
  if (semNome && semNome < comLotes.length) avisos.push(`${semNome} quadra(s) sem nome no arquivo ganharam ${numeros ? "número" : "letra"} pela posição.`);

  // ---------------------------------------------------------------- numeração dentro de cada quadra
  const sentido = base.params.sentidoLotes === "antihorario" ? -1 : 1;
  let numeracaoAviso = 0, repetidosNum = 0;
  const cfgs: QuadraCfg[] = [];
  const idDoLote = new Map<LoteArq, string>();
  comLotes.forEach((g, gi) => {
    const nome = nomesQ[gi]!;
    const c0 = centroide(maiorPeca(terras[gi]).ext);
    // ordem do contorno (horário a partir do noroeste): para quem não tem número
    const ang = (l: LoteArq) => { const c = pontoInterno(l.pol); const a = (Math.atan2(c[1] - c0[1], c[0] - c0[0]) * 180) / Math.PI; return (((sentido * (135 - a)) % 360) + 360) % 360; };
    const espacial = [...g.lotes].sort((a, b) => ang(a) - ang(b));
    const tomados = new Set<number>();
    for (const l of espacial) {
      if (l.numero === undefined) continue;
      if (!(Number.isInteger(l.numero) && l.numero > 0) || tomados.has(l.numero)) { repetidosNum++; l.numero = undefined; continue; }
      tomados.add(l.numero);
    }
    const sem = espacial.filter((l) => l.numero === undefined);
    if (sem.length && tomados.size) {
      // os que faltam preenchem os buracos da numeração (lote sem texto no meio da quadra) ou seguem depois do maior
      const max = Math.max(...tomados);
      const buracos: number[] = [];
      for (let n = 1; n <= max; n++) if (!tomados.has(n)) buracos.push(n);
      let prox = max;
      sem.forEach((l, j) => { l.numero = sem.length === buracos.length ? buracos[j] : ++prox; });
      numeracaoAviso += sem.length;
    } else if (sem.length) sem.forEach((l, j) => { l.numero = j + 1; });
    const ordenados = [...g.lotes].sort((a, b) => a.numero! - b.numero!);
    const continua = ordenados.every((l, j) => l.numero === j + 1);
    const lotesCfg: LoteDesenhado[] = ordenados.map((l) => ({ anel: antiHorario(l.pol.ext).map(U), ...(continua ? {} : { numero: l.numero }) }));
    for (const l of ordenados) idDoLote.set(l, `${nome}-${pad(l.numero!)}`);
    const maior = ordenados.reduce((m, l) => (areaPol(l.pol) > areaPol(m.pol) ? l : m), ordenados[0]);
    cfgs.push({ ancora: U(pontoInterno(maior.pol)), nome, ajustes: [], lotes: lotesCfg });
  });
  if (repetidosNum) avisos.push(`${repetidosNum} lote(s) com número repetido na mesma quadra ganharam outro número.`);
  if (numeracaoAviso) avisos.push(`${numeracaoAviso} lote(s) sem número no arquivo foram numerados pela posição na quadra.`);
  if (sobrepostos.length) {
    const desc = (i: number) => idDoLote.get(lotes[i]) ?? `nº ${i + 1} do arquivo`;
    avisos.push(`Lotes sobrepostos no arquivo: ${sobrepostos.slice(0, 6).map(([i, j, a]) => `${desc(i)} sobre ${desc(j)} (${fmt(a)} m²)`).join("; ")}${sobrepostos.length > 6 ? ` e mais ${sobrepostos.length - 6}` : ""}. A parte comum ficou com o segundo.`);
  }
  // quadras que se encostam sem rua no meio (o cálculo separa cada uma pelos lotes dela)
  const encostadas: string[] = [];
  for (let i = 0; i < terras.length; i++) for (let j = 0; j < i; j++) {
    const a = maiorPeca(terras[i]), b = maiorPeca(terras[j]);
    if (!a || !b || !caixaSobrepoe(caixa(a.ext), caixa(b.ext), 0.05)) continue;
    const u = uniaoFechada([a, b], 0.025);
    if (u.length === 1 && (perimetroPol(a) + perimetroPol(b) - perimetroPol(u[0])) / 2 > 1) encostadas.push(`${nomesQ[j]} e ${nomesQ[i]}`);
  }
  if (encostadas.length) avisos.push(`Quadras encostadas sem rua entre elas: ${encostadas.slice(0, 5).join("; ")}. Cada uma continua com os seus lotes.`);

  // ---------------------------------------------------------------- viário = gleba − (quadras ∪ áreas ∪ remanescente desenhado)
  const ocupadoTudo = [...terras.flat(), ...areas.map((a) => a.pol), ...remanescentesArq];
  let viario = diferenca([gleba], ocupadoTudo).filter((x) => areaPol(x) > 0.01);
  // evidência de rua no arquivo: polígonos de viário e eixos
  const viarioArq = pols.filter((p) => p.classe === "viario").map((p) => p.pol);
  const eixosArq = linhas.filter((x) => x.f.classe === "eixo" || x.f.classe === "viario");
  // terra larga demais para ser rua (cabe um círculo de 20 m) e sem rua desenhada: remanescente (o arquivo não cobre a gleba toda)
  const largo = intersecao(offsetPols(offsetPols(viario, -20), 20, "redonda"), viario).filter((x) => areaPol(x) > 2000);
  const evidencia = [...viarioArq, ...eixosArq.flatMap((e) => bufferLinha(e.pts, 50, "redonda"))];
  const remanescente = (evidencia.length ? diferenca(largo, evidencia) : largo).filter((x) => areaPol(x) > 2000);
  if (remanescente.length) {
    viario = diferenca(viario, remanescente).filter((x) => areaPol(x) > 0.01);
    avisos.push(`${fmt(somaArea(remanescente))} m² da gleba não têm nada desenhado no arquivo e são largos demais para rua: ficaram como área remanescente (do proprietário).`);
  }
  const remanescentes = [...remanescentesArq, ...remanescente];

  // ---------------------------------------------------------------- ruas: o viário repartido entre os eixos (ou os nomes de rua)
  const nomesRua = textosLivres
    .map((t) => ({ t, nome: nomeDaRua(t.f.texto!, t.f.papel) }))
    .filter((x): x is { t: TextoArq; nome: string } => !!x.nome && viario.some((pg) => dentroPol(x.t.p, pg)));
  interface Semente { linha?: Pt[]; pols?: Poligono[]; nome?: string; eixo?: Pt[] }
  const sementes: Semente[] = [];
  for (const e of eixosArq) {
    const dentro = recortarLinha(e.pts, offsetPols([gleba], 2)[0] ?? gleba);
    if (!dentro.length) continue;
    // nome: o do objeto (KML/GeoJSON) ou o texto de rua mais perto do eixo (até 25 m)
    let nome = e.f.nome ? nomeDaRua(e.f.nome, "rua") ?? e.f.nome : undefined;
    if (!nome) {
      let dm = 25;
      for (const r of nomesRua) {
        let d0 = Infinity;
        for (let i = 0; i + 1 < e.pts.length; i++) d0 = Math.min(d0, distSegmento(r.t.p, e.pts[i], e.pts[i + 1]).d);
        if (d0 < dm) { dm = d0; nome = r.nome; }
      }
    }
    sementes.push({ linha: e.pts, nome, eixo: e.pts });
  }
  if (!sementes.length && viarioArq.length > 1) {
    for (const v of viarioArq) {
      const pecas = intersecao([v], viario);
      if (!somaArea(pecas)) continue;
      const t = nomesRua.find((r) => dentroPol(r.t.p, v));
      sementes.push({ pols: pecas, nome: t?.nome });
    }
  }
  if (!sementes.length && nomesRua.length) {
    // sem eixo: a reta do nome da rua (o texto vai deitado ao longo dela) faz as vezes de eixo para repartir
    for (const r of nomesRua) {
      const a = (r.t.f.rot ?? 0) * (Math.PI / 180);
      const d: Pt = [Math.cos(a), Math.sin(a)];
      const reta: Pt[] = [[r.t.p[0] - d[0] * 2000, r.t.p[1] - d[1] * 2000], [r.t.p[0] + d[0] * 2000, r.t.p[1] + d[1] * 2000]];
      const trechos = viario.flatMap((pg) => recortarLinha(reta, pg));
      const meu = trechos.find((l) => l.some((_, i) => i + 1 < l.length && distSegmento(r.t.p, l[i], l[i + 1]).d < 0.5)) ?? trechos[0];
      if (meu && !sementes.some((s) => s.nome === r.nome)) sementes.push({ linha: meu, nome: r.nome });
    }
  }
  const partes: Poligono[][] = sementes.map(() => []);
  let resto = viario;
  if (sementes.length) {
    for (const raio of [0, 1.5, 3, 5, 8, 12, 17, 24, 34, 48, 70]) {
      if (!resto.length) break;
      for (let i = 0; i < sementes.length && resto.length; i++) {
        const s = sementes[i];
        const zona = s.linha ? (raio > 0 ? bufferLinha(s.linha, 2 * raio, "redonda") : []) : raio > 0 ? offsetPols(s.pols!, raio, "redonda") : s.pols!;
        if (!zona.length) continue;
        const ganho = intersecao(resto, zona).filter((x) => areaPol(x) > 0.01);
        if (!ganho.length) continue;
        partes[i].push(...ganho);
        resto = diferenca(resto, ganho).filter((x) => areaPol(x) > 0.01);
      }
    }
    // o que ficou longe de todas: para a mais perto
    for (const x of resto) {
      const c = pontoInterno(x);
      let melhor = 0, dm = Infinity;
      sementes.forEach((s, i) => {
        const d0 = s.linha ? Math.min(...s.linha.slice(0, -1).map((p, k) => distSegmento(c, p, s.linha![k + 1]).d))
          : Math.min(...s.pols!.flatMap((pg) => pg.ext.map((p, k) => distSegmento(c, p, pg.ext[(k + 1) % pg.ext.length]).d)));
        if (d0 < dm) { dm = d0; melhor = i; }
      });
      partes[melhor].push(x);
    }
  } else {
    // sem eixo nem nome de rua: cada pedaço do viário é uma rua (as frestas finas vão para a rua maior mais perto)
    const finos = viario.filter((x) => espessura(x) < 0.05 || areaPol(x) < 1);
    const bons = viario.filter((x) => !finos.includes(x));
    bons.forEach((x) => { sementes.push({ pols: [x] }); partes.push([x]); });
    for (const x of finos) {
      if (!bons.length) { sementes.push({ pols: [x] }); partes.push([x]); continue; }
      const c = pontoInterno(x);
      let melhor = 0, dm = Infinity;
      bons.forEach((b, i) => { const d0 = Math.min(...b.ext.map((p, k) => distSegmento(c, p, b.ext[(k + 1) % b.ext.length]).d)); if (d0 < dm) { dm = d0; melhor = i; } });
      partes[melhor].push(x);
    }
  }
  const ruasTmp = sementes.map((s, i) => ({ s, corpo: partes[i].length ? uniaoFechada(partes[i], 0.002) : [] })).filter((x) => somaArea(x.corpo) > 0.01);
  // nome: o da semente ou "RUA 01"… na ordem de cima para baixo (sem repetir nome)
  const ordemRuas = ruasTmp.map((r, i) => ({ i, c: centroide(maiorPeca(r.corpo).ext) })).sort((a, b) => (Math.abs(a.c[1] - b.c[1]) > 25 ? b.c[1] - a.c[1] : a.c[0] - b.c[0]));
  const nomesUsados = new Set(ruasTmp.map((r) => r.s.nome).filter(Boolean) as string[]);
  let nRua = 0;
  const ruas: Rua[] = [];
  for (const { i } of ordemRuas) {
    const r = ruasTmp[i];
    let nome = r.s.nome;
    if (!nome || ruas.some((x) => x.nome === nome)) { do nome = `RUA ${pad(++nRua)}`; while (nomesUsados.has(nome)); nomesUsados.add(nome); }
    const largura = larguraTipica(r.corpo, viario);
    ruas.push({ id: `imp${ruas.length + 1}`, nome, largura, eixo: (r.s.eixo ?? []).map(U), corpo: aneisUtm(r.corpo, U) });
  }

  // ---------------------------------------------------------------- áreas públicas e remanescente no modelo
  const areasDes: AreaDesenhada[] = areas.map((a, i) => ({ id: `imp-a${i + 1}`, tipo: a.tipo, nome: a.nome ?? "", anel: antiHorario(a.pol.ext).map(U) }));
  const furosArea = areas.reduce((s, a) => s + a.pol.furos.reduce((s2, f) => s2 + Math.abs(areaAssinada(f)), 0), 0);
  if (furosArea > 1) avisos.push(`Área pública com furo no arquivo (${fmt(furosArea)} m²): o furo foi preenchido.`);
  remanescentes.forEach((pg, k) => cfgs.push({ ancora: U(pontoInterno(pg)), nome: `REMANESCENTE ${k + 1}`, ajustes: [], lotes: [] }));

  // ---------------------------------------------------------------- projeto, parâmetros pelos lotes e conferência
  const params0: Parametros = { ...base.params, distanciasTerreno: false };
  let projeto: Projeto = {
    ...base, params: params0, ruas, areas: areasDes, quadras: cfgs, sobrasPublicas: [], gerado: true,
    importado: { arquivo: d.arquivo, em: new Date().toISOString() },
  };
  let res = calcular(projeto, perimetro);
  const params = parametrosDosLotes(res, params0);
  if (params !== params0) { projeto = { ...projeto, params }; res = calcular(projeto, perimetro); }

  // a área de cada lote no sistema é a do arquivo (o cálculo não mexe no lote importado)
  const doArquivo = new Map<string, number>();
  for (const [l, id] of idDoLote) doArquivo.set(id, areaPol(l.pol));
  const diferentes = res.lotes.filter((l) => doArquivo.has(l.id) && Math.abs(l.area - doArquivo.get(l.id)!) > 0.01);
  if (diferentes.length) avisos.push(`${diferentes.length} lote(s) ficaram com área diferente da do arquivo depois do recorte pelas ruas e áreas (ex.: ${diferentes.slice(0, 3).map((l) => `${l.id}: ${fmt(doArquivo.get(l.id)!)} → ${fmt(l.area)} m²`).join("; ")}).`);
  const faltam = [...doArquivo.keys()].filter((id) => !res.lotes.some((l) => l.id === id));
  if (faltam.length) avisos.push(`${faltam.length} lote(s) do arquivo não couberam na quadra calculada (${faltam.slice(0, 5).join(", ")}). Confira na prancheta.`);
  const pequenos = res.lotes.filter((l) => l.area < 125 - 0.01).length;
  if (pequenos) avisos.push(`${pequenos} lote(s) com menos de 125 m² — abaixo do mínimo da Lei 6.766 (art. 4º, II), salvo urbanização específica.`);
  if (!ruas.some((r) => r.eixo.length >= 2) && ruas.length) avisos.push("O arquivo não trouxe os eixos das ruas: a locação sai sem as estacas do eixo e as redes de infraestrutura e o passeio da maquete não passam por elas. Para tê-los, ponha os eixos numa camada EIXO e importe de novo.");

  const q = res.quadro;
  const resumo: ResumoImportacao = {
    gleba: q.gleba, quadras: res.quadras.length, lotes: res.lotes.length, areaLotes: q.lotes.area, viario: q.viario, ruas: res.ruas.length,
    verde: q.verde + q.lazer, institucional: q.institucional, app: q.app, remanescente: q.sobras,
    publicas: res.publicas.map((a) => ({ nome: a.nome, tipo: a.tipo, area: a.area })),
  };
  return { projeto, res, resumo, avisos };
}

/**
 * Medidas do projeto tiradas dos próprios lotes, com 3% de folga: o lote do
 * arquivo não sai acusado de fora da medida por ser como é. O padrão é a
 * mediana; as faixas vão do menor ao maior (a quina a mais também).
 */
export function parametrosDosLotes(res: Resultado, p: Parametros): Parametros {
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  const lotes = res.lotes.filter((l) => l.area > 0);
  if (!lotes.length) return p;
  const r2 = (x: number, up: boolean) => (up ? Math.ceil(x * 100) : Math.floor(x * 100)) / 100;
  const comFrente = lotes.filter((l) => l.lados.some((x) => x.tipo === "rua" || x.tipo === "via"));
  const medidas = comFrente.map((l) => {
    const fr = l.lados.filter((x) => x.tipo === "rua" || x.tipo === "via");
    const segs = fr.map((x) => [x.a, x.b] as [Pt, Pt]);
    const ruas = new Set(fr.map((x) => x.ref));
    return { l, testada: frentePrincipal(segs), rasa: profundidadeDe(l.pol, segs), esquina: l.esquina || ruas.size >= 2 };
  });
  const areas = lotes.map((l) => l.area);
  const q: Parametros = { ...p };
  q.areaMin = r2(Math.min(...areas) * 0.97, false);
  q.areaMax = r2(Math.max(...areas) * 1.03, true);
  if (medidas.length) {
    const frMin = Math.min(...medidas.map((m) => Math.min(m.l.frente, m.testada > 0 ? m.testada : m.l.frente)));
    const meio = medidas.filter((m) => !m.esquina);
    const frMax = Math.max(...(meio.length ? meio : medidas).map((m) => (m.testada > 0 ? m.testada : m.l.frente)));
    const profs = medidas.map((m) => m.l.profundidade).filter((x) => x > 0);
    const rasas = meio.map((m) => m.rasa).filter((x) => x > 0);
    q.frenteMin = r2(frMin * 0.97, false);
    q.frenteMax = r2(frMax * 1.03, true);
    q.profundidadeMax = r2(Math.max(...profs) * 1.03, true);
    q.profundidadeMin = r2((rasas.length ? Math.min(...rasas) : Math.min(...profs)) * 0.97, false);
    q.frente = r2(med((meio.length ? meio : medidas).map((m) => (m.testada > 0 ? m.testada : m.l.frente))), false);
    q.profundidade = r2(med(profs), false);
  }
  q.frente = Math.min(q.frenteMax, Math.max(q.frenteMin, q.frente || q.frenteMin));
  q.profundidade = Math.min(q.profundidadeMax, Math.max(q.profundidadeMin, q.profundidade || q.profundidadeMin));
  // o lote padrão é o retângulo padrão (as Perguntas conferem frente × profundidade)
  q.areaPadrao = Math.min(q.areaMax, Math.max(q.areaMin, Math.round(q.frente * q.profundidade)));
  if (Math.abs(q.areaPadrao - q.frente * q.profundidade) > 0.05 * q.frente * q.profundidade) {
    q.profundidade = r2(q.areaPadrao / q.frente, false);
    q.profundidadeMin = Math.min(q.profundidadeMin, q.profundidade);
    q.profundidadeMax = Math.max(q.profundidadeMax, q.profundidade);
  }
  // a área máxima tem de caber no maior lote possível (senão as Perguntas acusam a configuração)
  if (q.areaMax > q.frenteMax * q.profundidadeMax) q.profundidadeMax = r2(q.areaMax / Math.max(0.01, q.frenteMax), true);
  const nq = Math.max(...lotes.map((l) => quinasAviso(l.pol.ext)));
  if (nq > (p.quinasMax ?? 4)) q.quinasMax = nq;
  return completarFaixas(q, q);
}
