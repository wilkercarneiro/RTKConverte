// Selo de autenticidade da planta: código, metadados públicos, QR (em código,
// sem dependência) e a planta de exemplo com o QR, a assinatura do RT e o
// registro da emissão (reserva → PDF → hash).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import proj4lib from "proj4";
import { PDFDocument } from "pdf-lib";
import { parseTxt, fmtBR, fmtGmsPlanilha } from "../supabase/functions/_shared/geo.ts";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { gerarQr, retangulosQr, capacidadeBytes, penalidade } from "../supabase/functions/_shared/qr.ts";
import {
  ALFABETO_CODIGO, codigoAgrupado, codigoValido, emitirComAutenticidade, gerarCodigoVerificacao, metadadosPublicos,
  normalizarCodigo, sha256Hex, urlVerificacao, TIPOS_DOCUMENTO,
} from "../supabase/functions/_shared/autenticidade.ts";
import { pngAssinatura } from "./fixtures/png_assinatura.mjs";

const OUT = new URL("./out/", import.meta.url);
mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ código
test("código: 20 caracteres base32 de Crockford, aleatório e sem repetição", () => {
  const vistos = new Set();
  for (let i = 0; i < 2000; i++) {
    const c = gerarCodigoVerificacao();
    assert.equal(c.length, 20);
    assert.ok(codigoValido(c), c);
    assert.ok([...c].every((ch) => ALFABETO_CODIGO.includes(ch)));
    assert.ok(!/[ILOU]/.test(c), "sem letras que se confundem");
    vistos.add(c);
  }
  assert.equal(vistos.size, 2000);
  assert.equal(ALFABETO_CODIGO.length, 32);
});

test("código: o que a pessoa digita volta ao formato do banco", () => {
  assert.equal(normalizarCodigo("7k3m-9qxw-2zr4-tnbv-8c6h"), "7K3M9QXW2ZR4TNBV8C6H");
  assert.equal(normalizarCodigo(" 0O1 IL "), "00111");
  assert.equal(codigoAgrupado("7K3M9QXW2ZR4TNBV8C6H"), "7K3M-9QXW-2ZR4-TNBV-8C6H");
  assert.equal(urlVerificacao("7K3M9QXW2ZR4TNBV8C6H"), "https://vertces.com.br/app/#/verificar/7K3M9QXW2ZR4TNBV8C6H");
});

test("sha256Hex confere com o do Node", async () => {
  const b = new TextEncoder().encode("planta de teste");
  assert.equal(await sha256Hex(b), createHash("sha256").update(b).digest("hex"));
});

// ------------------------------------------------------------------ metadados
test("metadados públicos: lista fechada, sem CPF nem proprietário", () => {
  const m = metadadosPublicos({
    tipo: "planta_sigef",
    servico: { denominacao: "FAZENDA  TESTE", municipio: "Araci", uf: "ba", detentor_cpf: "111.222.333-44", detentor_nome: "MARIA" },
    rt: { nome: "TECNICO DE TESTE", conselho_sigla: "CFTA", conselho_numero: "0578839458-9", cpf: "999.888.777-66" },
    empresa: "GEO TESTE LTDA", areaFmt: "84,0638", perimetroFmt: "4.077,80", folha: "A1", dataStr: "05/11/2026",
  });
  assert.deepEqual(Object.keys(m).sort(), ["area_ha", "denominacao", "emitido_em", "empresa", "folha", "municipio", "perimetro_m", "rt_nome", "rt_registro", "titulo", "uf"]);
  const tudo = JSON.stringify(m);
  for (const proibido of ["111.222.333-44", "999.888.777-66", "MARIA"]) assert.ok(!tudo.includes(proibido), proibido);
  assert.equal(m.denominacao, "FAZENDA TESTE");
  assert.equal(m.uf, "BA");
  assert.equal(m.rt_registro, "CFTA 0578839458-9");
  assert.equal(m.titulo, TIPOS_DOCUMENTO.planta_sigef);
  const g = metadadosPublicos({ tipo: "planta_gleba", unidade: "GLEBA 2", servico: { denominacao: "FAZ" }, rt: null, areaFmt: "1", perimetroFmt: "2", dataStr: "x" });
  assert.equal(g.denominacao, "FAZ — GLEBA 2");
  assert.equal(g.rt_registro, "");
});

// ------------------------------------------------------------------ QR
/** Lê de volta os 15 bits de formato (cópia 1) e confere o BCH + máscara fixa. */
function formatoLido(q) {
  const m = q.modulos;
  const bits = [];
  for (let i = 0; i <= 5; i++) bits.push(m[i][8]);
  bits.push(m[7][8], m[8][8], m[8][7]);
  for (let i = 9; i < 15; i++) bits.push(m[8][14 - i]);
  let v = 0;
  bits.forEach((b, i) => { if (b) v |= 1 << i; });
  return v ^ 0x5412;
}

