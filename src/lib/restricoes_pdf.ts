// Relatório "Análise de restrições" em PDF (pdf-lib, no navegador): croqui do
// imóvel com as áreas encontradas, tabela por base consultada, data/hora da
// consulta, servidores que responderam e os que não, e o aviso de que é consulta
// a bases públicas e não substitui certidão. Não cobra crédito: dentro do
// serviço, o serviço já pagou.
import proj4mod from "proj4";
import { PDFDocument, StandardFonts, clip, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb } from "pdf-lib";
import type { PDFFont, PDFPage, RGB } from "pdf-lib";
import { GEO_DEF, utmDef } from "../../supabase/functions/_shared/geo.ts";
import { textoWinAnsi } from "../../supabase/functions/_shared/texto.ts";
import {
  AVISO_RESTRICOES, fmtData, fmtHa, fmtM, resumoRestricoes, ROTULO_CLASSE, textoFonte, textoItem,
} from "./restricoes.ts";
import type { LonLat, ResultadoRestricoes } from "./restricoes.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];
const T = (s: string) => textoWinAnsi(s);

export interface DadosRelatorioRestricoes {
  /** nome do imóvel / denominação */
  imovel?: string | null;
  municipio?: string | null;
  uf?: string | null;
  proprietario?: string | null;
  /** quem emitiu (empresa / responsável) */
  emitente?: string | null;
  // ---- extensões da Consultar imóvel (#/consulta); sem elas, o PDF é o de sempre ----
  /** título do documento (padrão "Análise de restrições do imóvel") */
  titulo?: string;
  /** a frase do topo no lugar do resumo das restrições, com a cor do tom */
  resumo?: { texto: string; tom: "neutro" | "ok" | "aviso" | "alerta" | "perigo"; linhas?: string[] } | null;
  /** a área do imóvel no cabeçalho (o mesmo motor; vale quando a consulta de restrições não respondeu) */
  areaM2?: number | null;
  fuso?: number | null;
  /** seções antes do resultado por base (identificação, SIGEF, CAR, queimadas, ambiente) */
  secoes?: SecaoRelatorio[];
  /** o laudo por IA, antes do aviso final */
  laudo?: { texto: string; modelo?: string | null; quando: string } | null;
  /** pontos no croqui (focos de queimada) */
  pontos?: { lonlat: LonLat; cor: string }[];
}

export interface SecaoRelatorio {
  titulo: string;
  linhas: { texto: string; destaque?: boolean; sub?: string | null }[];
}

const COR_TOM: Record<string, RGB> = {
  neutro: rgb(0.38, 0.42, 0.4), ok: rgb(0.1, 0.5, 0.27), aviso: rgb(0.62, 0.4, 0.04), alerta: rgb(0.62, 0.4, 0.04), perigo: rgb(0.78, 0.13, 0.13),
};

const A4: [number, number] = [595.28, 841.89];
const M = 40;
const COR_TEXTO = rgb(0.12, 0.14, 0.13);
const COR_SUB = rgb(0.38, 0.42, 0.4);
const COR_LINHA = rgb(0.82, 0.84, 0.83);
export const COR_CLASSE: Record<string, RGB> = {
  sobrepoe: rgb(0.78, 0.13, 0.13), encosta: rgb(0.8, 0.5, 0.02), livre: rgb(0.1, 0.5, 0.27), nao_consultado: rgb(0.45, 0.45, 0.45),
  // consulta incompleta ou sem resposta: alerta (âmbar escuro), nunca o verde de livre
  incompleta: rgb(0.62, 0.4, 0.04), falhou: rgb(0.62, 0.4, 0.04),
};

/** Cor do resumo no topo do PDF: a do estado geral (verde só com todas as bases completas e livres). */
export function corDoResumo(r: ResultadoRestricoes): RGB {
  return COR_CLASSE[resumoRestricoes(r).estado];
}

