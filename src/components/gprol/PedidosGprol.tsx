// Pedidos do GPROL a executar: no Início (todos) e na página do cliente (os dele).
// Cada modalidade do pedido tem o seu selo "feito / a fazer" e o botão Executar,
// que abre o serviço novo já com o cliente e o pedido. O crédito sai como sempre,
// quando o arquivo é enviado.
import { useEffect, useState } from "react";
import { gprol, modalidadesFeitas, MUDOU, ROTULO_ETAPA_PEDIDO, usePedidosGprol } from "../../lib/gprol";
import type { PedidoGprol } from "../../lib/gprol";
import { definicaoDe, rotuloCurto } from "../../lib/modalidades";
import type { ChaveServico } from "../../lib/modalidades";
import { servicoLiberado } from "../../lib/recursos";
import { temPermissao } from "../../lib/permissoes";
import { avisar, confirmar, Dica } from "../ui";

const MODALIDADES: ChaveServico[] = ["completo", "conferencia", "gleba", "divisao", "loteamento", "car", "pecas"];

const data = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "");

export function PedidosGprol({ clienteId, onExecutar }: {
  clienteId?: string;
  onExecutar: (p: PedidoGprol, chave: ChaveServico) => void;
}) {
  const { pedidos, erro } = usePedidosGprol(clienteId);
  // null até saber o que já foi feito: sem isso o botão Executar pisca e dá para duplicar
  const [feitas, setFeitas] = useState<Record<string, string[]> | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const criar = temPermissao("servicos.criar");

  useEffect(() => {
    if (!pedidos) return;
    let vivo = true;
    modalidadesFeitas(pedidos.map((p) => p.id)).then((f) => { if (vivo) setFeitas(f); });
    return () => { vivo = false; };
  }, [pedidos]);

  if (erro || !pedidos || !feitas) return null;
  // "a executar": pendente, ou em execução com modalidade ainda sem serviço
  const visiveis = pedidos.filter((p) =>
    p.origem === "gprol" && (p.status === "pendente" || p.modalidades.some((m) => !(feitas[p.id] ?? []).includes(m))));
  if (!visiveis.length) return null;

  async function acao(p: PedidoGprol, qual: "entregar" | "descartar") {
    const ok = await confirmar(qual === "entregar"
      ? { titulo: "Concluir este pedido?", texto: "Os serviços dele feitos aqui ficam concluídos e, no GPROL, o card vai para a etapa de serviços concluídos.", confirmar: "Concluir" }
      : { titulo: "Descartar este pedido?", texto: "Ele sai da lista. Dá para reabrir depois, se precisar.", confirmar: "Descartar", perigo: true });
    if (!ok) return;
    setOcupado(p.id);
    try {
      await gprol(qual, { pedido_id: p.id });
      avisar("ok", qual === "entregar" ? "Pedido concluído. O GPROL foi avisado." : "Pedido descartado.");
    } catch (e) {
      avisar("erro", (e as Error).message);
    } finally {
      setOcupado(null);
      dispatchEvent(new Event(MUDOU));
    }
  }

  return (
    <div className="gp-pedidos">
      <div className="secao-cabeca">
        <div className="rotulo-secao">A executar · GPROL<Dica>serviços vendidos no GPROL; ao executar, as etapas de lá andam sozinhas</Dica></div>
        <span className="sub">{visiveis.length} pedido(s)</span>
      </div>
      <ul className="gp-lista">
        {visiveis.map((p) => {
          const feitasP = feitas[p.id] ?? [];
          return (
            <li key={p.id} className="gp-pedido">
              <div className="gp-pedido-info">
                <b>{p.titulo || p.nome_servico || "Serviço do GPROL"}</b>
                <span className="sub">
                  {[p.dados?.local, p.etapa ? `GPROL: ${p.etapa}` : null, `recebido em ${data(p.recebido_em)}`].filter(Boolean).join(" · ")}
                </span>
                {p.dados?.observacoes && <span className="sub gp-obs">{p.dados.observacoes}</span>}
              </div>
              <div className="gp-pedido-mods">
                {MODALIDADES.filter((m) => p.modalidades.includes(m)).map((m) => {
                  const feito = feitasP.includes(m);
                  return feito ? (
                    <span key={m} className="chip ok-chip" title="Já tem serviço no Vertces">✓ {rotuloCurto[m]}</span>
                  ) : (
                    <button key={m} className="gp-executar" disabled={!criar || !servicoLiberado(m) || ocupado === p.id}
                      title={!criar ? "Peça a permissão “Criar serviços”" : !servicoLiberado(m) ? "Fora do plano da empresa" : `Abrir ${definicaoDe(m).titulo}`}
                      onClick={() => onExecutar(p, m)}>
                      Executar {rotuloCurto[m]}
                    </button>
                  );
                })}
              </div>
              <div className="gp-pedido-acoes">
                <span className={`chip gp-st-${p.status}`}>{ROTULO_ETAPA_PEDIDO[p.status]}</span>
                {p.status === "em_execucao" && <button className="link" disabled={ocupado === p.id} onClick={() => acao(p, "entregar")}>Concluir</button>}
                {p.status === "pendente" && <button className="link gp-descartar" disabled={ocupado === p.id} onClick={() => acao(p, "descartar")}>Descartar</button>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
