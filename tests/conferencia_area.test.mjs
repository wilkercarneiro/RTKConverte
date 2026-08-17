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

test("a prévia numera P-1, P-2… e nunca com o prefixo do credenciado", () => {
  // O código da conferência não pode ter cara de oficial: quem recebe a prévia
  // lia "DSBN-P-14300" e tratava o marco como já registrado. Ver
  // `codigoConferencia` em geo.ts.
  const previa = montarServico({ ...entrada({ comCodigo: false }), estiloCodigo: "conferencia" }, proj4);
  const oficial = montarServico({ ...entrada({ comCodigo: false }), prefixo: "DSBN" }, proj4);

  assert.ok(previa.ring.every((v) => /^[MPV]-\d+$/.test(v.codigo)), "todo código é TIPO-N");
  assert.ok(previa.ring.every((v) => !v.codigo.includes("DSBN")), "nenhum prefixo de credenciado");
  assert.ok(oficial.ring.every((v) => v.codigo.startsWith("DSBN-")));
  assert.equal(
    previa.ring.filter((v) => oficial.ring.some((o) => o.codigo === v.codigo)).length,
    0,
    "nenhum código de prévia pode coincidir com um oficial",
  );
  // a geometria é a mesma: o formato do código não muda o cálculo
  assert.equal(previa.areaHa, oficial.areaHa);
  assert.equal(previa.perimetroM, oficial.perimetroM);
});

test("a numeração da prévia começa em 1 por tipo, na ordem do anel", () => {
  const previa = montarServico({ ...entrada({ comCodigo: false }), estiloCodigo: "conferencia" }, proj4);
  const seq = { M: [], P: [], V: [] };
  for (const v of previa.ring) {
    const [tipo, n] = v.codigo.split("-");
    seq[tipo].push(Number(n));
  }
  for (const tipo of ["M", "P"]) {
    assert.deepEqual(
      seq[tipo],
      seq[tipo].map((_, i) => i + 1),
      `${tipo} numerado de 1 a ${seq[tipo].length} sem buracos`,
    );
  }
  assert.equal(previa.ring[0].codigo, `${previa.ring[0].tipo}-1`, "o vértice inicial é o 1 do seu tipo");
});

test("os contadores do credenciado não vazam para a prévia", () => {
  // Chamador que passe contadores altos (a leitura dos contadores oficiais, como
  // o gerar-documentos fazia) não pode mover a numeração da prévia.
  const comContador = montarServico(
    { ...entrada({ comCodigo: false, contadores: { M: 4558, P: 14444, V: 758 } }), estiloCodigo: "conferencia" },
    proj4,
  );
  const semContador = montarServico({ ...entrada({ comCodigo: false }), estiloCodigo: "conferencia" }, proj4);
  assert.deepEqual(comContador.ring.map((v) => v.codigo), semContador.ring.map((v) => v.codigo));
});

test("o serviço completo continua com o código oficial, intacto", () => {
  // Lacre: a mudança é EXCLUSIVA da conferência. Sem `estiloCodigo`, nada muda.
  const base = { M: 4558, P: 14444, V: 758 };
  const oficial = montarServico({ ...entrada({ comCodigo: false }), contadores: base }, proj4);
  const t0 = oficial.ring[0].tipo;
  assert.equal(oficial.ring[0].codigo, `DSBN-${t0}-${base[t0]}`, "continua partindo do contador do credenciado");
  assert.ok(oficial.ring.every((v) => /^DSBN-[MPV]-\d{4,}$/.test(v.codigo)));
});
