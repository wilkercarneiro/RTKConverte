// Laboratório da casca do sistema (só no `npm run dev`, #/lab/casca/<tela>):
// desenha o trilho lateral, o Início, os clientes e a Equipe com dados de
// exemplo, sem banco. Troca o `rpc`/`from`/`auth` do cliente do Supabase por
// respostas fixas — nada sai do navegador.
//   #/lab/casca/inicio · #/lab/casca/clientes · #/lab/casca/cliente[/<id>]
//   #/lab/casca/equipe · #/lab/casca/creditos
//   ?operador na URL: entra como membro sem permissões de gestão
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { definirPermissoes } from "../lib/permissoes";
import { definirRecursos } from "../lib/recursos";
import type { Rota } from "../lib/rota";
import { AppShell } from "./AppShell";
import { Inicio } from "./Inicio";
import { Clientes } from "./Clientes";
import { ClientePage } from "./ClientePage";
import { Equipe } from "./Equipe";
import { SemCreditos } from "./Creditos";
import { avisarConsumo } from "../lib/creditos";
import type { Creditos } from "../lib/creditos";
import { definicaoDe } from "../lib/modalidades";

type Linha = Record<string, unknown>;
const dia = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const horas = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

// [denominação, modalidade, glebas, status, município, detentor, dias atrás, cliente]
const SERVICOS: Linha[] = ([
  ["FAZENDA SANTA BARBARA", "completo", false, "rascunho", "SANTA BARBARA", "MARIA DAS DORES SILVA", 0, "c1"],
  ["SÍTIO LAGOA SECA", "completo", true, "gerado", "IRECÊ", "JOÃO PEREIRA NETO", 1, "c2"],
  ["LOTEAMENTO IRAN NOVO", "loteamento", false, "rascunho", "BARREIRAS", "AGROPECUÁRIA VALE DO SÃO FRANCISCO LTDA", 2, "c3"],
  ["FAZENDA CURRAL DA SERRA", "conferencia", false, "gerado", "JACOBINA", "ANTÔNIO CARLOS DE JESUS", 4, "c4"],
  ["GLEBA BOA VISTA", "completo", false, "gerado", "XIQUE-XIQUE", "THEREZA MOURA DOS SANTOS", 7, "c5"],
  ["CAR FAZENDA VIBRAÇÃO", "car", false, "gerado", "IBOTIRAMA", "LARISSA ALVES COSTA", 9, "c6"],
  ["SÍTIO RIACHO FUNDO", "conferencia", false, "gerado", "SANTA BARBARA", "MARIA DAS DORES SILVA", 20, "c1"],
  ["CAR FAZENDA SERRA AZUL", "car", false, "rascunho", "BARREIRAS", "AGROPECUÁRIA VALE DO SÃO FRANCISCO LTDA", 15, "c3"],
  ["FAZENDA BOA ESPERANÇA", "completo", false, "gerado", "SANTA BARBARA", "MARIA DAS DORES SILVA", 60, "c1"],
  ["FAZENDA PORTO DAS PEDRAS", "completo", false, "gerado", "BARREIRAS", "AGROPECUÁRIA VALE DO SÃO FRANCISCO LTDA", 90, "c3"],
] as const).map(([den, mod, glebas, status, mun, det, d, cli], i) => ({
  id: `s${i}`, denominacao: den, modalidade: mod, tem_glebas: glebas, tipo: "geo", status, municipio: mun, uf: "BA",
  detentor_nome: det, nome_arquivo_txt: `${String(den).toLowerCase().replace(/\s+/g, "_")}.txt`, created_at: dia(d),
  cliente_id: cli, pedido_externo_id: i === 8 ? "p2" : null, origem_id: null,
}));

const DOCS: Linha[] = [
  ["s1", "memorial_docx", "Memorial descritivo"], ["s1", "planta_pdf", "Planta A1"], ["s1", "pecas_zip", "Peças técnicas"],
  ["s3", "memorial_docx", "Memorial descritivo"], ["s4", "memorial_docx", "Memorial descritivo"], ["s0", "memorial_docx", "Memorial descritivo"],
  ["s0", "planilha_ods", "Planilha SIGEF"], ["s6", "memorial_docx", "Memorial descritivo"], ["s6", "planta_pdf_sistema", "Planta A3"],
  ["s8", "memorial_docx", "Memorial descritivo"], ["s8", "planta_pdf", "Planta A1"], ["s8", "pecas_zip", "Peças técnicas"],
  ["s9", "memorial_docx", "Memorial descritivo"], ["s9", "planta_pdf", "Planta A1"], ["s9", "pecas_zip", "Peças técnicas"],
].map(([servico_id, tipo, titulo], i) => ({
  id: `d${i}`, servico_id, tipo, titulo, versao: 1, path: `${servico_id}/v1/${tipo}.${tipo.includes("pdf") ? "pdf" : tipo.includes("zip") ? "zip" : tipo.includes("ods") ? "ods" : "docx"}`, created_at: dia(i),
}));

