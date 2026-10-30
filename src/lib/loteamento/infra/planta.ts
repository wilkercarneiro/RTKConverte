// Pranchas dos projetos de infraestrutura em PDF — uma folha por rede: água,
// esgoto, drenagem e energia/iluminação. Mesmo arranjo das plantas da equipe:
// o desenho à esquerda (o loteamento em cinza claro e a rede colorida, cotada)
// e a barra à direita com o título, a legenda, o quadro resumo, os critérios,
// as observações e o carimbo. Gerado no navegador (pdf-lib), sem servidor.
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import type { PDFFont, PDFImage, PDFPage, RGB } from "pdf-lib";
import { textoWinAnsi } from "../../../../supabase/functions/_shared/texto.ts";
import { caixa, centroide, comprimento, pontoNaPolilinha } from "../geom.ts";
import type { Anel, Poligono, Pt } from "../geom.ts";
import { fmt, viarioDe } from "../calculo.ts";
import type { Resultado } from "../calculo.ts";
import type { Projeto } from "../modelo.ts";
import { escalaPara } from "../planta.ts";
import type { DadosCarimbo, Folha } from "../planta.ts";
import type { ResultadoInfra } from "./index.ts";

const FOLHAS: Record<Folha, [number, number]> = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297] };
const MM = 72 / 25.4;
const T = (s: string) => textoWinAnsi(s);
const CINZA = (v: number) => rgb(v, v, v);
const COR = { agua: rgb(0.12, 0.44, 0.85), esgoto: rgb(0.54, 0.35, 0.17), drenagem: rgb(0.07, 0.6, 0.6), mt: rgb(0.89, 0.23, 0.18), bt: rgb(0.94, 0.54, 0.14), ip: rgb(0.95, 0.72, 0.02), vermelho: rgb(0.83, 0.18, 0.18) };

type Folha_ = "agua" | "esgoto" | "drenagem" | "energia";
const TITULOS: Record<Folha_, string> = {
  agua: "PROJETO DA REDE DE ABASTECIMENTO DE ÁGUA",
  esgoto: "PROJETO DA REDE COLETORA DE ESGOTO",
  drenagem: "PROJETO DE DRENAGEM PLUVIAL",
  energia: "PROJETO DA REDE DE ENERGIA E ILUMINAÇÃO PÚBLICA",
};

function texto(page: PDFPage, f: PDFFont, t: string, x: number, y: number, tam: number, cor: RGB, rot = 0) {
  page.drawText(T(t), { x, y, size: tam, font: f, color: cor, rotate: rot ? degrees(rot) : undefined });
}
function centrado(page: PDFPage, f: PDFFont, t: string, x: number, y: number, tam: number, cor: RGB, rot = 0) {
  const s = T(t), w = f.widthOfTextAtSize(s, tam), a = (rot * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  page.drawText(s, { x: x - dx * (w / 2) + dy * (tam * 0.35), y: y - dy * (w / 2) - dx * (tam * 0.35), size: tam, font: f, color: cor, rotate: rot ? degrees(rot) : undefined });
}
/** Quebra o texto em linhas que cabem na largura. */
function linhasDe(t: string, f: PDFFont, tam: number, w: number): string[] {
  const out: string[] = [];
  let atual = "";
  for (const pal of T(t).split(/\s+/)) {
    const tent = atual ? `${atual} ${pal}` : pal;
    if (f.widthOfTextAtSize(tent, tam) > w && atual) { out.push(atual); atual = pal; } else atual = tent;
  }
  if (atual) out.push(atual);
  return out;
}

export async function gerarPlantasInfra(res: Resultado, pr: Projeto, r: ResultadoInfra, c: DadosCarimbo, folha: Folha = "A1"): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(T(`Projetos de infraestrutura — ${pr.nome}`));
  pdf.setCreator("Vertces");
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  if (c.logo) { try { logo = c.logo.tipo === "png" ? await pdf.embedPng(c.logo.bytes) : await pdf.embedJpg(c.logo.bytes); } catch { logo = null; } }
  const folhas: Folha_[] = ["agua", "esgoto", "drenagem", "energia"];
  folhas.forEach((qual, i) => desenharFolha(pdf, res, pr, r, c, folha, qual, i + 1, folhas.length, fonte, negrito, logo));
  return pdf.save();
}

