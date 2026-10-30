// Laboratório das telas de sistema (só no `npm run dev`, #/lab/sistema/<tela>):
// Início com o GPROL, Equipe (pessoas, uso, acessos, auditoria), Configurações
// (empresa, plano e uso, minha conta), Ajuda e a central de suporte — com dados
// de exemplo, sem banco. Troca `rpc`/`from`/`storage`/`auth` do cliente do
// Supabase por respostas fixas; nada sai do navegador.
//   #/lab/sistema/inicio[?conectado] · /equipe · /config · /ajuda
//   ?suporte abre o chat; ?conversa abre a primeira conversa
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { definirPermissoes } from "../lib/permissoes";
import { definirRecursos } from "../lib/recursos";
import type { Rota } from "../lib/rota";
import type { Creditos } from "../lib/creditos";
import { cobrancaDeExemplo, creditosDeExemplo, instalarCobrancaFalsa } from "./laboratorioCreditos";
import { AppShell } from "./AppShell";
import { Inicio } from "./Inicio";
import { Equipe } from "./Equipe";
import { Configuracoes } from "./Configuracoes";
import { Ajuda } from "./Ajuda";
import { abrirSuporte } from "./suporte/SuporteChat";

const min = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const dia = (n: number) => min(n * 1440);
const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
const CONECTADO = q.has("conectado");

