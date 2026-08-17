// O mapeamento entre os cartões da tela e as colunas do banco.
//
// Três cartões, mas duas colunas ortogonais (`modalidade`, `tem_glebas`) mais um
// terceiro eixo (`tipo`, a origem do dado). Errar a leitura inversa faria um
// serviço com gleba aparecer como completo na lista, ou — pior — a conferência
// aparecer como serviço que vai ao SIGEF. Estes testes lacram as duas direções.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SERVICOS, camposDaSituacao, chaveDoServico, definicaoDe, pedeMatricula,
  rotuloCurto, situacaoDoImovel, vaiAoSigef,
} from "../src/lib/modalidades.ts";
import { hashParaRota, rotaParaHash } from "../src/lib/rota.ts";

test("ida e volta: os campos de cada cartão voltam ao mesmo cartão", () => {
  for (const d of SERVICOS) {
    assert.equal(chaveDoServico(d.campos), d.chave, `${d.chave} não fecha o ciclo`);
  }
});

test("serviço com gleba é o completo com tem_glebas — não um tipo novo", () => {
  const gleba = definicaoDe("gleba");
  const completo = definicaoDe("completo");
  assert.equal(gleba.campos.modalidade, completo.campos.modalidade);
  assert.equal(gleba.campos.tipo, completo.campos.tipo);
  assert.equal(gleba.campos.tem_glebas, true);
  assert.equal(completo.campos.tem_glebas, false);
});

test("serviços antigos (defaults do banco) leem como completo", () => {
  // a migration deu default 'completo'/false a todas as linhas existentes
  assert.equal(chaveDoServico({ tipo: "geo", modalidade: "completo", tem_glebas: false }), "completo");
  assert.equal(chaveDoServico({ tipo: "pecas", modalidade: "completo", tem_glebas: false }), "pecas");
});

test("só a conferência para antes do SIGEF", () => {
  assert.equal(vaiAoSigef({ modalidade: "completo" }), true);
  assert.equal(vaiAoSigef({ modalidade: "conferencia" }), false);
});

test("todo cartão tem rótulo curto para os chips das listas", () => {
  for (const d of SERVICOS) assert.ok(rotuloCurto[d.chave], `sem rótulo: ${d.chave}`);
});

test("chave desconhecida cai no serviço completo, não quebra", () => {
  assert.equal(definicaoDe("inexistente").chave, "completo");
});

test("rotas sobrevivem à ida e volta pelo hash", () => {
  const rotas = [
    { t: "inicio" }, { t: "clientes" }, { t: "servicos" }, { t: "config" },
    { t: "cliente", id: "abc-123" },
    { t: "servico", id: "def-456" },
    { t: "novo", chave: "gleba" },
    { t: "novo", chave: "conferencia", clienteId: "cli-9" },
  ];
  for (const r of rotas) {
    assert.deepEqual(hashParaRota(rotaParaHash(r)), r, `rota ${r.t} não sobreviveu`);
  }
});

test("hash inválido ou vazio cai no início em vez de tela em branco", () => {
  for (const h of ["", "#", "#/", "#/inexistente", "#/cliente", "#/servico"]) {
    const r = hashParaRota(h);
    assert.ok(["inicio", "clientes", "servicos"].includes(r.t), `${h} → ${r.t}`);
  }
});

// ---------------------------------------------------------------------------
// Situação do imóvel na conferência: matrícula / posse / ainda sem documento
// ---------------------------------------------------------------------------
//
// Uma pergunta na tela, duas colunas no banco. Estes testes lacram as duas
// direções — errar aqui faz a planta de um posseiro sair com "(MATR./CNS.)".

test("as três situações fecham o ciclo tela → colunas → tela", () => {
  for (const v of ["matricula", "posse", "nao_informar"]) {
    assert.equal(situacaoDoImovel(camposDaSituacao(v)), v, `${v} não fecha o ciclo`);
  }
});

test("cada situação grava o par de colunas que a planta lê", () => {
  assert.deepEqual(camposDaSituacao("matricula"), { tipo_imovel: "matricula", conf_exibir_matricula: true });
  assert.deepEqual(camposDaSituacao("posse"), { tipo_imovel: "posse", conf_exibir_matricula: true });
  // sem documento: a planta não imprime nem matrícula nem posse
  assert.deepEqual(camposDaSituacao("nao_informar"), { tipo_imovel: "matricula", conf_exibir_matricula: false });
});

test("serviço antigo (tipo_imovel nulo) lê como matrícula, sem mudar a planta", () => {
  // é o que a planta já assumia com tipo_imovel nulo (ver planta_dados.ts)
  assert.equal(situacaoDoImovel({ tipo_imovel: null, conf_exibir_matricula: true }), "matricula");
  assert.equal(situacaoDoImovel({ tipo_imovel: undefined, conf_exibir_matricula: undefined }), "matricula");
});

test("'não informar' vence tipo_imovel: nada é impresso", () => {
  assert.equal(situacaoDoImovel({ tipo_imovel: "posse", conf_exibir_matricula: false }), "nao_informar");
  assert.equal(situacaoDoImovel({ tipo_imovel: "matricula", conf_exibir_matricula: false }), "nao_informar");
});

test("só matrícula pede matrícula e CNS", () => {
  assert.equal(pedeMatricula("matricula"), true);
  assert.equal(pedeMatricula("posse"), false, "posseiro não tem cartório para informar");
  assert.equal(pedeMatricula("nao_informar"), false);
});
