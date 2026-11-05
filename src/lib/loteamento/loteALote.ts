// Arquivos de CADA lote, além do conjunto completo (entregas.ts): o memorial
// descritivo (DOCX), a planta A4 (PDF) e a locação dos vértices do lote, cada
// lote na sua pasta do zip (QUADRA_A/LOTE_01/); o mesmo para cada área pública
// (AREA_VERDE_01/). É o que o cartório e o comprador pedem lote por lote.
//
// Sai do servidor (função `entregar`), como as outras entregas: o projeto é o
// do banco, recalculado, e os ids pedidos são conferidos contra esse resultado
// — nada de geometria vinda da tela. Os nomes dos vértices são os MESMOS da
// locação completa (o "A-07" do lote é o "A-07" da coletora).
import JSZip from "jszip";
import { caixa, cross, dentroPol, dist, distSegmento, lerp, mult, soma, sub, unit } from "./geom.ts";
import type { Poligono, Pt } from "./geom.ts";
import { fmt } from "./calculo.ts";
import type { AreaConsolidada, Lado, Lote, Perimetro, Resultado, RuaCalc, TipoLado } from "./calculo.ts";
import { ROTULO_AREA, ehAcesso } from "./modelo.ts";
import type { Projeto } from "./modelo.ts";
import {
  FORMATOS, LOCACAO_PADRAO, agruparTrechos, arquivoLocacao, azimute, chavePonto, ladosEmOrdemDoMemorial, memorialDoLote,
  pontoAvulso, pontosDeLocacao, raioDoTrecho, resumoLote, trechosDoPerimetro,
} from "./saidas.ts";
import type { FormatoLocacao, PontoLocacao } from "./saidas.ts";
import { gerarDocx } from "./docx.ts";
import { gerarPlantaDoItem } from "./plantaLote.ts";
import type { FolhaItem, TrechoFolha } from "./plantaLote.ts";
import type { DadosCarimbo } from "./planta.ts";
import { paraUtm } from "./plano.ts";

/** Teto de lotes por chamada ao servidor: a tela pede de 60 em 60 e junta o zip. */
export const MAX_ITENS_POR_PEDIDO = 60;

export interface ItemLoteALote {
  /** "A-05" (o id do lote) ou "AREA_VERDE_01" (área pública) */
  id: string;
  tipo: "lote" | "area";
  /** pasta no zip: QUADRA_A/LOTE_05 · AREA_VERDE_01 */
  pasta: string;
  /** "LOTE 05 DA QUADRA A" · "ÁREA VERDE 01" */
  titulo: string;
  /** base do nome dos arquivos: LOTE_05_QUADRA_A · AREA_VERDE_01 */
  arquivo: string;
  quadra?: string;
  numero?: number;
  area: number;
  lote?: Lote;
  publica?: AreaConsolidada;
}

/** O que o pacote lê do serviço (os mesmos campos do memorial do loteamento). */
export interface ServicoDoPacote { municipio?: string | null; uf?: string | null; detentor_nome?: string | null; fuso_utm?: number | null }

const pad = (n: number) => String(n).padStart(2, "0");
const paraArquivo = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase();

/**
 * Lotes (por quadra, na numeração) e áreas públicas — verde, lazer e
 * institucional; a faixa de APP não entra. O id da área sai do nome dela
 * (sem repetir): a tela e o servidor calculam o mesmo projeto, então chegam ao
 * mesmo id.
 */
export function itensLoteALote(res: Resultado): ItemLoteALote[] {
  const out: ItemLoteALote[] = [];
  const pastas = new Set<string>();
  const unica = (base: string) => { let p = base; for (let k = 2; pastas.has(p); k++) p = `${base}_${k}`; pastas.add(p); return p; };
  for (const q of res.quadras) {
    const pq = unica(`QUADRA_${paraArquivo(q.nome) || "SEM_NOME"}`);
    for (const l of [...q.lotes].sort((a, b) => a.numero - b.numero)) {
      out.push({
        id: l.id, tipo: "lote", pasta: `${pq}/LOTE_${pad(l.numero)}`, titulo: `LOTE ${pad(l.numero)} DA QUADRA ${q.nome}`,
        arquivo: `LOTE_${pad(l.numero)}_${pq}`, quadra: q.nome, numero: l.numero, area: l.area, lote: l,
      });
    }
  }
  for (const a of res.publicas) {
    if (a.tipo === "app") continue;
    const id = unica(paraArquivo(a.nome) || "AREA_PUBLICA");
    out.push({ id, tipo: "area", pasta: id, titulo: a.nome.toUpperCase(), arquivo: id, area: a.area, publica: a });
  }
  return out;
}

