// Progresso de um serviço a partir dos documentos já gerados.
//
// Uma função só para o Início (cartão "continuar de onde parou" e lista de
// recentes) e para a lista de Serviços: as duas telas mostram os mesmos pontos
// e a mesma frase "falta …", e não podem discordar sobre o que está pronto.
import type { Servico } from "./types";
import { vaiAoSigef } from "./modalidades";

export interface DocsDoServico { docs: boolean; planta: boolean; pecas: boolean }

// a planta 'do sistema' sai junto do memorial e da planilha — é a mesma etapa
const TIPOS_ETAPA1 = new Set(["memorial_docx", "planilha_ods", "planta_pdf_sistema"]);

/** Agrupa a tabela documentos_gerados por serviço, marcando as três etapas. */
export function indexarDocumentos(ds: { servico_id: string; tipo: string }[]): Record<string, DocsDoServico> {
  const mapa: Record<string, DocsDoServico> = {};
  for (const d of ds) {
    if (!mapa[d.servico_id]) mapa[d.servico_id] = { docs: false, planta: false, pecas: false };
    const p = mapa[d.servico_id];
    if (TIPOS_ETAPA1.has(d.tipo)) p.docs = true;
    else if (d.tipo === "planta_pdf") p.planta = true;
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
 */
export function progressoDe(s: Pick<Servico, "modalidade" | "tipo">, p?: DocsDoServico): Progresso {
  const d = p ?? { docs: false, planta: false, pecas: false };
  if (s.tipo === "pecas") {
    const etapas = [d.pecas, d.planta];
    return montar(etapas, [!d.pecas ? "gerar as peças técnicas" : "gerar a planta"]);
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
