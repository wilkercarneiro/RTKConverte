import { mkdirSync as _mk } from "node:fs";
const _OUT = new URL("../../../tests/out/linha-central/", import.meta.url);
_mk(_OUT, { recursive: true });
// Aplica o motor da linha central nas quadras reais do EDILSON (estado atual de produção).
import { writeFileSync } from "node:fs";
import { carregar, calc, nQuinas } from "./base.mjs";
import { estruturar, montar, montarMelhor, quinasArco, areaAss } from "./espinha.ts";
import { desenhar } from "./desenho.mjs";
const DIR = _OUT.pathname.replace(/^\/([A-Za-z]:)/, "$1");

const pr = carregar();
const res = calc(pr);

/** tipo de cada aresta do contorno da quadra, pelos lados dos lotes que encostam nela */
export function quadraParaMotor(q) {
  const c = q.pol.ext.reduce((a, p) => [a[0] + p[0] / q.pol.ext.length, a[1] + p[1] / q.pol.ext.length], [0, 0]);
  const loc = (p) => [p[0] - c[0], p[1] - c[1]];
  const anel = q.pol.ext.map(loc);
  const lados = q.lotes.flatMap((l) => l.lados.filter((d) => d.tipo !== "lote").map((d) => ({ a: loc(d.a), b: loc(d.b), tipo: d.tipo, ref: d.ref ?? d.nome })));
  const dSeg = (p, a, b) => { const ab = [b[0] - a[0], b[1] - a[1]], l2 = ab[0] ** 2 + ab[1] ** 2; const f = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2)) : 0; return Math.hypot(p[0] - a[0] - ab[0] * f, p[1] - a[1] - ab[1] * f); };
  const tipos = [], refs = [];
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i], b = anel[(i + 1) % anel.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let best = null, bd = Infinity;
    for (const d of lados) { const x = dSeg(m, d.a, d.b); if (x < bd) { bd = x; best = d; } }
    const t = best && bd < 0.2 ? best.tipo : "divisa";
    // a estrada levantada vem como "via" com ref por lado do perímetro (borda9, borda10…): é a mesma estrada
    tipos.push(t === "rua" || t === "via" ? t : "divisa");
    refs.push(t === "via" ? "estrada" : best && bd < 0.2 ? String(best.ref ?? "") : "");
  }
  return { anel, tipos, refs, c, loc };
}

export function rodarQuadra(nome, cfg = {}) {
  const q = res.quadras.find((x) => x.nome === nome);
  const { anel, tipos, refs, loc } = quadraParaMotor(q);
  const E = estruturar(anel, tipos, refs);
  const N = cfg.N ?? q.lotes.length;
  const L = (cfg.unico ? montar : montarMelhor)(E, { N, profMin: pr.params.profundidadeMin, profPadrao: pr.params.profundidade, ...cfg });
  const antes = q.lotes.map((l) => l.pol.ext.map(loc));
  return { q, E, L, antes, N };
}

function relatorio(nome, r) {
  const { q, L, antes } = r;
  const areas = L.lotes.map((l) => l.area);
  const g = L.lotes.flatMap((l) => l.giroLat.filter(Number.isFinite));
  const q5 = L.lotes.filter((l) => l.quinas.length > 4);
  const a0 = q.lotes.map((l) => l.area);
  const q5a = antes.filter((a) => quinasArco(a).length > 4).length;
  console.log(`\n=== Quadra ${nome}: ${q.lotes.length} lotes hoje → ${L.lotes.length} no motor novo (${L.ms.toFixed(0)} ms)`);
  console.log(`  hoje: áreas ${Math.min(...a0).toFixed(1)}–${Math.max(...a0).toFixed(1)} · lotes >4 quinas (arco = 1): ${q5a}`);
  console.log(`  cabeceiras: ${(L.cabeceiras ?? []).join(" / ")} · esquinas ${L.esquinas ? Object.values(L.esquinas).map((v) => v.toFixed(0)).join(", ") : "-"}`);
  console.log(`  novo: áreas ${Math.min(...areas).toFixed(3)}–${Math.max(...areas).toFixed(3)} (T1 ${L.T1.toFixed(2)}, T2 ${L.T2.toFixed(2)}, ponta ${L.Tponta.toFixed(2)}) · >4 quinas: ${q5.length} · giro das laterais: máx ${g.length ? Math.max(...g).toFixed(1) : "-"}°, médio ${g.length ? (g.reduce((s, x) => s + x, 0) / g.length).toFixed(1) : "-"}°`);
  if (L.avisos.length) console.log("  avisos:", L.avisos.join(" | "));
  if (L.tentativas) console.log("  tentativas:", L.tentativas.join(" || "));
}

const alvo = process.argv[1].endsWith("edilson.mjs") ? (process.argv[2] ?? "A") : "";
for (const nome of alvo ? alvo.split(",") : []) {
  try {
    const r = rodarQuadra(nome);
    relatorio(nome, r);
    desenhar(DIR + `ed_${nome}.svg`, r.E, r.L, { titulo: `Quadra ${nome} — motor da linha central (${r.L.lotes.length} lotes)`, giros: true });
    desenhar(DIR + `ed_${nome}_antes.svg`, r.E, { lotes: [], juncoes: [], C: null }, { titulo: `Quadra ${nome} — hoje`, antes: r.antes });
  } catch (e) { console.log(`Quadra ${nome}: ERRO ${e.message}`); }
}
