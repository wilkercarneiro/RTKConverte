// Conferência de área: o que ela pode entregar sem passar pelo SIGEF.
//
// A conferência é o que se faz ANTES de mandar ao SIGEF, então tudo que ela
// gera tem de sair do cálculo do próprio sistema. `sigefDoCalculo` é a tradução
// que permite reusar o gerador de peças (Memorial Tabular) sem PDF nenhum — é
// tradução, não um segundo gerador: as peças continuam saindo de um caminho só.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo, sigefDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";
import { entrada } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);

const contexto = (calc) => {
  const desc = new Map(calc.ring.map((v) => [v.codigo, v.trecho.descritivo]));
  return {
    servico: {
      denominacao: "FAZENDA SALGADA VELHA", detentor_nome: "FULANO DE TAL",
      detentor_cpf: "000.000.000-00", matricula: "1.234", cns: "00.810-2",
      codigo_sncr: "312.010.028.860-1", municipio: "Araci", uf: "BA",
    },
    rt: { nome: "RT TESTE", formacao: "Técnico em Agropecuária", conselho_numero: "0578839458-9" },
    cred: { prefixo_vertice: "DSBN" },
    trt: "BR20260807",
    confrontacaoDe: (c) => desc.get(c) ?? "",
  };
};

test("sigefDoCalculo produz uma linha por vértice, na ordem do anel", () => {
  const calc = montarServico(entrada(), proj4);
  const g = geometriaDoCalculo(calc);
  const sigef = sigefDoCalculo(g, contexto(calc));

  assert.equal(sigef.linhas.length, g.vertices.length);
  assert.deepEqual(sigef.linhas.map((l) => l.codigo), g.vertices.map((v) => v.codigo));
  // cada linha aponta para o vértice seguinte: é o que a tabela do doc 2 desenha
  sigef.linhas.forEach((l, i) => {
    assert.equal(l.vante, g.vertices[(i + 1) % g.vertices.length].codigo, `vante da linha ${i}`);
  });
});

test("sigefDoCalculo carrega área, perímetro e cabeçalho do serviço", () => {
  const calc = montarServico(entrada(), proj4);
  const g = geometriaDoCalculo(calc);
  const sigef = sigefDoCalculo(g, contexto(calc));

  assert.equal(sigef.cabecalho.areaHa, "6,7238");
  assert.equal(sigef.cabecalho.perimetroM, "1.291,52");
  assert.equal(sigef.cabecalho.denominacao, "FAZENDA SALGADA VELHA");
  assert.equal(sigef.cabecalho.municipioUf, "Araci-BA");
  assert.equal(sigef.cabecalho.documentoRt, "BR20260807");
  // o PDF traria data de geração; o cálculo não tem essa noção
  assert.equal(sigef.cabecalho.dataGeracao, null);
});

test("a confrontação de cada linha vem do trecho do vértice, não truncada", () => {
  const calc = montarServico(entrada(), proj4);
  const sigef = sigefDoCalculo(geometriaDoCalculo(calc), contexto(calc));

  // o PDF do SIGEF trunca a confrontação com "..."; aqui ela sai inteira
  assert.ok(sigef.linhas.every((l) => !l.confrontacao.endsWith("...")));
  const vias = new Set(sigef.linhas.map((l) => l.confrontacao));
  assert.ok(vias.has("ESTRADA VICINAL"), "a estrada tem de aparecer como confrontação");
  assert.ok(vias.has("LINHA FERREA"), "a linha férrea tem de aparecer como confrontação");
});

test("azimute e distância batem com os do memorial descritivo", () => {
  // É a garantia que sustenta a ressalva do documento: o tabular da conferência
  // e o memorial descritivo saem do MESMO cálculo. Divergir entre os dois seria
  // pior que divergir do SIGEF — seriam dois números nossos discordando.
  const calc = montarServico(entrada(), proj4);
  const g = geometriaDoCalculo(calc);
  const sigef = sigefDoCalculo(g, contexto(calc));

  sigef.linhas.forEach((l, i) => {
    assert.equal(l.azimute, calc.segs[i].azimuteFmt, `azimute da linha ${i}`);
    assert.equal(l.dist, calc.segs[i].distFmt, `distância da linha ${i}`);
  });
});

test("códigos provisórios não colidem com os oficiais", () => {
  // A conferência aloca com prefixo PROV e não toca nos contadores do
  // credenciado; a promoção a serviço completo detecta esses códigos pelo
  // prefixo e refaz a numeração. Ver PREFIXO_PROVISORIO em gerar-documentos.
  const prov = montarServico({ ...entrada({ comCodigo: false }), prefixo: "PROV" }, proj4);
  const oficial = montarServico({ ...entrada({ comCodigo: false }), prefixo: "DSBN" }, proj4);

  assert.ok(prov.ring.every((v) => v.codigo.startsWith("PROV-")));
  assert.ok(oficial.ring.every((v) => v.codigo.startsWith("DSBN-")));
  assert.equal(
    prov.ring.filter((v) => oficial.ring.some((o) => o.codigo === v.codigo)).length,
    0,
    "nenhum código provisório pode coincidir com um oficial",
  );
  // a geometria é a mesma: o prefixo não muda o cálculo
  assert.equal(prov.areaHa, oficial.areaHa);
});