/**
 * Confere o pedido contra o resultado recalculado: lista de ids (texto), de 1 a
 * 60, todos existentes. Devolve os itens na ordem do loteamento ou o motivo.
 */
export function conferirItens(res: Resultado, ids: unknown): { itens: ItemLoteALote[] } | { erro: string } {
  if (!Array.isArray(ids) || !ids.length || ids.some((x) => typeof x !== "string")) return { erro: "Diga quais lotes gerar (lista de ids)." };
  const pedidos = new Set(ids as string[]);
  if (pedidos.size > MAX_ITENS_POR_PEDIDO) return { erro: `No máximo ${MAX_ITENS_POR_PEDIDO} lotes por pedido — a tela divide os pedidos maiores.` };
  const todos = itensLoteALote(res);
  const porId = new Map(todos.map((x) => [x.id, x]));
  const falta = [...pedidos].find((id) => !porId.has(id));
  if (falta) return { erro: `O lote ${falta.slice(0, 40)} não existe neste loteamento (o projeto mudou?). Recarregue a página e tente de novo.` };
  return { itens: todos.filter((x) => pedidos.has(x.id)) };
}

// ---------------------------------------------------------------------------
// Vizinhos de uma área pública (o lote já sai do cálculo com os lados prontos)
// ---------------------------------------------------------------------------

/** Quem está do outro lado: mesma ordem de busca do cálculo (fora da gleba, lote, área, remanescente, rua). */
function vizinhoEm(p: Pt, m: Pt, propria: AreaConsolidada, res: Resultado, perimetro: Perimetro): { tipo: TipoLado; ref?: string; nome: string } {
  if (!dentroPol(p, res.gleba)) {
    let melhor = 0, dm = Infinity;
    res.ladosGleba.forEach((l, i) => { const dd = distSegmento(m, l.a, l.b).d; if (dd < dm) { dm = dd; melhor = i; } });
    const lg = res.ladosGleba[melhor];
    if (lg && ehAcesso(lg.tipo)) return { tipo: "via", ref: `borda${melhor}`, nome: lg.nome || (lg.tipo === "rodovia" ? "Rodovia" : "estrada existente") };
    return { tipo: "divisa", ref: `borda${melhor}`, nome: perimetro.confrontantes[melhor] || lg?.nome || "divisa da gleba" };
  }
  const dentroCx = (pg: Poligono) => { const b = caixa(pg.ext); return p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1] && dentroPol(p, pg); };
  for (const l of res.lotes) if (dentroCx(l.pol)) return { tipo: "lote", ref: l.id, nome: `Lote ${pad(l.numero)} da Quadra ${l.quadra}` };
  for (const a of res.publicas) if (a !== propria && dentroCx(a.pol)) return { tipo: "area", ref: a.nome, nome: a.nome };
  for (const s of res.sobras) if (dentroCx(s)) return { tipo: "sobra", ref: "sobra", nome: "área remanescente" };
  // rua: a que tem o pedaço onde o ponto cai; entre duas (cruzamento), a do eixo mais perto
  const distEixo = (e: Pt[]) => { let d = Infinity; for (let i = 0; i + 1 < e.length; i++) d = Math.min(d, distSegmento(p, e[i], e[i + 1]).d); return d; };
  let rua: RuaCalc | undefined, dm = Infinity;
  for (const r of res.ruas) {
    if (!r.pols.some(dentroCx)) continue;
    const d = r.eixo.length >= 2 ? distEixo(r.eixo) : 0;
    if (d < dm) { dm = d; rua = r; }
  }
  if (!rua) for (const r of res.ruas) { const d = distEixo(r.eixo); if (d < dm) { dm = d; rua = r; } }
  return { tipo: "rua", ref: rua?.id, nome: rua?.nome ?? "via" };
}

/**
 * Lados da área pública com os confrontantes. O anel da área vem limpo (sem
 * vértice no meio de lado reto), então primeiro entram nele os cantos dos lotes
 * e da gleba que caem sobre os lados — onde o vizinho muda — e só depois cada
 * pedaço é sondado por fora.
 */
