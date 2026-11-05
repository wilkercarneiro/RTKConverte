// Laboratório da conferência (só no `npm run dev`): #/lab/conferencia
//   ?semwebgl   simula o navegador sem WebGL (aceleração gráfica desligada)
//   ?glebas     serviço com glebas (carregadas do "banco" depois do 1º desenho)
//   ?quebrar    o mapa lança um erro qualquer ao desenhar (barreira do mapa)
//   ?pecas      a tela de peças (serviço do PDF do SIGEF): abrir não grava nada
//   ?divisao    serviço completo em partilha (etapa Divisão); +&salva: a divisão já salva em 2 partes;
//               +&codigos: marcos já com código definitivo (os documentos de cada parte podem ser
//               gerados, com 37 + 2 créditos gerais de exemplo)
//   ?completo   serviço completo sem glebas: em Dados, "Dividir em partes iguais | Desmembrar uma área"
//   ?desmembramento  o mesmo, em desmembramento (etapa Desmembramento): uma área desmembrada e a
//               remanescente; +&salva e +&codigos como acima; +&geradas: a área desmembrada já tem
//               o serviço dela e os quatro documentos (a lista da etapa Documentos e o ZIP)
// Dados fictícios, sem banco: troca `from`/`rpc`/`storage`/`auth` do cliente do
// Supabase por respostas fixas e GUARDA toda escrita em window.__labEscritas —
// abrir o serviço e trocar de etapa não pode gravar nada.
import { useState } from "react";
import maplibregl from "maplibre-gl";
import proj4 from "proj4";
import { supabase } from "../lib/supabase";
import { definirPermissoes } from "../lib/permissoes";
import { definirRecursos } from "../lib/recursos";
import { sugerirDivisoes } from "../lib/divisao";
import { aplicarDivisao, entradaDoServico, publicadorUtm } from "../lib/divisao_servico";
import { aneisDosLotes, anelBruto, limparAvisos, perimetroDaDivisao, projetoDaDivisao, resultadoDosLotes } from "../lib/divisao_prancheta";
import { calcular } from "../lib/loteamento/calculo";
import { areaDoPerimetroM2, inicioDoDesmembramento, percentuais } from "../lib/desmembramento";
import type { Gleba, Servico, Vertice } from "../lib/types";
import type { Rota } from "../lib/rota";
import { AppShell } from "./AppShell";
import { Conferencia } from "./Conferencia";
import { PecasServico } from "./PecasServico";

const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
const SID = "lab-servico";

// 14 pontos de um levantamento de teste (coordenadas, sem dado de pessoa)
const PONTOS: [number, number, number, number, string, string][] = [
  [103, 492699.572, 8736640.077, 318.435, "11 25 42,585 S", "39 4 00,931 W"],
  [118, 492487.966, 8736591.265, 319.763, "11 25 44,172 S", "39 4 07,915 W"],
  [133, 492276.245, 8736701.491, 323.04, "11 25 40,582 S", "39 4 14,902 W"],
  [148, 492286.929, 8737098.929, 306.182, "11 25 27,642 S", "39 4 14,546 W"],
  [163, 492244.805, 8737527.878, 304.605, "11 25 13,676 S", "39 4 15,933 W"],
  [178, 492206.766, 8737918.007, 303.445, "11 25 00,975 S", "39 4 17,185 W"],
  [193, 492289.718, 8738051.314, 299.644, "11 24 56,635 S", "39 4 14,446 W"],
  [208, 492440.576, 8737923.192, 299.656, "11 25 00,808 S", "39 4 09,469 W"],
  [223, 492653.914, 8737722.835, 305.196, "11 25 07,332 S", "39 4 02,430 W"],
  [238, 492836.252, 8737502.475, 292.186, "11 25 14,508 S", "39 3 56,414 W"],
  [253, 492980.637, 8737226.766, 287.504, "11 25 23,485 S", "39 3 51,651 W"],
  [268, 493018.126, 8737074.487, 287.975, "11 25 28,444 S", "39 3 50,415 W"],
  [283, 493063.551, 8736919.429, 294.28, "11 25 33,492 S", "39 3 48,917 W"],
  [298, 493018.175, 8736708.246, 303.943, "11 25 40,367 S", "39 3 50,416 W"],
];
const MS = new Map<number, string>([[0, "(MATR.1.000/CNS.00.000-0) FAZENDA EXEMPLO\\ FULANO DE TAL\\ CPF:000.000.000-00"], [5, "ESTRADA VICINAL"], [9, "(POSSE) SÍTIO MODELO\\ BELTRANA DE TAL\\ CPF:111.111.111-11"]]);