const hex = (h: string): RGB => {
  const n = parseInt(h.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** Quebra o texto na largura (em pt) com a fonte dada. */
function quebrar(texto: string, fonte: PDFFont, tam: number, largura: number): string[] {
  const out: string[] = [];
  for (const paragrafo of T(texto).split("\n")) {
    let linha = "";
    for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
      const tentativa = linha ? `${linha} ${palavra}` : palavra;
      if (fonte.widthOfTextAtSize(tentativa, tam) <= largura || !linha) linha = tentativa;
      else { out.push(linha); linha = palavra; }
    }
    out.push(linha);
  }
  return out;
}

const dataHora = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};

/**
 * Monta o PDF. `aneis` é o imóvel em lon/lat (o mesmo que foi consultado).
 */
export async function gerarPdfRestricoes(r: ResultadoRestricoes, aneis: LonLat[][], dados: DadosRelatorioRestricoes = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const tituloDoc = dados.titulo || "Análise de restrições do imóvel";
  doc.setTitle(tituloDoc);
  doc.setProducer("Vertces");
  doc.setCreationDate(new Date(r.quando));
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = A4[0] - 2 * M;

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const novaPagina = () => { page = doc.addPage(A4); y = A4[1] - M; };
  const garantir = (h: number) => { if (y - h < M + 30) novaPagina(); };
  const escrever = (texto: string, o: { tam?: number; f?: PDFFont; cor?: RGB; x?: number; larg?: number; entre?: number } = {}) => {
    const tam = o.tam ?? 9, f = o.f ?? fonte, x = o.x ?? M, larg = o.larg ?? L - (x - M);
    for (const l of quebrar(texto, f, tam, larg)) {
      garantir(tam + 3);
      page.drawText(l, { x, y: y - tam, size: tam, font: f, color: o.cor ?? COR_TEXTO });
      y -= tam + (o.entre ?? 3);
    }
  };
  const regua = (esp = 6) => { garantir(esp * 2); y -= esp; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: COR_LINHA }); y -= esp; };

  // ---- cabeçalho ----
  escrever(tituloDoc, { tam: 16, f: negrito, entre: 6 });
  const ident = [dados.imovel, [dados.municipio, dados.uf].filter(Boolean).join("/"), dados.proprietario ? `Proprietário: ${dados.proprietario}` : ""].filter(Boolean).join(" · ");
  if (ident) escrever(ident, { tam: 10 });
  escrever(`Área do imóvel: ${fmtHa(dados.areaM2 ?? r.areaImovelM2)} (UTM SIRGAS 2000, fuso ${dados.fuso ?? r.fuso}S) · Consulta em ${dataHora(r.quando)}`, { tam: 9, cor: COR_SUB });
  if (dados.emitente) escrever(`Emitido por: ${dados.emitente}`, { tam: 9, cor: COR_SUB });
  y -= 4;
  if (dados.resumo) {
    escrever(dados.resumo.texto, { tam: 12, f: negrito, cor: COR_TOM[dados.resumo.tom] ?? COR_TEXTO, entre: 4 });
    for (const l of dados.resumo.linhas ?? []) escrever(`• ${l}`, { tam: 9, x: M + 6 });
    y -= 4;
  } else {
    const resumo = resumoRestricoes(r);
    escrever(resumo.texto, { tam: 11, f: negrito, cor: corDoResumo(r), entre: 6 });
  }

  // ---- croqui ----
  const H = 290;
  garantir(H + 40);
  desenharCroqui(page, r, aneis, { x: M, y: y - H, w: L, h: H }, fonte, dados.pontos ?? []);
  y -= H + 6;
  // legenda
  const tipos = r.fontes.filter((f) => f.itens.length);
  let lx = M;
  const legenda = [{ cor: rgb(0, 0, 0), rotulo: "Imóvel" }, ...tipos.map((f) => ({ cor: hex(f.cor), rotulo: f.singular }))];
  garantir(14);
  for (const it of legenda) {
    const w = fonte.widthOfTextAtSize(T(it.rotulo), 8) + 18;
    if (lx + w > A4[0] - M) { lx = M; y -= 12; garantir(12); }
    page.drawRectangle({ x: lx, y: y - 8, width: 9, height: 7, color: it.cor, opacity: it.rotulo === "Imóvel" ? 0 : 0.5, borderColor: it.cor, borderWidth: 1 });
    page.drawText(T(it.rotulo), { x: lx + 12, y: y - 8, size: 8, font: fonte, color: COR_TEXTO });
    lx += w + 6;
  }
  y -= 16;
  escrever(`Áreas recortadas na vizinhança do imóvel. Cor mais forte: parte do imóvel dentro da restrição.`, { tam: 7.5, cor: COR_SUB });

  // ---- seções da consulta (identificação, SIGEF, CAR, queimadas, ambiente) ----
  for (const sec of dados.secoes ?? []) {
    regua(8);
    escrever(sec.titulo, { tam: 12, f: negrito, entre: 6 });
    for (const l of sec.linhas) {
      garantir(24);
      escrever(l.texto, { tam: 9, f: l.destaque ? negrito : fonte, x: M + 6 });
      if (l.sub) escrever(l.sub, { tam: 7.5, cor: COR_SUB, x: M + 12 });
    }
  }

  // ---- tabela por base ----
  regua(8);
  escrever(dados.secoes?.length ? "Restrições — resultado por base consultada" : "Resultado por base consultada", { tam: 12, f: negrito, entre: 6 });
  if (!r.fontes.length) escrever("As bases de restrição não responderam nesta consulta. Refaça a consulta mais tarde.", { tam: 9, f: negrito, cor: COR_CLASSE.incompleta });
  for (const f of r.fontes) {
    garantir(40);
    const cor = COR_CLASSE[f.classe];
    const selo = T(ROTULO_CLASSE[f.classe].toUpperCase());
    const ws = negrito.widthOfTextAtSize(selo, 7.5) + 10;
    page.drawRectangle({ x: M, y: y - 11, width: ws, height: 12, color: cor });
    page.drawText(selo, { x: M + 5, y: y - 8.5, size: 7.5, font: negrito, color: rgb(1, 1, 1) });
    page.drawText(T(`${f.rotulo} (${f.orgao})`), { x: M + ws + 8, y: y - 9, size: 10, font: negrito, color: COR_TEXTO });
    y -= 16;
    escrever(textoFonte(f, r.encostaM), { tam: 9, x: M + 10 });
    for (const it of f.itens) {
      garantir(30);
      escrever(`• ${it.nome} — ${textoItem(it)}`, { tam: 9, f: negrito, x: M + 14 });
      if (it.detalhes.length) escrever(it.detalhes.join(" · "), { tam: 8, cor: COR_SUB, x: M + 22 });
    }
    const fonteTxt = f.classe === "nao_consultado"
      ? `Servidor: sem resposta (${f.motivo ?? "?"})`
      : `Servidor: ${f.servidor}${f.atualizacao ? ` · registro mais recente atualizado em ${fmtData(f.atualizacao)}` : ""}${f.cortada ? " · resposta cortada no limite de registros" : ""}${f.motivo ? ` · ${f.motivo}` : ""}`;
    escrever(fonteTxt, { tam: 7.5, cor: COR_SUB, x: M + 10 });
    escrever(f.nota, { tam: 7.5, cor: COR_SUB, x: M + 10, entre: 6 });
  }

  // ---- fontes ----
  regua(8);
  escrever("Fontes consultadas", { tam: 12, f: negrito, entre: 6 });
  const ok = r.fontes.filter((f) => f.classe !== "nao_consultado");
  const fora = r.fontes.filter((f) => f.classe === "nao_consultado");
  const cortadas = r.fontes.filter((f) => f.classe === "incompleta");
  escrever(ok.length ? ok.map((f) => `${f.singular}: ${f.servidor}`).join("; ") + "." : "Nenhuma base respondeu.", { tam: 8.5 });
  if (fora.length) escrever(`Não consultadas: ${fora.map((f) => `${f.singular} (${f.motivo})`).join("; ")}. Refaça a consulta mais tarde para estas bases.`, { tam: 8.5, f: negrito, cor: COR_CLASSE.incompleta });
  if (cortadas.length) escrever(`Resposta incompleta (mais áreas do que o limite da consulta): ${cortadas.map((f) => f.singular).join("; ")}. Nestas bases o resultado não permite afirmar que o imóvel está livre.`, { tam: 8.5, f: negrito, cor: COR_CLASSE.incompleta });
  escrever(`Critério: "sobrepõe" quando a interseção passa de 1 m²; "encosta" quando a área está a até ${fmtM(r.encostaM)} do perímetro sem sobrepor. Áreas calculadas em UTM (fuso ${r.fuso}S) com o mesmo método da área do imóvel.`, { tam: 8, cor: COR_SUB });

  // ---- laudo por IA ----
  if (dados.laudo?.texto) {
    regua(8);
    escrever("Parecer técnico preliminar (escrito por IA com os dados acima)", { tam: 12, f: negrito, entre: 6 });
    escrever(`Gerado em ${dataHora(dados.laudo.quando)}${dados.laudo.modelo ? ` · modelo ${dados.laudo.modelo}` : ""}. Revise antes de usar: a responsabilidade técnica é do profissional.`, { tam: 7.5, cor: COR_SUB, entre: 6 });
    for (const par of dados.laudo.texto.split(/\n+/)) {
      const t = par.trim();
      if (!t) continue;
      const titulo = /^\d+\.\s/.test(t) && t.length < 80;
      escrever(t, { tam: titulo ? 10 : 9, f: titulo ? negrito : fonte, entre: titulo ? 4 : 3, x: /^[-•]/.test(t) ? M + 8 : M });
    }
  }

  // ---- aviso ----
  regua(8);
  escrever(AVISO_RESTRICOES, { tam: 9, f: negrito });

  // rodapé em todas as páginas
  const paginas = doc.getPages();
  paginas.forEach((p, i) => {
    p.drawText(T(`${dados.titulo ? dados.titulo : "Análise de restrições"} · consulta de ${dataHora(r.quando)} · página ${i + 1} de ${paginas.length}`), { x: M, y: 22, size: 7, font: fonte, color: COR_SUB });
  });
  return doc.save();
}