test("QR: estrutura da norma (localizadores, temporização, formato, módulo escuro)", () => {
  const url = urlVerificacao(gerarCodigoVerificacao());
  const q = gerarQr(url, "M");
  assert.equal(q.versao, 4, "URL de 59 bytes cabe na versão 4-M");
  assert.equal(q.tamanho, 33);
  assert.equal(q.nivel, "M");
  const m = q.modulos;
  // localizador: anel escuro 7×7, anel claro 5×5, miolo 3×3 escuro
  for (const [ox, oy] of [[0, 0], [q.tamanho - 7, 0], [0, q.tamanho - 7]]) {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      assert.equal(m[oy + y][ox + x], d !== 2, `localizador em ${ox},${oy}`);
    }
  }
  for (let i = 8; i < q.tamanho - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0, "temporização horizontal");
    assert.equal(m[i][6], i % 2 === 0, "temporização vertical");
  }
  assert.equal(m[q.tamanho - 8][8], true, "módulo escuro");
  const fmt = formatoLido(q);
  // dado = nível(2) + máscara(3); M = 00
  assert.equal(fmt >>> 10, (0 << 3) | q.mascara);
  let rem = fmt >>> 10;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  assert.equal(fmt & 0x3ff, rem & 0x3ff, "BCH do formato");
});

test("QR: versão sobe com o texto, máscara é a de menor penalidade, retângulos cobrem os módulos", () => {
  assert.equal(gerarQr("HELLO").versao, 1);
  assert.ok(gerarQr("x".repeat(100)).versao >= 6);
  assert.throws(() => gerarQr("x".repeat(400)), /longo demais/);
  assert.ok(capacidadeBytes(4, "M") >= 59);
  const q = gerarQr("https://vertces.com.br/app/#/verificar/ABCDEFGHJKMNPQRSTVWX");
  let escuros = 0;
  for (const l of q.modulos) for (const c of l) if (c) escuros++;
  assert.equal(retangulosQr(q).reduce((s, r) => s + r.w, 0), escuros);
  assert.ok(penalidade(q.modulos) > 0);
  // determinístico
  assert.deepEqual(gerarQr("abc").modulos, gerarQr("abc").modulos);
});

// ------------------------------------------------------------------ registro da emissão
function bancoFalso({ semTabela = false } = {}) {
  const linhas = new Map();
  return {
    linhas,
    from: (t) => {
      assert.equal(t, "documentos_autenticidade");
      return {
        insert: async (v) => {
          if (semTabela) return { error: { code: "42P01", message: "relation does not exist" } };
          linhas.set(v.codigo, { ...v, hash_sha256: null });
          return { error: null };
        },
        update: (v) => ({ eq: async (_c, codigo) => { Object.assign(linhas.get(codigo), v); return { error: null }; } }),
        delete: () => ({ eq: async (_c, codigo) => { linhas.delete(codigo); return { error: null }; } }),
      };
    },
  };
}
const RESERVA = {
  servico_id: "s1", escritorio_id: "e1", tipo: "planta_sigef",
  metadados: metadadosPublicos({ tipo: "planta_sigef", servico: { denominacao: "F" }, rt: null, areaFmt: "1", perimetroFmt: "2", dataStr: "d" }),
};

test("emissão: reserva o código, gera com o selo e confirma com o SHA-256 dos bytes finais", async () => {
  const db = bancoFalso();
  let seloRecebido = null;
  const e = await emitirComAutenticidade(db, RESERVA, async (selo) => { seloRecebido = selo; return new TextEncoder().encode(`pdf ${selo.codigo}`); });
  assert.ok(codigoValido(e.codigo));
  assert.equal(seloRecebido.url, urlVerificacao(e.codigo));
  const linha = db.linhas.get(e.codigo);
  assert.equal(linha.hash_sha256, e.hash);
  assert.equal(e.hash, createHash("sha256").update(`pdf ${e.codigo}`).digest("hex"));
  assert.equal(e.aviso, undefined);
  // repetir a geração = código novo
  const e2 = await emitirComAutenticidade(db, RESERVA, async () => new Uint8Array([1]));
  assert.notEqual(e2.codigo, e.codigo);
});

test("emissão: geração que falha descarta a reserva; banco sem a migração gera sem selo, avisado", async () => {
  const db = bancoFalso();
  await assert.rejects(emitirComAutenticidade(db, RESERVA, async () => { throw new Error("planta falhou"); }), /planta falhou/);
  assert.equal(db.linhas.size, 0);
  const semTabela = bancoFalso({ semTabela: true });
  let selo = "não chamado";
  const e = await emitirComAutenticidade(semTabela, RESERVA, async (s) => { selo = s; return new Uint8Array([7]); });
  assert.equal(selo, null);
  assert.equal(e.codigo, null);
  assert.match(e.aviso, /sem o selo/);
});