const SERVICOS = [
  ["FAZENDA SANTA BARBARA", "completo", "rascunho", "SANTA BARBARA", "MARIA DAS DORES SILVA", 0],
  ["SÍTIO LAGOA SECA", "completo", "gerado", "IRECÊ", "JOÃO PEREIRA NETO", 1],
  ["LOTEAMENTO IRAN NOVO", "loteamento", "rascunho", "BARREIRAS", "IRAN SANTOS", 2],
  ["FAZENDA CURRAL DA SERRA", "conferencia", "gerado", "JACOBINA", "ANTÔNIO CARLOS", 4],
].map(([den, mod, status, mun, det, d], i) => ({
  id: `s${i}`, denominacao: den, modalidade: mod, tem_glebas: false, tipo: "geo", status, municipio: mun, uf: "BA",
  detentor_nome: det, nome_arquivo_txt: "x.txt", created_at: dia(d as number), cliente_id: null,
}));
const MEMBROS = [
  { user_id: "u1", email: "daniel@dprol.com.br", nome: "Daniel Nascimento", cargo: "Engenheiro agrimensor", papel: "dono", permissoes: [], ativo: true, desde: dia(120), ultimo_acesso: min(2), senha_provisoria: false, descricao: "Responsável técnico; assina as peças e acompanha o SIGEF.", telefone: "(74) 99911-2233" },
  { user_id: "u2", email: "marta@dprol.com.br", nome: "Marta Ribeiro", cargo: "Projetista", papel: "membro", permissoes: ["servicos.criar", "documentos.gerar", "clientes.editar", "cadastros.editar"], ativo: true, desde: dia(60), ultimo_acesso: min(40), senha_provisoria: false, descricao: "Confere os TXT, monta a planta e gera memoriais e peças.", telefone: "(74) 98822-4455" },
  { user_id: "u3", email: "paulo@dprol.com.br", nome: "Paulo Sena", cargo: "Topógrafo", papel: "membro", permissoes: ["servicos.criar"], ativo: true, desde: dia(5), ultimo_acesso: null, senha_provisoria: true, descricao: "Levantamento em campo com o GNSS; envia os TXT.", telefone: null },
  { user_id: "u4", email: "ana@dprol.com.br", nome: "Ana Lúcia", cargo: "Estagiária", papel: "membro", permissoes: [], ativo: false, desde: dia(90), ultimo_acesso: dia(32), senha_provisoria: false, descricao: null, telefone: null },
];
const ATIVIDADES = [
  { id: 6, acao: "documento.gerado", alvo: "SÍTIO LAGOA SECA", detalhe: { campos: ["Planta A1", "Memorial"] }, created_at: min(30), quem: "Marta Ribeiro", vezes: 1 },
  { id: 5, acao: "servico.criado", alvo: "FAZENDA SANTA BARBARA", detalhe: null, created_at: min(90), quem: "Daniel Nascimento", vezes: 1 },
  { id: 4, acao: "cliente.alterado", alvo: "MARIA DAS DORES SILVA", detalhe: { campos: ["estado_civil", "profissao", "rg"] }, created_at: dia(1), quem: "Marta Ribeiro", vezes: 3 },
  { id: 3, acao: "membro.adicionado", alvo: "Paulo Sena", detalhe: null, created_at: dia(5), quem: "Daniel Nascimento", vezes: 1 },
];
const ACESSOS = [
  ["u1", "Daniel Nascimento", 2, 2, "189.40.12.7", "Chrome 130", "Windows", "computador", 14, "inicio"],
  ["u2", "Marta Ribeiro", 95, 40, "189.40.12.7", "Edge 129", "Windows", "computador", 38, "servico"],
  ["u1", "Daniel Nascimento", 600, 520, "177.22.81.3", "Safari 18", "iOS", "celular", 6, "servicos"],
  ["u2", "Marta Ribeiro", 1500, 1340, "189.40.12.7", "Edge 129", "Windows", "computador", 52, "servico"],
  ["u3", "Paulo Sena", 2900, 2890, "45.170.3.90", "Chrome 129", "Android", "celular", 3, "novo"],
].map(([user_id, quem, ini, fim, ip, navegador, sistema, dispositivo, telas, ultima_tela], i) => ({
  id: i + 1, user_id, quem, em: min(ini as number), ultimo_em: min(fim as number), ip, navegador, sistema, dispositivo, telas, ultima_tela,
}));
const USO = [
  { user_id: "u1", nome: "Daniel Nascimento", email: "daniel@dprol.com.br", ativo: true, sessoes: 31, minutos: 1840, ultimo_acesso: min(2), servicos_criados: 9, documentos: 22, alteracoes: 140, clientes: 6 },
  { user_id: "u2", nome: "Marta Ribeiro", email: "marta@dprol.com.br", ativo: true, sessoes: 44, minutos: 2950, ultimo_acesso: min(40), servicos_criados: 14, documentos: 61, alteracoes: 388, clientes: 11 },
  { user_id: "u3", nome: "Paulo Sena", email: "paulo@dprol.com.br", ativo: true, sessoes: 3, minutos: 25, ultimo_acesso: dia(2), servicos_criados: 2, documentos: 0, alteracoes: 4, clientes: 0 },
  { user_id: "u4", nome: "Ana Lúcia", email: "ana@dprol.com.br", ativo: false, sessoes: 0, minutos: 0, ultimo_acesso: dia(32), servicos_criados: 0, documentos: 0, alteracoes: 0, clientes: 0 },
];
const CREDITOS: Creditos = creditosDeExemplo();
instalarCobrancaFalsa(CREDITOS);
const CHAMADOS = [
  { id: "ch1", numero: 128, assunto: "A planta A1 não gera no serviço Lagoa Seca", categoria: "erro", prioridade: "alta", status: "aguardando_cliente", criado_em: min(180), ultima_mensagem_em: min(12), ultima_mensagem_de: "suporte", nao_lidas: 1, autor: "Marta Ribeiro", meu: true, avaliacao: null, previa: "Corrigimos o limite do servidor. Pode gerar de novo?" },
  { id: "ch2", numero: 121, assunto: "Como separar a fazenda em duas glebas?", categoria: "duvida", prioridade: "normal", status: "aberto", criado_em: dia(1), ultima_mensagem_em: dia(1), ultima_mensagem_de: "cliente", nao_lidas: 0, autor: "Paulo Sena", meu: false, avaliacao: null, previa: "Tenho o TXT com os dois blocos e não sei por onde começar." },
  { id: "ch3", numero: 97, assunto: "Liberar a maquete 3D no plano", categoria: "financeiro", prioridade: "normal", status: "resolvido", criado_em: dia(12), ultima_mensagem_em: dia(10), ultima_mensagem_de: "suporte", nao_lidas: 0, autor: "Daniel Nascimento", meu: true, avaliacao: 5, previa: "Liberado! Já aparece no loteamento." },
];
const PRINT = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#F4F6F5"/><rect x="0" y="0" width="300" height="26" fill="#0E3B2B"/><rect x="16" y="44" width="170" height="12" rx="4" fill="#C9D5CF"/><rect x="16" y="66" width="268" height="90" rx="8" fill="#fff" stroke="#E3E8E5"/><rect x="28" y="80" width="120" height="10" rx="3" fill="#FBEAEA"/><text x="30" y="88" font-size="8" fill="#B93A3A" font-family="sans-serif">CPU time limit reached</text><rect x="196" y="168" width="88" height="20" rx="6" fill="#178552"/></svg>`);
const MENSAGENS: Record<string, unknown[]> = {
  ch1: [
    { id: 1, chamado_id: "ch1", autor_tipo: "cliente", texto: "Cliquei em gerar a planta A1 e depois de um tempo aparece “O servidor interrompeu o processamento”. As outras plantas saem normais.", anexos: [{ path: "e1/ch1/print.png", nome: "print-1432.png", tipo: "image/png", tamanho: 182000 }], interna: false, created_at: min(180) },
    { id: 2, chamado_id: "ch1", autor_tipo: "sistema", texto: "O suporte começou o atendimento.", anexos: [], interna: false, created_at: min(150) },
    { id: 3, chamado_id: "ch1", autor_tipo: "suporte", texto: "Oi, Marta! Vimos aqui: a A1 com 9 glebas passava do limite de processamento do servidor. Já aumentamos. Pode gerar de novo e me conta?", anexos: [], interna: false, created_at: min(12) },
  ],
  ch2: [{ id: 4, chamado_id: "ch2", autor_tipo: "cliente", texto: "Tenho o TXT com os dois blocos e não sei por onde começar.", anexos: [], interna: false, created_at: dia(1) }],
  ch3: [
    { id: 5, chamado_id: "ch3", autor_tipo: "cliente", texto: "Queremos mostrar a maquete 3D para um cliente de loteamento.", anexos: [], interna: false, created_at: dia(12) },
    { id: 6, chamado_id: "ch3", autor_tipo: "suporte", texto: "Liberado! Já aparece no loteamento.", anexos: [], interna: false, created_at: dia(10) },
    { id: 7, chamado_id: "ch3", autor_tipo: "sistema", texto: "Chamado encerrado pela empresa.", anexos: [], interna: false, created_at: dia(10) },
  ],
};
const TUTORIAIS = [
  ["inicio", "Seu primeiro serviço: do TXT à planta", "Envie o TXT do GNSS, confira os vértices e gere a planta e o memorial.", "6:40"],
  ["servicos", "Confrontantes por trecho", "Como nomear vizinhos, estradas e rios para o memorial sair certo.", "4:15"],
  ["documentos", "Editor de planta: mover rótulos e carimbo", null, "3:05"],
  ["loteamento", "Loteamento em 5 minutos", "Ruas, quadras e lotes automáticos, e ajuste à mão.", "5:20"],
  ["equipe", "Equipe: permissões e senhas", "Cadastre a equipe, defina o que cada um pode fazer e acompanhe o uso.", "3:50"],
  ["config", "Conectar ao GPROL", "Pedidos, etapas, documentos e clientes nos dois sistemas.", "2:45"],
].map(([modulo, titulo, descricao, duracao], i) => ({ id: `t${i}`, modulo, titulo, descricao, video_url: "https://youtu.be/dQw4w9WgXcQ", duracao, ordem: i, publicado: true }));

