// Escritórios (2026-10-08): a edge function confere que o serviço é de quem
// chama, e cada escritório usa os próprios modelos e logo. O escritório que já
// existia continua lendo tudo da raiz do bucket, exatamente como antes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ehRecusa, escritorioDoUsuario, exigirServicoDoUsuario, exigirUsuario,
} from "../supabase/functions/_shared/acesso.ts";
import {
  SEM_ESCRITORIO, baixarModelo, caminhosDaLogo, caminhosDoModelo, escritorioDoServico,
} from "../supabase/functions/_shared/modelos.ts";
import { carregarLogoPlanta } from "../supabase/functions/_shared/planta_dados.ts";

// cliente falso: usuário logado ou não, serviços que a RLS deixa ver, resposta da RPC
function cliente({ user = { id: "u1" }, visiveis = [], rpc = { data: null, error: null } } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: user ? null : new Error("jwt") }) },
    from: (tabela) => ({
      select: () => ({
        eq: (_c, v) => ({
          maybeSingle: async () => ({ data: tabela === "servicos" && visiveis.includes(v) ? { id: v } : null, error: null }),
        }),
      }),
    }),
    rpc: async () => rpc,
  };
}

test("sem usuário: 401", async () => {
  const r = await exigirUsuario(cliente({ user: null }));
  assert.ok(ehRecusa(r));
  assert.equal(r.status, 401);
});

test("serviço que a RLS não mostra: 404 (não revela se é de outro escritório)", async () => {
  const r = await exigirServicoDoUsuario(cliente({ visiveis: ["s1"] }), "s2");
  assert.deepEqual(r, { erro: "Serviço não encontrado", status: 404 });
});

test("serviço visível: passa", async () => {
  assert.equal(await exigirServicoDoUsuario(cliente({ visiveis: ["s1"] }), "s1"), null);
});

test("banco sem escritórios (RPC inexistente): segue sem escritório, como antes", async () => {
  const r = await escritorioDoUsuario(cliente({ rpc: { data: null, error: { code: "PGRST202" } } }));
  assert.deepEqual(r, { escritorioId: null });
});

test("usuário sem escritório: 403", async () => {
  const r = await escritorioDoUsuario(cliente({ rpc: { data: [], error: null } }));
  assert.ok(ehRecusa(r));
  assert.equal(r.status, 403);
});

test("usuário com escritório: devolve o id", async () => {
  const r = await escritorioDoUsuario(cliente({ rpc: { data: [{ id: "e1", nome: "X" }], error: null } }));
  assert.deepEqual(r, { escritorioId: "e1" });
});

test("antes da migração: modelo e logo só na raiz (comportamento de sempre)", () => {
  assert.deepEqual(caminhosDoModelo(SEM_ESCRITORIO, "pecas/1-memorial-descritivo.docx"), ["pecas/1-memorial-descritivo.docx"]);
  assert.deepEqual(caminhosDaLogo(SEM_ESCRITORIO).map((x) => x.caminho), ["logo-empresa.png", "logo-empresa.jpg"]);
});

test("escritório legado: o próprio primeiro, depois a raiz; logo da raiz", () => {
  const esc = { id: "e1", compartilhados: true };
  assert.deepEqual(caminhosDoModelo(esc, "memorial-template.docx"),
    ["escritorios/e1/memorial-template.docx", "memorial-template.docx"]);
  assert.deepEqual(caminhosDaLogo(esc).map((x) => x.caminho), ["logo-empresa.png", "logo-empresa.jpg"]);
});

test("escritório novo nunca recebe o timbre/logo do legado", () => {
  const esc = { id: "e2", compartilhados: false };
  assert.deepEqual(caminhosDoModelo(esc, "pecas/3-cartas-anuencia.docx"),
    ["escritorios/e2/pecas/3-cartas-anuencia.docx", "padrao/pecas/3-cartas-anuencia.docx"]);
  assert.deepEqual(caminhosDaLogo(esc).map((x) => x.caminho),
    ["escritorios/e2/logo-empresa.png", "escritorios/e2/logo-empresa.jpg"]);
});

test("planilha SIGEF (formato oficial) vale para todos", () => {
  const esc = { id: "e2", compartilhados: false };
  assert.deepEqual(caminhosDoModelo(esc, "planta-template.ods"),
    ["escritorios/e2/planta-template.ods", "padrao/planta-template.ods", "planta-template.ods"]);
});

// storage falso com um conjunto de arquivos
const storage = (arquivos) => ({
  storage: {
    from: () => ({
      download: async (n) => arquivos.includes(n)
        ? { data: new Blob([n]), error: null }
        : { data: null, error: new Error("not found") },
    }),
  },
});

test("baixarModelo usa o primeiro que existe", async () => {
  const s = storage(["memorial-template.docx", "escritorios/e1/memorial-template.docx"]);
  const r = await baixarModelo(s, { id: "e1", compartilhados: true }, "memorial-template.docx");
  assert.equal(r.caminho, "escritorios/e1/memorial-template.docx");
  const novo = await baixarModelo(s, { id: "e2", compartilhados: false }, "memorial-template.docx");
  assert.equal(novo.data, null);
});

test("logo da planta: escritório novo sem logo própria sai sem logo", async () => {
  const s = storage(["logo-empresa.png"]);
  assert.equal(await carregarLogoPlanta(s, { id: "e2", compartilhados: false }), null);
  assert.equal((await carregarLogoPlanta(s))?.tipo, "png");
});

test("escritorioDoServico: serviço sem escritorio_id = antes da migração", async () => {
  assert.deepEqual(await escritorioDoServico({}, {}), SEM_ESCRITORIO);
  const supa = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { modelos_compartilhados: true }, error: null }) }) }) }),
  };
  assert.deepEqual(await escritorioDoServico(supa, { escritorio_id: "e1" }), { id: "e1", compartilhados: true });
});