const CLIENTE = {
  id: "c1", nome: "MARIA DAS DORES SILVA", tipo_pessoa: "PF", cpf_cnpj: "123.456.789-09", genero: "F",
  rg: "12.345.678-90", rg_orgao: "SSP/BA", data_nascimento: "1968-04-12", nacionalidade: null, estado_civil: "casado",
  regime_bens: "comunhao_parcial", profissao: "agricultora", conjuge_nome: "JOSÉ CARLOS DA SILVA", conjuge_cpf: "284.715.630-53",
  telefone: "(74) 99988-7766", telefone2: null, email: "maria@exemplo.com",
  endereco: "Fazenda Santa Bárbara, zona rural", cidade: "SANTA BÁRBARA", uf: "BA", cep: "44150-000",
  representante_nome: null, representante_cpf: null, origem: "gprol",
  observacoes: "Prefere contato à tarde. Documentos com o filho, Carlos.", is_espolio: false,
  inventariante_nome: null, inventariante_cpf: null, inventariante_rg: null, created_at: dia(400),
};
const base = { tipo_pessoa: "PF", genero: "M", rg: null, rg_orgao: null, data_nascimento: null, nacionalidade: null, estado_civil: null,
  regime_bens: null, profissao: null, conjuge_nome: null, conjuge_cpf: null, telefone: null, telefone2: null, email: null, endereco: null,
  cidade: null, uf: "BA", cep: null, representante_nome: null, representante_cpf: null, origem: null, observacoes: null,
  is_espolio: false, inventariante_nome: null, inventariante_cpf: null, inventariante_rg: null };