const RPC: Record<string, unknown> = {
  meus_creditos: CREDITOS, minha_cobranca: cobrancaDeExemplo("em_dia"), listar_membros: MEMBROS, listar_atividades: ATIVIDADES,
  pode_adicionar_membro: { ok: true, limite: 5, ativos: 3, sou_dono: true },
  listar_acessos: ACESSOS, uso_da_equipe: USO, meus_chamados: CHAMADOS, abrir_chamado: "ch2",
};

// credenciados (Configurações › Responsáveis e credenciados): um em uso, com a
// numeração andando, e um antigo que nunca gerou (contador 0 = nenhum usado)
const CREDENCIADOS = [
  { id: "c1", nome: "DANIEL NASCIMENTO", prefixo_vertice: "DSBN", contador_m: 3611, contador_p: 14300, contador_v: 758 },
  { id: "c2", nome: "MARTA RIBEIRO", prefixo_vertice: "MRTR", contador_m: 0, contador_p: 0, contador_v: 0 },
];
/** O que a tela mandou gravar (insert/update), para conferir no laboratório. */
const ESCRITAS: { tabela: string; op: string; dados: unknown }[] = [];
(window as unknown as { __labEscritas: typeof ESCRITAS }).__labEscritas = ESCRITAS;

function consulta(t: string) {
  let linhas: unknown[] = t === "servicos" ? SERVICOS : t === "tutoriais" ? TUTORIAIS : t === "credenciados" ? CREDENCIADOS
    : t === "integracoes" ? (CONECTADO ? [{ status: "ativa", empresa_externa_nome: "D'Prol Topografia", conectado_em: dia(20), ultima_sincronizacao: min(3), ultimo_erro: null, resumo: null }] : [])
      : t === "config_empresa" ? [{ key: "razao_social", value: "D'PROL TOPOGRAFIA LTDA" }, { key: "cnpj", value: "12.345.678/0001-90" }, { key: "cidade_empresa", value: "Irecê" }, { key: "uf_empresa", value: "BA" }]
        : [];
  let contar = false;
  const c: Record<string, unknown> = {};
  for (const m of ["order", "in", "limit", "insert", "update", "upsert", "delete", "neq", "gte"]) c[m] = () => c;
  for (const m of ["insert", "update", "upsert"]) c[m] = (dados: unknown) => { ESCRITAS.push({ tabela: t, op: m, dados }); return c; };
  c.select = (_s?: string, o?: { count?: string; head?: boolean }) => { if (o?.head) contar = true; return c; };
  c.eq = (col: string, v: string) => { if (t === "chamado_mensagens" && col === "chamado_id") linhas = MENSAGENS[v] ?? []; return c; };
  c.single = c.maybeSingle = () => Promise.resolve({ data: linhas[0] ?? null, error: null });
  c.then = (ok: (v: unknown) => unknown) => Promise.resolve(contar ? { count: CONECTADO ? 2 : 0, data: null, error: null } : { data: linhas, error: null }).then(ok);
  return c;
}

