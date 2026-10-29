// Laboratório da casca do sistema (só no `npm run dev`, #/lab/casca/<tela>):
// desenha o trilho lateral, o Início, a página do cliente e a Equipe com dados
// de exemplo, sem banco. Troca o `rpc`/`from`/`auth` do cliente do Supabase por
// respostas fixas — nada sai do navegador.
//   #/lab/casca/inicio · #/lab/casca/cliente · #/lab/casca/equipe
//   ?operador na URL: entra como membro sem permissões de gestão
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { definirPermissoes } from "../lib/permissoes";
import { definirRecursos } from "../lib/recursos";
import type { Rota } from "../lib/rota";
import { AppShell } from "./AppShell";
import { Inicio } from "./Inicio";
import { ClientePage } from "./ClientePage";
import { Equipe } from "./Equipe";
import { SemCreditos } from "./Creditos";
import { avisarConsumo } from "../lib/creditos";
import type { Creditos } from "../lib/creditos";
import { definicaoDe } from "../lib/modalidades";

const dia = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const SERVICOS = [
  ["FAZENDA SANTA BARBARA", "completo", false, "rascunho", "SANTA BARBARA", "MARIA DAS DORES SILVA", 0],
  ["SÍTIO LAGOA SECA", "completo", true, "gerado", "IRECÊ", "JOÃO PEREIRA NETO", 1],
  ["LOTEAMENTO IRAN NOVO", "loteamento", false, "rascunho", "BARREIRAS", "IRAN SANTOS", 2],
  ["FAZENDA CURRAL DA SERRA", "conferencia", false, "gerado", "JACOBINA", "ANTÔNIO CARLOS", 4],
  ["GLEBA BOA VISTA", "completo", false, "gerado", "XIQUE-XIQUE", "THEREZA MOURA", 7],
  ["CAR FAZENDA VIBRAÇÃO", "car", false, "gerado", "IBOTIRAMA", "LARISSA ALVES", 9],
].map(([den, mod, glebas, status, mun, det, d], i) => ({
  id: `s${i}`, denominacao: den, modalidade: mod, tem_glebas: glebas, tipo: "geo", status, municipio: mun, uf: "BA",
  detentor_nome: det, nome_arquivo_txt: `${String(den).toLowerCase().replace(/\s+/g, "_")}.txt`, created_at: dia(d as number),
  cliente_id: i === 0 ? "c1" : null,
}));
const DOCS = [
  ["s1", "memorial_docx", "Memorial descritivo"], ["s1", "planta_pdf", "Planta A1"], ["s1", "pecas_zip", "Peças técnicas"],
  ["s3", "memorial_docx", "Memorial descritivo"], ["s4", "memorial_docx", "Memorial descritivo"], ["s0", "memorial_docx", "Memorial descritivo"],
].map(([servico_id, tipo, titulo], i) => ({
  id: `d${i}`, servico_id, tipo, titulo, versao: 1, path: `${servico_id}/v1/${tipo}.docx`, created_at: dia(i),
}));
const CLIENTE = {
  id: "c1", nome: "MARIA DAS DORES SILVA", cpf_cnpj: "123.456.789-09", genero: "F", telefone: "(74) 99988-7766",
  email: "maria@exemplo.com", endereco: "Fazenda Santa Bárbara, zona rural, Santa Bárbara-BA", observacoes: null,
  is_espolio: false, created_at: dia(40),
};
const MEMBROS = [
  { user_id: "u1", email: "suporte@dprol.com.br", nome: "Daniel Nascimento", cargo: null, papel: "dono", permissoes: [], ativo: true, desde: dia(120), ultimo_acesso: dia(0), senha_provisoria: false },
  { user_id: "u2", email: "projetos@dprol.com.br", nome: "Marta Ribeiro", cargo: "Projetista", papel: "membro", permissoes: ["servicos.criar", "documentos.gerar", "clientes.editar", "cadastros.editar"], ativo: true, desde: dia(60), ultimo_acesso: dia(1), senha_provisoria: false },
  { user_id: "u3", email: "campo@dprol.com.br", nome: "Paulo Sena", cargo: "Topógrafo", papel: "membro", permissoes: ["servicos.criar"], ativo: true, desde: dia(5), ultimo_acesso: null, senha_provisoria: true },
  { user_id: "u4", email: "estagio@dprol.com.br", nome: "Ana Lúcia", cargo: "Estagiária", papel: "membro", permissoes: [], ativo: false, desde: dia(90), ultimo_acesso: dia(32), senha_provisoria: false },
];
const ATIVIDADES = [
  { id: 6, acao: "documento.gerado", alvo: "Planta A1", detalhe: { servico: "SÍTIO LAGOA SECA" }, created_at: dia(0), quem: "Marta Ribeiro" },
  { id: 5, acao: "servico.criado", alvo: "FAZENDA SANTA BARBARA", detalhe: null, created_at: dia(0), quem: "Daniel Nascimento" },
  { id: 4, acao: "membro.adicionado", alvo: "Paulo Sena", detalhe: null, created_at: dia(5), quem: "Daniel Nascimento" },
  { id: 3, acao: "membro.desativado", alvo: "Ana Lúcia", detalhe: null, created_at: dia(6), quem: "Daniel Nascimento" },
  { id: 2, acao: "cliente.criado", alvo: "MARIA DAS DORES SILVA", detalhe: null, created_at: dia(6), quem: "Marta Ribeiro" },
];
// créditos (0027): CAR esgotado, o resto com folga
const CREDITOS: Creditos = {
  mes: "2026-10-01",
  total: { limite: 30, usado: 27, extra: 0 },
  servicos: {
    "servico.completo": { limite: 20, usado: 18, extra: 0, disponivel: true },
    "servico.car": { limite: 4, usado: 4, extra: 0, disponivel: false },
  },
  sou_dono: true,
  pacotes: [
    { id: "p1", nome: "10 serviços extras", chave: "total", quantidade: 10, preco: 900 },
    { id: "p2", nome: "CAR 10", chave: "servico.car", quantidade: 10, preco: 450 },
  ],
  pedidos: [{ id: "x1", chave: "total", quantidade: 5, preco: null, descricao: "Pedido avulso", status: "aprovado", created_at: "2026-10-12T12:00:00Z" }],
};

