// Histórico de documentos (src/lib/historico.ts): o título que o operador vê,
// a última geração que a tela do serviço reabre e o aviso de que o histórico
// mudou. Bugs achados gravando os tutoriais:
//   - "· v6 · editada · v6 · editada": reabrir a planta editada e salvar de novo
//     acumulava a versão e a marca no título;
//   - o Memorial Tabular da conferência aparecia cru ("2 - Memorial Tabular"),
//     numa versão só dele;
//   - o bloco "Documentos gerados" sumia ao reabrir o serviço;
//   - o histórico só mostrava a versão nova depois de recarregar a página.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TITULO_TABULAR_PREVIA, folhaDoTitulo, nomeDaGlebaNoTitulo, tituloBasePlanta,
  tituloNoHistorico, tituloPlantaEditada, ultimaGeracao,
} from "../src/lib/historico.ts";
import { indexarDocumentos, progressoDe } from "../src/lib/progresso.ts";

const doc = (versao, tipo, titulo, path = `s/v${versao}/${tipo}`) => ({ versao, tipo, titulo, path });

test("planta editada: 'editada' uma vez só, por mais que reabra e salve", () => {
  const base = "Planta A1 (PDF · dados do sistema) · PRÉVIA";
  assert.equal(tituloPlantaEditada(base), `${base} · editada`);
  // o que o histórico passava ao visualizador e o visualizador gravava
  assert.equal(tituloPlantaEditada(`${base} · v6`), `${base} · editada`);
  assert.equal(tituloPlantaEditada(`${base} · v6 · editada · v6`), `${base} · editada`);
  // o que já ficou gravado no banco aparece limpo
  assert.equal(tituloBasePlanta("Planta A1 · v6 · editada · v6 · editada"), "Planta A1");
  assert.equal(
    tituloNoHistorico(doc(6, "planta_pdf_editada", "Planta A1 · v6 · editada · v6 · editada")),
    "Planta A1 · editada",
  );
  // o meio do título é do servidor e fica: "PRÉVIA", "(PDF · SIGEF)", nome com V
  assert.equal(tituloBasePlanta("Planta A3 (PDF · SIGEF)"), "Planta A3 (PDF · SIGEF)");
  assert.equal(tituloBasePlanta("Planta A1 · FAZENDA V2"), "Planta A1 · FAZENDA V2");
  assert.equal(tituloPlantaEditada(undefined), "Planta · editada");
});

test("Memorial Tabular da conferência: nome legível, e as peças de verdade intactas", () => {
  // linha antiga: versão só com o tabular, título cru da peça
  const avulso = doc(3, "peca_2", "2 - Memorial Tabular");
  assert.equal(tituloNoHistorico(avulso, [avulso]), TITULO_TABULAR_PREVIA);
  // linha nova: tipo próprio, anexada à versão dos documentos
  assert.equal(tituloNoHistorico(doc(2, "memorial_tabular", TITULO_TABULAR_PREVIA)), TITULO_TABULAR_PREVIA);
  // no jogo completo de peças a peça 2 continua numerada como sempre
  const jogo = [doc(4, "peca_1", "1 - Memorial Descritivo"), doc(4, "peca_2", "2 - Memorial Tabular"), doc(4, "peca_3", "3 - Cartas de Anuência")];
  assert.equal(tituloNoHistorico(jogo[1], jogo), "2 - Memorial Tabular");
  assert.equal(tituloNoHistorico(doc(1, "memorial_docx", "Memorial Descritivo (DOCX)")), "Memorial Descritivo (DOCX)");
});

test("o título da prévia que a gerar-pecas grava é o que a tela espera", () => {
  const src = readFileSync(new URL("../supabase/functions/gerar-pecas/index.ts", import.meta.url), "utf8");
  assert.match(src, /"memorial_tabular"/, "a prévia grava o tipo memorial_tabular");
  assert.match(src, /\(DOCX\)\$\{rotulo \? ` · \$\{rotulo\}` : ""\} · PRÉVIA/, "título: <nome> (DOCX) · PRÉVIA");
  // o nome sai do título da peça sem o número: "2 - Memorial Tabular" → "Memorial Tabular"
  assert.equal(`${"2 - Memorial Tabular".replace(/^\d+\s*-\s*/, "")} (DOCX) · PRÉVIA`, TITULO_TABULAR_PREVIA);
});