const VERTICES: Vertice[] = PONTOS.map(([num, e, n, h, lat, lon], ordem) => ({
  id: `v${ordem}`, servico_id: SID, ordem, num_txt: num, rotulo_txt: MS.has(ordem) ? "M" : null,
  e, n, h, sigma_pos: 0.004, sigma_h: 0.008,
  tipo: MS.has(ordem) ? "M" : "P", codigo: null, codigo_provisorio: false, metodo: "PG6", inserido_manual: false,
  lat_gms: lat, lon_gms: lon,
  descritivo: MS.get(ordem) ?? null, tipo_limite: MS.has(ordem) ? (ordem === 5 ? "LA3" : "LA1") : null,
  eh_via: ordem === 5, cns: null, matricula: null, apelido_txt: null, numerado: false, exibir_planta: true,
  ...(q.has("codigos") ? { codigo: `XXXX-${MS.has(ordem) ? "M" : "P"}-${String(ordem + 1).padStart(4, "0")}` } : {}),
}) as Vertice);

const DESMEMBRAMENTO = q.has("desmembramento");
const DIVISAO = q.has("divisao") || DESMEMBRAMENTO;
const COM_GLEBAS = q.has("glebas") || DIVISAO;
// ?completo: serviço completo comum — em Dados, o convite "Dividir em partes iguais | Desmembrar uma área"
const COMPLETO = q.has("completo") || DIVISAO;
const SALVA = DIVISAO && q.has("salva");

/**
 * Desmembramento já salvo, pelo MESMO caminho da prancheta: o motor corta uma
 * área com 10% do imóvel (arredondada), a prancheta calcula, e salvar grava os
 * marcos novos da divisa no perímetro e as duas áreas como glebas — a
 * desmembrada no nome de MARIA DE TAL, a remanescente com o proprietário. O
 * rascunho da prancheta vai junto (como o serviço real guarda ao salvar).
 * Com &geradas, a área desmembrada já tem o serviço dela (lab-area-1).
 */
function desmembramentoSalvo() {
  const pub = publicadorUtm(24, (f, t, c) => proj4(f, t, c));
  const ini = inicioDoDesmembramento(areaDoPerimetroM2(VERTICES, pub) / 10000);
  const fr = percentuais(ini.areasHa);
  const ent = entradaDoServico(VERTICES, fr, false, pub);
  const r = sugerirDivisoes(ent)[0];
  const projeto = projetoDaDivisao(ent, r.partes.map((p) => anelBruto(ent, p)), "FAZENDA LABORATÓRIO");
  const rd = resultadoDosLotes(ent, aneisDosLotes(limparAvisos(calcular(projeto, perimetroDaDivisao(ent)), true)), fr, r.azimute);
  const ap = aplicarDivisao(VERTICES, rd, [
    { nome: "ÁREA DESMEMBRADA 01", herdeiro: "MARIA DE TAL", cpf: "000.000.000-01", denominacao: "" },
    { nome: "ÁREA REMANESCENTE", herdeiro: "", cpf: "", denominacao: "" },
  ], fr, SID);
  return {
    divisao: { azimute: r.azimute, inverter: false, iguais: false, projeto },
    vertices: ap.vertices.map((v, i) => (q.has("codigos") && !v.codigo ? { ...v, id: v.id ?? `d${i}`, codigo: `XXXX-M-${String(900 + i).padStart(4, "0")}` } : v)),
    glebas: ap.glebas.map((g, i) => ({ ...g, id: `a${i + 1}`, ...(i === 0 && q.has("geradas") ? { servico_parte_id: "lab-area-1" } : {}) })),
  };
}
const DESM_SALVO = SALVA && DESMEMBRAMENTO ? desmembramentoSalvo() : null;
const VERTICES_LAB = DESM_SALVO?.vertices ?? VERTICES;

