// Linha do tempo do cliente (RPC historico_cliente, 0029): o cadastro dele e
// tudo o que aconteceu nos serviços dele, agrupado por dia, com quem fez e os
// campos alterados. Banco sem a 0029 = lista vazia, sem erro na tela.
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { categoriaAtividade, rotuloAtividade, rotuloCampo } from "../../lib/equipe";
import type { Atividade } from "../../lib/equipe";
import { rotaParaHash } from "../../lib/rota";
import { iniciaisDe } from "./qualificacao";
import { quandoFoi } from "../Auditoria";

/** Carrega o histórico uma vez por cliente (null = carregando). Erro vira lista vazia. */
export function useHistoricoCliente(clienteId: string, versao = 0): Atividade[] | null {
  const [itens, setItens] = useState<Atividade[] | null>(null);
  useEffect(() => {
    let vivo = true;
    supabase.rpc("historico_cliente", { p_cliente: clienteId, p_limite: 150 })
      .then(({ data, error }) => { if (vivo) setItens(error || !Array.isArray(data) ? [] : (data as Atividade[])); },
        () => { if (vivo) setItens([]); });
    return () => { vivo = false; };
  }, [clienteId, versao]);
  return itens;
}

const hora = (d: string) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function rotuloDia(d: string): string {
  const t = new Date(d); t.setHours(0, 0, 0, 0);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dias = Math.round((hoje.getTime() - t.getTime()) / 86_400_000);
  if (dias === 0) return "Hoje";
  if (dias === 1) return "Ontem";
  const s = t.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: dias > 300 ? "numeric" : undefined });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Item({ a, compacto }: { a: Atividade; compacto?: boolean }) {
  const campos = Array.isArray(a.detalhe?.campos) ? (a.detalhe!.campos as string[]) : [];
  const ehDoc = a.acao === "documento.gerado";
  const servicoId = a.servico_id ?? (typeof a.detalhe?.servico_id === "string" ? a.detalhe.servico_id : null);
  const link = servicoId && a.acao !== "servico.excluido";
  const docAntigo = ehDoc && campos.length === 0 && typeof a.detalhe?.servico === "string";
  const alvo = a.alvo ? (link ? <a href={rotaParaHash({ t: "servico", id: servicoId! })}>{a.alvo}</a> : <b>{a.alvo}</b>) : null;
  return (
    <li className={`cl-tl-item cat-${categoriaAtividade(a.acao)}`}>
      <span className="cl-tl-quem" aria-hidden="true">{iniciaisDe(a.quem || "?")}</span>
      <div className="cl-tl-corpo">
        <p>
          <b>{a.quem}</b>{" "}
          {docAntigo ? <>gerou <b>{a.alvo}</b> em {link ? <a href={rotaParaHash({ t: "servico", id: servicoId! })}>{String(a.detalhe!.servico)}</a> : String(a.detalhe!.servico)}</>
            : <>{rotuloAtividade(a.acao)} {alvo}</>}
          {!ehDoc && (a.vezes ?? 1) > 1 && <span className="cl-tl-vezes"> · {a.vezes} gravações</span>}
          {ehDoc && a.detalhe?.versao != null && <span className="cl-tl-vezes"> · versão {String(a.detalhe.versao)}</span>}
        </p>
        {!compacto && campos.length > 0 && (
          <span className="cl-tl-campos">
            {campos.slice(0, 8).map((c) => <span key={c}>{ehDoc ? c : rotuloCampo(c)}</span>)}
            {campos.length > 8 && <span className="mais">+{campos.length - 8}</span>}
          </span>
        )}
      </div>
      <time dateTime={a.created_at} title={new Date(a.created_at).toLocaleString("pt-BR")}>{compacto ? quandoFoi(a.created_at) : hora(a.created_at)}</time>
    </li>
  );
}

/** Linha do tempo agrupada por dia. `compacto`: sem grupos, para a visão geral. */
export function LinhaDoTempoCliente({ itens, compacto }: { itens: Atividade[]; compacto?: boolean }) {
  if (compacto) return <ol className="cl-tl compacto">{itens.map((a) => <Item key={a.id} a={a} compacto />)}</ol>;
  const porDia = new Map<string, Atividade[]>();
  for (const a of itens) {
    const d = rotuloDia(a.created_at);
    porDia.set(d, [...(porDia.get(d) ?? []), a]);
  }
  return (
    <div className="cl-tl-dias">
      {[...porDia].map(([dia, as]) => (
        <section key={dia} className="cl-tl-dia">
          <h4>{dia}<span>{as.length} {as.length === 1 ? "registro" : "registros"}</span></h4>
          <ol className="cl-tl">{as.map((a) => <Item key={a.id} a={a} />)}</ol>
        </section>
      ))}
    </div>
  );
}