let instalado = false;
function instalar() {
  if (instalado) return;
  instalado = true;
  const s = supabase as unknown as Record<string, unknown>;
  s.rpc = (nome: string) => Promise.resolve({ data: RPC[nome] ?? null, error: null });
  s.from = (t: string) => consulta(t);
  const storage = supabase.storage as unknown as Record<string, unknown>;
  storage.from = () => ({
    createSignedUrl: (p: string) => Promise.resolve({ data: p.includes("logo") || p.includes("pecas") || p.includes("memorial") ? null : { signedUrl: PRINT }, error: null }),
    upload: () => Promise.resolve({ data: {}, error: null }),
    remove: () => Promise.resolve({ data: {}, error: null }),
  });
  const auth = supabase.auth as unknown as Record<string, unknown>;
  auth.getUser = () => Promise.resolve({ data: { user: { id: "u1", email: "daniel@dprol.com.br" } }, error: null });
  // conectado: a função gprol responde daqui (Integrações mostra o estado e "Configurar sincronização")
  auth.getSession = () => Promise.resolve({ data: { session: CONECTADO ? { access_token: "lab" } : null }, error: null });
  auth.signOut = () => Promise.resolve({ error: null });
  RPC.meu_escritorio = [{ id: "e1", nome: "D'Prol", papel: "dono", modelos_compartilhados: true, status: "ativo" }];
  const fetchReal = window.fetch.bind(window);
  window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const u = String(entrada instanceof Request ? entrada.url : entrada);
    if (!u.includes("/functions/v1/gprol")) return fetchReal(entrada, init);
    const { acao } = JSON.parse(String(init?.body ?? "{}")) as { acao?: string };
    const corpo = acao === "status"
      ? { liberado: true, pode_configurar: true, pendentes: 0, pedidos_pendentes: 2, erros: [],
          integracao: { status: "ativa", empresa_externa_nome: "D'Prol Topografia", conectado_em: dia(20), ultima_sincronizacao: min(3), ultimo_erro: null,
            resumo: { clientes_ligados: 214, clientes_criados: 9, pedidos: 12 } } }
      : { ok: true, enviados: 0, recebidos: 0 };
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  definirRecursos({ "servico.completo": true, "servico.conferencia": true, "servico.loteamento": true, "servico.car": true, "empresa.equipe": true,
    "integracao.gprol": true, "planta.editor": true, "sigef.mapa": true, "loteamento.maquete3d": false, "sigef.sobreposicao": false });
  definirPermissoes({ dono: true, lista: [] });
}

export function LaboratorioSistema() {
  instalar();
  const tela = location.hash.replace(/^#\/lab\/sistema\/?/, "").split(/[/?]/)[0] || "inicio";
  const [, forcar] = useState(0);
  useEffect(() => {
    if (q.has("suporte") || q.has("conversa") || q.has("novo")) setTimeout(() => abrirSuporte({ novo: q.has("novo") }), 400);
  }, []);
  const rota: Rota = tela === "equipe" ? { t: "equipe" } : tela === "config" ? { t: "config" } : tela === "ajuda" ? { t: "ajuda" } : { t: "inicio" };
  const ir = (r: Rota) => { location.hash = `#/lab/sistema/${r.t === "admin" ? "inicio" : r.t}`; forcar((n) => n + 1); };
  const escritorio = { estado: "ok" as const, escritorio: { id: "e1", nome: "D'Prol", papel: "dono" as const, modelos_compartilhados: true, plano: "Profissional" } };
  return (
    <AppShell rota={rota} ir={ir} usuario={{ nome: "Daniel Nascimento", papel: "Dono · D'Prol" }} escritorioId="e1">
      {tela === "equipe" ? <Equipe escritorio={escritorio} />
        : tela === "config" ? <Configuracoes escritorio={escritorio} />
          : tela === "ajuda" ? <Ajuda />
            : <Inicio onNovo={() => {}} onAbrir={() => {}} onVerServicos={() => {}} nome="Daniel Nascimento" creditos={CREDITOS}
                onConfigurarGprol={() => ir({ t: "config" })} />}
    </AppShell>
  );
}