const SERVICO = {
  id: SID, tipo: "geo", modalidade: COMPLETO ? "completo" : "conferencia", status: "gerado", tem_glebas: COM_GLEBAS,
  ...(DESMEMBRAMENTO ? { divisao: { tipo: "desmembramento", iguais: false, remanescente: 1, ...(DESM_SALVO?.divisao ?? {}) } } : DIVISAO ? { divisao: { iguais: true } } : {}),
  nome_arquivo_txt: "LABORATORIO.txt", fuso_utm: 24, credenciado_id: "c1", rt_id: "rt1",
  denominacao: "FAZENDA LABORATÓRIO", detentor_nome: "FULANO DE TAL", detentor_cpf: "000.000.000-00",
  municipio: "ARACI", uf: "BA", trt: "BR0000000000", created_at: new Date(Date.now() - 864e5).toISOString(),
} as unknown as Servico;

// partilha já salva: duas partes pelos vértices 0 e 7 (a divisa liga os dois)
if (SALVA && !DESMEMBRAMENTO) for (const o of [0, 7]) VERTICES[o] = { ...VERTICES[o], rotulo_txt: "DIVISÃO", tipo: "M" } as Vertice;
const anelDe = (ordens: number[]) => ordens.map((o) => [VERTICES[o].e!, VERTICES[o].n!] as [number, number]);
const PARTES_SALVAS = [
  { id: "p1", servico_id: SID, ordem: 0, nome: "PARTE 1", anel: anelDe([0, 1, 2, 3, 4, 5, 6, 7]), confrontante_interno: null, detentor_nome: "MARIA DE TAL", detentor_cpf: "000.000.000-01" },
  { id: "p2", servico_id: SID, ordem: 1, nome: "PARTE 2", anel: anelDe([7, 8, 9, 10, 11, 12, 13, 0]), confrontante_interno: null, detentor_nome: "JOÃO DE TAL", detentor_cpf: "000.000.000-02" },
] as unknown as Gleba[];

// &geradas: os quatro documentos da última geração do serviço da área desmembrada
const DOCS_AREA = DESMEMBRAMENTO && q.has("geradas")
  ? ([["memorial_docx", "Memorial Descritivo (DOCX)", "memorial.docx"], ["planilha_ods", "Planilha SIGEF (ODS)", "planilha.ods"],
    ["planta_pdf_sistema", "Planta A1 (PDF · dados do sistema)", "planta-sistema.pdf"], ["tabular_docx", "Memorial Tabular (DOCX · dados do sistema)", "memorial-tabular.docx"]] as const)
    .map(([tipo, titulo, arq], i) => ({ id: `dg${i}`, servico_id: "lab-area-1", versao: 2, tipo, titulo, path: `lab-area-1/v2/${arq}`, created_at: new Date().toISOString() }))
  : [];
const CREDITOS_LAB = {
  periodo: { inicio: "2026-11-01", renova_em: "2026-12-01", dia: 1 },
  carteiras: [{ chave: "geral", nome: "Créditos gerais", descricao: null, servicos: null, por_mes: 50, usado: 13, extra: 2, precos: [] }],
  servicos: { "servico.completo": { disponivel: true, carteira: "geral", precisa_aceite: false } },
  sou_dono: true, pagamento_online: false, compras: [],
};

