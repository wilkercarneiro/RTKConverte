// Saídas da terraplanagem feitas no navegador: DXF (CAD) e CSV da malha.
// O PDF do relatório está em pdf.ts.
import type { Curva } from "../relevo/curvas.ts";
import { pontosDeRotulo } from "../relevo/curvas.ts";
import type { Pt } from "./geometria.ts";
import { caixa } from "./geometria.ts";
import type { ResultadoTerraplanagem } from "./calculo.ts";
import { fmtN } from "./calculo.ts";
import type { ProjetoTerraplanagem } from "./modelo.ts";

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[–—]/g, "-").replace(/[²]/g, "2").replace(/[³]/g, "3").replace(/[^\x20-\x7E]/g, "?");

export const CAMADAS_TERRAPLANAGEM: [string, number][] = [
  ["TERRENO_PONTOS", 7], ["TERRENO_CURVAS_MESTRAS", 34], ["TERRENO_CURVAS", 252], ["CONTORNO_LEVANTAMENTO", 8],
  ["PLATAFORMA", 3], ["TALUDE_CRISTA", 1], ["TALUDE_PE", 5], ["LINHA_PASSAGEM", 7],
  ["CORTE", 1], ["ATERRO", 5], ["ISOLINHAS_CORTE", 1], ["ISOLINHAS_ATERRO", 5], ["SECOES", 2], ["NOTA", 8],
];

export function notaDoMetodo(r: ResultadoTerraplanagem, pr: ProjetoTerraplanagem): string {
  return `Terreno: TIN de ${r.nPontos} pontos do levantamento. Malha de ${fmtN(r.malha.passo, 2)} m. Volumes por prisma com corte parcial; dentro da plataforma, integral exata por triangulo. `
    + `Taludes: corte 1:${fmtN(pr.taludes.corte, 2)}, aterro 1:${fmtN(pr.taludes.aterro, 2)} (V:H). `
    + (r.equilibrio ? `Cota de equilibrio por bissecao (corte = aterro x ${fmtN(pr.fatores.compactacao, 2)}).` : "Cota informada pelo projetista.");
}

