// Faixa do GPROL na página do serviço.
//  - ligado a um pedido: etapa no GPROL, aviso de cancelado (a entrega é o
//    "Concluir serviço" do cabeçalho: ConcluirServico.tsx);
//  - solto, com integração: oferece ligar ao pedido do cliente (evita o mesmo
//    serviço nascer duas vezes no GPROL) ou a um serviço aberto de lá;
//    sem nada para ligar, avisa que ele vai ao GPROL ao gerar os documentos.
import { useEffect, useState } from "react";
import { gprol, modalidadesFeitas, MUDOU, ROTULO_ETAPA_PEDIDO, sincronizarGprol, useIntegracaoGprol } from "../../lib/gprol";
import type { PedidoGprol } from "../../lib/gprol";
import { supabase } from "../../lib/supabase";
import { chaveDoServico, rotuloCurto } from "../../lib/modalidades";
import type { Servico } from "../../lib/types";
import { avisar, confirmar } from "../ui";

interface ServicoAberto { id: string; nome: string; fazenda: string | null; titulo: string | null; etapa: string | null; ligado: boolean; criado_em: string }

export function ServicoGprol({ servico }: { servico: Servico }) {
  const { integracao } = useIntegracaoGprol();
  const [pedidoId, setPedidoId] = useState<string | null>((servico as { pedido_externo_id?: string | null }).pedido_externo_id ?? null);
  const [pedido, setPedido] = useState<PedidoGprol | null>(null);
  const [candidatos, setCandidatos] = useState<PedidoGprol[]>([]);
  const [abertos, setAbertos] = useState<ServicoAberto[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [vez, setVez] = useState(0);
  const conectado = integracao?.status === "ativa";
  const chave = chaveDoServico(servico);

  useEffect(() => {
    let vivo = true;
    (async () => {
      // o pedido pode ter sido ligado por fora desta tela (sincronismo, gleba herdando)
      const { data: s } = await supabase.from("servicos").select("pedido_externo_id").eq("id", servico.id).maybeSingle();
      const pid = (s as { pedido_externo_id: string | null } | null)?.pedido_externo_id ?? null;
      if (!vivo) return;
      setPedidoId(pid);
      if (pid) {
        const { data } = await supabase.from("pedidos_externos").select("*").eq("id", pid).maybeSingle();
        if (vivo) setPedido((data as PedidoGprol | null) ?? null);
        return;
      }
      setPedido(null);
      if (!conectado || servico.origem_id || !servico.cliente_id) { setCandidatos([]); return; }
      const { data } = await supabase.from("pedidos_externos").select("*").eq("cliente_id", servico.cliente_id)
        .eq("origem", "gprol").in("status", ["pendente", "em_execucao"]).contains("modalidades", [chave]);
      const lista = (data as PedidoGprol[] | null) ?? [];
      const feitas = await modalidadesFeitas(lista.map((p) => p.id));
      if (vivo) setCandidatos(lista.filter((p) => !(feitas[p.id] ?? []).includes(chave)));
    })();
    const f = () => setVez((v) => v + 1);
    addEventListener(MUDOU, f);
    return () => { vivo = false; removeEventListener(MUDOU, f); };
  }, [servico.id, servico.cliente_id, servico.origem_id, conectado, chave, vez]);

  async function ligar(p: PedidoGprol) {
    setOcupado(true);
    const { error } = await supabase.from("servicos").update({ pedido_externo_id: p.id }).eq("id", servico.id);
    setOcupado(false);
    if (error) { avisar("erro", error.message); return; }
    avisar("ok", "Serviço ligado ao pedido do GPROL.");
    sincronizarGprol(0, true);
    setVez((v) => v + 1);
  }

  async function verAbertos() {
    if (!servico.cliente_id) return;
    setOcupado(true);
    try {
      const r = await gprol<{ itens: ServicoAberto[]; cliente_ligado: boolean }>("servicos_gprol", { cliente_id: servico.cliente_id });
      setAbertos(r.itens.filter((x) => !x.ligado));
      if (!r.cliente_ligado) avisar("ok", "Este cliente ainda não está no GPROL: ele vai para lá ao gerar os documentos.");
    } catch (e) {
      avisar("erro", (e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function vincular(a: ServicoAberto) {
    if (!(await confirmar({ titulo: `Ligar a “${a.titulo ?? a.nome}” do GPROL?`, texto: "As etapas de lá passam a andar conforme este serviço avança.", confirmar: "Ligar" }))) return;
    setOcupado(true);
    try {
      await gprol("vincular", { servico_id: servico.id, servico_gprol_id: a.id });
      avisar("ok", "Serviço ligado ao GPROL.");
      setAbertos(null);
      dispatchEvent(new Event(MUDOU));
    } catch (e) {
      avisar("erro", (e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (pedidoId && pedido) {
    return (
      <div className={`gp-faixa gp-servico${pedido.status === "cancelado" ? " alerta-faixa" : ""}`}>
        <span className="gp-marca">GPROL</span>
        <span className="gp-texto">
          {pedido.status === "cancelado"
            ? <><b>Cancelado no GPROL.</b> Nada foi apagado aqui; confira com a equipe antes de continuar.</>
            : <>{pedido.titulo ?? pedido.nome_servico}{pedido.etapa ? <> · etapa <b>{pedido.etapa}</b></> : null}</>}
        </span>
        <span className={`chip gp-st-${pedido.status}`}>{ROTULO_ETAPA_PEDIDO[pedido.status]}</span>
        {pedido.status === "em_execucao" && !servico.origem_id && (
          <span className="sub gp-dica-concluir">ao concluir o serviço, o card vai para a etapa de concluídos</span>
        )}
      </div>
    );
  }
  if (!conectado || servico.origem_id) return null;

  if (candidatos.length) {
    return (
      <div className="gp-faixa gp-servico alerta-faixa">
        <span className="gp-marca">GPROL</span>
        <span className="gp-texto">
          {candidatos.length === 1
            ? <>O cliente tem um pedido de <b>{rotuloCurto[chave]}</b> no GPROL: <b>{candidatos[0].titulo ?? candidatos[0].nome_servico}</b>. É este serviço?</>
            : <>O cliente tem {candidatos.length} pedidos de <b>{rotuloCurto[chave]}</b> no GPROL. Este serviço é de um deles?</>}
        </span>
        <span className="gp-botoes">
          {candidatos.map((p) => (
            <button key={p.id} disabled={ocupado} onClick={() => ligar(p)}>
              {candidatos.length === 1 ? "Sim, ligar" : `Ligar a “${p.titulo ?? p.nome_servico}”`}
            </button>
          ))}
        </span>
      </div>
    );
  }

  return (
    <div className="gp-faixa gp-servico gp-discreta">
      <span className="gp-marca">GPROL</span>
      <span className="gp-texto">Vai para o GPROL ao gerar os primeiros documentos.</span>
      {servico.cliente_id && abertos === null && (
        <button className="link" disabled={ocupado} onClick={verAbertos}>Já existe lá? Ligar a um serviço do GPROL</button>
      )}
      {abertos !== null && (
        <div className="gp-abertos">
          {abertos.length === 0 ? <span className="sub">Nenhum serviço aberto deste cliente no GPROL.</span> : abertos.map((a) => (
            <button key={a.id} disabled={ocupado} onClick={() => vincular(a)}>
              {a.titulo ?? a.nome}{a.etapa ? ` · ${a.etapa}` : ""}
            </button>
          ))}
          <button className="fantasma" onClick={() => setAbertos(null)}>Fechar</button>
        </div>
      )}
    </div>
  );
}