function desenharFolha(pdf: PDFDocument, res: Resultado, pr: Projeto, r: ResultadoInfra, c: DadosCarimbo, folha: Folha, qual: Folha_, n: number, total: number,
  fonte: PDFFont, negrito: PDFFont, logo: PDFImage | null) {
  const [fw, fh] = FOLHAS[folha];
  const W = fw * MM, H = fh * MM, k = fw / 841;
  const mL = 25 * MM, mO = 10 * MM;
  const larguraBarra = Math.max(150 * MM, (W - mL - mO) * 0.22);
  const barraX = W - mO - larguraBarra;
  const area = { x: mL + 6 * MM, y: mO + 8 * MM, w: barraX - mL - 12 * MM, h: H - 2 * mO - 16 * MM };
  const page = pdf.addPage([W, H]);
  page.drawRectangle({ x: mL, y: mO, width: W - mL - mO, height: H - 2 * mO, borderWidth: 2, borderColor: CINZA(0) });
  page.drawLine({ start: { x: barraX, y: mO }, end: { x: barraX, y: H - mO }, thickness: 1.2 });

  // ---------------- desenho ----------------
  const den = escalaPara(res, folha);
  const ptm = (1000 / den) * MM;
  const bb = caixa(res.gleba.ext);
  const cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2;
  const ox = area.x + area.w / 2, oy = area.y + area.h / 2;
  const P = (p: Pt): Pt => [ox + (p[0] - cx) * ptm, oy + (p[1] - cy) * ptm];
  const svg = (pol: Poligono) => {
    const a = (an: Anel) => "M" + an.map((p) => `${((p[0] - cx) * ptm).toFixed(2)} ${(-(p[1] - cy) * ptm).toFixed(2)}`).join("L") + "Z";
    return a(pol.ext) + pol.furos.map(a).join("");
  };
  const pol = (pg: Poligono, o: { cor?: RGB; borda?: RGB; esp?: number; opac?: number }) =>
    page.drawSvgPath(svg(pg), { x: ox, y: oy, color: o.cor, borderColor: o.borda, borderWidth: o.esp ?? 0, opacity: o.opac });
  const linha = (pts: Pt[], cor: RGB, esp: number, tracejado?: number[]) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const A = P(pts[i]), B = P(pts[i + 1]);
      page.drawLine({ start: { x: A[0], y: A[1] }, end: { x: B[0], y: B[1] }, thickness: esp, color: cor, dashArray: tracejado });
    }
  };
  const bola = (p: Pt, raio: number, fundo: RGB, borda: RGB, esp = 0.6) => { const A = P(p); page.drawCircle({ x: A[0], y: A[1], size: raio, color: fundo, borderColor: borda, borderWidth: esp }); };
  /** rótulo ao longo do trecho, no meio dele, deslocado para um lado */
  const rotulo = (pts: Pt[], t: string, tam: number, cor: RGB, desl = 4) => {
    const L = comprimento(pts);
    if (L * ptm < negrito.widthOfTextAtSize(T(t), tam) + 8) return;
    const { pt, dir } = pontoNaPolilinha(pts, L / 2);
    const A = P(pt);
    let ang = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    const a = (ang * Math.PI) / 180;
    centrado(page, negrito, t, A[0] - Math.sin(a) * desl, A[1] + Math.cos(a) * desl, tam, cor, ang);
  };

  // base: o loteamento claro
  for (const v of viarioDe(res)) pol(v, { cor: CINZA(0.93), borda: CINZA(0.72), esp: 0.4 });
  for (const a of res.publicas) pol(a.pol, { cor: a.tipo === "institucional" ? rgb(0.96, 0.93, 0.85) : rgb(0.9, 0.95, 0.88), borda: CINZA(0.6), esp: 0.4 });
  for (const l of res.lotes) pol(l.pol, { borda: CINZA(0.72), esp: 0.35 });
  pol(res.gleba, { borda: CINZA(0.15), esp: 1.4 });
  const tamLote = Math.max(3, Math.min(6, pr.params.frente * ptm * 0.18));
  for (const l of res.lotes) { const q = P(centroide(l.pol.ext)); centrado(page, fonte, String(l.numero), q[0], q[1], tamLote, CINZA(0.65)); }
  for (const q of res.quadras) { const t = P(q.centro); centrado(page, negrito, q.nome, t[0], t[1] + tamLote * 1.6, tamLote * 1.6, CINZA(0.55)); }
  for (const rua of res.ruas) rotulo(rua.eixo, rua.nome.toUpperCase(), Math.max(4.5, Math.min(8, rua.largura * ptm * 0.32)), CINZA(0.45), 0);

  const tam = Math.max(3.4, Math.min(5.6, 4.2 * k * (ptm / 2.5)));
  const legenda: { simbolo: (x: number, y: number) => void; texto: string }[] = [];
  const resumo: [string, string][] = [];
  const criterios: string[] = [];
  let avisos: string[] = [];
  const traco = (cor: RGB, esp: number, tracejado?: number[]) => (x: number, y: number) => page.drawLine({ start: { x, y: y + 3 }, end: { x: x + 22, y: y + 3 }, thickness: esp, color: cor, dashArray: tracejado });
  const circulo = (fundo: RGB, borda: RGB, raio = 3) => (x: number, y: number) => page.drawCircle({ x: x + 11, y: y + 3, size: raio, color: fundo, borderColor: borda, borderWidth: 0.7 });
  const p = r.params;

  if (qual === "agua") {
    const a = r.agua;
    for (const lg of a.ligacoes) linha([lg.de, lg.ate], COR.agua, 0.25);
    for (const t of a.tubos) {
      const esp = t.dn <= 50 ? 0.9 : t.dn <= 75 ? 1.2 : t.dn <= 100 ? 1.5 : 2;
      for (const l of [t.linha, ...(t.linha2 ? [t.linha2] : [])]) linha(l, COR.agua, esp, t.adutora ? [5, 2] : undefined);
      rotulo(t.linha, `DN${t.dn}  ${fmt(t.L, 1)} m`, tam, COR.agua);
    }
    const pres = new Map(a.nos.map((x) => [x.no, x]));
    r.grafo.nos.forEach((no) => {
      const x = pres.get(no.id);
      if (!x) return;
      bola(no.p, 1.6, CINZA(1), COR.agua);
      const A = P(no.p);
      texto(page, fonte, `N${no.id + 1}  CT ${fmt(no.z)}  p=${fmt(x.pDin, 1)}`, A[0] + 3, A[1] - 7, tam * 0.85, rgb(0.06, 0.24, 0.48));
    });
    for (const rg of a.registros) { const A = P(rg.p); page.drawSvgPath("M-3 -2L3 2L3 -2L-3 2Z", { x: A[0], y: A[1], color: COR.agua }); }
    for (const ds of a.descargas) { const A = P(ds.p); page.drawSvgPath("M-3 3L3 3L0 8Z", { x: A[0], y: A[1], borderColor: COR.agua, borderWidth: 0.7, color: CINZA(1) }); }
    for (const v of a.ventosas) { const A = P(v.p); page.drawSvgPath("M0 -6L3 -9L0 -12L-3 -9Z", { x: A[0], y: A[1], borderColor: COR.agua, borderWidth: 0.7, color: CINZA(1) }); }
    for (const v of a.vrps) { const A = P(v.p); page.drawRectangle({ x: A[0] - 7, y: A[1] - 4, width: 14, height: 8, color: CINZA(1), borderColor: COR.agua, borderWidth: 0.8 }); centrado(page, negrito, "VRP", A[0], A[1], 4.5, COR.agua); }
    for (const h of a.hidrantes) { const A = P(h.p); page.drawCircle({ x: A[0] + 6, y: A[1] + 6, size: 4, color: COR.vermelho }); centrado(page, negrito, "H", A[0] + 6, A[1] + 6, 5, CINZA(1)); }
    const rs = a.reservatorio;
    if (rs) {
      const A = P(rs.p);
      page.drawCircle({ x: A[0], y: A[1], size: 8, color: COR.agua, borderColor: CINZA(1), borderWidth: 1.2 });
      centrado(page, negrito, "R", A[0], A[1], 8, CINZA(1));
      texto(page, negrito, `RESERVATÓRIO ${rs.tipo.toUpperCase()} ${rs.volume} m³`, A[0] + 11, A[1] + 2, tam * 1.1, COR.agua);
      texto(page, fonte, `NA mín. ${fmt(rs.na)} m${rs.tipo === "elevado" ? ` · fuste ${rs.altura} m` : ""}`, A[0] + 11, A[1] - 6, tam, COR.agua);
    }
    legenda.push(
      { simbolo: traco(COR.agua, 1.5), texto: "Rede de distribuição (DN e extensão)" },
      { simbolo: traco(COR.agua, 1.2, [5, 2]), texto: "Adutora do reservatório" },
      { simbolo: circulo(COR.agua, CINZA(1), 4), texto: "Reservatório" },
      { simbolo: circulo(COR.vermelho, COR.vermelho), texto: "Hidrante de coluna DN 100" },
      { simbolo: (x, y) => page.drawSvgPath("M-3 -2L3 2L3 -2L-3 2Z", { x: x + 11, y: y + 3, color: COR.agua }), texto: "Registro de manobra" },
      { simbolo: (x, y) => page.drawSvgPath("M-3 -1L3 -1L0 -6Z", { x: x + 11, y: y + 3, borderColor: COR.agua, borderWidth: 0.7 }), texto: "Descarga" },
      { simbolo: (x, y) => page.drawSvgPath("M0 3L3 0L0 -3L-3 0Z", { x: x + 11, y: y + 3, borderColor: COR.agua, borderWidth: 0.7 }), texto: "Ventosa" },
      { simbolo: circulo(CINZA(1), COR.agua, 1.8), texto: "Nó: cota do terreno (CT) e pressão dinâmica (mca)" },
    );
    resumo.push(["População de projeto", `${r.populacao.toLocaleString("pt-BR")} hab.`], ["Vazão máx. horária", `${fmt(a.resumo.qHora, 2)} L/s`],
      ...Object.entries(a.resumo.extensao).sort((x, y) => +x[0] - +y[0]).map(([dn, L]) => [`Tubo PVC DN ${dn}`, `${fmt(L, 1)} m`] as [string, string]),
      ["Pressão dinâmica", `${fmt(a.resumo.pMin, 1)} a ${fmt(a.resumo.pMax, 1)} mca`], ["Pressão estática máx.", `${fmt(a.resumo.pEstMax, 1)} mca`],
      ["Reservatório", rs ? `${rs.volume} m³ ${rs.tipo}` : "—"], ["Hidrantes / registros", `${a.hidrantes.length} / ${a.registros.length}`], ["Ligações prediais", String(a.ligacoes.length)]);
    criterios.push(`NBR 12218:2017 · ${p.habPorLote} hab./lote · ${p.perCapita} L/hab.dia · K1 ${fmt(p.k1, 1)} · K2 ${fmt(p.k2, 1)}`, `Hazen-Williams C = ${p.cHW} · perda máx. ${fmt(p.perdaMax, 0)} m/km · DN mín. 50`, `Pressão dinâmica ≥ ${p.pressaoMin} mca · estática ≤ ${p.pressaoMax} mca`, "Rede no passeio a 0,70 m do alinhamento; recobrimento 0,70 m (passeio) e 1,00 m (via)", "Rede malhada resolvida pelo gradiente global (EPANET)");
    avisos = a.avisos;
  } else if (qual === "esgoto") {
    const e = r.esgoto;
    for (const lg of e.ligacoes) linha([lg.de, lg.ate], COR.esgoto, 0.25);
    for (const t of e.trechos) {
      linha(t.linha, COR.esgoto, t.dn >= 200 ? 1.6 : 1.2);
      // seta no meio do trecho
      const L = comprimento(t.linha);
      const { pt, dir } = pontoNaPolilinha(t.linha, L / 2);
      const A = P(pt), ang = Math.atan2(dir[1], dir[0]);
      const s = 3.5;
      page.drawSvgPath(`M${(-s * Math.cos(ang) + s * 0.6 * Math.sin(ang)).toFixed(2)} ${(s * Math.sin(ang) + s * 0.6 * Math.cos(ang)).toFixed(2)}L${(s * Math.cos(ang)).toFixed(2)} ${(-s * Math.sin(ang)).toFixed(2)}L${(-s * Math.cos(ang) - s * 0.6 * Math.sin(ang)).toFixed(2)} ${(s * Math.sin(ang) - s * 0.6 * Math.cos(ang)).toFixed(2)}Z`, { x: A[0], y: A[1], color: COR.esgoto });
      rotulo(t.linha, `DN${t.dn}  i=${fmt(t.I * 100, 2)}%  ${fmt(t.L, 1)} m`, tam, COR.esgoto, 5);
    }
    if (e.elevatoria) linha(e.elevatoria.recalque, COR.esgoto, 1, [1.5, 2.5]);
    for (const pv of e.pvs) {
      const A = P(pv.p);
      if (pv.tipo === "TIL") page.drawRectangle({ x: A[0] - 2.2, y: A[1] - 2.2, width: 4.4, height: 4.4, color: CINZA(1), borderColor: COR.esgoto, borderWidth: 0.8 });
      else page.drawCircle({ x: A[0], y: A[1], size: pv.saida ? 4 : 2.8, color: pv.saida ? COR.esgoto : CINZA(1), borderColor: COR.esgoto, borderWidth: 0.9 });
      texto(page, negrito, pv.id, A[0] + 4, A[1] + 3, tam * 0.9, COR.esgoto);
      texto(page, fonte, `CT ${fmt(pv.z)} CF ${fmt(pv.fundo)} h ${fmt(pv.prof)}`, A[0] + 4, A[1] - 3.5, tam * 0.75, rgb(0.35, 0.22, 0.1));
    }
    const sd = e.saida;
    if (sd) {
      const A = P(sd.p);
      const rot = e.elevatoria ? "ESTAÇÃO ELEVATÓRIA" : sd.destino === "ete" ? "ESTAÇÃO DE TRATAMENTO (ETE)" : "LIGAÇÃO NA REDE PÚBLICA";
      page.drawRectangle({ x: A[0] + 8, y: A[1] - 18, width: negrito.widthOfTextAtSize(T(rot), tam * 1.05) + 8, height: tam * 1.05 + 6, color: COR.esgoto });
      texto(page, negrito, rot, A[0] + 12, A[1] - 15, tam * 1.05, CINZA(1));
    }
    legenda.push(
      { simbolo: traco(COR.esgoto, 1.2), texto: "Coletor (DN, declividade e extensão) e sentido do escoamento" },
      { simbolo: circulo(CINZA(1), COR.esgoto), texto: "Poço de visita (PV): CT tampa, CF fundo, h profundidade" },
      { simbolo: (x, y) => page.drawRectangle({ x: x + 8.8, y: y + 0.8, width: 4.4, height: 4.4, borderColor: COR.esgoto, borderWidth: 0.8 }), texto: "Terminal de inspeção e limpeza (TIL)" },
      { simbolo: traco(COR.esgoto, 0.25), texto: "Ligação predial DN 100" },
      ...(e.elevatoria ? [{ simbolo: traco(COR.esgoto, 1, [1.5, 2.5]), texto: "Linha de recalque" }] : []),
    );
    resumo.push(...Object.entries(e.resumo.extensao).sort((x, y) => +x[0] - +y[0]).map(([dn, L]) => [`Coletor PVC DN ${dn}`, `${fmt(L, 1)} m`] as [string, string]),
      ["Poços de visita", String(e.resumo.nPv)], ["TIL", String(e.resumo.nTil)], ["Profundidade média / máx.", `${fmt(e.resumo.profMedia)} / ${fmt(e.resumo.profMax)} m`],
      ["Vazão final no lançamento", `${fmt(e.resumo.qFinal, 2)} L/s`], ["Ligações prediais", String(e.ligacoes.length)]);
    criterios.push(`NBR 9649 · retorno ${fmt(p.retorno, 1)} · infiltração ${fmt(p.infiltracao, 2)} L/s.km · Q mín. 1,5 L/s`, "I mín. = 0,0055·Qi^-0,47 (tensão trativa ≥ 1 Pa), ≥ 0,5%", "y/D ≤ 0,75 · velocidade ≤ 5 m/s · tubo de queda ≥ 0,50 m", `DN mín. ${p.dnMinEsgoto} · recobrimento ${fmt(p.recobrimentoEsgoto, 2)} m · PV a cada ≤ ${p.distPv} m`);
    avisos = e.avisos;
  } else if (qual === "drenagem") {
    const d = r.drenagem;
    for (const sj of d.sarjetas) linha(sj.linha, COR.drenagem, 0.4, [1, 3]);
    for (const rm of d.ramais) linha([rm.de, rm.ate], COR.drenagem, 0.6);
    for (const t of d.trechos) { linha(t.linha, COR.drenagem, t.dn >= 800 ? 2 : t.dn >= 600 ? 1.6 : 1.2, [6, 2.5]); rotulo(t.linha, `Ø${t.dn}  i=${fmt(t.I * 100, 2)}%  Q=${fmt(t.q, 0)} L/s`, tam, COR.drenagem, 5); }
    for (const b of d.bocas) { const A = P(b.p); page.drawRectangle({ x: A[0] - 2.5, y: A[1] - 1.5, width: 5, height: 3, color: COR.drenagem }); }
    for (const pv of d.pvs) { const A = P(pv.p); page.drawCircle({ x: A[0], y: A[1], size: 2.6, color: CINZA(1), borderColor: COR.drenagem, borderWidth: 0.9 }); texto(page, fonte, `${pv.id} h ${fmt(pv.prof)}`, A[0] + 3.5, A[1] + 3, tam * 0.75, rgb(0.03, 0.4, 0.4)); }
    if (d.lancamento && d.trechos.length) {
      const A = P(d.lancamento.p);
      page.drawSvgPath("M-6 6L6 6L0 -6Z", { x: A[0], y: A[1], color: COR.drenagem, borderColor: CINZA(1), borderWidth: 0.8 });
      texto(page, negrito, `LANÇAMENTO ${fmt(d.lancamento.q / 1000, 2)} m³/s${d.lancamento.rio ? " (RIO)" : ""}`, A[0] + 9, A[1] - 3, tam * 1.05, COR.drenagem);
    }
    legenda.push(
      { simbolo: traco(COR.drenagem, 1.2, [6, 2.5]), texto: "Galeria de águas pluviais (Ø, declividade, vazão)" },
      { simbolo: (x, y) => page.drawRectangle({ x: x + 8.5, y: y + 1.5, width: 5, height: 3, color: COR.drenagem }), texto: "Boca de lobo" },
      { simbolo: traco(COR.drenagem, 0.6), texto: "Ramal da boca de lobo Ø400" },
      { simbolo: circulo(CINZA(1), COR.drenagem), texto: "Poço de visita de drenagem" },
      { simbolo: traco(COR.drenagem, 0.4, [1, 3]), texto: "Escoamento pela sarjeta" },
    );
    resumo.push(["Área drenada", `${fmt(d.resumo.areaDrenada / 1e4, 2)} ha`], ["C médio", fmt(d.resumo.cMedio, 2)], [`Chuva (T=${p.periodoRetorno} anos, ${p.tcInicial} min)`, `${fmt(d.resumo.i10, 1)} mm/h`],
      ...Object.entries(d.resumo.extensao).sort((x, y) => +x[0] - +y[0]).map(([dn, L]) => [`Galeria Ø${dn}`, `${fmt(L, 1)} m`] as [string, string]),
      ["Bocas de lobo", String(d.bocas.length)], ["Poços de visita", String(d.pvs.length)], ["Vazão no lançamento", `${fmt(d.resumo.qLancamento / 1000, 3)} m³/s`]);
    criterios.push("Método racional Q = C·i·A", `Chuva: ${p.idf.nome}`, `T = ${p.periodoRetorno} anos · tc inicial ${p.tcInicial} min`, "Sarjeta (Izzard): faixa alagada ≤ 2,0 m · n 0,016", "Galeria Ø mín. 400 · v de 0,75 a 6 m/s · PV ≤ 60 m · recobrimento 1,0 m");
    avisos = d.avisos;
  } else {
    const e = r.eletrica;
    for (const rm of e.ramais) linha([rm.de, rm.ate], COR.bt, 0.25, [1.2, 1.2]);
    for (const v of e.vaos) {
      const A = e.postes[v.a].p, B = e.postes[v.b].p;
      if (v.bt) linha([A, B], COR.bt, v.cabo === "3x1x120+70" ? 1.4 : 1);
      if (v.mt) linha([A, B], COR.mt, 1.1, [5, 2.5]);
    }
    for (const pt of e.postes) {
      const A = P(pt.p);
      const tr = pt.trafo !== null ? e.trafos[pt.trafo] : null;
      if (tr) {
        page.drawSvgPath("M0 -6L5 3L-5 3Z", { x: A[0], y: A[1], color: COR.mt, borderColor: CINZA(1), borderWidth: 0.6 });
        texto(page, negrito, `${tr.id} ${tr.kva.toLocaleString("pt-BR")} kVA`, A[0] + 6, A[1] + 4, tam, COR.mt);
      } else page.drawCircle({ x: A[0], y: A[1], size: 1.9, color: COR.ip, borderColor: CINZA(0.2), borderWidth: 0.5 });
      texto(page, fonte, `${pt.id} ${pt.altura}/${pt.esforco}`, A[0] + 3, A[1] - 5.5, tam * 0.72, CINZA(0.25));
    }
    if (e.entrada) { const A = P(e.entrada.p); page.drawSvgPath("M-5 6L0 -6L5 6Z", { x: A[0], y: A[1] - 8, color: COR.mt }); texto(page, negrito, "DERIVAÇÃO DA REDE DA DISTRIBUIDORA", A[0] + 7, A[1] - 12, tam, COR.mt); }
    legenda.push(
      { simbolo: traco(COR.mt, 1.1, [5, 2.5]), texto: "Média tensão — rede compacta 15 kV" },
      { simbolo: traco(COR.bt, 1), texto: "Baixa tensão — multiplexado 3×1×70+70 mm²" },
      { simbolo: traco(COR.bt, 1.4), texto: "Baixa tensão — multiplexado 3×1×120+70 mm²" },
      { simbolo: (x, y) => page.drawSvgPath("M0 -6L5 3L-5 3Z", { x: x + 11, y: y + 4, color: COR.mt }), texto: "Transformador (kVA)" },
      { simbolo: circulo(COR.ip, CINZA(0.2), 2), texto: "Poste (altura/esforço) com luminária LED" },
      { simbolo: traco(COR.bt, 0.4, [1.2, 1.2]), texto: "Ramal de ligação do lote" },
    );
    resumo.push(["Postes", String(e.resumo.nPostes)], ["Transformadores", e.trafos.map((t) => `${t.kva.toLocaleString("pt-BR")}`).join(" + ") + " kVA"], ["Demanda total", `${fmt(e.resumo.demanda, 1)} kVA`],
      ["Média tensão", `${fmt(e.resumo.extensaoMT, 0)} m`], ["Baixa tensão", `${fmt(e.resumo.extensaoBT, 0)} m`], ["Queda de tensão máx.", `${fmt(e.resumo.quedaMax)}%`],
      ["Iluminação", `${e.ip.quantidade} LED ${e.ip.potencia} W`], ["Iluminância média", `${fmt(e.ip.eMedia, 1)} lux (${e.ip.classe})`]);
    criterios.push(`Neoenergia DIS-NOR-012 rev. 08 · BT ${p.tensaoBT} V · unidade tipo ${p.padraoLote}`, "Demanda Tab. 17 × 1,28 (Tab. 18) · trafos 45/75/112,5 kVA (Tab. 19)", `Vão básico ${p.vao} m · queda ≤ ${fmt(p.quedaMax, 1)}% · circuito ≤ ${p.tensaoBT === "380/220" ? 500 : 200} m`, `Iluminação NBR 5101 classe ${e.ip.classe}: LED no poste da rede, unilateral`);
    avisos = e.avisos;
  }

  // ---------------- barra lateral ----------------
  const bx = barraX + 5 * MM, bw = larguraBarra - 10 * MM;
  let y = H - mO - 9 * MM;
  const titulo = (t: string) => {
    page.drawRectangle({ x: barraX, y: y - 3.5 * MM, width: larguraBarra, height: 7 * MM, color: CINZA(0.12) });
    texto(page, negrito, t, bx, y - 1.4 * MM, 7.5 * k, CINZA(1));
    y -= 9 * MM;
  };
  for (const l of linhasDe(TITULOS[qual], negrito, 10.5 * k, bw)) { texto(page, negrito, l, bx, y, 10.5 * k, CINZA(0)); y -= 13 * k; }
  texto(page, fonte, `${pr.nome.toUpperCase()}`, bx, y, 8 * k, CINZA(0.25));
  y -= 14 * k;
  titulo("LEGENDA");
  for (const it of legenda) { it.simbolo(bx, y); texto(page, fonte, it.texto, bx + 28, y + 0.5, 6.4 * k, CINZA(0.1)); y -= 10.5 * k; }
  y -= 2 * MM;
  titulo("QUADRO RESUMO");
  for (const [rot, val] of resumo) {
    texto(page, fonte, rot, bx, y, 6.6 * k, CINZA(0.1));
    const s = T(val);
    texto(page, negrito, s, bx + bw - negrito.widthOfTextAtSize(s, 6.6 * k), y, 6.6 * k, CINZA(0));
    page.drawLine({ start: { x: bx, y: y - 2.6 }, end: { x: bx + bw, y: y - 2.6 }, thickness: 0.25, color: CINZA(0.75) });
    y -= 10.5 * k;
  }
  y -= 2 * MM;
  titulo("CRITÉRIOS DE PROJETO");
  for (const cr of criterios) for (const l of linhasDe(`• ${cr}`, fonte, 6.2 * k, bw)) { texto(page, fonte, l, bx, y, 6.2 * k, CINZA(0.15)); y -= 8.6 * k; }
  // observações até onde couber, sobre o carimbo
  const topoCarimbo = mO + 74 * MM * Math.min(1, k * 1.1);
  if (avisos.length && y - 12 * MM > topoCarimbo) {
    y -= 2 * MM;
    titulo("OBSERVAÇÕES");
    for (const av of avisos) {
      const ls = linhasDe(`• ${av}`, fonte, 6 * k, bw);
      if (y - ls.length * 8.2 * k < topoCarimbo + 4 * MM) break;
      for (const l of ls) { texto(page, fonte, l, bx, y, 6 * k, rgb(0.55, 0.3, 0)); y -= 8.2 * k; }
    }
  }

  // carimbo
  page.drawLine({ start: { x: barraX, y: topoCarimbo }, end: { x: W - mO, y: topoCarimbo }, thickness: 1 });
  let cyy = topoCarimbo - 6 * MM;
  if (logo) {
    const s = Math.min((bw * 0.5) / logo.width, (16 * MM) / logo.height);
    page.drawImage(logo, { x: bx, y: cyy - logo.height * s + 4 * MM, width: logo.width * s, height: logo.height * s });
    cyy -= Math.max(14 * MM, logo.height * s);
  }
  const campo = (rot: string, val: string) => {
    texto(page, fonte, rot, bx, cyy, 5.6 * k, CINZA(0.4));
    for (const l of linhasDe(val || "—", negrito, 6.6 * k, bw).slice(0, 2)) { cyy -= 8 * k; texto(page, negrito, l, bx, cyy, 6.6 * k, CINZA(0)); }
    cyy -= 9 * k;
  };
  if (c.empresa) campo("EMPRESA", `${c.empresa}${c.cnpj ? ` — CNPJ ${c.cnpj}` : ""}`);
  campo("EMPREENDIMENTO / PROPRIETÁRIO", `${pr.nome}${c.proprietario ? ` — ${c.proprietario}` : ""}`);
  campo("MUNICÍPIO", [c.municipio, c.uf].filter(Boolean).join("/"));
  campo("RESPONSÁVEL TÉCNICO", `${c.rt || "—"}${c.rtTitulo ? ` — ${c.rtTitulo}` : ""}${c.rtRegistro ? ` — ${c.rtRegistro}` : ""}${c.trt ? ` — ART/TRT ${c.trt}` : ""}`);
  const linhaFinal = `ESCALA 1:${den}   ·   FOLHA ${n}/${total}   ·   ${new Date().toLocaleDateString("pt-BR")}   ·   SIRGAS 2000 / UTM ${c.fuso}S`;
  texto(page, negrito, linhaFinal, bx, mO + 4 * MM, Math.min(7 * k, (bw / negrito.widthOfTextAtSize(T(linhaFinal), 7 * k)) * 7 * k), CINZA(0));

  // escala gráfica e norte, embaixo do desenho
  const passo = [10, 20, 25, 50, 100, 200].find((m) => m * ptm >= 40) ?? 200;
  const ex = area.x, ey = mO + 4 * MM;
  for (let i = 0; i < 4; i++) page.drawRectangle({ x: ex + i * passo * ptm, y: ey, width: passo * ptm, height: 3, color: i % 2 ? CINZA(1) : CINZA(0), borderColor: CINZA(0), borderWidth: 0.4 });
  for (let i = 0; i <= 4; i++) centrado(page, fonte, `${i * passo}`, ex + i * passo * ptm, ey + 8, 5.5 * k, CINZA(0));
  texto(page, fonte, "m", ex + 4 * passo * ptm + 6, ey, 5.5 * k, CINZA(0));
  const nx = area.x + area.w - 10 * MM, ny = H - mO - 18 * MM;
  page.drawSvgPath("M0 -14L6 6L0 2L-6 6Z", { x: nx, y: ny, color: CINZA(0) });
  centrado(page, negrito, "N", nx, ny + 20, 9 * k, CINZA(0));
}