/** O croqui em escala: imóvel em preto, as áreas na cor do tipo, recortadas no quadro. */
function desenharCroqui(page: PDFPage, r: ResultadoRestricoes, aneis: LonLat[][], q: { x: number; y: number; w: number; h: number }, fonte: PDFFont, extras: { lonlat: LonLat; cor: string }[] = []) {
  const def = utmDef(r.fuso);
  const U = (p: LonLat) => proj(GEO_DEF, def, p);
  const im = aneis.filter((a) => a.length >= 3).map((a) => a.map(U));
  page.drawRectangle({ x: q.x, y: q.y, width: q.w, height: q.h, color: rgb(0.97, 0.98, 0.97), borderColor: COR_LINHA, borderWidth: 0.8 });
  if (!im.length) return;
  const xs = im.flat().map((p) => p[0]), ys = im.flat().map((p) => p[1]);
  let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // o imóvel ocupa ~60% do quadro; ao redor, as áreas vizinhas
  const folga = Math.max((x1 - x0) * 0.35, (y1 - y0) * 0.35, 150);
  x0 -= folga; x1 += folga; y0 -= folga; y1 += folga;
  const esc = Math.min(q.w / (x1 - x0), q.h / (y1 - y0));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // coordenadas do SVG de drawSvgPath: origem no canto superior esquerdo do quadro, y para baixo
  const sx = (p: [number, number]) => (q.w / 2 + (p[0] - cx) * esc).toFixed(2);
  const sy = (p: [number, number]) => (q.h / 2 - (p[1] - cy) * esc).toFixed(2);
  const caminho = (pols: [number, number][][]) => pols.map((a) => `M${a.map((p) => `${sx(p)} ${sy(p)}`).join(" L")} Z`).join(" ");
  const opts = { x: q.x, y: q.y + q.h };

  page.pushOperators(pushGraphicsState(), rectangle(q.x, q.y, q.w, q.h), clip(), endPath());
  for (const f of r.fontes) {
    const cor = hex(f.cor);
    for (const it of f.itens) {
      if (it.geometria) {
        for (const pol of it.geometria.coordinates) {
          page.drawSvgPath(caminho(pol.map((a) => a.map((p) => U(p as LonLat)))), { ...opts, color: cor, opacity: 0.22, borderColor: cor, borderWidth: 1, borderOpacity: 0.9 });
        }
      } else if (it.classe === "sobrepoe" && !it.pontos.length) {
        // imóvel inteiro dentro (faixa de fronteira): o quadro todo na cor
        page.drawRectangle({ x: q.x, y: q.y, width: q.w, height: q.h, color: cor, opacity: 0.12 });
      }
      if (it.sobreposta) {
        for (const pol of it.sobreposta.coordinates) {
          page.drawSvgPath(caminho(pol.map((a) => a.map((p) => U(p as LonLat)))), { ...opts, color: cor, opacity: 0.55 });
        }
      }
      for (const p of it.pontos) {
        const u = U(p);
        page.drawCircle({ x: q.x + Number(sx(u)), y: q.y + q.h - Number(sy(u)), size: 3.2, color: cor, borderColor: rgb(1, 1, 1), borderWidth: 0.8 });
      }
    }
  }
  page.drawSvgPath(caminho(im), { ...opts, borderColor: rgb(0, 0, 0), borderWidth: 1.8 });
  for (const p of extras) {
    const u = U(p.lonlat);
    page.drawCircle({ x: q.x + Number(sx(u)), y: q.y + q.h - Number(sy(u)), size: 2.6, color: hex(p.cor), borderColor: rgb(1, 1, 1), borderWidth: 0.6 });
  }
  page.pushOperators(popGraphicsState());

  // norte e escala
  const nx = q.x + q.w - 22, ny = q.y + q.h - 14;
  page.drawSvgPath("M0 0 L6 16 L0 12 L-6 16 Z", { x: nx, y: ny, color: rgb(0.1, 0.1, 0.1) });
  page.drawText("N", { x: nx - 3, y: ny + 2, size: 8, font: fonte, color: rgb(0.1, 0.1, 0.1) });
  const alvo = (q.w * 0.22) / esc;
  const pot = 10 ** Math.floor(Math.log10(alvo));
  const passo = [1, 2, 5, 10].map((k) => k * pot).filter((v) => v <= alvo).pop() ?? pot;
  const wb = passo * esc;
  const bx = q.x + 10, by = q.y + 10;
  page.drawRectangle({ x: bx, y: by, width: wb / 2, height: 4, color: rgb(0.1, 0.1, 0.1) });
  page.drawRectangle({ x: bx + wb / 2, y: by, width: wb / 2, height: 4, color: rgb(1, 1, 1), borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 0.6 });
  page.drawText(T(passo >= 1000 ? `${passo / 1000} km` : `${passo} m`), { x: bx + wb + 4, y: by, size: 7.5, font: fonte, color: rgb(0.1, 0.1, 0.1) });
  const escala = Math.round(1 / (esc / (72 / 0.0254)));
  page.drawText(T(`Escala aprox. 1:${escala.toLocaleString("pt-BR")} (A4)`), { x: bx, y: by + 8, size: 7, font: fonte, color: COR_SUB });
}

export const nomeArquivoRestricoes = (r: ResultadoRestricoes, imovel?: string | null, prefixo = "analise-restricoes") =>
  `${prefixo}-${(imovel || "imovel").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\w-]+/g, "_").slice(0, 40)}-${r.quando.slice(0, 10)}.pdf`;

