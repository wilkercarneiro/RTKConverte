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
//   • a conta recusou a linha (o id é de outra empresa): marca como recusada
//     e segue — nunca mais tenta aquela;
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
  /** a conta tinha uma versão mais nova: a deste aparelho virou esta cópia */
  copias: { de: string; copia: Medicao }[];
  /** falhas avulsas (tentam de novo na próxima rodada) */
  falhas: number;
  /** ainda há o que enviar */
  restam: number;
}

/** Os erros que valem para todas as medições: não adianta tentar a próxima. */
const PARA_TUDO: TipoErroConta[] = ["sem-rede", "sem-login", "sem-tabela"];

export const SUFIXO_COPIA = " (deste aparelho)";

async function rodada(f: Fila): Promise<ResultadoFila> {
  const r: ResultadoFila = { enviadas: 0, parou: null, recusadas: [], copias: [], falhas: 0, restam: 0 };
  const ids = Object.values(f.ler().registros).filter(paraEnviar)
    .sort((a, b) => a.medicao.atualizadaEm.localeCompare(b.medicao.atualizadaEm))
    .map((x) => x.medicao.id);
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
        if (x) f.gravar({ ...agora, registros: { ...agora.registros, [id]: { ...x, recusada: true } } });
        r.recusadas.push(m);
        continue;
      }
      r.falhas++;
      continue;
    }
    const depois = f.ler();
    const atual = depois.registros[id];
    if (!atual) {
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
    const iso = new Date().toISOString();
    const copia: Medicao = {
      ...atual.medicao,
      id: novoId(),
      nome: (atual.medicao.nome.endsWith(SUFIXO_COPIA) ? atual.medicao.nome : atual.medicao.nome + SUFIXO_COPIA).slice(0, 200),
      atualizadaEm: iso > atual.medicao.atualizadaEm ? iso : atual.medicao.atualizadaEm,
    };
    const sem = removerMedicao(depois, id);
    f.gravar({
      atualId: depois.atualId === id ? copia.id : sem.atualId,
      registros: { ...sem.registros, [copia.id]: { medicao: copia, enviadaVersao: null } },
    });
    r.copias.push({ de: id, copia });
    f.aoCopiar?.(id, copia);
    ids.push(copia.id);
  }
  r.restam = Object.values(f.ler().registros).filter(paraEnviar).length;
  return r;
}

let rodando: Promise<ResultadoFila> | null = null;
let deNovo = false;

/** Sobe o que está pendente. Duas chamadas ao mesmo tempo viram uma rodada a mais, nunca duas juntas. */
export function enviarPendentes(f: Fila): Promise<ResultadoFila> {
  if (rodando) { deNovo = true; return rodando; }
  rodando = (async () => {
    try {
      let r: ResultadoFila;
      let soma = { enviadas: 0, recusadas: [] as Medicao[], copias: [] as ResultadoFila["copias"] };
      do {
        deNovo = false;
        r = await rodada(f);
        soma = { enviadas: soma.enviadas + r.enviadas, recusadas: [...soma.recusadas, ...r.recusadas], copias: [...soma.copias, ...r.copias] };
      } while (deNovo && !r.parou);
      return { ...r, ...soma };
    } finally {
      rodando = null;
    }
  })();
  return rodando;
}

