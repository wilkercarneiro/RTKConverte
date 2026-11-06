// Onde as medições ficam na CONTA (migração 0047_medicoes_campo, RLS por
// escritório): assim a medição feita no celular aparece no computador do
// escritório. A tela fala com esta interface; o banco de verdade está em
// conta.ts e o laboratório usa a de memória daqui.
import { medir } from "./geometria.ts";
import type { Medicao } from "./tipos.ts";

/**
 * sem-tabela: o banco ainda não foi atualizado para guardar medições;
 * sem-rede; sem-login: a sessão expirou; outra-conta: a medição existe na
 * conta de OUTRA empresa (a RLS recusou); outro: qualquer outra falha.
 */
export type TipoErroConta = "sem-tabela" | "sem-rede" | "sem-login" | "outra-conta" | "outro";

/**
 * O que aconteceu ao salvar: "ok" ou "conta-mais-nova" — a conta já tinha uma
 * versão mais nova (outro aparelho, relógio atrasado) e a gravação foi deixada
 * de lado pelo banco.
 */
export type ResultadoSalvar = "ok" | "conta-mais-nova";

export class ErroConta extends Error {
  tipo: TipoErroConta;
  constructor(tipo: TipoErroConta, mensagem: string) {
    super(mensagem);
    this.tipo = tipo;
  }
}

export interface RepositorioMedicoes {
  /** as medições da empresa, mais novas primeiro */
  listar(): Promise<Medicao[]>;
  /** grava (cria ou atualiza pelo id); a versão mais velha nunca sobrescreve a nova */
  salvar(m: Medicao): Promise<ResultadoSalvar>;
  excluir(id: string): Promise<void>;
}

/** A linha da tabela medicoes_campo a partir da medição (números já no motor único). */
export function linhaDaMedicao(m: Medicao) {
  const md = medir(m.vertices);
  const modos = new Set(m.vertices.map((v) => (v.modo === "mao" ? "mao" : "gps")));
  return {
    id: m.id,
    nome: m.nome.trim().slice(0, 200) || "Medição",
    vertices: m.vertices,
    fechada: m.fechada,
    n_vertices: md.n,
    area_m2: md.n >= 3 ? Math.round(md.areaM2 * 100) / 100 : null,
    perimetro_m: md.n >= 2 ? Math.round(md.perimetroM * 100) / 100 : null,
    fuso: md.n ? md.fuso : null,
    precisao_media_m: md.precisaoMediaM == null ? null : Math.round(md.precisaoMediaM * 10) / 10,
    origem: modos.size > 1 ? "misto" : modos.has("mao") ? "mao" : "gps",
    criado_em: m.criadaEm,
    atualizado_em: m.atualizadaEm,
  };
}

/** Conta de mentira (laboratório): guarda em memória e pode falhar sob comando. */
export function repositorioMemoria(inicial: Medicao[] = [], op: { falha?: (id?: string) => TipoErroConta | null; demoraMs?: number } = {}): RepositorioMedicoes & { itens: () => Medicao[] } {
  const dados = new Map(inicial.map((m) => [m.id, m]));
  const esperar = () => new Promise((r) => setTimeout(r, op.demoraMs ?? 250));
  const conferir = (id?: string) => {
    const f = op.falha?.(id);
    if (f) throw new ErroConta(f, f === "sem-rede" ? "Sem internet agora." : f === "sem-tabela" ? "O sistema ainda não foi atualizado para guardar medições na conta." : f === "outra-conta" ? "Esta medição é de outra conta." : "Falhou.");
  };
  return {
    async listar() { await esperar(); conferir(); return [...dados.values()].sort((a, b) => b.atualizadaEm.localeCompare(a.atualizadaEm)); },
    async salvar(m) {
      await esperar(); conferir(m.id);
      const antes = dados.get(m.id);
      // como o gatilho medicoes_campo_mais_nova: a versão velha fica de lado, sem erro
      if (antes && m.atualizadaEm < antes.atualizadaEm) return "conta-mais-nova";
      dados.set(m.id, structuredClone(m));
      return "ok";
    },
    async excluir(id) { await esperar(); conferir(id); dados.delete(id); },
    itens: () => [...dados.values()],
  };
}
