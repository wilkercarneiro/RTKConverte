// Relatório de terraplanagem em PDF (pdf-lib, no navegador): números da obra,
// o mapa de corte e aterro, as duas seções e o método. O mapa vem pronto em
// PNG (desenho.ts, o mesmo da tela); sem ele (teste em node), o croqui sai em
// vetor só com a plataforma e o contorno.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage, RGB } from "pdf-lib";
import { textoWinAnsi } from "../../../supabase/functions/_shared/texto.ts";
import type { ResultadoTerraplanagem, Secao } from "./calculo.ts";
import { fmtN } from "./calculo.ts";
import type { ProjetoTerraplanagem } from "./modelo.ts";
import { rumo, textoCaminhoes, textoSaldo } from "./textos.ts";

const T = (s: string) => textoWinAnsi(s);
const A4: [number, number] = [595.28, 841.89];
const M = 40;
const COR_TEXTO = rgb(0.07, 0.125, 0.1);
const COR_SUB = rgb(0.36, 0.42, 0.39);
const COR_LINHA = rgb(0.85, 0.87, 0.86);
const VERDE = rgb(0.055, 0.23, 0.17);
const CORTE = rgb(0.71, 0.14, 0.09);
const ATERRO = rgb(0.11, 0.3, 0.85);
const OURO = rgb(0.72, 0.47, 0.12);

export interface DadosRelatorio {
  emitente?: string | null;
  responsavel?: string | null;
  quando?: Date;
}

function quebrar(texto: string, f: PDFFont, tam: number, largura: number): string[] {
  const out: string[] = [];
  for (const par of T(texto).split("\n")) {
    let l = "";
    for (const p of par.split(/\s+/).filter(Boolean)) {
      const t = l ? `${l} ${p}` : p;
      if (f.widthOfTextAtSize(t, tam) <= largura || !l) l = t; else { out.push(l); l = p; }
    }
    out.push(l);
  }
  return out;
}

const m3 = (v: number) => `${fmtN(v, v >= 100 ? 0 : 1)} m³`;
const m2 = (v: number) => `${fmtN(v, v >= 100 ? 0 : 1)} m²`;