const GLEBAS: Gleba[] = [
  { id: "g1", servico_id: SID, ordem: 0, nome: "GLEBA 1", anel: [[0, 7], [7, 13]] as [number, number][], confrontante_interno: null },
];
const TRECHOS_PECAS = [
  { id: "t1", servico_id: SID, vertice_inicio_ordem: 0, codigo_inicio: "XXXX-M-0001", descritivo: "(MATR.1.000/CNS.00.000-0) FAZENDA EXEMPLO\\ FULANO DE TAL\\ CPF:000.000.000-00", tipo_limite: "LA1", eh_via: false, numerado: false, exibir_planta: true },
  { id: "t2", servico_id: SID, vertice_inicio_ordem: 1, codigo_inicio: "XXXX-M-0002", descritivo: "ESTRADA VICINAL", tipo_limite: "LA3", eh_via: true, numerado: false, exibir_planta: true },
];
const TABELAS: Record<string, unknown[]> = {
  servicos: [{ ...SERVICO, tipo: "pecas", modalidade: "completo" }],
  // os confrontantes demoram mais que o serviço: era a janela em que o
  // autossalvamento apagava todos (delete + insert de uma lista vazia)
  trechos_confrontantes: TRECHOS_PECAS,
  credenciados: [{ id: "c1", nome: "CREDENCIADO EXEMPLO", prefixo_vertice: "XXXX", contador_m: 1, contador_p: 1, contador_v: 1 }],
  responsaveis_tecnicos: [{ id: "rt1", nome: "TECNICO EXEMPLO", formacao: "Técnico em Agrimensura", conselho_sigla: "CREA", conselho_numero: "12345-D", identidade: "00.000.000-00 SSP/BA", cpf: "000.000.000-00", trt: "BR0000000000" }],
  glebas: DESM_SALVO ? DESM_SALVO.glebas : SALVA ? PARTES_SALVAS : COM_GLEBAS && !DIVISAO ? GLEBAS : [],
  documentos_gerados: DOCS_AREA,
};

/** O que a tela mandou gravar (insert/update/upsert/delete). */
const ESCRITAS: { tabela: string; op: string }[] = [];
(window as unknown as { __labEscritas: typeof ESCRITAS }).__labEscritas = ESCRITAS;

