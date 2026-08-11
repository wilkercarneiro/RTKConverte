// O Memorial Descritivo da geração de documentos sai do MODELO DA EMPRESA — o
// mesmo .docx da peça 1 — e não de um layout montado em código.
//
// Antes ele era escrito parágrafo a parágrafo: título "M E M O R I A L
// D E S C R I T I V O (GEO)", uma lista de campos própria e um fecho próprio. O
// resultado era um documento parecido, não o documento da empresa. Estes testes
// prendem a saída ao modelo: se alguém voltar a montar o memorial à mão, ou se o
// preenchimento parar de casar com o modelo, eles quebram.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import proj4lib from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { gerarMemorialDescritivoXml } from "../supabase/functions/_shared/pecas.ts";
import { montarDadosPecasDoCalculo } from "../supabase/functions/_shared/pecas_dados.ts";
import { entrada } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);

const SERVICO = {
  detentor_nome: "JACO CORDEIRO FERREIRA",
  detentor_cpf: "968.839.875-68",
  detentor_genero: "M",
  endereco_detentor: "ZONA RURAL",
  denominacao: "FAZENDA SALGADA VELHA",
  municipio: "CONCEIÇÃO DO COITÉ",
  uf: "BA",
  matricula: "4.490",
  cns: "00.810-2",
  codigo_sncr: "312.010.028.860-1",
  fuso_utm: 24,
  tipo_imovel: "matricula",
  trt: "BR20260601082",
};
const RT = { nome: "DANIEL NASCIMENTO SANTOS", formacao: "TÉCNICO EM AGRIMENSURA", conselho_sigla: "CFTA", conselho_numero: "0578839458-9" };

async function memorial(servico = SERVICO) {
  const posse = servico.tipo_imovel === "posse";
  const pasta = posse ? "pecas-posse" : "pecas";
  const calc = montarServico(entrada(), proj4);
  const dados = montarDadosPecasDoCalculo({
    servico, rt: RT, cred: { prefixo_vertice: "DSBN" }, calc, dataStr: "11/08/2026",
  });
  const z = await JSZip.loadAsync(readFileSync(new URL(`../reference/${pasta}/1-memorial-descritivo.docx`, import.meta.url)));
  const xml = gerarMemorialDescritivoXml(await z.file("word/document.xml").async("string"), dados, posse);
  const texto = (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map((s) => s.replace(/<[^>]+>/g, "")).join(" ").replace(/\s+/g, " ");
  return { xml, texto };
}

test("o memorial é o documento da empresa, não um layout montado em código", async () => {
  const { texto } = await memorial();
  // a organização do modelo: título, tabela de campos, seção e fecho
  for (const parte of ["MEMORIAL DESCRITIVO", "Requerente", "Município", "Área (ha)", "Denominação",
    "Perímetro", "Datum", "Matrícula", "Meridiano", "TRT", "DESCRIÇÃO DO PERÍMETRO"]) {
    assert.ok(texto.includes(parte), `faltou "${parte}" — o modelo tem`);
  }
  // e nada do layout antigo, que era o que fazia o documento sair diferente
  assert.doesNotMatch(texto, /M E M O R I A L/);
  assert.doesNotMatch(texto, /Imóvel :/);
});

test("só as informações mudam: os dados do serviço entram nos campos do modelo", async () => {
  const { texto } = await memorial();
  assert.ok(texto.includes("JACO CORDEIRO FERREIRA"), "requerente do serviço");
  assert.ok(texto.includes("CONCEIÇÃO DO COITÉ"), "município do serviço");
  assert.ok(texto.includes("BR20260601082"), "TRT do serviço");
  assert.ok(texto.includes("DANIEL NASCIMENTO SANTOS"), "responsável técnico");
  // e o do cliente que veio no modelo não pode sobrar em lugar nenhum
  assert.doesNotMatch(texto, /LARISSA|GILBERTO|VIBRAÇÃO/);
});

test("a descrição do perímetro é a do cálculo do serviço", async () => {
  const { texto } = await memorial();
  assert.ok(texto.includes("Inicia-se a descrição deste perímetro no vértice DSBN-"), "abertura no vértice calculado");
  assert.match(texto, /azimute/i);
  assert.match(texto, /até o vértice DSBN-/);
});

test("posse usa o modelo de posse, com o mapa de posse", async () => {
  const { texto } = await memorial({ ...SERVICO, tipo_imovel: "posse" });
  assert.ok(texto.includes("DESCRIÇÃO DO PERÍMETRO"));
  assert.ok(texto.includes("JACO CORDEIRO FERREIRA"), "requerente do serviço");
  // o caso de exemplo do modelo de posse não pode sobreviver: a substituição é
  // literal, e passar o mapa de matrícula aqui devolveria o documento do exemplo
  assert.doesNotMatch(texto, /ANTONIO DA SILVA COSTA|SÃO DOMINGOS|FEIRA DE SANTANA/);
});

test("o memorial sai timbrado, com o mesmo cabeçalho e rodapé das peças", async () => {
  const z = await JSZip.loadAsync(readFileSync(new URL("../reference/pecas/1-memorial-descritivo.docx", import.meta.url)));
  const header = await z.file("word/header2.xml").async("string");
  const footer = await z.file("word/footer1.xml").async("string");
  assert.match(header, /gain="19661f"/, "marca d'água do modelo");
  assert.match(header, /<w:drawing>/, "logo no topo");
  assert.match(footer, /8167-2207/, "rodapé de contato novo");
});