test("última geração: os documentos da versão mais nova que tem memorial/planilha", () => {
  const docs = [
    doc(1, "memorial_docx", "Memorial Descritivo (DOCX)"), doc(1, "planilha_ods", "Planilha SIGEF (ODS)"),
    doc(2, "memorial_docx", "Memorial Descritivo (DOCX)"), doc(2, "planilha_ods", "Planilha SIGEF (ODS)"),
    doc(2, "planta_pdf_sistema", "Planta A3 (PDF · dados do sistema)"),
    doc(2, "gleba_planta_pdf", "Planta A3 · GLEBA 10", "s/v2/glebas/10-GLEBA 10/planta-A3.pdf"),
    doc(2, "gleba_planta_pdf", "Planta A3 · GLEBA 2", "s/v2/glebas/2-GLEBA 2/planta-A3.pdf"),
    doc(2, "planta_pdf_editada", "Planta A3 · editada"),
    doc(3, "planta_pdf", "Planta A1 (PDF · SIGEF)"),
    doc(4, "peca_1", "1 - Memorial Descritivo", "s/v4/pecas/1-memorial-descritivo.docx"),
    doc(4, "peca_1_glebas_1_GLEBA_1", "1 - Memorial Descritivo · GLEBA 1", "s/v4/pecas/glebas/1-GLEBA 1/1-memorial-descritivo.docx"),
    doc(4, "peca_2", "2 - Memorial Tabular", "s/v4/pecas/2-memorial-tabular.docx"),
  ];
  const u = ultimaGeracao(docs);
  assert.equal(u.documentos.versao, 2);
  assert.equal(u.documentos.memorial.versao, 2);
  assert.equal(u.documentos.planta.tipo, "planta_pdf_sistema", "a planta editada não toma o lugar da do sistema");
  assert.deepEqual(u.documentos.glebas.map((g) => nomeDaGlebaNoTitulo(g.titulo)), ["GLEBA 2", "GLEBA 10"], "ordem da pasta, numérica");
  assert.equal(u.plantaSigef.versao, 3);
  assert.equal(u.pecas.versao, 4);
  assert.deepEqual(u.pecas.itens.map((d) => d.tipo), ["peca_1", "peca_2", "peca_1_glebas_1_GLEBA_1"], "o jogo do imóvel antes do das glebas");
  assert.equal(u.tabular, null);
});

test("última geração: conferência com o tabular (antigo e novo) não vira 'peças prontas'", () => {
  const antigo = [
    doc(1, "memorial_docx", "Memorial Descritivo (DOCX) · PRÉVIA"), doc(1, "planilha_ods", "Planilha SIGEF (ODS) · PRÉVIA"),
    doc(2, "peca_2", "2 - Memorial Tabular"),
  ];
  const ua = ultimaGeracao(antigo);
  assert.equal(ua.documentos.versao, 1);
  assert.equal(ua.pecas, null);
  assert.equal(ua.tabular.versao, 2);

  const novo = [
    doc(1, "memorial_docx", "Memorial Descritivo (DOCX) · PRÉVIA"), doc(1, "planilha_ods", "Planilha SIGEF (ODS) · PRÉVIA"),
    doc(1, "memorial_tabular", TITULO_TABULAR_PREVIA),
  ];
  const un = ultimaGeracao(novo);
  assert.equal(un.documentos.versao, 1);
  assert.equal(un.pecas, null);
  assert.equal(un.tabular.tipo, "memorial_tabular");
  assert.deepEqual(ultimaGeracao([]), { documentos: null, plantaSigef: null, pecas: null, tabular: null });
});

test("folha e nome da gleba saem do título", () => {
  assert.equal(folhaDoTitulo("Planta A3 (PDF · dados do sistema) · PRÉVIA"), "A3");
  assert.equal(folhaDoTitulo("Planta A1 (PDF · SIGEF)"), "A1");
  assert.equal(folhaDoTitulo("Memorial Descritivo (DOCX)"), null);
  assert.equal(nomeDaGlebaNoTitulo("Planta A3 · GLEBA 1 · PRÉVIA"), "GLEBA 1");
  assert.equal(nomeDaGlebaNoTitulo("Planta A3 · PARTE 2 - JOÃO"), "PARTE 2 - JOÃO");
});

test("progresso: a A3 das glebas e a planta editada não contam como peças", () => {
  const p = indexarDocumentos([
    { servico_id: "s", tipo: "memorial_docx" }, { servico_id: "s", tipo: "gleba_planta_pdf" },
    { servico_id: "s", tipo: "planta_pdf_editada" },
  ]);
  assert.deepEqual(p.s, { docs: true, planta: false, pecas: false });
  assert.equal(progressoDe({ modalidade: "completo", tipo: "geo", status: "gerado" }, p.s).falta, "enviar o PDF do SIGEF e gerar a planta");
  const c = indexarDocumentos([{ servico_id: "c", tipo: "memorial_tabular" }]);
  assert.deepEqual(c.c, { docs: true, planta: false, pecas: false });
  assert.equal(indexarDocumentos([{ servico_id: "x", tipo: "peca_1" }]).x.pecas, true);
});

test("toda geração avisa o histórico (sem recarregar a página)", () => {
  for (const arq of ["../src/components/Conferencia.tsx", "../src/components/PecasServico.tsx"]) {
    const src = readFileSync(new URL(arq, import.meta.url), "utf8");
    const re = /chamarFuncao<[^>]*>\(\s*"(gerar-documentos|gerar-planta|gerar-pecas)"/g;
    let m, n = 0;
    while ((m = re.exec(src))) {
      const trecho = src.slice(m.index, m.index + 1200);
      if (/modo:\s*"analisar"/.test(trecho.slice(0, 200))) continue; // só lê o PDF, não gera nada
      n++;
      assert.match(trecho, /depoisDeGerar\(|avisarHistoricoAtualizado\(/, `${arq}: ${m[1]} sem aviso ao histórico`);
    }
    assert.ok(n > 0, `${arq}: nenhuma geração encontrada`);
  }
});