const CLIENTES: Linha[] = [
  CLIENTE,
  { ...base, id: "c2", nome: "JOÃO PEREIRA NETO", cpf_cnpj: "531.902.846-60", telefone: "(74) 98811-2233", cidade: "IRECÊ",
    estado_civil: "solteiro", profissao: "produtor rural", endereco: "Rua da Matriz, 120, Centro", origem: "indicacao", created_at: dia(130) },
  { ...base, id: "c3", nome: "AGROPECUÁRIA VALE DO SÃO FRANCISCO LTDA", tipo_pessoa: "PJ", cpf_cnpj: "12.345.678/0001-95",
    telefone: "(77) 3611-4455", email: "contato@valesf.agr.br", endereco: "Av. Clériston Andrade, 1500, Vila Brasil", cidade: "BARREIRAS",
    cep: "47800-000", representante_nome: "IRAN SANTOS OLIVEIRA", representante_cpf: "702.384.159-88", origem: "gprol", created_at: dia(210) },
  { ...base, id: "c4", nome: "ANTÔNIO CARLOS DE JESUS", cpf_cnpj: "918.273.645-64", telefone: "(74) 99120-4567", cidade: "JACOBINA",
    estado_civil: "casado", regime_bens: "comunhao_universal", conjuge_nome: "ANA RITA DE JESUS", profissao: "lavrador", rg: "08.765.432-11",
    rg_orgao: "SSP/BA", origem: "site", created_at: dia(75) },
  { ...base, id: "c5", nome: "THEREZA MOURA DOS SANTOS", genero: "F", cpf_cnpj: "460.138.927-50", cidade: "XIQUE-XIQUE",
    estado_civil: "viuvo", profissao: "aposentada", endereco: "Fazenda Boa Vista, zona rural", is_espolio: true,
    inventariante_nome: "PAULO MOURA DOS SANTOS", inventariante_cpf: "375.920.481-32", telefone: "(74) 99876-1020", origem: "parceiro", created_at: dia(50) },
  { ...base, id: "c6", nome: "LARISSA ALVES COSTA", genero: "F", cpf_cnpj: "649.201.753-61", cidade: "IBOTIRAMA", email: "larissa.costa@exemplo.com",
    telefone: "(77) 99654-3210", estado_civil: "uniao_estavel", conjuge_nome: "MARCOS VINÍCIUS COSTA", profissao: "pecuarista", origem: "redes", created_at: dia(12) },
  { ...base, id: "c7", nome: "COOPERATIVA DOS AGRICULTORES DE IRECÊ", tipo_pessoa: "PJ", cpf_cnpj: "45.781.236/0001-40", cidade: "IRECÊ",
    email: "coopirece@exemplo.com", created_at: dia(3) },
  { ...base, id: "c8", nome: "FRANCISCO DAS CHAGAS LIMA", cpf_cnpj: null, telefone: "(74) 98102-7788", cidade: "JUAZEIRO", origem: "indicacao", created_at: dia(1) },
];
const VINCULOS: Linha[] = [
  { entidade: "cliente", local_id: "c1", externo_id: "gp-1031" },
  { entidade: "cliente", local_id: "c3", externo_id: "gp-0877" },
];
const INTEGRACAO = { provedor: "gprol", status: "ativa", empresa_externa_nome: "D'Prol", conectado_em: dia(30), desconectado_em: null, ultima_sincronizacao: horas(1), ultimo_erro: null, resumo: null };
const PEDIDOS: Linha[] = [
  { id: "p1", externo_id: "gp-p-77", origem: "gprol", cliente_id: "c1", titulo: "Georreferenciamento + CAR — Fazenda Lagoa Grande", nome_servico: "Georreferenciamento",
    modalidades: ["completo", "car"], dados: { local: "Santa Bárbara-BA" }, etapa: "Medição", status: "pendente", recebido_em: dia(2), atualizado_em: dia(2) },
  // já atrelado ao serviço s8 (FAZENDA BOA ESPERANÇA)
  { id: "p2", externo_id: "gp-p-61", origem: "gprol", cliente_id: "c1", titulo: "Georreferenciamento — Fazenda Boa Esperança", nome_servico: "Georreferenciamento",
    modalidades: ["completo"], dados: { local: "Santa Bárbara-BA" }, etapa: "Certificação SIGEF", status: "em_execucao", recebido_em: dia(58), atualizado_em: dia(1) },
];
// serviços do cliente no GPROL (ação servicos_gprol da função gprol)
const SERVICOS_GPROL: Record<string, Linha[]> = {
  c1: [
    { id: "gs-1", nome: "Desmembramento", fazenda: "Sítio Riacho Fundo", titulo: "Desmembramento — Sítio Riacho Fundo", etapa: "Documentação", ligado: false, criado_em: dia(25) },
    { id: "gs-2", nome: "Georreferenciamento", fazenda: "Fazenda Boa Esperança", titulo: "Georreferenciamento — Fazenda Boa Esperança", etapa: "Certificação SIGEF", ligado: true, criado_em: dia(58) },
  ],
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
// linha do tempo de cada cliente (historico_cliente, 0029)
const HISTORICO: Record<string, Linha[]> = {
  c1: [
    { id: 30, acao: "cliente.alterado", alvo: "MARIA DAS DORES SILVA", detalhe: { campos: ["estado_civil", "regime_bens", "conjuge_nome", "conjuge_cpf"] }, created_at: horas(1), quem: "Marta Ribeiro", vezes: 3 },
    { id: 29, acao: "documento.gerado", alvo: "FAZENDA SANTA BARBARA", detalhe: { campos: ["Memorial descritivo", "Planilha SIGEF"], versao: 1 }, created_at: horas(3), quem: "Marta Ribeiro", servico_id: "s0" },
    { id: 28, acao: "vertices.alterados", alvo: "FAZENDA SANTA BARBARA", detalhe: null, created_at: horas(4), quem: "Paulo Sena", servico_id: "s0", vezes: 5 },
    { id: 27, acao: "servico.criado", alvo: "FAZENDA SANTA BARBARA", detalhe: null, created_at: horas(5), quem: "Daniel Nascimento", servico_id: "s0" },
    { id: 26, acao: "confrontantes.alterados", alvo: "SÍTIO RIACHO FUNDO", detalhe: { campos: ["nome", "cpf"] }, created_at: dia(19), quem: "Marta Ribeiro", servico_id: "s6" },
    { id: 25, acao: "documento.gerado", alvo: "SÍTIO RIACHO FUNDO", detalhe: { campos: ["Memorial descritivo", "Planta A3"], versao: 1 }, created_at: dia(20), quem: "Marta Ribeiro", servico_id: "s6" },
    { id: 24, acao: "cliente.alterado", alvo: "MARIA DAS DORES SILVA", detalhe: { campos: ["telefone", "endereco", "cep"] }, created_at: dia(45), quem: "Daniel Nascimento" },
    { id: 23, acao: "documento.gerado", alvo: "FAZENDA BOA ESPERANÇA", detalhe: { campos: ["Planta A1", "Peças técnicas"], versao: 2 }, created_at: dia(58), quem: "Daniel Nascimento", servico_id: "s8" },
  ],
  c3: [
    { id: 40, acao: "servico.criado", alvo: "CAR FAZENDA SERRA AZUL", detalhe: null, created_at: dia(15), quem: "Marta Ribeiro", servico_id: "s7" },
    { id: 39, acao: "cliente.alterado", alvo: "AGROPECUÁRIA VALE DO SÃO FRANCISCO LTDA", detalhe: { campos: ["representante_nome", "representante_cpf"] }, created_at: dia(16), quem: "Daniel Nascimento" },
  ],
};

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

const TABELAS: Record<string, Linha[]> = {
  servicos: SERVICOS, documentos_gerados: DOCS, clientes: CLIENTES, vinculos_externos: VINCULOS,
  integracoes: [INTEGRACAO], pedidos_externos: PEDIDOS,
};

/** Imita o construtor de consultas do supabase-js: eq/in/order/limit filtram de verdade. */
function consulta(t: string) {
  const tabela = TABELAS[t] ?? [];
  let linhas = [...tabela];
  let escrita: { tipo: "update"; patch: Linha } | { tipo: "delete" } | null = null;
  const cadeia: Record<string, unknown> = {};
  cadeia.select = cadeia.upsert = () => cadeia;
  cadeia.eq = (c: string, v: unknown) => { linhas = linhas.filter((l) => l[c] === v); return cadeia; };
  cadeia.in = (c: string, vs: unknown[]) => { linhas = linhas.filter((l) => vs.includes(l[c])); return cadeia; };
  cadeia.neq = (c: string, v: unknown) => { linhas = linhas.filter((l) => l[c] !== v); return cadeia; };
  cadeia.is = (c: string, v: unknown) => { linhas = linhas.filter((l) => (l[c] ?? null) === v); return cadeia; };
  cadeia.contains = cadeia.gte = cadeia.lte = cadeia.not = cadeia.or = cadeia.ilike = () => cadeia;
  cadeia.order = (c: string, o?: { ascending?: boolean }) => {
    const s = o?.ascending === false ? -1 : 1;
    linhas.sort((a, b) => String(a[c] ?? "").localeCompare(String(b[c] ?? ""), "pt-BR") * s);
    return cadeia;
  };
  cadeia.limit = (n: number) => { linhas = linhas.slice(0, n); return cadeia; };
  cadeia.insert = (obj: Linha) => {
    const novo = { ...obj, id: `${t[0]}${Date.now()}`, created_at: new Date().toISOString() };
    tabela.push(novo);
    linhas = [novo];
    return cadeia;
  };
  cadeia.update = (patch: Linha) => { escrita = { tipo: "update", patch }; return cadeia; };
  cadeia.delete = () => { escrita = { tipo: "delete" }; return cadeia; };
  const fechar = () => {
    if (escrita?.tipo === "update") for (const l of linhas) Object.assign(l, escrita.patch);
    if (escrita?.tipo === "delete") for (const l of linhas) tabela.splice(tabela.indexOf(l), 1);
    return escrita ? { data: null, error: null } : { data: linhas, error: null };
  };
  cadeia.single = cadeia.maybeSingle = () => { fechar(); return Promise.resolve({ data: linhas[0] ?? null, error: null }); };
  cadeia.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(fechar()).then(ok, erro);
  return cadeia;
}

let instalado = false;
function instalar(operador: boolean) {
  if (instalado) return;
  instalado = true;
  const s = supabase as unknown as Record<string, unknown>;
  s.rpc = (nome: string, args?: { p_cliente?: string }) =>
    Promise.resolve({ data: nome === "historico_cliente" ? HISTORICO[args?.p_cliente ?? ""] ?? [] : RPC[nome] ?? null, error: null });
  s.from = (t: string) => consulta(t);
  const auth = supabase.auth as unknown as Record<string, unknown>;
  auth.getUser = () => Promise.resolve({ data: { user: { id: operador ? "u3" : "u1" } }, error: null });
  auth.getSession = () => Promise.resolve({ data: { session: { access_token: "lab" } }, error: null });
  auth.signOut = () => Promise.resolve({ error: null });
  // a função gprol (servicos_gprol, vincular, sincronizar) responde daqui
  const fetchReal = window.fetch.bind(window);
  window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const u = String(entrada instanceof Request ? entrada.url : entrada);
    if (!u.includes("/functions/v1/gprol")) return fetchReal(entrada, init);
    const b = JSON.parse(String(init?.body ?? "{}")) as { acao?: string; cliente_id?: string; servico_id?: string; servico_gprol_id?: string };
    const r = (obj: unknown) => new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
    if (b.acao === "servicos_gprol") return r({ itens: SERVICOS_GPROL[b.cliente_id ?? ""] ?? [], cliente_ligado: true });
    if (b.acao === "vincular") {
      const sg = Object.values(SERVICOS_GPROL).flat().find((x) => x.id === b.servico_gprol_id);
      const sv = SERVICOS.find((x) => x.id === b.servico_id);
      if (!sg || !sv) return r({ erro: "não encontrado" });
      const id = `p${PEDIDOS.length + 1}`;
      PEDIDOS.push({ id, externo_id: sg.id, origem: "gprol", cliente_id: sv.cliente_id, titulo: sg.titulo, nome_servico: sg.nome,
        modalidades: [sv.modalidade], dados: { fazenda: sg.fazenda }, etapa: sg.etapa, status: "em_execucao", recebido_em: new Date().toISOString(), atualizado_em: new Date().toISOString() });
      sv.pedido_externo_id = id;
      sg.ligado = true;
      return r({ ok: true, pedido_id: id });
    }
    return r({ ok: true, enviados: 0, recebidos: 0 });
  };
  definirRecursos(null);
  definirPermissoes(operador ? { dono: false, lista: ["servicos.criar"] } : { dono: true, lista: [] });
}

