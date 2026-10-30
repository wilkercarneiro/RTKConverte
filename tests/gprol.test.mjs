// Integração com o GPROL (2026-10-30): regras puras do que vai para lá — nome
// do serviço, nota do card, campos do cliente, versões de documento e espera
// entre tentativas.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  camposClienteParaGprol, chaveDoServico, esperaDaTentativa, localParaGprol, marcoMaisAdiantado, nomeParaGprol,
  notaDoCard, ultimasVersoes, urlDeAutorizacao,
} from "../supabase/functions/_shared/gprol.ts";

test("chave do serviço segue a mesma leitura do front (modalidades.ts)", () => {
  assert.equal(chaveDoServico({ tipo: "pecas", modalidade: "completo" }), "pecas");
  assert.equal(chaveDoServico({ tipo: "geo", modalidade: "car" }), "car");
  assert.equal(chaveDoServico({ tipo: "geo", modalidade: "conferencia" }), "conferencia");
  assert.equal(chaveDoServico({ tipo: "geo", modalidade: "loteamento" }), "loteamento");
  assert.equal(chaveDoServico({ tipo: "geo", modalidade: "completo", tem_glebas: true, divisao: { iguais: true } }), "divisao");
  assert.equal(chaveDoServico({ tipo: "geo", modalidade: "completo", tem_glebas: true }), "gleba");
  assert.equal(chaveDoServico({ tipo: "geo", modalidade: "completo" }), "completo");
});

test("nome do serviço no GPROL: tipo · denominação, senão detentor, senão arquivo", () => {
  assert.equal(nomeParaGprol({ denominacao: "Fazenda Boa Vista", detentor_nome: "José" }, "completo"), "Georreferenciamento · Fazenda Boa Vista");
  assert.equal(nomeParaGprol({ denominacao: "  ", detentor_nome: "José" }, "car"), "CAR · José");
  assert.equal(nomeParaGprol({ nome_arquivo_txt: "IBERA.txt" }, "gleba"), "Georreferenciamento com glebas · IBERA.txt");
  assert.equal(nomeParaGprol({}, "pecas"), "Peças técnicas");
});

test("local: município/UF", () => {
  assert.equal(localParaGprol("Feira de Santana", "ba"), "Feira de Santana/BA");
  assert.equal(localParaGprol("Feira", null), "Feira");
  assert.equal(localParaGprol(null, null), null);
});

test("nota do card usa o marco mais adiantado e quem fez", () => {
  assert.equal(marcoMaisAdiantado(["iniciado", "pecas", "documentos"]), "pecas");
  assert.equal(marcoMaisAdiantado([]), null);
  assert.equal(notaDoCard(["iniciado", "documentos"], "Maria"), "Vertces · Maria · documentos gerados");
  assert.equal(notaDoCard(["iniciado"], null), "Vertces · serviço iniciado");
  assert.equal(notaDoCard(["entregue", "iniciado"], " "), "Vertces · serviço concluído");
});

test("cliente: só os campos que mudaram, com os nomes do GPROL", () => {
  const c = { nome: "Ana", cpf_cnpj: "1", email: null, telefone: "75 9", endereco: "Rua", genero: "F" };
  assert.deepEqual(camposClienteParaGprol(c, ["telefone"]), { phone: "75 9" });
  assert.deepEqual(camposClienteParaGprol(c, ["email", "genero"]), { email: "" });
  assert.deepEqual(camposClienteParaGprol(c), { full_name: "Ana", cpf_cnpj: "1", email: "", phone: "75 9", address: "Rua" });
});

test("espera entre tentativas cresce e para em 2 h", () => {
  assert.equal(esperaDaTentativa(1), 60_000);
  assert.equal(esperaDaTentativa(2), 300_000);
  assert.equal(esperaDaTentativa(3), 1_800_000);
  assert.equal(esperaDaTentativa(4), 7_200_000);
  assert.equal(esperaDaTentativa(9), 7_200_000);
  assert.equal(esperaDaTentativa(0), 60_000);
});

test("documentos: última versão de cada tipo, com todas as plantas de gleba dela", () => {
  const docs = [
    { id: "a", tipo: "memorial_docx", versao: 1 },
    { id: "b", tipo: "memorial_docx", versao: 2 },
    { id: "c", tipo: "gleba_planta_pdf", versao: 2 },
    { id: "d", tipo: "gleba_planta_pdf", versao: 2 },
    { id: "e", tipo: "gleba_planta_pdf", versao: 1 },
    { id: "f", tipo: "planta_pdf_editada", versao: 1 },
  ];
  assert.deepEqual(ultimasVersoes(docs).map((d) => d.id), ["b", "c", "d", "f"]);
});

test("link de autorização vai ao app do GPROL com state e escritório", () => {
  const u = new URL(urlDeAutorizacao("https://app.gprol.com.br", "st4te", "esc-1", "D'Prol & Cia"));
  assert.equal(u.origin + u.pathname, "https://app.gprol.com.br/integracoes/vertces/autorizar");
  assert.equal(u.searchParams.get("state"), "st4te");
  assert.equal(u.searchParams.get("escritorio_id"), "esc-1");
  assert.equal(u.searchParams.get("escritorio"), "D'Prol & Cia");
});

test("pedido do GPROL preenche denominação e município/UF sem sobrescrever", async () => {
  const { camposDoPedido } = await import("../src/lib/pedidoGprol.ts");
  assert.deepEqual(camposDoPedido({ fazenda: "Fazenda Boa Vista", local: "Feira de Santana/BA" }, {}),
    { denominacao: "Fazenda Boa Vista", municipio: "Feira de Santana", uf: "BA" });
  assert.deepEqual(camposDoPedido({ local: "Embu-Guaçu - sp" }, {}), { municipio: "Embu-Guaçu", uf: "SP" });
  assert.deepEqual(camposDoPedido({ local: "Zona rural de Ipirá" }, {}), { municipio: "Zona rural de Ipirá" });
  assert.deepEqual(camposDoPedido({ local: "Cidade/XX" }, {}), { municipio: "Cidade" });
  assert.deepEqual(camposDoPedido({ fazenda: "X", local: "Feira/BA" }, { denominacao: "Já tem", municipio: "Outro", uf: "SE" }), {});
  assert.deepEqual(camposDoPedido(null, {}), {});
});