export async function gerarPdfTerraplanagem(r: ResultadoTerraplanagem, pr: ProjetoTerraplanagem, mapaPng: Uint8Array | null, dados: DadosRelatorio = {}): Promise<Uint8Array> {
  const quando = dados.quando ?? new Date();
  const doc = await PDFDocument.create();
  doc.setTitle(T(`Terraplanagem — ${pr.nome}`));
  doc.setProducer("Vertces");
  doc.setCreationDate(quando);
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = A4[0] - 2 * M;
  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const nova = () => { page = doc.addPage(A4); y = A4[1] - M; };
  const garantir = (h: number) => { if (y - h < M + 24) nova(); };
  const escrever = (t: string, o: { tam?: number; f?: PDFFont; cor?: RGB; x?: number; larg?: number; entre?: number } = {}) => {
    const tam = o.tam ?? 9, f = o.f ?? fonte, x = o.x ?? M, larg = o.larg ?? L - (x - M);
    for (const l of quebrar(t, f, tam, larg)) {
      garantir(tam + 3);
      page.drawText(l, { x, y: y - tam, size: tam, font: f, color: o.cor ?? COR_TEXTO });
      y -= tam + (o.entre ?? 3);
    }
  };
  const regua = (esp = 8) => { garantir(esp * 2); y -= esp; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: COR_LINHA }); y -= esp; };

  // ---- cabeçalho ----
  escrever("TERRAPLANAGEM · ESTIMATIVA DE CORTE E ATERRO", { tam: 8, f: negrito, cor: COR_SUB, entre: 4 });
  escrever(pr.nome, { tam: 18, f: negrito, entre: 6 });
  const fonteTxt = pr.fonte.tipo === "arquivo" ? `Levantamento: ${pr.fonte.arquivo || "arquivo de pontos"}` : `Terreno: ${pr.fonte.descricao}`;
  escrever(`${fonteTxt} · ${r.nPontos} pontos · ${pr.fuso ? `UTM SIRGAS 2000, fuso ${pr.fuso}S` : "coordenadas UTM"} · emitido em ${quando.toLocaleDateString("pt-BR")} às ${quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`, { tam: 8.5, cor: COR_SUB });
  if (dados.emitente || dados.responsavel) escrever([dados.emitente, dados.responsavel].filter(Boolean).join(" · "), { tam: 8.5, cor: COR_SUB });
  y -= 8;

  // ---- números ----
  const caixas: { rot: string; val: string; sub: string; cor: RGB }[] = [
    { rot: "CORTE", val: m3(r.corte), sub: `em ${m2(r.areaCorte)}`, cor: CORTE },
    { rot: "ATERRO", val: m3(r.aterro), sub: `em ${m2(r.areaAterro)}`, cor: ATERRO },
    { rot: "SALDO", val: Math.abs(r.saldo) < Math.max(1, r.corte) * 0.01 ? "equilibrado" : m3(Math.abs(r.saldo)), sub: textoSaldo(r), cor: VERDE },
    { rot: "CAMINHÕES (APROX.)", val: fmtN(r.caminhoes.quantidade, 0), sub: textoCaminhoes(r, pr, true), cor: OURO },
  ];
  const wc = (L - 3 * 8) / 4, hc = 62;
  garantir(hc + 10);
  caixas.forEach((c, i) => {
    const x = M + i * (wc + 8);
    page.drawRectangle({ x, y: y - hc, width: wc, height: hc, color: rgb(0.97, 0.98, 0.975), borderColor: COR_LINHA, borderWidth: 0.7 });
    page.drawRectangle({ x, y: y - hc, width: 3, height: hc, color: c.cor });
    page.drawText(T(c.rot), { x: x + 10, y: y - 14, size: 7, font: negrito, color: COR_SUB });
    page.drawText(T(c.val), { x: x + 10, y: y - 33, size: 15, font: negrito, color: c.cor });
    quebrar(c.sub, fonte, 7, wc - 16).slice(0, 2).forEach((l, k) => page.drawText(l, { x: x + 10, y: y - 45 - k * 8.5, size: 7, font: fonte, color: COR_SUB }));
  });
  y -= hc + 12;

  // ---- parâmetros (duas colunas) ----
  const linhas: [string, string][] = [
    ["Cota da plataforma (no centro)", `${fmtN(r.cota, 3)} m${r.equilibrio ? " — equilibra corte e aterro" : " — informada"}`],
    ["Plataforma", `${m2(r.areaPlataforma)} · ${fmtN(r.retangulo.comprimento, 1)} × ${fmtN(r.retangulo.largura, 1)} m · perímetro ${fmtN(r.perimetroPlataforma, 1)} m`],
    ["Inclinação", pr.cota.inclinacao > 0 ? `${fmtN(pr.cota.inclinacao, 2)}% para ${rumo(pr.cota.direcao)} (azimute ${fmtN(pr.cota.direcao, 0)}°)` : "plana"],
    ["Taludes (V:H)", `corte 1:${fmtN(pr.taludes.corte, 2)} · aterro 1:${fmtN(pr.taludes.aterro, 2)}`],
    ["Maior corte / maior aterro", `${fmtN(r.maxCorte, 2)} m / ${fmtN(r.maxAterro, 2)} m`],
    ["Empolamento · compactação", `${fmtN(pr.fatores.empolamento, 0)}% · 1 m³ de aterro pede ${fmtN(pr.fatores.compactacao, 2)} m³ de corte`],
    ["Terreno no levantamento", `cotas de ${fmtN(r.faixaTerreno.min, 2)} a ${fmtN(r.faixaTerreno.max, 2)} m · desnível ${fmtN(r.faixaTerreno.max - r.faixaTerreno.min, 2)} m`],
    ["Plataforma no contorno", pr.plataforma.modo === "contorno" ? `contorno dos pontos recuado ${fmtN(r.folga ?? 0, 1)} m (espaço do talude)` : pr.plataforma.modo === "retangulo" ? "retângulo desenhado no mapa" : `polígono${pr.plataforma.nomePoligono ? ` (${pr.plataforma.nomePoligono})` : ""}`],
  ];
  const colW = (L - 16) / 2;
  for (let i = 0; i < linhas.length; i += 2) {
    garantir(26);
    const y0 = y;
    let ymin = y;
    for (let k = 0; k < 2 && i + k < linhas.length; k++) {
      const [rot, val] = linhas[i + k];
      const x = M + k * (colW + 16);
      y = y0;
      escrever(rot, { tam: 7, f: negrito, cor: COR_SUB, x, larg: colW, entre: 2 });
      escrever(val, { tam: 9, x, larg: colW, entre: 2 });
      ymin = Math.min(ymin, y);
    }
    y = ymin - 5;
  }

  // ---- mapa ----
  regua(6);
  escrever("Mapa de corte e aterro", { tam: 11, f: negrito, entre: 5 });
  const H = 300;
  garantir(H + 30);
  if (mapaPng) {
    try {
      const img = await doc.embedPng(mapaPng);
      const esc = Math.min(L / img.width, H / img.height);
      const w = img.width * esc, h = img.height * esc;
      page.drawImage(img, { x: M + (L - w) / 2, y: y - h, width: w, height: h });
      page.drawRectangle({ x: M + (L - w) / 2, y: y - h, width: w, height: h, borderColor: COR_LINHA, borderWidth: 0.7 });
      y -= h + 6;
    } catch { croqui(page, r, { x: M, y: y - H, w: L, h: H }); y -= H + 6; }
  } else { croqui(page, r, { x: M, y: y - H, w: L, h: H }); y -= H + 6; }
  // legenda
  const leg: [string, RGB, "faixa" | "linha" | "tracejado"][] = [
    ["Corte", CORTE, "faixa"], ["Aterro", ATERRO, "faixa"], ["Plataforma", VERDE, "linha"],
    ["Crista do talude", CORTE, "tracejado"], ["Pé do talude", ATERRO, "tracejado"], ["Linha de passagem", COR_TEXTO, "tracejado"], ["Seções", OURO, "tracejado"],
  ];
  let lx = M;
  garantir(14);
  for (const [rot, cor, tipo] of leg) {
    const w = fonte.widthOfTextAtSize(T(rot), 7.5) + 24;
    if (lx + w > A4[0] - M) { lx = M; y -= 12; }
    if (tipo === "faixa") page.drawRectangle({ x: lx, y: y - 8, width: 12, height: 7, color: cor, opacity: 0.55 });
    else page.drawLine({ start: { x: lx, y: y - 4.5 }, end: { x: lx + 12, y: y - 4.5 }, thickness: tipo === "linha" ? 1.8 : 1.2, color: cor, dashArray: tipo === "tracejado" ? [3, 2] : undefined });
    page.drawText(T(rot), { x: lx + 16, y: y - 8, size: 7.5, font: fonte, color: COR_TEXTO });
    lx += w + 4;
  }
  y -= 16;
  escrever(`Isolinhas de corte e aterro a cada ${fmtN(r.intervaloIsolinhas, 1)} m; curvas do terreno a cada ${fmtN(r.intervaloTerreno, 2)} m.`, { tam: 7.5, cor: COR_SUB });

  // ---- seções ----
  for (const s of r.secoes) {
    garantir(200);
    regua(6);
    escrever(`Seção ${s.nome}–${s.nome}' (${s.nome === "A" ? "longitudinal" : "transversal"})`, { tam: 11, f: negrito, entre: 4 });
    desenharSecao(page, s, { x: M, y: y - 150, w: L, h: 150 }, fonte);
    y -= 160;
  }

  // ---- avisos e método ----
  if (r.avisos.length) {
    regua(6);
    escrever("Atenção", { tam: 11, f: negrito, entre: 4, cor: rgb(0.48, 0.33, 0.06) });
    for (const a of r.avisos) escrever(`• ${a}`, { tam: 8.5 });
  }
  regua(6);
  escrever("Método", { tam: 11, f: negrito, entre: 4 });
  escrever(
    `O terreno é o TIN (triangulação de Delaunay) dos ${r.nPontos} pontos do levantamento: entre três pontos vizinhos vale o plano que passa por eles. ` +
    `Dentro da plataforma, cada triângulo é recortado pelo contorno da plataforma e o volume de corte e de aterro sai pela integral exata, separada pela linha de passagem. ` +
    `Nos taludes, malha regular de ${fmtN(r.malha.passo, 2)} m com prisma em cada célula e corte parcial onde a altura passa do zero; as células da borda são subdivididas. ` +
    `O talude parte da borda da plataforma na proporção pedida até encontrar o terreno (crista no corte, pé no aterro). ` +
    (r.equilibrio ? `A cota de equilíbrio foi achada por bisseção, até o corte igualar o aterro × ${fmtN(pr.fatores.compactacao, 2)}. ` : "") +
    `Caminhões: volume a transportar × (1 + ${fmtN(pr.fatores.empolamento, 0)}% de empolamento) ÷ ${fmtN(pr.fatores.caminhao, 0)} m³ por caçamba.`,
    { tam: 8.5 },
  );
  y -= 4;
  escrever("Estimativa de projeto feita com os pontos informados. Não substitui o projeto executivo de terraplanagem: confira o levantamento, a sondagem do solo e os taludes com o responsável técnico antes da obra.", { tam: 8.5, f: negrito });

  const paginas = doc.getPages();
  paginas.forEach((p, i) => p.drawText(T(`Vertces · Terraplanagem · ${pr.nome} · página ${i + 1} de ${paginas.length}`), { x: M, y: 22, size: 7, font: fonte, color: COR_SUB }));
  return doc.save();
}


