// "Concluir serviço": o fim do trabalho como decisão da equipe (0033).
//
// Grava servicos.concluido_em (o servidor carimba hora e autor). Se o serviço
// executa um pedido do GPROL e é o último do pedido a concluir, o banco marca o
// pedido como entregue e o põe na fila: aqui só disparamos a sincronização, e o
// card anda no GPROL para a etapa escolhida para "serviço concluído".
// "Reabrir" desfaz aqui (o card do GPROL não volta: lá o funil só anda para frente).
import { useState } from "react";
import { MUDOU, sincronizarGprol } from "../lib/gprol";
import { supabase } from "../lib/supabase";
import type { Servico } from "../lib/types";
import { avisar, confirmar } from "./ui";

type Base = Pick<Servico, "id" | "concluido_em" | "pedido_externo_id">;

export interface Conclusao {
  concluido: boolean;
  ocupado: boolean;
  concluir: () => Promise<void>;
  reabrir: () => Promise<void>;
}

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * `pronto`: todos os documentos da modalidade já saíram; sem isso a confirmação
 * avisa o que ainda falta (`falta`). `onMudou` recebe a data gravada (ou nulo).
 */
export function useConclusao(servico: Base, { pronto, falta, onMudou }: {
  pronto: boolean; falta?: string; onMudou: (concluidoEm: string | null) => void;
}): Conclusao {
  const [ocupado, setOcupado] = useState(false);
  const noGprol = !!servico.pedido_externo_id;

  async function gravar(concluir: boolean) {
    setOcupado(true);
    try {
      const { data, error } = await supabase.from("servicos")
        .update({ concluido_em: concluir ? new Date().toISOString() : null })
        .eq("id", servico.id).select("concluido_em").single();
      if (error) throw error;
      const em = (data as { concluido_em: string | null } | null)?.concluido_em ?? null;
      onMudou(em);
      if (noGprol) sincronizarGprol(0, true);
      dispatchEvent(new Event(MUDOU));
      avisar("ok", concluir
        ? noGprol ? "Serviço concluído. No GPROL, o card vai para a etapa de concluídos." : "Serviço concluído."
        : "Serviço reaberto: ele volta para “Em andamento”.");
    } catch (e) {
      avisar("erro", `Não foi possível ${concluir ? "concluir" : "reabrir"} o serviço: ${(e as Error).message}`);
    } finally {
      setOcupado(false);
    }
  }

  return {
    concluido: !!servico.concluido_em,
    ocupado,
    concluir: async () => {
      const texto = [
        pronto ? "Todos os documentos deste serviço já foram gerados." : `Ainda falta ${falta ?? "terminar os documentos"}: conclua só se o trabalho acabou mesmo assim.`,
        "Ele sai de “Em andamento” no Início, nos Serviços e no cliente.",
        noGprol ? "No GPROL, o card vai para a etapa de serviços concluídos (num pedido com mais de um serviço, quando todos estiverem concluídos)." : "",
        "Dá para reabrir depois.",
      ].filter(Boolean).join(" ");
      if (!(await confirmar({ titulo: "Concluir o serviço?", texto, confirmar: "Concluir serviço" }))) return;
      await gravar(true);
    },
    reabrir: async () => {
      if (!(await confirmar({
        titulo: "Reabrir o serviço?",
        texto: noGprol
          ? "Ele volta para “Em andamento” aqui. No GPROL o card não volta de etapa (lá o funil só anda para frente)."
          : "Ele volta para “Em andamento”.",
        confirmar: "Reabrir",
      }))) return;
      await gravar(false);
    },
  };
}

/** Cabeçalho do serviço: botão "Concluir serviço" ou o selo "Concluído em …" com "Reabrir". */
export function BotaoConcluir({ servico, conclusao, pronto }: { servico: Base; conclusao: Conclusao; pronto: boolean }) {
  if (conclusao.concluido && servico.concluido_em) {
    return (
      <span className="concluido-selo" title="Concluído pela equipe">
        <span className="concluido-chip">✓ Concluído em {dataCurta(servico.concluido_em)}</span>
        <button type="button" className="link" disabled={conclusao.ocupado} onClick={conclusao.reabrir}>Reabrir</button>
      </span>
    );
  }
  return (
    <button type="button" className={pronto ? "principal concluir-btn" : "concluir-btn"} disabled={conclusao.ocupado}
      onClick={conclusao.concluir} title={pronto ? "Tudo gerado: feche o serviço" : "Fechar o serviço antes de gerar tudo"}>
      {conclusao.ocupado ? "Concluindo…" : "Concluir serviço"}
    </button>
  );
}
