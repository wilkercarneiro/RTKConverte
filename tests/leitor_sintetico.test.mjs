// Teste de estresse do "aparelho do futuro": levantamentos reais reescritos em
// todos os formatos e variações de tests/leitor/gerador.mjs. A garantia:
//
//   NENHUMA leitura que o sistema der como certa (confiança "alta") pode estar
//   errada. O que ele não tem certeza vai para a IA/operador — nunca passa calado.
//
// Também mede quantas variações são lidas sem ajuda (a taxa que a IA melhora).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import proj4 from "proj4";
import { detectZoneCandidates, escolherZona } from "../supabase/functions/_shared/geo.ts";
import { abrir } from "../supabase/functions/_shared/leitor/abertura.ts";
import { lerLinhas } from "../supabase/functions/_shared/leitor/index.ts";
import { mesmoCiclo } from "../supabase/functions/_shared/leitor/ordem.ts";
import { variacoes } from "./leitor/gerador.mjs";

const op = { proj4 };
const ler = (bytes, nome) => lerLinhas(abrir(bytes, nome).linhas, op);

function bases() {
  const out = [];
  for (const n of ["LARISSA", "THEREZA", "ANTONIO"]) out.push({ nome: n, bytes: readFileSync(new URL(`../reference/${n}.txt`, import.meta.url)) });
  const raiz = new URL("./corpus-real/bruto/", import.meta.url);
  if (existsSync(raiz)) {
    const listar = (d) => readdirSync(d).flatMap((x) => { const p = join(d, x); return statSync(p).isDirectory() ? listar(p) : [p]; });
    const vistos = new Set();
    for (const p of listar(raiz.pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
      const nome = p.split(sep).at(-2);
      if (vistos.has(nome)) continue;
      vistos.add(nome);
      out.push({ nome, bytes: readFileSync(p) });
    }
  }
  return out;
}

/** Confere a leitura contra a verdade. Devolve null se certa, ou o motivo. */
function conferir(l, verdade, espera) {
  const tolXY = espera.coords === "geo" ? 0.002 : 0;
  const lidos = l.anel;
  if (lidos.length !== verdade.length) return `nº de pontos ${lidos.length} ≠ ${verdade.length}`;
  // o arquivo traz o nome de cada ponto: ele TEM de ser lido (número sintético = nome perdido)
  if (espera.nomes !== false && lidos.some((p) => p.numSintetico)) return `nomes dos pontos não lidos (${lidos.filter((p) => p.numSintetico).slice(0, 3).map((p) => p.nome).join(", ")} viraram sequência)`;
  const comNome = espera.nomes !== false;
  const porChave = comNome ? new Map(verdade.map((p) => [p.num, p])) : null;
  const pares = comNome ? lidos.map((p) => [p, porChave.get(p.num)]) : lidos.map((p) => [p, verdade.find((v) => Math.hypot(v.e - p.e, v.n - p.n) <= Math.max(tolXY, 1e-6))]);
  for (const [p, v] of pares) {
    if (!v) return `ponto ${p.nome} não existe na verdade`;
    if (Math.abs(p.e - v.e) > tolXY || Math.abs(p.n - v.n) > tolXY) return `ponto ${p.nome}: E/N ${p.e},${p.n} ≠ ${v.e},${v.n}`;
    if (espera.h !== false && Math.abs(p.h - v.h) > 1e-9) return `ponto ${p.nome}: h ${p.h} ≠ ${v.h}`;
    if (espera.sigma !== false) {
      const tol = espera.sigmaTolerancia ?? 1e-12;
      if (Math.abs(p.sigmaPos - v.sigmaPos) > tol || Math.abs(p.sigmaH - v.sigmaH) > tol) return `ponto ${p.nome}: σ ${p.sigmaPos}/${p.sigmaH} ≠ ${v.sigmaPos}/${v.sigmaH}`;
    }
    if (espera.rotulos === true && (p.rotulo ?? null) !== (v.rotulo ?? null)) return `ponto ${p.nome}: rótulo "${p.rotulo}" ≠ "${v.rotulo}"`;
    if (espera.rotulos === "acentuado" && (p.rotulo ?? null) !== (v.rotulo ? v.rotulo.replace(/a/g, "ã") : null)) return `ponto ${p.nome}: rótulo "${p.rotulo}"`;
  }
  // mesma figura: a ordem lida é a da verdade (girada/invertida)
  const idx = (p) => verdade.indexOf(pares.find(([x]) => x === p)[1]);
  if (l.blocos.length === 1 && !mesmoCiclo(lidos.map(idx), verdade.map((_, i) => i))) return "ordem do perímetro diferente";
  return null;
}

test("estresse: nenhuma leitura 'certa' está errada, em todos os formatos e variações", () => {
  const stats = new Map();
  const erradasComCerteza = [];
  let total = 0;
  for (const base of bases()) {
    const v0 = ler(base.bytes, base.nome);
    if (!v0 || !v0.ok || v0.blocos.length !== 1 || v0.anel.length < 4) continue; // verdade: só levantamentos de uma parte, sem bloqueio
    const verdade = v0.anel.map((p) => ({ num: p.num, rotulo: p.rotulo, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH }));
    const cands = detectZoneCandidates(verdade, proj4);
    const fuso = escolherZona(cands, "BA").escolhido.zone;
    for (const va of variacoes(verdade, fuso, total + 7)) {
      total++;
      const s = stats.get(va.nome) ?? { certa: 0, certaPendente: 0, duvidaCerta: 0, duvidaErrada: 0, naoLeu: 0, exemplos: [] };
      stats.set(va.nome, s);
      let l = null;
      try { l = ler(va.bytes, va.arquivo); } catch (e) { s.naoLeu++; s.exemplos.push(`${base.nome}: exceção ${e.message}`); continue; }
      if (!l) { s.naoLeu++; continue; }
      const motivo = conferir(l, verdade, va.espera);
      if (l.confianca === "alta") {
        if (motivo) { erradasComCerteza.push(`${va.nome} / ${base.nome}: ${motivo}`); continue; }
        const soPendencia = l.avisos.filter((a) => a.nivel === "bloqueio").every((a) => a.codigo === "sem_precisao" || a.codigo === "sem_altura");
        if (l.ok) s.certa++; else if (soPendencia) s.certaPendente++; else { s.duvidaCerta++; s.exemplos.push(`${base.nome}: bloqueio ${l.avisos.filter((a) => a.nivel === "bloqueio").map((a) => a.codigo)}`); }
      } else if (motivo) { s.duvidaErrada++; if (s.exemplos.length < 2) s.exemplos.push(`${base.nome}: ${motivo} (${l.duvidas.join("; ")})`); }
      else s.duvidaCerta++;
    }
  }
  const tabela = [...stats].map(([nome, s]) => `${nome.padEnd(24)} certa ${String(s.certa).padStart(3)} | certa+pede σ/h ${String(s.certaPendente).padStart(3)} | dúvida(certa) ${String(s.duvidaCerta).padStart(3)} | dúvida(errada→IA) ${String(s.duvidaErrada).padStart(3)} | não leu ${String(s.naoLeu).padStart(3)}${s.exemplos.length ? "  ex: " + s.exemplos[0].slice(0, 140) : ""}`);
  console.log(`\n[estresse] ${total} arquivos gerados\n` + tabela.join("\n"));
  assert.deepEqual(erradasComCerteza.slice(0, 15), [], `${erradasComCerteza.length} leitura(s) dadas como certas estão erradas`);
});
