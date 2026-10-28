// Laboratório do painel do superadmin (só no `npm run dev`, #/lab/admin):
// desenha o painel com dados de exemplo, sem banco. Troca o `rpc`/`from` do
// cliente do Supabase por respostas fixas — nada sai do navegador.
import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { RECURSOS } from "../../lib/recursos";
import { hashParaRota, useRota } from "../../lib/rota";
import { PainelAdmin } from "./PainelAdmin";
import type { AbaAdmin } from "./PainelAdmin";

const dia = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const PLANOS = [
  { id: "p1", nome: "Essencial", descricao: "", cor: "#5B6B63", ordem: 10, ativo: true },
  { id: "p2", nome: "Profissional", descricao: "", cor: "#178552", ordem: 20, ativo: true },
  { id: "p3", nome: "Completo", descricao: "", cor: "#0E3B2B", ordem: 30, ativo: true },
];
const EMPRESAS = [
  ["D'PROL GEORREFERENCIAMENTO", "p3", "ativo", 6, 214, 38, 0, 0],
  ["AGRIMENSURA SERTÃO LTDA", "p2", "ativo", 3, 41, 12, 1, 2],
  ["TOPO NORTE ENGENHARIA", "p1", "ativo", 2, 9, 0, 22, 25],
  ["GEO CAMPO FORMOSO", "p2", "suspenso", 1, 17, 0, 40, 41],
  ["MEDIÇÕES RECÔNCAVO", "p3", "ativo", 4, 63, 19, 0, 1],
  ["CHAPADA GEO SERVIÇOS", null, "ativo", 1, 0, 0, 3, 3],
].map(([nome, plano, status, usuarios, servicos, s30, acesso, criado], i) => ({
  id: `e${i}`, nome, cnpj: ["11222333000181", "45723174000110", "19131243000197", "33000167000101", "60746948000112", "07526557000100"][i],
  responsavel: ["Daniel Nascimento", "Marta Ribeiro", "Paulo Sena", "Ana Lúcia", "José Carlos", "Rita Prado"][i],
  telefone: "71999990000", email: `contato@empresa${i}.com.br`, status, plano_id: plano,
  plano: PLANOS.find((p) => p.id === plano)?.nome ?? null, observacoes: null, created_at: dia(120 - i * 18 + (criado as number)),
  usuarios, servicos, servicos_30d: s30, ultimo_servico: (s30 as number) ? dia(1 + i) : dia((acesso as number) + 5),
  ultimo_acesso: dia(acesso as number), excecoes: i === 1 ? 1 : 0,
}));
const MATRIZ = PLANOS.flatMap((p) => RECURSOS.filter((r) => r.chave !== "sigef.mapa").map((r) => ({
  plano_id: p.id, recurso_chave: r.chave,
  liberado: p.id === "p3" || (p.id === "p2" ? r.chave !== "servico.loteamento" && r.chave !== "loteamento.maquete3d" : ["servico.completo", "servico.conferencia", "servico.pecas", "planta.editor"].includes(r.chave)),
})));
const BANCO: Record<string, unknown[]> = {
  planos: PLANOS,
  recursos: RECURSOS.map((r) => ({ ...r, ativo: true, criado_em: r.chave === "sigef.mapa" ? dia(1) : dia(90) })),
  plano_recursos: MATRIZ,
  contatos_site: [
    { id: "c1", nome: "Fernando Alves", empresa: "Alves Topografia", telefone: "77988887777", email: "fernando@alvestopo.com.br", cidade_uf: "Barreiras/BA", mensagem: "Faço uns 15 georreferenciamentos por mês e quero ver o loteamento.", origem: "site", status: "novo", created_at: dia(0) },
    { id: "c2", nome: "Luciana Mota", empresa: "LM Agrimensura", telefone: "74977776666", email: null, cidade_uf: "Irecê/BA", mensagem: null, origem: "site", status: "novo", created_at: dia(2) },
    { id: "c3", nome: "Roberto Dias", empresa: null, telefone: "71966665555", email: "rdias@gmail.com", cidade_uf: "Salvador/BA", mensagem: "CAR em lote.", origem: "site", status: "reuniao", created_at: dia(5) },
  ],
  saas_config: [{ key: "senha_padrao", value: "SenhaDeExemplo1" }],
};
const RPC: Record<string, (a: Record<string, unknown>) => unknown> = {
  sa_sincronizar_recursos: () => 1,
  sa_empresas: () => EMPRESAS,
  sa_serie_servicos: () => Array.from({ length: 30 }, (_, i) => ({ dia: dia(29 - i).slice(0, 10), total: Math.max(0, Math.round(4 + 3 * Math.sin(i / 3) + (i % 7 === 5 || i % 7 === 6 ? -4 : 0) + i / 6)) })),
  sa_uso_modalidades: () => [
    { chave: "servico.completo", total: 41 }, { chave: "servico.conferencia", total: 17 }, { chave: "servico.car", total: 9 },
    { chave: "servico.loteamento", total: 4 }, { chave: "servico.divisao", total: 3 }, { chave: "servico.pecas", total: 2 },
  ],
  sa_empresa_usuarios: () => [
    { user_id: "u1", email: "contato@empresa1.com.br", papel: "dono", desde: dia(60), ultimo_acesso: dia(1), senha_provisoria: false },
    { user_id: "u2", email: "campo@empresa1.com.br", papel: "membro", desde: dia(20), ultimo_acesso: null, senha_provisoria: true },
  ],
  sa_recursos_empresa: () => RECURSOS.map((r, i) => ({
    chave: r.chave, liberado: i % 4 !== 3, origem: i === 4 ? "excecao" : r.chave === "sigef.mapa" ? "padrao" : "plano", excecao: i === 4 ? true : null,
  })),
};

/** Resposta que aceita qualquer encadeamento do supabase-js e resolve com a tabela. */
function consulta(linhas: unknown[]) {
  const r = { data: linhas, error: null };
  const cadeia: Record<string, unknown> = {};
  for (const m of ["select", "order", "eq", "in", "limit", "insert", "update", "upsert", "delete"]) cadeia[m] = () => cadeia;
  cadeia.single = () => Promise.resolve({ data: linhas[0] ?? null, error: null });
  cadeia.maybeSingle = () => Promise.resolve({ data: linhas[0] ?? null, error: null });
  cadeia.then = (ok: (v: unknown) => unknown) => Promise.resolve(r).then(ok);
  return cadeia;
}

let instalado = false;
function instalar() {
  if (instalado) return;
  instalado = true;
  const s = supabase as unknown as Record<string, unknown>;
  s.rpc = (nome: string, args: Record<string, unknown>) => Promise.resolve({ data: RPC[nome]?.(args ?? {}) ?? null, error: null });
  s.from = (t: string) => consulta(BANCO[t] ?? []);
}

export function LaboratorioAdmin() {
  instalar();
  const { rota, ir } = useRota();
  const [, forcar] = useState(0);
  // o lab vive em #/lab/admin/<aba>/<id>: traduz para a rota do painel
  const r = hashParaRota(location.hash.replace("#/lab/", "#/"));
  const irLab = (x: Parameters<typeof ir>[0]) => {
    location.hash = x.t === "admin" ? `#/lab/admin/${x.aba}${x.id ? `/${x.id}` : ""}` : "#/lab/admin";
    forcar((n) => n + 1);
  };
  void rota;
  return (
    <PainelAdmin aba={(r.t === "admin" ? r.aba : "visao") as AbaAdmin} id={r.t === "admin" ? r.id : undefined}
      ir={irLab} email="wilker@vertice.app" temEscritorio />
  );
}
