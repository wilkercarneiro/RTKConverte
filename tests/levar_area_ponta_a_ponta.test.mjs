// Levar a área de um serviço para outro, de ponta a ponta, com as Edge Functions
// REAIS (ler-arquivo e parse-txt) num Supabase falso em memória (tests/funcoes/):
//
//   serviço de origem (vértices do banco) ──▶ TXT do levantamento + vértices levados
//   ──▶ ler-arquivo (formato da equipe, sem IA) ──▶ parse-txt (serviço novo criado)
//   ──▶ remendos (confrontação completa + método) ──▶ cada LADO do imóvel novo tem
//       o mesmo confrontante, com o MESMO descritivo, matrícula, CNS e tipo de limite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import proj4 from "proj4";

register("./funcoes/ganchos.mjs", import.meta.url);
const { bancoNovo } = await import("./funcoes/supabase-falso.mjs");
const { executarReceita } = await import("../supabase/functions/_shared/leitor/index.ts");
const { exportarArea } = await import("../src/lib/exportar/index.ts");
const { prepararCamadas } = await import("../src/lib/exportar/coordenadas.ts");
const { camadasDoGeo } = await import("../src/lib/exportar/geo.ts");
const { aneisDoPerimetro } = await import("../src/lib/exportar/levantamento.ts");
const { verticesLevados, remendosDosVertices } = await import("../src/lib/area_vertices.ts");
const { ANEL } = await import("./fixtures/salgada_velha.mjs");