// ------------------------------------------------------------------ planta de exemplo
const proj4 = (f, t, c) => proj4lib(f, t, c);
const pontos = parseTxt(readFileSync(new URL("../reference/LARISSA.txt", import.meta.url), "utf8"));
const MS = new Set([30, 36, 41, 58, 64, 9]);
const vertices = pontos.map((p, i) => ({
  ordem: i, numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH,
  tipo: MS.has(p.num) ? "M" : "P", metodo: "PG6", inserido: false,
  descritivo: MS.has(p.num) ? `(POSSE) FAZENDA VIZINHA ${p.num}\\ FULANO DE TAL\\ CPF:000.000.000-00` : null,
  tipoLimite: MS.has(p.num) ? "LA1" : null, ehVia: false,
}));
const servico = montarServico({
  fusoUtm: 24, verticeInicialOrdem: vertices.findIndex((v) => v.numTxt === 30), prefixo: "DSBN",
  contadores: { M: 3605, P: 13130, V: 758 }, vertices,
}, proj4);
const ring = servico.ring;
const posDe = new Map(ring.map((v, i) => [v.ordem, i]));
const dadosBase = {
  vertices: ring.map((v, i) => ({
    codigo: v.codigo, e: v.eProj, n: v.nProj,
    lonFmt: fmtGmsPlanilha(v.lonGms, "lon"), latFmt: fmtGmsPlanilha(v.latGms, "lat"),
    alt: String(v.h).replace(".", ","), azFmt: servico.segs[i].azimuteFmt, distFmt: servico.segs[i].distFmt,
    vante: ring[(i + 1) % ring.length].codigo,
  })),
  trechos: servico.trechosOrdenados.map((t, k) => ({
    descritivo: t.descritivo, isEstrada: t.ehVia, inicioIdx: posDe.get(t.verticeInicioOrdem),
    fimIdx: posDe.get(servico.trechosOrdenados[(k + 1) % servico.trechosOrdenados.length].verticeInicioOrdem),
  })),
  denominacao: "FAZENDA TESTE", proprietarios: [{ nome: "MARIA DE TESTE SILVA", cpf: "111.222.333-44" }],
  matricula: "4.490", cns: "00.803-7", sncr: "312.010.028.860-1", municipioUf: "ARACI-BA",
  areaFmt: fmtBR(servico.areaHa, 4), tarefasFmt: fmtBR(servico.areaHa * 10000 / 4356, 2), perimetroFmt: fmtBR(servico.perimetroM, 2),
  mcAbs: 39, fuso: 24, latMediaDeg: -11.4, trt: "BR20260408910",
  rt: { nome: "TECNICO DE TESTE", formacao: "Técnico em Agropecuária", conselhoSigla: "CFTA", conselhoNumero: "0578839458-9", codigoCredenciado: "DSBN" },
  desenhista: "JANETE OLIVEIRA", dataStr: "05/11/2026", logo: null,
};

/** Texto de todo o conteúdo da página (fluxos descomprimidos). */
async function conteudo(bytes) {
  const pg = (await PDFDocument.load(bytes)).getPage(0);
  let txt = "";
  for (const ref of pg.node.normalizedEntries().Contents.asArray()) {
    const bruto = Buffer.from(pg.doc.context.lookup(ref).getContents());
    try { txt += inflateSync(bruto).toString("latin1"); } catch { txt += bruto.toString("latin1"); }
  }
  return txt;
}
const hexDe = (s) => Buffer.from(s, "latin1").toString("hex").toUpperCase();
const contar = (txt, re) => (txt.match(re) ?? []).length;

for (const folha of ["A1", "A3", "A4"]) {
  test(`planta ${folha}: com o selo sai o QR em vetor e o código; sem ele, a planta de sempre`, async () => {
    const codigo = gerarCodigoVerificacao();
    const selo = { codigo, url: urlVerificacao(codigo) };
    const sem = await gerarPlantaPdf({ ...dadosBase, folha });
    const sem2 = await gerarPlantaPdf({ ...dadosBase, folha });
    const com = await gerarPlantaPdf({ ...dadosBase, folha, autenticidade: selo, assinaturaRt: { bytes: pngAssinatura(), tipo: "png" } });
    writeFileSync(new URL(`./planta-autenticidade-${folha}.pdf`, OUT), com);
    const tSem = await conteudo(sem), tSem2 = await conteudo(sem2), tCom = await conteudo(com);
    assert.equal(tSem, tSem2, "sem o selo o desenho é determinístico (mesma planta de antes)");
    assert.notEqual(tCom, tSem);
    assert.ok(tCom.includes(hexDe(codigoAgrupado(codigo))), "o código agrupado está impresso");
    assert.ok(!tSem.includes(hexDe(codigoAgrupado(codigo))));
    // QR: uma corrida de módulos escuros = um retângulo preenchido
    const corridas = retangulosQr(gerarQr(selo.url, "M")).length;
    assert.ok(contar(tCom, /\nh\nf\n/g) - contar(tSem, /\nh\nf\n/g) >= corridas, "retângulos do QR no conteúdo");
    if (folha !== "A4") {
      assert.ok(tCom.includes(hexDe("DOCUMENTO VERIFIC")) || tCom.includes(hexDe("DOCUMENTO VERIFICÁVEL")));
      // a imagem da assinatura do RT entrou (um XObject a mais)
      assert.ok(contar(tCom, / Do\n?/g) > contar(tSem, / Do\n?/g), "imagem da assinatura desenhada");
    }
    const doc = await PDFDocument.load(com);
    assert.equal(doc.getPageCount(), 1);
  });
}
