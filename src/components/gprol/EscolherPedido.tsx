// Antes do serviço novo: se há pedido do GPROL esperando esta modalidade (do
// cliente escolhido, ou de qualquer cliente quando se começa pelo Início),
// pergunta se é dele. É a defesa contra o mesmo serviço nascer duas vezes no GPROL.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { modalidadesFeitas, usePedidosGprol } from "../../lib/gprol";
import type { PedidoGprol } from "../../lib/gprol";
import { rotuloCurto } from "../../lib/modalidades";
import type { ChaveServico } from "../../lib/modalidades";

export function EscolherPedido({ chave, clienteId, onEscolher, children }: {
  chave: ChaveServico;
  clienteId?: string;
  onEscolher: (p: PedidoGprol) => void;
  children: ReactNode;
}) {
  const { pedidos } = usePedidosGprol(clienteId);
  const [candidatos, setCandidatos] = useState<PedidoGprol[] | null>(null);
  const [seguir, setSeguir] = useState(false);

  useEffect(() => {
    // decide uma vez: pedido que chega depois não troca a tela no meio do envio do arquivo
    if (!pedidos || candidatos !== null) return;
    let vivo = true;
    const comEsta = pedidos.filter((p) => p.origem === "gprol" && p.modalidades.includes(chave));
    modalidadesFeitas(comEsta.map((p) => p.id)).then((f) => {
      if (vivo) setCandidatos(comEsta.filter((p) => !(f[p.id] ?? []).includes(chave)));
    });
    return () => { vivo = false; };
  }, [pedidos, chave, candidatos]);

  if (candidatos === null && !seguir) return <div className="centro"><span className="spinner" />&nbsp; Abrindo…</div>;
  if (seguir || !candidatos || candidatos.length === 0) return <>{children}</>;

  return (
    <div className="pagina fade">
      <div className="bloco gp-escolher">
        <header><h3>Este serviço é de um pedido do GPROL?</h3></header>
        <p className="sub">
          {candidatos.length === 1 ? "Há um pedido" : `Há ${candidatos.length} pedidos`} de {rotuloCurto[chave]} esperando execução.
          Ligando ao pedido, o card anda sozinho no GPROL e o serviço não aparece duas vezes por lá.
        </p>
        <ul className="gp-lista">
          {candidatos.map((p) => (
            <li key={p.id} className="gp-pedido">
              <div className="gp-pedido-info">
                <b>{p.titulo || p.nome_servico}</b>
                <span className="sub">{[p.dados?.cliente_gprol, p.dados?.local, p.etapa ? `GPROL: ${p.etapa}` : null].filter(Boolean).join(" · ")}</span>
              </div>
              <div className="gp-pedido-acoes"><button className="principal" onClick={() => onEscolher(p)}>É este</button></div>
            </li>
          ))}
        </ul>
        <div className="rodape-bloco"><button onClick={() => setSeguir(true)}>Não, é outro serviço</button></div>
      </div>
    </div>
  );
}