const env = { SUPABASE_URL: "http://falso", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
let capturado;
globalThis.Deno = { serve: (h) => { capturado = h; }, env: { get: (k) => env[k] } };
await import("../supabase/functions/ler-arquivo/index.ts");
const lerArquivo = capturado;
await import("../supabase/functions/parse-txt/index.ts");
const parseTxt = capturado;

const b64 = (s) => Buffer.from(new TextEncoder().encode(s)).toString("base64");
async function chamar(h, corpo) {
  const r = await h(new Request("http://funcao", { method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));
  return { status: r.status, corpo: await r.json() };
}

// a confrontação completa de cada M da SALGADA (o que o rótulo do TXT NÃO leva)
const CONF = {
  3: { descritivo: "ESTRADA VICINAL", tipo_limite: "LA3", eh_via: true, cns: null, matricula: null, numerado: false, exibir_planta: true },
  4: { descritivo: "(MATR.12.345/CNS.01.234-5) FAZENDA BOA ESPERANÇA\\ JOÃO DA SILVA\\ CPF:123.456.789-00", tipo_limite: "LA1", eh_via: false, cns: "01.234-5", matricula: "12.345", numerado: false, exibir_planta: true },
  14: { descritivo: "LINHA FERREA", tipo_limite: "LA3", eh_via: true, cns: null, matricula: null, numerado: false, exibir_planta: true },
  15: { descritivo: "(POSSE) SÍTIO SÃO JOSÉ\\ MARIA DE SOUZA\\ CPF:987.654.321-00", tipo_limite: "LA2", eh_via: false, cns: null, matricula: null, numerado: true, exibir_planta: false },
};
const ORIGEM = ANEL.map(([ordem, e, n, tipo, codigo], i) => ({
  id: `o${ordem}`, ordem, num_txt: ordem + 1, e, n, h: 360 + i / 10, sigma_pos: 0.012, sigma_h: 0.021, tipo, codigo,
  codigo_provisorio: false, inserido_manual: false, lat_gms: "", lon_gms: "", metodo: "PG1", apelido_txt: null,
  ...(CONF[ordem] ?? { descritivo: null, tipo_limite: null, eh_via: false, cns: null, matricula: null, numerado: false, exibir_planta: true }),
}));

/** Qual vértice da origem é este ponto (o mais perto; o TXT leva mm, o canônico difere em décimos de mm). */
const daOrigem = (p) => ORIGEM.reduce((m, v) => (Math.hypot(v.e - p.e, v.n - p.n) < Math.hypot(m.e - p.e, m.n - p.n) ? v : m)).ordem;

/** Confrontação de cada lado (chave: os dois vértices da origem): o M que abre o trecho, dando a volta. */
function porLado(vs) {
  const seq = [...vs].sort((a, b) => a.ordem - b.ordem);
  const ms = seq.filter((v) => v.tipo === "M");
  let atual = ms[ms.length - 1];
  const k = (a, b) => [daOrigem(a), daOrigem(b)].sort((x, y) => x - y).join("|");
  const out = new Map();
  seq.forEach((v, i) => {
    if (v.tipo === "M") atual = v;
    const { descritivo, tipo_limite, eh_via, cns, matricula, numerado, exibir_planta } = atual;
    out.set(k(v, seq[(i + 1) % seq.length]), { descritivo, tipo_limite, eh_via, cns, matricula, numerado, exibir_planta });
  });
  return out;
}

test("área levada de ponta a ponta: o serviço novo nasce com os mesmos lados, confrontantes completos e método", async () => {
  // 1) origem → TXT do levantamento + vértices levados (o que levarArea.ts monta)
  const camadas = camadasDoGeo(ORIGEM, [], 24, { nome: "FAZENDA SALGADA VELHA" });
  const txt = new TextDecoder().decode((await exportarArea(camadas, "levantamento", { fuso: 24, nome: "SALGADA" })).dados);
  const levados = verticesLevados(ORIGEM, aneisDoPerimetro(prepararCamadas(camadas, 24)).map((a) => a.utm));
  assert.equal(levados.length, ANEL.length);
  assert.equal(levados.filter((v) => v.confrontacao).length, Object.keys(CONF).length, "um por M");

  // 2) as funções reais: ler-arquivo → prévia → parse-txt
  const banco = bancoNovo();
  const lida = await chamar(lerArquivo, { nome_arquivo: "SALGADA_LEVANTAMENTO_SIRGAS2000_UTM24S.txt", arquivo_base64: b64(txt) });
  assert.equal(lida.status, 200, JSON.stringify(lida.corpo));
  assert.equal(lida.corpo.receita.origem, "padrao");
  assert.equal(lida.corpo.ia.usada, false);
  const local = executarReceita(lida.corpo.linhas, lida.corpo.receita, { proj4 });
  assert.ok(local.ok, "sem σ/altitude a pedir");
  const criado = await chamar(parseTxt, {
    nome_arquivo: "SALGADA_LEVANTAMENTO_SIRGAS2000_UTM24S.txt", arquivo_base64: b64(txt), uf: "BA", fuso: 24,
    leitura: { receita: lida.corpo.receita, confirmados: local.aConfirmar },
  });
  assert.equal(criado.status, 200, JSON.stringify(criado.corpo));
  const sid = criado.corpo.servico.id;
  const novos = banco.tabelas.vertices.filter((v) => v.servico_id === sid);
  assert.equal(novos.length, ANEL.length);
  assert.equal(novos.filter((v) => v.tipo === "M").length, Object.keys(CONF).length, "os M voltam como M");
  assert.ok(novos.every((v) => Math.abs(v.sigma_pos - 0.012) < 1e-9 && Math.abs(v.sigma_h - 0.021) < 1e-9), "σ de cada vértice");

  // 3) os remendos (o que o Upload grava logo depois de criar)
  const remendos = remendosDosVertices(novos, levados);
  for (const m of remendos) for (const v of novos) if (m.ids.includes(v.id)) Object.assign(v, m.campos);
  assert.ok(remendos.length <= 1 + Object.keys(CONF).length, `poucos UPDATEs (agrupados): ${remendos.length}`);

  // 4) lado a lado, a confrontação do serviço novo é a do serviço de origem
  const antes = porLado(ORIGEM), depois = porLado(novos);
  assert.equal(depois.size, antes.size);
  for (const [lado, c] of antes) assert.deepEqual(depois.get(lado), c, `lado ${lado}`);
  assert.ok(novos.every((v) => v.metodo === "PG1"), "o método de cada vértice");
});

test("PARTES (IBERA): cada M leva a confrontação do lado seguinte DA PRÓPRIA parte — conferido contra a confrontação de geo.ts", async () => {
  const { VERTICES, GLEBAS } = await import("./fixtures/ibera.mjs");
  const { textoConfrontante } = await import("../src/lib/exportar/geo.ts");
  const origem = VERTICES.map(([ordem, num, tipo, e, n]) => ({
    ordem, num_txt: num, e, n, h: 500, tipo, codigo: null, metodo: "PG6", sigma_pos: 0.02, sigma_h: 0.03,
    descritivo: tipo === "M" ? `VIZINHO ${num}\\ DONO ${num}` : null, tipo_limite: tipo === "M" ? "LA1" : null,
  }));
  const camadas = prepararCamadas(camadasDoGeo(origem, GLEBAS, 24), 24);
  const aneis = aneisDoPerimetro(camadas);
  assert.ok(aneis.length > 1);
  const levados = verticesLevados(origem, aneis.map((a) => a.utm));
  let k = 0, conferidos = 0;
  for (const anel of aneis) {
    anel.utm.forEach((_, i) => {
      const l = levados[k++];
      const esperado = anel.confrontantes[i] ?? null; // geo.ts: confrontante do lado i → i+1, por parte
      if (l.confrontacao) {
        assert.equal(textoConfrontante(l.confrontacao), esperado, `parte ${anel.nome}, ponto ${i}`);
        conferidos++;
      }
    });
  }
  assert.equal(k, levados.length);
  assert.equal(conferidos, VERTICES.filter((v) => v[2] === "M").length, "todo M da IBERA recebeu confrontação");
});

test("certificado do vizinho: volta com o código, o tipo e o GMS do SIGEF; vértice nosso (prefixo próprio) não", () => {
  const sq = [[0, 0], [100, 0], [100, 100], [50, 120], [0, 100]].map(([x, y]) => [500000 + x, 8700000 + y]);
  const origem = sq.map(([e, n], ordem) => ({ ordem, e, n, tipo: ordem === 0 ? "M" : "P", metodo: "PG6", descritivo: ordem === 0 ? "VIZINHO" : null,
    codigo: null, codigo_provisorio: false, inserido_manual: false, lat_gms: "", lon_gms: "" }));
  Object.assign(origem[2], { tipo: "V", codigo: "ABCD-V-0012", inserido_manual: true, metodo: "PG2", lat_gms: "-11 47 22,123", lon_gms: "-38 59 59,456" });
  Object.assign(origem[3], { codigo: "DSBN-P-0099", inserido_manual: true }); // inserido por nós, código nosso
  const levados = verticesLevados(origem, [sq], "DSBN");
  assert.deepEqual(levados[2].certificado, { codigo: "ABCD-V-0012", tipo: "V", lat_gms: "-11 47 22,123", lon_gms: "-38 59 59,456" });
  assert.equal(levados[3].certificado, undefined);
  // o TXT trouxe o V de volta como P: o remendo o devolve ao SIGEF
  const novos = sq.map(([e, n], i) => ({ id: `n${i}`, e, n, tipo: i === 0 ? "M" : "P", metodo: "PG6" }));
  const r = remendosDosVertices(novos, levados);
  const doV = r.find((m) => m.ids.includes("n2"));
  assert.deepEqual(doV.campos, { metodo: "PG2", codigo: "ABCD-V-0012", codigo_provisorio: false, inserido_manual: true, lat_gms: "-11 47 22,123", lon_gms: "-38 59 59,456", tipo: "V" });
  assert.ok(!r.some((m) => m.ids.includes("n3")), "o nosso não muda");
});

test("remendos: só casa por coordenada (5 cm), não mexe em quem não casa, e não grava o que já está igual", async () => {
  const levados = [
    { e: 500000, n: 8700000, metodo: "PG1", confrontacao: { descritivo: "VIZINHO", tipo_limite: "LA1", eh_via: false, cns: null, matricula: null, numerado: false, exibir_planta: true } },
    { e: 500100, n: 8700000, metodo: "PG6" },
  ];
  const novos = [
    { id: "a", e: 500000.022, n: 8700000.022, tipo: "M", metodo: "PG6" }, // ~3 cm (GMS arredondado): casa — método + confrontação
    { id: "b", e: 500100, n: 8700000.004, tipo: "P", metodo: "PG6" }, // casa, mas já está igual
    { id: "c", e: 500200, n: 8700000, tipo: "M", metodo: "PG6" },     // não casa
    { id: "d", e: 500000.08, n: 8700000, tipo: "P", metodo: "PG6" },  // 8 cm: longe demais
  ];
  const r = remendosDosVertices(novos, levados);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].ids, ["a"]);
  assert.equal(r[0].campos.metodo, "PG1");
  assert.equal(r[0].campos.descritivo, "VIZINHO");
});