let servicosCriados = 0;
function consulta(t: string) {
  let linhas = TABELAS[t] ?? [];
  const c: Record<string, unknown> = {};
  for (const m of ["select", "order", "in", "limit", "neq", "gte", "eq", "not", "or", "is", "lt", "lte", "ilike"]) c[m] = () => c;
  // documentos_gerados por serviço: a tela do imóvel e a lista das áreas leem a mesma tabela
  if (t === "documentos_gerados") {
    const doServico = (l: unknown) => (l as { servico_id: string }).servico_id;
    c.eq = (col: string, v: unknown) => { if (col === "servico_id") linhas = linhas.filter((l) => doServico(l) === v); return c; };
    c.in = (col: string, vs: unknown[]) => { if (col === "servico_id") linhas = linhas.filter((l) => vs.includes(doServico(l))); return c; };
  }
  let inseriu = false;
  for (const m of ["insert", "update", "upsert", "delete"]) c[m] = () => { ESCRITAS.push({ tabela: t, op: m }); if (m === "insert") inseriu = true; return c; };
  // o serviço de uma área nasce com id próprio (lab-area-2, -3…)
  c.single = c.maybeSingle = () => Promise.resolve({ data: t === "servicos" && inseriu ? { ...(linhas[0] as object), id: `lab-area-${++servicosCriados + 1}` } : linhas[0] ?? null, error: null });
  // as glebas chegam "do banco" um pouco depois do primeiro desenho, como na produção
  const atraso = t === "glebas" ? 400 : t === "trechos_confrontantes" ? 2500 : 30;
  c.then = (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
    new Promise((r) => setTimeout(r, atraso)).then(() => ({ data: linhas, error: null, count: linhas.length })).then(ok, falha);
  return c;
}

let instalado = false;
function instalar() {
  if (instalado) return;
  instalado = true;
  if (q.has("semwebgl")) {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, tipo: string, ...resto: unknown[]) {
      if (/webgl/i.test(tipo)) return null;
      return (orig as (...a: unknown[]) => unknown).call(this, tipo, ...resto);
    } as typeof HTMLCanvasElement.prototype.getContext;
  }
  if (q.has("quebrar")) {
    // erro inesperado DEPOIS de criar o mapa (o try/catch da criação não pega):
    // quem segura é a barreira do mapa — confrontantes e vértices ficam na tela
    (maplibregl.Map.prototype as unknown as { addControl: () => never }).addControl = () => { throw new Error("falha simulada do mapa (laboratório)"); };
  }
  const s = supabase as unknown as Record<string, unknown>;
  // alocar_contadores: a reserva de números do credenciado (o GEO da parte numera os marcos sem gerar)
  s.rpc = (nome: string) => {
    if (nome === "alocar_contadores") { ESCRITAS.push({ tabela: "credenciados", op: "alocar_contadores" }); return Promise.resolve({ data: [{ base_m: 101, base_p: 501, base_v: 1 }], error: null }); }
    return Promise.resolve({ data: nome === "meus_creditos" && COMPLETO ? CREDITOS_LAB : [], error: null });
  };
  s.from = (t: string) => consulta(t);
  const storage = supabase.storage as unknown as Record<string, unknown>;
  // os documentos dos serviços de área do laboratório "existem": URL de dados (o ZIP funciona)
  const urlDoLab = (path: string) => `data:application/octet-stream;base64,${btoa(`laboratorio ${path}`)}`;
  storage.from = () => ({
    list: () => Promise.resolve({ data: [], error: null }),
    createSignedUrl: (path: string) => Promise.resolve({ data: path.startsWith("lab-area-") ? { signedUrl: urlDoLab(path) } : null, error: null }),
    upload: () => { ESCRITAS.push({ tabela: "storage", op: "upload" }); return Promise.resolve({ data: {}, error: null }); },
    download: () => Promise.resolve({ data: null, error: { message: "lab" } }),
    remove: () => Promise.resolve({ data: {}, error: null }),
  });
  const auth = supabase.auth as unknown as Record<string, unknown>;
  auth.getUser = () => Promise.resolve({ data: { user: { id: "u1", email: "lab@exemplo.com" } }, error: null });
  auth.getSession = () => Promise.resolve({ data: { session: { access_token: "lab" } }, error: null });
  const fetchReal = window.fetch.bind(window);
  window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const u = String(entrada instanceof Request ? entrada.url : entrada);
    // gerar-documentos de um serviço de área: os quatro documentos (o tabular junto)
    if (u.includes("/functions/v1/gerar-documentos") && COMPLETO) {
      const corpo = JSON.parse(String(init?.body ?? "{}")) as { servico_id?: string; tabular?: boolean };
      if (corpo.tabular && corpo.servico_id?.startsWith("lab-area-")) {
        const p = (arq: string) => urlDoLab(`${corpo.servico_id}/v1/${arq}`);
        return new Response(JSON.stringify({
          ok: true, memorial_docx: p("memorial.docx"), planilha_ods: p("planilha.ods"), planta_pdf: p("planta-sistema.pdf"), tabular_docx: p("memorial-tabular.docx"),
          avisos: ["Planta do imóvel: MAPBOX_TOKEN não configurado no servidor — a planta saiu sem imagem de satélite."],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }
    if (u.includes("/functions/v1/") || u.includes("/rest/v1/")) {
      return new Response(JSON.stringify({ ok: true, parcelas: { type: "FeatureCollection", features: [] }, sobreposicoes: [], encostos: [], avisos: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return fetchReal(entrada, init);
  };
  definirRecursos({ "servico.completo": true, "servico.conferencia": true, "sigef.mapa": true, "planta.editor": true, "sigef.sobreposicao": true });
  definirPermissoes({ dono: true, lista: [] });
}

export function LaboratorioConferencia() {
  instalar();
  const [, forcar] = useState(0);
  const rota: Rota = { t: "servico", id: SID };
  if (q.has("pecas")) {
    return (
      <AppShell rota={rota} ir={() => forcar((n) => n + 1)} usuario={{ nome: "Laboratório", papel: "Dono" }} escritorioId={undefined}>
        <PecasServico servicoId={SID} onVoltar={() => undefined} />
      </AppShell>
    );
  }
  return (
    <AppShell rota={rota} ir={() => forcar((n) => n + 1)} usuario={{ nome: "Laboratório", papel: "Dono" }} escritorioId={undefined}>
      <Conferencia key={SID} inicial={{ servico: SERVICO, vertices: VERTICES_LAB, trechos: [], preview: {
        fuso: 24, epsg: 31984, candidatos: [24], fusoAmbiguo: false, foraDaUf: false, areaHa: 0, perimetroM: 0, qtdM: 0, qtdP: 0, qtdV: 0,
      } }} onVoltar={() => undefined} />
    </AppShell>
  );
}