const RPC: Record<string, unknown> = {
  meus_creditos: CREDITOS,
  listar_membros: MEMBROS,
  listar_atividades: ATIVIDADES,
  pode_adicionar_membro: { ok: true, limite: 5, ativos: 3, sou_dono: true },
};

function consulta(t: string) {
  const linhas: unknown[] = t === "servicos" ? SERVICOS : t === "documentos_gerados" ? DOCS : t === "clientes" ? [CLIENTE] : [];
  const r = { data: linhas, error: null };
  const cadeia: Record<string, unknown> = {};
  let filtroCliente = false;
  for (const m of ["select", "order", "in", "limit", "insert", "update", "upsert", "delete"]) cadeia[m] = () => cadeia;
  cadeia.eq = (c: string) => { if (c === "cliente_id") filtroCliente = true; return cadeia; };
  cadeia.single = cadeia.maybeSingle = () => Promise.resolve({ data: linhas[0] ?? null, error: null });
  cadeia.then = (ok: (v: unknown) => unknown) =>
    Promise.resolve(filtroCliente ? { data: SERVICOS.filter((s) => s.cliente_id === "c1"), error: null } : r).then(ok);
  return cadeia;
}

let instalado = false;
function instalar(operador: boolean) {
  if (instalado) return;
  instalado = true;
  const s = supabase as unknown as Record<string, unknown>;
  s.rpc = (nome: string) => Promise.resolve({ data: RPC[nome] ?? null, error: null });
  s.from = (t: string) => consulta(t);
  const auth = supabase.auth as unknown as Record<string, unknown>;
  auth.getUser = () => Promise.resolve({ data: { user: { id: operador ? "u3" : "u1" } }, error: null });
  auth.signOut = () => Promise.resolve({ error: null });
  definirRecursos(null);
  definirPermissoes(operador ? { dono: false, lista: ["servicos.criar"] } : { dono: true, lista: [] });
}

export function LaboratorioCasca() {
  const operador = location.hash.includes("operador");
  instalar(operador);
  const tela = location.hash.replace(/^#\/lab\/casca\/?/, "").split(/[/?]/)[0] || "inicio";
  const [, forcar] = useState(0);
  if (tela === "creditos" && !(window as { _avisou?: boolean })._avisou) {
    (window as { _avisou?: boolean })._avisou = true;
    setTimeout(() => void avisarConsumo("completo"), 300);
  }
  const rota: Rota = tela === "equipe" ? { t: "equipe" } : tela === "cliente" ? { t: "cliente", id: "c1" } : { t: "inicio" };
  const ir = (r: Rota) => {
    const alvo = r.t === "equipe" ? "equipe" : r.t === "cliente" || r.t === "clientes" ? "cliente" : "inicio";
    location.hash = `#/lab/casca/${alvo}${operador ? "?operador" : ""}`;
    forcar((n) => n + 1);
  };
  const escritorio = { estado: "ok" as const, escritorio: { id: "e1", nome: "D'Prol", papel: operador ? "membro" as const : "dono" as const, modelos_compartilhados: true } };
  return (
    <AppShell rota={rota} ir={ir} usuario={{ nome: operador ? "Paulo Sena" : "Daniel Nascimento", papel: operador ? "Equipe · D'Prol" : "Dono · D'Prol" }} superadmin={!operador}>
      {tela === "equipe" ? <Equipe escritorio={escritorio} />
        : tela === "creditos" ? <SemCreditos def={definicaoDe("car")} creditos={CREDITOS} onVoltar={() => ir({ t: "inicio" })} onAtualizar={() => {}} />
        : tela === "cliente" ? <ClientePage clienteId="c1" onVoltar={() => ir({ t: "inicio" })} onAbrirServico={() => {}} onNovoServico={() => {}} />
          : <Inicio onNovo={() => {}} onAbrir={() => {}} onVerServicos={() => {}} nome="Daniel Nascimento" creditos={CREDITOS} />}
    </AppShell>
  );
}