/** Croqui vetorial (sem a imagem): contorno e plataforma. */
function croqui(page: PDFPage, r: ResultadoTerraplanagem, q: { x: number; y: number; w: number; h: number }) {
  page.drawRectangle({ x: q.x, y: q.y, width: q.w, height: q.h, color: rgb(0.97, 0.98, 0.97), borderColor: COR_LINHA, borderWidth: 0.7 });
  const pts = r.contorno;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const esc = Math.min((q.w - 30) / Math.max(1, x1 - x0), (q.h - 30) / Math.max(1, y1 - y0));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const path = (a: [number, number][]) => `M${a.map((p) => `${(q.w / 2 + (p[0] - cx) * esc).toFixed(2)} ${(q.h / 2 - (p[1] - cy) * esc).toFixed(2)}`).join(" L")} Z`;
  page.drawSvgPath(path(pts), { x: q.x, y: q.y + q.h, borderColor: COR_SUB, borderWidth: 0.8, borderDashArray: [3, 2] });
  page.drawSvgPath(path(r.plataforma), { x: q.x, y: q.y + q.h, color: VERDE, opacity: 0.15, borderColor: VERDE, borderWidth: 1.6 });
}

/** Perfil: terreno (linha marrom), projeto (verde), corte e aterro pintados entre os dois. */
export function desenharSecao(page: PDFPage, s: Secao, q: { x: number; y: number; w: number; h: number }, fonte: PDFFont) {
  const ok = s.terreno.map((t, i) => t === t && s.projeto[i] === s.projeto[i]);
  const vals = [...s.terreno.filter((v) => v === v), ...s.projeto.filter((v) => v === v)];
  if (!vals.length) return;
  let zmin = Math.min(...vals), zmax = Math.max(...vals);
  const folga = Math.max(0.5, (zmax - zmin) * 0.15);
  zmin -= folga; zmax += folga;
  const smax = s.s[s.s.length - 1] || 1;
  const ex = 32, ey = 18;
  const W = q.w - ex - 6, Hh = q.h - ey - 6;
  const X = (v: number) => q.x + ex + (v / smax) * W;
  const Y = (z: number) => q.y + ey + ((z - zmin) / (zmax - zmin)) * Hh;
  page.drawRectangle({ x: q.x + ex, y: q.y + ey, width: W, height: Hh, color: rgb(0.985, 0.99, 0.985), borderColor: COR_LINHA, borderWidth: 0.6 });
  // grade de cotas
  const passoZ = [0.5, 1, 2, 5, 10, 20, 50].find((p) => (zmax - zmin) / p <= 6) ?? 100;
  for (let z = Math.ceil(zmin / passoZ) * passoZ; z <= zmax; z += passoZ) {
    page.drawLine({ start: { x: q.x + ex, y: Y(z) }, end: { x: q.x + ex + W, y: Y(z) }, thickness: 0.3, color: COR_LINHA });
    page.drawText(T(fmtN(z, passoZ < 1 ? 1 : 0)), { x: q.x, y: Y(z) - 2.5, size: 6.5, font: fonte, color: COR_SUB });
  }
  const passoS = [5, 10, 20, 25, 50, 100, 200, 500].find((p) => smax / p <= 10) ?? 1000;
  for (let d = 0; d <= smax; d += passoS) page.drawText(T(`${d}`), { x: X(d) - 4, y: q.y + 6, size: 6.5, font: fonte, color: COR_SUB });
  // corte/aterro: trapézios entre amostras
  for (let i = 0; i + 1 < s.s.length; i++) {
    if (!ok[i] || !ok[i + 1]) continue;
    const h0 = s.terreno[i] - s.projeto[i], h1 = s.terreno[i + 1] - s.projeto[i + 1];
    if (Math.abs(h0) < 1e-3 && Math.abs(h1) < 1e-3) continue;
    const cor = h0 + h1 > 0 ? CORTE : ATERRO;
    const p = `M${X(s.s[i])} ${-Y(s.terreno[i])} L${X(s.s[i + 1])} ${-Y(s.terreno[i + 1])} L${X(s.s[i + 1])} ${-Y(s.projeto[i + 1])} L${X(s.s[i])} ${-Y(s.projeto[i])} Z`;
    page.drawSvgPath(p, { x: 0, y: 0, color: cor, opacity: 0.35 });
  }
  const traco = (zs: number[], cor: RGB, esp: number) => {
    for (let i = 0; i + 1 < s.s.length; i++) {
      if (!(zs[i] === zs[i]) || !(zs[i + 1] === zs[i + 1])) continue;
      page.drawLine({ start: { x: X(s.s[i]), y: Y(zs[i]) }, end: { x: X(s.s[i + 1]), y: Y(zs[i + 1]) }, thickness: esp, color: cor });
    }
  };
  traco(s.terreno, rgb(0.43, 0.33, 0.2), 0.9);
  traco(s.projeto, VERDE, 1.4);
  page.drawText(T(s.nome), { x: q.x + ex + 3, y: q.y + q.h - 14, size: 9, font: fonte, color: OURO });
  page.drawText(T(`${s.nome}'`), { x: q.x + ex + W - 12, y: q.y + q.h - 14, size: 9, font: fonte, color: OURO });
  const exag = (W / smax) / (Hh / (zmax - zmin));
  const legenda = T(`distância (m) · cota (m) · exagero vertical ${fmtN(1 / exag, 1)}×`);
  page.drawText(legenda, { x: q.x + q.w - fonte.widthOfTextAtSize(legenda, 7) - 6, y: q.y + q.h + 6, size: 7, font: fonte, color: COR_SUB });
}