export function LaboratorioCasca() {
  const operador = location.hash.includes("operador");
  instalar(operador);
  const [caminho] = location.hash.replace(/^#\/lab\/casca\/?/, "").split("?");
  const [tela = "inicio", idCliente] = caminho.split("/").filter(Boolean);
  const [, forcar] = useState(0);
  if (tela === "creditos" && !(window as { _avisou?: boolean })._avisou) {
    (window as { _avisou?: boolean })._avisou = true;
    setTimeout(() => void avisarConsumo("completo"), 300);
  }
  const rota: Rota = tela === "equipe" ? { t: "equipe" }
    : tela === "cliente" ? { t: "cliente", id: idCliente || "c1" }
      : tela === "clientes" ? { t: "clientes" } : { t: "inicio" };
  const ir = (r: Rota) => {
    const alvo = r.t === "equipe" ? "equipe" : r.t === "cliente" ? `cliente/${r.id}` : r.t === "clientes" ? "clientes" : "inicio";
    location.hash = `#/lab/casca/${alvo}${operador ? "?operador" : ""}`;
    forcar((n) => n + 1);
  };
  const escritorio = { estado: "ok" as const, escritorio: { id: "e1", nome: "D'Prol", papel: operador ? "membro" as const : "dono" as const, modelos_compartilhados: true } };
  return (
    <AppShell rota={rota} ir={ir} usuario={{ nome: operador ? "Paulo Sena" : "Daniel Nascimento", papel: operador ? "Equipe · D'Prol" : "Dono · D'Prol" }} superadmin={!operador}>
      {tela === "equipe" ? <Equipe escritorio={escritorio} />
        : tela === "creditos" ? <SemCreditos def={definicaoDe("car")} creditos={CREDITOS} onVoltar={() => ir({ t: "inicio" })} onAtualizar={() => {}} />
        : tela === "clientes" ? <Clientes onAbrir={(id) => ir({ t: "cliente", id })} />
        : tela === "cliente" ? <ClientePage key={idCliente || "c1"} clienteId={idCliente || "c1"} onVoltar={() => ir({ t: "clientes" })}
            onAbrirServico={() => {}} onNovoServico={() => {}} onExecutarPedido={() => {}} />
          : <Inicio onNovo={() => {}} onAbrir={() => {}} onVerServicos={() => {}} nome="Daniel Nascimento" creditos={CREDITOS} />}
    </AppShell>
  );
}
