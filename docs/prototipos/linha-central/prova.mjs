import { mkdirSync as _mk } from "node:fs";
const _OUT = new URL("../../../tests/out/linha-central/", import.meta.url);
_mk(_OUT, { recursive: true });
// Prova: grava os lotes do motor novo no projeto real do EDILSON e deixa o motor ATUAL do sistema
// (calcular) medir — áreas, quinas, frente, profundidade, avisos. Compara com o estado de produção.
import { writeFileSync } from "node:fs";
import { carregar, calc } from "./base.mjs";
import { cfgDe } from "../../../src/lib/loteamento/edicao.ts";
import { paraUtm } from "../../../src/lib/loteamento/plano.ts";
import { quinas } from "../../../src/lib/loteamento/geom.ts";
import { rodarQuadra } from "./edilson.mjs";
import { quinasArco } from "./espinha.ts";

const DIR = _OUT.pathname.replace(/^\/([A-Za-z]:)/, "$1");
const nomes = (process.argv[2] ?? "A,C,D").split(",");
const pr0 = carregar();
const res0 = calc(pr0);
let pr = structuredClone(pr0);
const novos = {};
for (const nome of nomes) {
  const r = rodarQuadra(nome);
  const q = res0.quadras.find((x) => x.nome === nome);
  const c = q.pol.ext.reduce((a, p) => [a[0] + p[0] / q.pol.ext.length, a[1] + p[1] / q.pol.ext.length], [0, 0]);
  const i = cfgDe(pr, q, res0.plano);
  const aneis = r.L.lotes.map((l) => l.anel.map((p) => paraUtm(res0.plano, [p[0] + c[0], p[1] + c[1]])));
  pr.quadras[i] = { ...pr.quadras[i], lotes: aneis.map((anel) => ({ anel })) };
  novos[nome] = r;
}
const res1 = calc(pr);
writeFileSync(DIR + "edilson_novo.json", JSON.stringify(pr));

const fmt = (v) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const linhas = [];
for (const nome of nomes) {
  const a = res0.quadras.find((x) => x.nome === nome), b = res1.quadras.find((x) => x.nome === nome);
  const est = (q) => {
    const ar = q.lotes.map((l) => l.area);
    const prob = q.lotes.filter((l) => l.problemas.length);
    const q5sis = q.lotes.filter((l) => quinas(l.pol.ext) > 4).length;
    const q5arco = q.lotes.filter((l) => quinasArco(l.pol.ext).length > 4).length;
    return { n: q.lotes.length, min: Math.min(...ar), max: Math.max(...ar), prob: prob.map((l) => `${l.id}: ${l.problemas.join("; ")}`), q5sis, q5arco };
  };
  const ea = est(a), eb = est(b);
  linhas.push({ nome, antes: ea, depois: eb });
  console.log(`\nQuadra ${nome}`);
  console.log(`  hoje : ${ea.n} lotes · ${fmt(ea.min)} a ${fmt(ea.max)} m² · 5+ quinas (sistema) ${ea.q5sis} · avisos ${ea.prob.length}${ea.prob.length ? " → " + ea.prob.join(" | ") : ""}`);
  console.log(`  novo : ${eb.n} lotes · ${fmt(eb.min)} a ${fmt(eb.max)} m² · 5+ quinas (sistema) ${eb.q5sis} · avisos ${eb.prob.length}${eb.prob.length ? " → " + eb.prob.join(" | ") : ""}`);
}
console.log(`\nprojeto inteiro: hoje ${res0.lotes.length} lotes, ${res0.problemas.filter((p) => p.texto.startsWith("Lote")).length} avisos de lote · novo ${res1.lotes.length} lotes, ${res1.problemas.filter((p) => p.texto.startsWith("Lote")).length} avisos de lote`);
console.log(`área loteada: hoje ${fmt(res0.quadro.lotes.area)} m² · novo ${fmt(res1.quadro.lotes.area)} m² · rosa (sobra) hoje ${fmt(res0.quadro.sobras)} · novo ${fmt(res1.quadro.sobras)}`);
writeFileSync(DIR + "prova.json", JSON.stringify(linhas, null, 1));
