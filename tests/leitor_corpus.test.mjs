// Corpus de ouro: os TXT REAIS já enviados ao sistema (copiados da VPS para
// tests/corpus-real/, fora do Git — dados de clientes). Para cada arquivo que o
// parser antigo aceitava, o leitor novo tem de dar EXATAMENTE os mesmos pontos
// (nº, rótulo, E, N, h, σ), na mesma ordem — salvo as correções intencionais,
// cada uma conferida aqui pelo motivo:
//   - ordem do arquivo quando a numeração cruzava o desenho (e o arquivo não);
//   - linha com E/N repetidos: a cópia sai do rótulo (JACO LOTE).
// Também compara a ordem escolhida com a ordem FINAL que a equipe deixou no
// banco depois das correções à mão (servicos-banco.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import proj4 from "proj4";
import { parseTxt } from "../supabase/functions/_shared/geo.ts";
import { blocosPorNumeracao } from "../supabase/functions/_shared/certificados.ts";
import { abrir } from "../supabase/functions/_shared/leitor/abertura.ts";
import { lerLinhas } from "../supabase/functions/_shared/leitor/index.ts";
import { cruzamentos } from "../supabase/functions/_shared/leitor/ordem.ts";

const RAIZ = new URL("./corpus-real/bruto/", import.meta.url);
const temCorpus = existsSync(RAIZ);

function listar(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...listar(p)); else out.push(p);
  }
  return out;
}

function carregar() {
  const raiz = RAIZ.pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const vistos = new Map();
  for (const p of listar(raiz)) {
    const partes = p.split(/[\\/]/);
    const servico = partes[partes.length - 3], nome = partes[partes.length - 2];
    const bytes = readFileSync(p);
    const h = createHash("sha1").update(bytes).digest("hex");
    if (!vistos.has(h)) vistos.set(h, { nome, bytes, servicos: [] });
    vistos.get(h).servicos.push(servico);
  }
  return [...vistos.values()];
}

const igualCiclico = (a, b) => {
  if (a.length !== b.length || !a.length) return false;
  for (const seq of [b, [...b].reverse()]) {
    for (let s = 0; s < seq.length; s++) if (a.every((x, i) => x === seq[(i + s) % seq.length])) return true;
  }
  return false;
};

