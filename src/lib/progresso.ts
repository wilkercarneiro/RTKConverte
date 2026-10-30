// Progresso de um serviço a partir dos documentos já gerados.
//
// Uma função só para o Início (cartão "continuar de onde parou" e lista de
// recentes) e para a lista de Serviços: as duas telas mostram os mesmos pontos
// e a mesma frase "falta …", e não podem discordar sobre o que está pronto.
import type { Servico } from "./types";
// com extensão: os testes (node --test) importam este módulo direto
import { vaiAoSigef } from "./modalidades.ts";

export interface DocsDoServico { docs: boolean; planta: boolean; pecas: boolean }

// a planta 'do sistema' sai junto do memorial e da planilha — é a mesma etapa;
// a A3 de cada gleba e o Memorial Tabular de prévia (conferência) também
const TIPOS_ETAPA1 = new Set(["memorial_docx", "planilha_ods", "planta_pdf_sistema", "gleba_planta_pdf", "memorial_tabular"]);
// a planta editada no visualizador é derivada de uma planta que já contou
const TIPOS_SEM_ETAPA = new Set(["planta_pdf_editada"]);

/** Agrupa a tabela documentos_gerados por serviço, marcando as três etapas. */
export function indexarDocumentos(ds: { servico_id: string; tipo: string }[]): Record<string, DocsDoServico> {
  const mapa: Record<string, DocsDoServico> = {};
  for (const d of ds) {
    if (!mapa[d.servico_id]) mapa[d.servico_id] = { docs: false, planta: false, pecas: false };
    const p = mapa[d.servico_id];
    if (TIPOS_ETAPA1.has(d.tipo)) p.docs = true;
    else if (d.tipo === "planta_pdf") p.planta = true;
    else if (TIPOS_SEM_ETAPA.has(d.tipo)) continue;
    else p.pecas = true;
  }
  return mapa;
}

export interface Progresso {
  /** uma entrada por etapa, na ordem — true = concluída */
  etapas: boolean[];
  /** índice da etapa em andamento (-1 quando tudo está pronto) */
  atual: number;
  /** o que falta, em uma frase curta */
  falta: string;
  concluido: boolean;
}

/**
 * A conferência de área termina na etapa 1, então dizer que "falta gerar as
 * peças" a ela seria mentira. Quem decide isso é `vaiAoSigef`, a mesma função
 * que a tela do serviço usa para esconder os blocos do SIGEF.
 *
 * Concluído é uma decisão (botão "Concluir serviço", `concluido_em`, 0033), não
 * só documentos prontos: com tudo gerado e sem concluir, falta "concluir o
 * serviço"; concluído antes de gerar tudo (a equipe decidiu), está concluído.
 */
export function progressoDe(s: Pick<Servico, "modalidade" | "tipo" | "status" | "concluido_em">, p?: DocsDoServico): Progresso {
  const base = progressoDosDocumentos(s, p);
  if (s.concluido_em) return { ...base, atual: -1, concluido: true, falta: "concluído" };
  if (base.concluido) return { ...base, atual: base.etapas.length, concluido: false, falta: "concluir o serviço" };
  return base;
}

/** Só os documentos: tudo o que a modalidade gera já saiu? (o "pronto para concluir") */
export function progressoDosDocumentos(s: Pick<Servico, "modalidade" | "tipo" | "status">, p?: DocsDoServico): Progresso {
  const d = p ?? { docs: false, planta: false, pecas: false };
  if (s.tipo === "pecas") {
    const etapas = [d.pecas, d.planta];
    return montar(etapas, [!d.pecas ? "gerar as peças técnicas" : "gerar a planta"]);
  }
  if (s.modalidade === "loteamento") {
    // o loteamento é desenhado na tela; "gerado" = já saíram planta e locação
    return montar([s.status === "gerado"], ["projetar o loteamento e exportar"]);
  }
  if (s.modalidade === "car") {
    // como o loteamento: "gerado" = os shapefiles já foram baixados
    return montar([s.status === "gerado"], ["marcar reserva e APP e baixar os shapefiles"]);
  }
  if (!vaiAoSigef(s)) {
    return montar([d.docs], ["gerar memorial e planta"]);
  }
  return montar(
    [d.docs, d.planta, d.pecas],
    ["gerar memorial e planilha", "enviar o PDF do SIGEF e gerar a planta", "gerar as peças técnicas"],
  );
}

function montar(etapas: boolean[], faltas: string[]): Progresso {
  const atual = etapas.findIndex((e) => !e);
  const concluido = atual === -1;
  return {
    etapas, atual, concluido,
    falta: concluido ? "concluído" : (faltas[atual] ?? faltas[faltas.length - 1]),
  };
}
