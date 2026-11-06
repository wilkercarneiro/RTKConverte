// A fila de envio: o que ficou no aparelho sobe para a conta.
//
// Mora fora da tela de propósito: o agrimensor mede sem sinal, volta e abre o
// Vertces em qualquer tela (ou no computador) — a casca do sistema (AppShell)
// chama enviarMedicoesPendentes() ao entrar, quando a internet volta e quando a
// aba volta a aparecer. Com o #/campo aberto, a tela registra a SUA fila
// (registrarTela), que fala com o estado que ela tem na memória.
//
// Cada medição é tratada à parte: o erro de uma não segura as outras.
//   • sem internet / sessão vencida / banco sem a tabela: para (as outras
//     falhariam igual) e tenta de novo depois;
//   • a conta recusou a linha (o id é de outra empresa — a pessoa mudou de
//     empresa depois de enviar): a medição sobe como cópia com id novo para a
//     conta de agora; se até a cópia for recusada, fica só no aparelho;
//   • a conta tem uma versão MAIS NOVA (outro aparelho mexeu): a deste
//     aparelho vira uma cópia "(deste aparelho)" com id novo, que sobe
//     também — nada se perde e nada sobrescreve o trabalho do outro;
//   • excluída enquanto subia: apaga da conta de novo.
import {
  marcarEnviada, novoId, paraEnviar, removerMedicao,
} from "./aparelho.ts";
import type { EstadoAparelho } from "./aparelho.ts";
import { ErroConta } from "./repositorio.ts";
import type { RepositorioMedicoes, TipoErroConta } from "./repositorio.ts";
import type { Medicao } from "./tipos.ts";

export interface Fila {
  repo: RepositorioMedicoes;
  ler(): EstadoAparelho;
  gravar(e: EstadoAparelho): void;
  /** uma medição chegou à conta */
  aoEnviar?(m: Medicao): void;
  /** a conta tinha versão mais nova: a deste aparelho virou `copia` (chamado na hora, antes de subir a cópia) */
  aoCopiar?(de: string, copia: Medicao): void;
}

export interface ResultadoFila {
  enviadas: number;
  /** o motivo de ter parado no meio (null = foi até o fim) */
  parou: TipoErroConta | null;
  /** medições que a conta recusou (são de outra empresa) */
  recusadas: Medicao[];
  /** a deste aparelho virou esta cópia: a conta tinha uma versão mais nova, ou o id era de outra empresa */
  copias: { de: string; copia: Medicao; motivo: MotivoCopia }[];
  /** falhas avulsas (tentam de novo na próxima rodada) */
  falhas: number;
  /** ainda há o que enviar */
  restam: number;
}

/** Os erros que valem para todas as medições: não adianta tentar a próxima. */
const PARA_TUDO: TipoErroConta[] = ["sem-rede", "sem-login", "sem-tabela"];

export const SUFIXO_COPIA = " (deste aparelho)";

export type MotivoCopia = "conta-mais-nova" | "outra-conta";

/** Troca a medição `id` do aparelho por uma cópia com id novo (a em andamento passa a ser a cópia). */
function virarCopia(f: Fila, id: string, motivo: MotivoCopia): Medicao | null {
  const agora = f.ler();
  const atual = agora.registros[id];
  if (!atual) return null;
  const iso = new Date().toISOString();
  const copia: Medicao = {
    ...atual.medicao,
    id: novoId(),
    nome: (atual.medicao.nome.endsWith(SUFIXO_COPIA) ? atual.medicao.nome : atual.medicao.nome + SUFIXO_COPIA).slice(0, 200),
    atualizadaEm: iso > atual.medicao.atualizadaEm ? iso : atual.medicao.atualizadaEm,
  };
  const sem = removerMedicao(agora, id);
  f.gravar({
    atualId: agora.atualId === id ? copia.id : sem.atualId,
    registros: { ...sem.registros, [copia.id]: { medicao: copia, enviadaVersao: null, ...(motivo === "outra-conta" ? { copiaPorRecusa: true } : {}) } },
  });
  return copia;
}