/** DXF R12 (AC1009): UTM, cotas no Z, uma camada por coisa (o desenhista liga e desliga). */
export function terraplanagemParaDxf(r: ResultadoTerraplanagem, pr: ProjetoTerraplanagem): string {
  const o: string[] = [];
  const g = (c: number, v: string | number) => { o.push(String(c), typeof v === "number" ? v.toFixed(3) : v); };
  const bb = caixa(r.contorno);
  const lado = Math.max(1, bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]);
  const alt = Math.max(0.3, Math.min(8, lado / 220));
  g(999, semAcento(`${pr.nome} - terraplanagem${pr.fuso ? ` - UTM SIRGAS 2000 fuso ${pr.fuso}S` : " - UTM"}`));
  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(9, "$EXTMIN"); g(10, bb.min[0]); g(20, bb.min[1]); g(30, r.faixaTerreno.min);
  g(9, "$EXTMAX"); g(10, bb.max[0]); g(20, bb.max[1]); g(30, r.faixaTerreno.max);
  g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LTYPE"); g(70, "1");
  g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, "0"); g(3, "Solid line"); g(72, "65"); g(73, "0"); g(40, 0);
  g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "LAYER"); g(70, String(CAMADAS_TERRAPLANAGEM.length));
  for (const [nome, cor] of CAMADAS_TERRAPLANAGEM) { g(0, "LAYER"); g(2, nome); g(70, "0"); g(62, String(cor)); g(6, "CONTINUOUS"); }
  g(0, "ENDTAB");
  g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");

  /** polilinha 2D na elevação z (curvas) ou 3D (cada vértice com a sua cota) */
  const poli = (pts: Pt[], camada: string, fechada: boolean, z: number | number[]) => {
    if (pts.length < 2) return;
    const tres = Array.isArray(z);
    g(0, "POLYLINE"); g(8, camada); g(66, "1"); g(70, String((fechada ? 1 : 0) | (tres ? 8 : 0))); g(10, 0); g(20, 0); g(30, tres ? 0 : z);
    pts.forEach((p, i) => { g(0, "VERTEX"); g(8, camada); g(10, p[0]); g(20, p[1]); g(30, tres ? z[i] : z); if (tres) g(70, "32"); });
    g(0, "SEQEND"); g(8, camada);
  };
  const texto = (p: Pt, t: string, h: number, camada: string, z = 0, rot = 0) => {
    g(0, "TEXT"); g(8, camada); g(10, p[0]); g(20, p[1]); g(30, z); g(40, h); g(1, semAcento(t));
    if (rot) g(50, rot);
    g(72, "1"); g(73, "2"); g(11, p[0]); g(21, p[1]); g(31, z);
  };
  const abrir = (c: Curva) => (c.fechada && c.pts.length > 2 && c.pts[0][0] === c.pts[c.pts.length - 1][0] && c.pts[0][1] === c.pts[c.pts.length - 1][1] ? c.pts.slice(0, -1) : c.pts);
  const { e0, n0, passo, nx, ny, terreno, altura } = r.malha;
  const cotaEm = (p: Pt) => {
    const i = Math.round((p[0] - e0) / passo), j = Math.round((p[1] - n0) / passo);
    const v = i >= 0 && j >= 0 && i < nx && j < ny ? terreno[j * nx + i] : NaN;
    return v === v ? v : r.cota;
  };

  // mapa de corte e aterro: faixas de células da mesma classe numa SOLID só
  for (let j = 0; j < ny - 1; j++) {
    let ini = -1, cls = 0;
    const fechar = (fim: number) => {
      if (ini < 0 || !cls) return;
      const x0 = e0 + ini * passo, x1 = e0 + fim * passo, y0 = n0 + j * passo, y1 = y0 + passo;
      const cam = cls > 0 ? "CORTE" : "ATERRO";
      g(0, "SOLID"); g(8, cam);
      g(10, x0); g(20, y0); g(30, 0); g(11, x1); g(21, y0); g(31, 0); g(12, x0); g(22, y1); g(32, 0); g(13, x1); g(23, y1); g(33, 0);
    };
    for (let i = 0; i <= nx - 1; i++) {
      let c = 0;
      if (i < nx - 1) {
        const k = j * nx + i;
        const m = (altura[k] + altura[k + 1] + altura[k + nx] + altura[k + nx + 1]) / 4;
        c = m === m ? (m > 0.01 ? 1 : m < -0.01 ? -1 : 0) : 0;
      }
      if (c !== cls) { fechar(i); ini = i; cls = c; }
    }
  }
  // terreno
  for (const c of r.curvasTerreno) {
    const cam = c.mestra ? "TERRENO_CURVAS_MESTRAS" : "TERRENO_CURVAS";
    poli(abrir(c), cam, c.fechada, c.cota);
    if (c.mestra) for (const q of pontosDeRotulo(c.pts, alt * 60)) texto(q.p, c.cota.toFixed(r.intervaloTerreno < 1 ? 1 : 0), alt, cam, c.cota, q.ang);
  }
  poli(r.contorno, "CONTORNO_LEVANTAMENTO", true, 0);
  for (const p of pr.pontos) {
    g(0, "POINT"); g(8, "TERRENO_PONTOS"); g(10, p.e); g(20, p.n); g(30, p.z);
    texto([p.e + alt * 0.5, p.n + alt * 0.5], `${p.nome} ${p.z.toFixed(2)}`, alt * 0.55, "TERRENO_PONTOS", p.z);
  }
  // projeto
  const zPlat = (p: Pt) => {
    const i = Math.round((p[0] - e0) / passo), j = Math.round((p[1] - n0) / passo);
    const v = i >= 0 && j >= 0 && i < nx && j < ny ? r.malha.projeto[j * nx + i] : NaN;
    return v === v ? v : r.cota;
  };
  poli(r.plataforma, "PLATAFORMA", true, r.plataforma.map(zPlat));
  const c0 = r.retangulo.centro;
  texto(c0, `PLATAFORMA ${r.cota.toFixed(2)}`, alt * 1.4, "PLATAFORMA", r.cota);
  for (const l of r.crista) poli(l, "TALUDE_CRISTA", false, l.map(cotaEm));
  for (const l of r.pe) poli(l, "TALUDE_PE", false, l.map(cotaEm));
  for (const l of r.passagem) poli(l, "LINHA_PASSAGEM", false, l.map(() => r.cota));
  for (const c of r.isolinhas) {
    const cam = c.cota > 0 ? "ISOLINHAS_CORTE" : "ISOLINHAS_ATERRO";
    poli(abrir(c), cam, c.fechada, 0);
    for (const q of pontosDeRotulo(c.pts, alt * 50)) texto(q.p, `${c.cota > 0 ? "C" : "A"} ${Math.abs(c.cota).toFixed(1)}`, alt * 0.7, cam, 0, q.ang);
  }
  for (const s of r.secoes) {
    poli([s.a, s.b], "SECOES", false, 0);
    texto(s.a, s.nome, alt * 1.6, "SECOES");
    texto(s.b, `${s.nome}'`, alt * 1.6, "SECOES");
  }
  const linhasNota = [
    `Corte ${fmtN(r.corte, 1)} m3 - Aterro ${fmtN(r.aterro, 1)} m3 - Plataforma ${fmtN(r.areaPlataforma, 1)} m2 na cota ${fmtN(r.cota, 3)}`,
    notaDoMetodo(r, pr),
    "Estimativa de projeto pelo levantamento informado: confira em campo antes da obra.",
  ];
  linhasNota.forEach((t, i) => texto([bb.min[0], bb.min[1] - alt * (3 + 1.6 * i)], t, alt * 0.8, "NOTA"));
  g(0, "ENDSEC"); g(0, "EOF");
  return o.join("\r\n") + "\r\n";
}

/** CSV da malha (Excel abre direto: ";" e vírgula decimal). Só os nós com terreno. */
export function malhaParaCsv(r: ResultadoTerraplanagem): string {
  const { e0, n0, passo, nx, ny, terreno, projeto, altura } = r.malha;
  const f = (v: number, c: number) => v.toFixed(c).replace(".", ",");
  const linhas = ["E;N;Terreno (m);Projeto (m);Corte (m);Aterro (m)"];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (!(terreno[k] === terreno[k])) continue;
    const h = altura[k];
    linhas.push([f(e0 + i * passo, 3), f(n0 + j * passo, 3), f(terreno[k], 3), f(projeto[k], 3), f(h > 0 ? h : 0, 3), f(h < 0 ? -h : 0, 3)].join(";"));
  }
  return "﻿" + linhas.join("\r\n") + "\r\n";
}

export const nomeDoArquivo = (nome: string, ext: string) =>
  `${(nome || "terraplanagem").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "terraplanagem"}_terraplanagem.${ext}`;
