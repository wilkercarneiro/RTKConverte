// Peças técnicas SEM o PDF do SIGEF (pedido de 23/11/2026): imóvel que não
// passa pelo SIGEF — área urbana, por exemplo — gera as 7 peças pelo cálculo do
// próprio sistema (gerar-pecas com `origem: "calculo"`, sem `apenas`). E o
// segundo requerente, que agora é preenchido na etapa Dados, sai nelas mesmo
// sem o PDF: antes ele só aparecia na tela DEPOIS do PDF.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import proj4 from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { montarDadosPecasDoCalculo } from "../supabase/functions/_shared/pecas_dados.ts";
import { modelosDasPecas, pastaDasPecas } from "../supabase/functions/_shared/tabular_sistema.ts";
import { gerarPecasXml, gerarPecasPosseXml } from "../supabase/functions/_shared/pecas.ts";
import { entrada } from "./fixtures/salgada_velha.mjs";

const RT = { nome: "DANIEL NASCIMENTO SANTOS", formacao: "TÉCNICO EM AGRIMENSURA", conselho_sigla: "CFTA", conselho_numero: "0578839458-9", cpf: "000.000.000-00", identidade: "00.000.000-00 SSP/BA" };
const SERVICO = {
  detentor_nome: "JOSÉ URBANO DA SILVA", detentor_cpf: "111.111.111-11", detentor_genero: "M",
  requerente2_nome: "ANA URBANA DA SILVA", requerente2_cpf: "222.222.222-22", requerente2_genero: "F",
  endereco_detentor: "RUA DAS FLORES, 10, CENTRO", denominacao: "LOTE URBANO 12", municipio: "CONCEIÇÃO DO COITÉ", uf: "BA",
  matricula: "9.999", cns: "00.810-2", fuso_utm: 24, trt: "BR20261123001",
};
const textoDoXml = (xml) => (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map((s) => s.replace(/<[^>]+>/g, "")).join(" ").replace(/\s+/g, " ");

async function modelos(posse) {
  const xml = {};
  for (const [num, arq] of modelosDasPecas(posse)) {
    const bytes = readFileSync(new URL(`../reference/${pastaDasPecas(posse)}/${arq}.docx`, import.meta.url));
    xml[num] = await (await JSZip.loadAsync(bytes)).file("word/document.xml").async("string");
  }
  return xml;
}

for (const posse of [false, true]) {
  test(`sem PDF do SIGEF (${posse ? "posse" : "matrícula"}): todas as peças saem do cálculo, com os dois requerentes`, async () => {
    const servico = { ...SERVICO, tipo_imovel: posse ? "posse" : "matricula" };
    const calc = montarServico(entrada(), proj4);
    const dados = montarDadosPecasDoCalculo({ servico, rt: RT, cred: { prefixo_vertice: "DSBN" }, calc, dataStr: "23/11/2026" });
    assert.equal(dados.requerentes.length, 2, "o segundo requerente entra nas peças");
    const tpl = await modelos(posse);
    const xmls = posse ? gerarPecasPosseXml(tpl, dados) : gerarPecasXml(tpl, dados);
    const nums = modelosDasPecas(posse).map(([n]) => n);
    assert.ok(nums.length >= (posse ? 4 : 7), `jogo completo (${nums.length} peças)`);
    for (const n of nums) {
      assert.ok(xmls[n], `peça ${n} gerada`);
      const t = textoDoXml(xmls[n]);
      assert.ok(!/\{[a-z_]+\}|«|»/i.test(t), `peça ${n} sem marcador sobrando`);
    }
    // o requerimento/declaração e o memorial nomeiam o casal
    const tudo = nums.map((n) => textoDoXml(xmls[n])).join(" ");
    assert.ok(tudo.includes("JOSÉ URBANO DA SILVA"), "1º requerente");
    assert.ok(tudo.includes("ANA URBANA DA SILVA"), "2º requerente");
    assert.ok(tudo.includes("222.222.222-22"), "CPF do 2º requerente");
    // área e perímetro do cálculo, iguais aos do memorial
    assert.ok(tudo.includes(String(dados.areaHa)), `área ${dados.areaHa}`);
  });
}
