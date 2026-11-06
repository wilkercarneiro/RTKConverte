// Onde as medições ficam na CONTA (migração 0044_medicoes_campo, RLS por
// escritório): assim a medição feita no celular aparece no computador do
// escritório. A tela fala com esta interface; o banco de verdade está em
// conta.ts e o laboratório usa a de memória daqui.
import { medir } from "./geometria.ts";
import type { Medicao } from "./tipos.ts";

export type TipoErroConta = "sem-tabela" | "sem-rede" | "sem-login" | "outro";

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
  /** grava (cria ou atualiza pelo id) */
  salvar(m: Medicao): Promise<void>;
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
export function repositorioMemoria(inicial: Medicao[] = [], op: { falha?: () => TipoErroConta | null; demoraMs?: number } = {}): RepositorioMedicoes & { itens: () => Medicao[] } {
  const dados = new Map(inicial.map((m) => [m.id, m]));
  const esperar = () => new Promise((r) => setTimeout(r, op.demoraMs ?? 250));
  const conferir = () => {
    const f = op.falha?.();
    if (f) throw new ErroConta(f, f === "sem-rede" ? "Sem internet agora." : f === "sem-tabela" ? "O banco ainda não tem a atualização 0044." : "Falhou.");
  };
  return {
    async listar() { await esperar(); conferir(); return [...dados.values()].sort((a, b) => b.atualizadaEm.localeCompare(a.atualizadaEm)); },
    async salvar(m) { await esperar(); conferir(); dados.set(m.id, structuredClone(m)); },
    async excluir(id) { await esperar(); conferir(); dados.delete(id); },
    itens: () => [...dados.values()],
  };
}