async function rodada(f: Fila): Promise<ResultadoFila> {
  const r: ResultadoFila = { enviadas: 0, parou: null, recusadas: [], copias: [], falhas: 0, restam: 0 };
  const ids = Object.values(f.ler().registros).filter(paraEnviar)
    .sort((a, b) => a.medicao.atualizadaEm.localeCompare(b.medicao.atualizadaEm))
    .map((x) => x.medicao.id);
  const copiar = (id: string, motivo: MotivoCopia) => {
    const copia = virarCopia(f, id, motivo);
    if (!copia) return;
    r.copias.push({ de: id, copia, motivo });
    f.aoCopiar?.(id, copia);
    ids.push(copia.id);
  };
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    // o retrato é tirado de novo a cada item: excluída ou já enviada no meio do caminho fica de fora
    const reg = f.ler().registros[id];
    if (!reg || !paraEnviar(reg)) continue;
    const m = reg.medicao;
    let res: "ok" | "conta-mais-nova";
    try {
      res = await f.repo.salvar(m);
    } catch (e) {
      const tipo: TipoErroConta = e instanceof ErroConta ? e.tipo : "outro";
      if (PARA_TUDO.includes(tipo)) { r.parou = tipo; break; }
      if (tipo === "outra-conta") {
        const agora = f.ler();
        const x = agora.registros[id];
        if (!x) continue;
        // o id é de outra empresa (a pessoa mudou de empresa depois de enviar): sobe como cópia
        // para a conta de agora; se até a cópia é recusada, a conta não deixa gravar: fica no aparelho
        if (!x.copiaPorRecusa) { copiar(id, "outra-conta"); continue; }
        f.gravar({ ...agora, registros: { ...agora.registros, [id]: { ...x, recusada: true } } });
        r.recusadas.push(m);
        continue;
      }
      r.falhas++;
      continue;
    }
    const depois = f.ler();
    if (!depois.registros[id]) {
      // excluída enquanto subia: não pode ressuscitar na conta
      try { await f.repo.excluir(id); } catch { /* fica para a pessoa excluir lá */ }
      continue;
    }
    if (res === "ok") {
      f.gravar(marcarEnviada(depois, id, m.atualizadaEm));
      r.enviadas++;
      f.aoEnviar?.(m);
      continue;
    }
    // a conta tem uma versão mais nova: a deste aparelho sobe como cópia
    copiar(id, "conta-mais-nova");
  }
  r.restam = Object.values(f.ler().registros).filter(paraEnviar).length;
  return r;
}

/**
 * Uma fila que fala com a tela quando ela está aberta e com o aparelho quando
 * não está, decidido A CADA leitura e gravação. A casca começa a rodada com o
 * localStorage; se o #/campo abre no meio (ele é carregado depois), o resto da
 * rodada já grava pelo estado da tela, e a tela não passa por cima do que a
 * casca fez.
 */
export function filaViva(base: Fila, daTela: () => Fila | null): Fila {
  const f = () => daTela() ?? base;
  return {
    get repo() { return f().repo; },
    ler: () => f().ler(),
    gravar: (e) => f().gravar(e),
    aoEnviar: (m) => f().aoEnviar?.(m),
    aoCopiar: (de, c) => f().aoCopiar?.(de, c),
  };
}

// Uma rodada por vez no módulo inteiro (casca e tela usam a mesma conta). Quem
// chama no meio de uma rodada espera ela acabar e ganha a PRÓXIMA, feita com a
// fila que passou: nunca a resposta de uma rodada que não viu a sua fila.
// Várias chamadas no meio viram uma rodada só, com a fila da última.
let atual: Promise<ResultadoFila> | null = null;
let proxima: { fila: Fila; p: Promise<ResultadoFila> } | null = null;

function iniciar(f: Fila): Promise<ResultadoFila> {
  const p: Promise<ResultadoFila> = rodada(f).finally(() => { if (atual === p) atual = null; });
  atual = p;
  return p;
}

/** Sobe o que está pendente. Duas chamadas ao mesmo tempo nunca rodam juntas. */
export function enviarPendentes(f: Fila): Promise<ResultadoFila> {
  if (proxima) { proxima.fila = f; return proxima.p; }
  if (!atual) return iniciar(f);
  const nx = { fila: f } as { fila: Fila; p: Promise<ResultadoFila> };
  nx.p = atual.catch(() => undefined).then(() => {
    if (proxima === nx) proxima = null;
    return iniciar(nx.fila);
  });
  proxima = nx;
  return nx.p;
}