test("corpus real: leitor novo reproduz o parser antigo (exceto correções intencionais)", { skip: !temCorpus && "sem tests/corpus-real" }, () => {
  const arquivos = carregar();
  const banco = existsSync(new URL("./corpus-real/servicos-banco.json", import.meta.url))
    ? new Map(JSON.parse(readFileSync(new URL("./corpus-real/servicos-banco.json", import.meta.url), "utf8")).map((s) => [s.id, s]))
    : new Map();
  const resumo = { arquivos: arquivos.length, iguais: 0, ordemArquivo: [], ordemAmbigua: [], rotuloCorrigido: [], antigoRecusava: [], sigmaAbsurdoPego: [] };
  const contagemAvisos = new Map();
  const ordemBanco = { igualNovo: 0, igualAntigo: 0, so_novo: [], so_antigo: [], nenhum: 0, comparados: 0 };

  for (const a of arquivos) {
    const ab = abrir(a.bytes, a.nome);
    assert.equal(ab.tipo, "texto", a.nome);
    const texto = new TextDecoder().decode(a.bytes);
    let antigo = null;
    try { antigo = parseTxt(texto); } catch (e) { resumo.antigoRecusava.push(`${a.nome}: ${e.message}`); }
    const novo = lerLinhas(ab.linhas, { proj4 });
    assert.ok(novo, `${a.nome}: leitor novo não leu`);
    for (const av of novo.avisos) contagemAvisos.set(av.codigo, [...(contagemAvisos.get(av.codigo) ?? []), a.nome]);
    if (!antigo) continue;
    const bloqueios = novo.avisos.filter((x) => x.nivel === "bloqueio");
    if (bloqueios.length) {
      // única recusa nova aceita: σ absurdo (> 10 m) que o antigo gravava calado
      assert.ok(bloqueios.every((b) => b.codigo === "V3_sigma_unidade"), `${a.nome}: leitura nova com bloqueio: ${bloqueios.map((x) => x.mensagem).join(" | ")}`);
      assert.ok(antigo.some((p) => p.sigmaPos > 10 || p.sigmaH > 10), `${a.nome}: bloqueio de σ sem σ absurdo no arquivo`);
      resumo.sigmaAbsurdoPego.push(a.nome);
    }
    assert.equal(novo.receita.origem, "padrao", `${a.nome}: deveria cair no formato padrão`);

    const pa = antigo.map((p) => ({ num: p.num, rotulo: p.rotulo, e: p.e, n: p.n, h: p.h, sp: p.sigmaPos, sh: p.sigmaH }));
    const pn = novo.anel.map((p) => ({ num: p.num, rotulo: p.rotulo, e: p.e, n: p.n, h: p.h, sp: p.sigmaPos, sh: p.sigmaH }));
    assert.equal(pn.length, pa.length, `${a.nome}: nº de pontos`);

    // mesmos pontos (conjunto), campo a campo
    const porNum = new Map(pa.map((p) => [p.num, p]));
    let rotuloMudou = false;
    for (const p of pn) {
      const q = porNum.get(p.num);
      assert.ok(q, `${a.nome}: ponto ${p.num} não existe no antigo`);
      for (const k of ["e", "n", "h", "sp", "sh"]) assert.equal(p[k], q[k], `${a.nome}: ponto ${p.num} campo ${k}`);
      if (p.rotulo !== q.rotulo) {
        // única diferença aceita: a cópia de E/N que o antigo colava no rótulo
        assert.match(q.rotulo, /^[^,]*,[\d.]+,[\d.]+$/, `${a.nome}: rótulo do ponto ${p.num} mudou: "${q.rotulo}" → "${p.rotulo}"`);
        assert.equal(p.rotulo, q.rotulo.split(",")[0] || null);
        rotuloMudou = true;
      }
    }
    if (rotuloMudou) resumo.rotuloCorrigido.push(a.nome);

    // ordem
    if (novo.criterio === "id") {
      assert.deepEqual(pn.map((p) => p.num), pa.map((p) => p.num), `${a.nome}: ordem`);
      // blocos (partes) iguais aos do parse-txt antigo
      assert.deepEqual(novo.blocos, blocosPorNumeracao(antigo), `${a.nome}: blocos`);
    } else {
      // só troca para a ordem do arquivo quando (a) a numeração cruzava e o
      // arquivo não, ou (b) as duas eram válidas e o arquivo é o perímetro
      // "natural" (menor, ou um só em vez de partes) — sempre com aviso a confirmar
      assert.equal(cruzamentos(novo.anel).length, 0, `${a.nome}: a ordem do arquivo também cruza`);
      const cruzavaAntes = blocosPorNumeracao(antigo).some((b) => cruzamentos(b.map((i) => antigo[i])).length > 0);
      const ambigua = novo.avisos.some((x) => x.codigo === "ordem_ambigua");
      assert.ok(cruzavaAntes || ambigua, `${a.nome}: trocou de ordem sem motivo`);
      assert.ok(novo.aConfirmar.includes(ambigua ? "ordem_ambigua" : "ordem_do_arquivo"), `${a.nome}: troca de ordem sem pedir confirmação`);
      (ambigua ? resumo.ordemAmbigua : resumo.ordemArquivo).push(a.nome);
    }
    if (!rotuloMudou && novo.criterio === "id") resumo.iguais++;

    // ordem final gravada pela equipe no banco
    for (const sid of a.servicos) {
      const s = banco.get(sid);
      if (!s || !s.anel || s.tem_glebas) continue;
      const doBanco = s.anel.map((v) => v.num).filter((x) => x !== null);
      const setNovo = new Set(pn.map((p) => p.num));
      if (doBanco.length !== pn.length || !doBanco.every((x) => setNovo.has(x))) continue; // pontos removidos/inseridos à mão
      ordemBanco.comparados++;
      const okNovo = igualCiclico(pn.map((p) => p.num), doBanco), okAntigo = igualCiclico(pa.map((p) => p.num), doBanco);
      if (okNovo) ordemBanco.igualNovo++;
      if (okAntigo) ordemBanco.igualAntigo++;
      if (okNovo && !okAntigo) ordemBanco.so_novo.push(a.nome);
      if (okAntigo && !okNovo) ordemBanco.so_antigo.push(a.nome);
      if (!okNovo && !okAntigo) ordemBanco.nenhum++;
    }
  }
  const avisos = Object.fromEntries([...contagemAvisos].map(([k, v]) => [k, v.length]));
  console.log("\n[corpus]", JSON.stringify({ ...resumo, ordemBanco, avisos }, null, 1));
  // nenhum serviço em que a equipe tenha mantido a ordem antiga e o novo mude
  assert.deepEqual(ordemBanco.so_antigo, [], "o leitor novo mudou a ordem de um serviço que a equipe aceitou como estava");
});