function ladosDaArea(a: AreaConsolidada, res: Resultado, perimetro: Perimetro): Lado[] {
  const anel = a.pol.ext;
  const bb = caixa(anel);
  const perto = (q: Pt) => q[0] >= bb.min[0] - 0.05 && q[0] <= bb.max[0] + 0.05 && q[1] >= bb.min[1] - 0.05 && q[1] <= bb.max[1] + 0.05;
  const cantos: Pt[] = [...res.gleba.ext.filter(perto)];
  for (const l of res.lotes) { const b = caixa(l.pol.ext); if (b.max[0] < bb.min[0] - 0.05 || b.min[0] > bb.max[0] + 0.05 || b.max[1] < bb.min[1] - 0.05 || b.min[1] > bb.max[1] + 0.05) continue; cantos.push(...l.pol.ext); }
  for (const o of res.publicas) if (o !== a) cantos.push(...o.pol.ext.filter(perto));
  const brutos: Lado[] = [];
  for (let i = 0; i < anel.length; i++) {
    const a0 = anel[i], b0 = anel[(i + 1) % anel.length];
    const L = dist(a0, b0);
    if (L < 1e-6) continue;
    const ts = cantos.map((q) => ({ q, ...distSegmento(q, a0, b0) })).filter((x) => x.d < 0.01 && x.t * L > 0.02 && (1 - x.t) * L > 0.02).sort((x, y) => x.t - y.t);
    const pts = [a0, ...ts.map((x) => lerp(a0, b0, x.t)), b0];
    for (let k = 0; k + 1 < pts.length; k++) {
      const p0 = pts[k], p1 = pts[k + 1];
      const c = dist(p0, p1);
      if (c < 0.005) continue;
      const d = unit(sub(p1, p0));
      const m = lerp(p0, p1, 0.5);
      // anel anti-horário: o interior fica à esquerda, o vizinho à direita
      brutos.push({ a: p0, b: p1, comp: c, ...vizinhoEm(soma(m, mult([d[1], -d[0]], 0.05)), m, a, res, perimetro) });
    }
  }
  // pedaços seguidos e alinhados com o mesmo vizinho voltam a ser um lado só
  const out: Lado[] = [];
  for (const x of brutos) {
    const u = out[out.length - 1];
    if (u && u.tipo === x.tipo && u.ref === x.ref && Math.abs(cross(unit(sub(u.b, u.a)), unit(sub(x.b, x.a)))) < 0.005) { u.b = x.b; u.comp = dist(u.a, u.b); }
    else out.push({ ...x });
  }
  if (out.length > 2) {
    const p = out[0], u = out[out.length - 1];
    if (p.tipo === u.tipo && p.ref === u.ref && Math.abs(cross(unit(sub(u.b, u.a)), unit(sub(p.b, p.a)))) < 0.005) { p.a = u.a; p.comp = dist(p.a, p.b); out.pop(); }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Um item: vértices, trechos, memorial, planta e locação
// ---------------------------------------------------------------------------

interface Base {
  res: Resultado;
  perimetro: Perimetro;
  /** pontos da locação completa (cantos de lote e curvas), pela chave do vértice */
  pontos: Map<string, PontoLocacao>;
  nomes: Map<string, string>;
  /** pontos de dentro dos arcos de esquina (não têm nome nem vão para a coletora) */
  intermed: Set<string>;
}

export function basePacote(res: Resultado, perimetro: Perimetro): Base {
  const pts = pontosDeLocacao(res, perimetro, LOCACAO_PADRAO).filter((p) => p.tipo === "lote" || p.tipo === "curva");
  return {
    res, perimetro,
    pontos: new Map(pts.map((p) => [chavePonto(p.p), p])),
    nomes: new Map(pts.map((p) => [chavePonto(p.p), p.nome])),
    intermed: new Set(res.quadras.flatMap((q) => q.curvas.flatMap((c) => c.intermediarios.map(chavePonto)))),
  };
}

export interface ItemMontado {
  item: ItemLoteALote;
  folha: FolhaItem;
  memorial: { titulo: string; paragrafos: string[] };
  /** pontos de locação do item: um por vértice com nome, na ordem do memorial */
  pontos: PontoLocacao[];
}

const SIGLA: Record<string, string> = { verde: "AV", lazer: "AL", institucional: "AI", app: "APP" };

export function montarItem(item: ItemLoteALote, b: Base, dados: { loteamento: string; municipio: string; uf: string; proprietario: string; fuso: number }): ItemMontado {
  const { res, perimetro } = b;
  const U = (p: Pt) => paraUtm(res.plano, p);
  const coord = (p: Pt) => { const u = U(p); return `E ${fmt(u[0], 3)} m e N ${fmt(u[1], 3)} m`; };
  let seq: Lado[], nomes: Map<string, string>, memorial: ItemMontado["memorial"], medidas: [string, string][], codigo: string, quadraLote: string;
  if (item.lote) {
    const l = item.lote;
    seq = ladosEmOrdemDoMemorial(l);
    nomes = b.nomes;
    memorial = memorialDoLote(l, res, b.nomes, dados);
    const r = resumoLote(l);
    medidas = [
      ["Área", `${fmt(l.area)} m²`], ["Perímetro", `${fmt(l.lados.reduce((s, x) => s + x.comp, 0))} m`],
      ["Frente", r.frente], ...(r.curva ? [["Curva da esquina", r.curva] as [string, string]] : []), ["Lado direito", r.direito], ["Fundos", r.fundos], ["Lado esquerdo", r.esquerdo],
    ];
    codigo = `Q${l.quadra} L${pad(l.numero)}`;
    quadraLote = `Quadra ${l.quadra} — Lote ${pad(l.numero)}`;
  } else {
    const a = item.publica!;
    const lados = ladosDaArea(a, res, perimetro);
    // começa no lado mais comprido de frente para a rua (como o lote); sem rua, no primeiro
    const fr = lados.filter((x) => x.tipo === "rua" || x.tipo === "via").sort((x, y) => y.comp - x.comp)[0] ?? lados[0];
    const i0 = Math.max(0, lados.indexOf(fr));
    seq = [...lados.slice(i0), ...lados.slice(0, i0)];
    // os vértices que a locação já tem guardam o nome dela; os outros ganham AV01-01, AV01-02…
    const sigla = `${SIGLA[a.tipo] ?? "AP"}${pad(res.publicas.filter((x) => x.tipo === a.tipo).indexOf(a) + 1)}`;
    nomes = new Map<string, string>();
    let k = 0;
    for (const x of seq) {
      const kk = chavePonto(x.a);
      const n = b.nomes.get(kk);
      if (n) nomes.set(kk, n);
      else if (!b.intermed.has(kk) && !nomes.has(kk)) nomes.set(kk, `${sigla}-${pad(++k)}`);
    }
    const nomeV = (p: Pt) => nomes.get(chavePonto(p)) ?? `${sigla}-?`;
    const perim = lados.reduce((s, x) => s + x.comp, 0);
    const trechos = trechosDoPerimetro(seq, nomes, nomeV, coord);
    memorial = {
      titulo: a.nome.toUpperCase(),
      paragrafos: [
        `Imóvel: ${a.nome} do loteamento ${dados.loteamento}${dados.municipio ? `, município de ${dados.municipio}${dados.uf ? `/${dados.uf}` : ""}` : ""}.`,
        `Destinação: ${ROTULO_AREA[a.tipo].toLowerCase()} — passa a integrar o domínio do Município desde a data de registro do loteamento (Lei 6.766/79, art. 22).`,
        `Área: ${fmt(a.area)} m² · Perímetro: ${fmt(perim)} m.`,
        seq.length
          ? `Descrição do perímetro: inicia-se no vértice ${nomeV(seq[0].a)}, de coordenadas ${coord(seq[0].a)}${fr && (fr.tipo === "rua" || fr.tipo === "via") ? `, situado no alinhamento da ${fr.nome}` : ""}; ${trechos.join("; ")}, ponto inicial da descrição deste perímetro.`
          : "Descrição do perímetro: —",
        `Coordenadas no sistema geodésico SIRGAS 2000, projeção UTM, fuso ${dados.fuso}S. Azimutes de quadrícula; distâncias e área ${res.plano.terreno ? "no plano topográfico (medidas de terreno)" : "no plano UTM"}.`,
      ],
    };
    medidas = [["Área", `${fmt(a.area)} m²`], ["Perímetro", `${fmt(perim)} m`], ["Destinação", ROTULO_AREA[a.tipo]]];
    codigo = sigla;
    quadraLote = a.nome;
  }
  const grupos = agruparTrechos(seq, nomes);
  const nomeDe = (p: Pt) => nomes.get(chavePonto(p)) ?? "?";
  const vertices = grupos.map((g) => ({ p: g[0].a, nome: nomeDe(g[0].a) }));
  const trechos: TrechoFolha[] = grupos.map((g, i) => {
    const pts = [g[0].a, ...g.map((x) => x.b)];
    return {
      de: vertices[i].nome, ate: vertices[(i + 1) % vertices.length].nome, pts,
      comp: g.reduce((s, x) => s + x.comp, 0), az: azimute(pts[0], pts[pts.length - 1]), raio: raioDoTrecho(g),
      confrontante: [...new Set(g.map((x) => x.nome))].join(" e "),
    };
  });
  const pontos = vertices.map((vt) => b.pontos.get(chavePonto(vt.p)) ?? pontoAvulso(res, perimetro, vt.p, vt.nome, codigo));
  const pol = item.lote ? item.lote.pol : item.publica!.pol;
  const folha: FolhaItem = {
    titulo: item.titulo, quadraLote, tipo: item.lote ? "lote" : item.publica!.tipo, pol, vertices, trechos, area: item.area,
    perimetro: seq.reduce((s, x) => s + x.comp, 0), medidas, idLote: item.lote?.id,
  };
  return { item, folha, memorial, pontos };
}

// ---------------------------------------------------------------------------
// Locação do item em DXF (só o lote, os pontos e os nomes)
// ---------------------------------------------------------------------------

function dxfDoItem(pontos: PontoLocacao[], anelUtm: Pt[]): string {
  const o: string[] = [];
  const g = (c: number, v: string | number) => { o.push(String(c), typeof v === "number" ? v.toFixed(4) : v); };
  g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES"); g(0, "TABLE"); g(2, "LAYER"); g(70, "3");
  for (const [nome, cor] of [["LOTE", 7], ["PONTO_LOCACAO", 6], ["NOME_PONTO", 6]] as const) { g(0, "LAYER"); g(2, nome); g(70, "0"); g(62, String(cor)); g(6, "CONTINUOUS"); }
  g(0, "ENDTAB"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  g(0, "POLYLINE"); g(8, "LOTE"); g(66, "1"); g(70, "1"); g(10, 0); g(20, 0); g(30, 0);
  for (const p of anelUtm) { g(0, "VERTEX"); g(8, "LOTE"); g(10, p[0]); g(20, p[1]); g(30, 0); }
  g(0, "SEQEND"); g(8, "LOTE");
  for (const p of pontos) {
    g(0, "POINT"); g(8, "PONTO_LOCACAO"); g(10, p.e); g(20, p.n); g(30, p.h);
    g(0, "TEXT"); g(8, "NOME_PONTO"); g(10, p.e + 0.6); g(20, p.n + 0.6); g(30, 0); g(40, 0.6); g(1, p.nome);
  }
  g(0, "ENDSEC"); g(0, "EOF");
  return o.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// O pacote (zip)
// ---------------------------------------------------------------------------

export interface PedidoPacote {
  itens: ItemLoteALote[];
  formato?: FormatoLocacao;
}

/**
 * Zip com uma pasta por item: memorial (DOCX), planta A4 (PDF) e locação dos
 * vértices no formato da coletora. Quem chama já conferiu acesso, crédito,
 * contorno e os ids (`conferirItens`).
 */
export async function pacoteLoteALote(
  pedido: PedidoPacote, projeto: Projeto, res: Resultado, perimetro: Perimetro, servico: ServicoDoPacote, carimbo: DadosCarimbo,
): Promise<Uint8Array> {
  const fuso = servico.fuso_utm ?? 24;
  const formato: FormatoLocacao = FORMATOS.some((f) => f.id === pedido.formato) ? pedido.formato! : "csv-nome-e-n";
  const f = FORMATOS.find((x) => x.id === formato)!;
  const dados = { loteamento: projeto.nome, municipio: servico.municipio ?? "", uf: servico.uf ?? "", proprietario: servico.detentor_nome ?? "", fuso };
  const b = basePacote(res, perimetro);
  const zip = new JSZip();
  for (const item of pedido.itens) {
    const m = montarItem(item, b, dados);
    const pasta = zip.folder(item.pasta)!;
    const docx = await gerarDocx([{ titulo: "MEMORIAL DESCRITIVO", subtitulo: m.memorial.titulo, paragrafos: m.memorial.paragrafos }], `${projeto.nome} — memorial descritivo: ${m.memorial.titulo.toLowerCase()}`);
    pasta.file(`MEMORIAL_${item.arquivo}.docx`, new Uint8Array(await docx.arrayBuffer()));
    pasta.file(`PLANTA_${item.arquivo}.pdf`, await gerarPlantaDoItem(m.folha, res, carimbo, { ...dados, proprietario: dados.proprietario }));
    const sufixo = `SIRGAS2000_UTM${fuso}S`;
    if (formato === "dxf") pasta.file(`LOCACAO_${item.arquivo}_${sufixo}.dxf`, dxfDoItem(m.pontos, m.folha.pol.ext.map((p) => paraUtm(res.plano, p))));
    else pasta.file(`LOCACAO_${item.arquivo}_${sufixo}.${f.ext}`, arquivoLocacao(m.pontos, formato));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
