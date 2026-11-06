// Antes do serviço novo: se há pedido do GPROL esperando esta modalidade (do
// cliente escolhido, ou de qualquer cliente quando se começa pelo Início),
// pergunta se é dele. É a defesa contra o mesmo serviço nascer duas vezes no GPROL.
//
// Tela centralizada com duas escolhas grandes (pedido do Wilker, 05/11/2026):
// "Sim, é um pedido do GPROL" (com 1 pedido, já diz qual e liga num clique;
// com vários, abre a lista) e "Começar do zero" (com a foto da modalidade).
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { modalidadesFeitas, usePedidosGprol } from "../../lib/gprol";
import type { PedidoGprol } from "../../lib/gprol";
import { definicaoDe, rotuloCurto } from "../../lib/modalidades";
import type { ChaveServico } from "../../lib/modalidades";
import { FOTOS } from "../NovoServico";
import "./gprol.css";

const SETA = "M5 12h14M12 5l7 7-7 7";
const Seta = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={SETA} /></svg>
);

const local = (p: PedidoGprol) => [p.dados?.cliente_gprol, p.dados?.local, p.etapa ? `GPROL: ${p.etapa}` : null].filter(Boolean).join(" · ");

export function EscolherPedido({ chave, clienteId, onEscolher, children }: {
  chave: ChaveServico;
  clienteId?: string;
  onEscolher: (p: PedidoGprol) => void;
  children: ReactNode;
}) {
  const { pedidos } = usePedidosGprol(clienteId);
  const [candidatos, setCandidatos] = useState<PedidoGprol[] | null>(null);
  const [seguir, setSeguir] = useState(false);
  const [lista, setLista] = useState(false);

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

  const nome = rotuloCurto[chave];
  const titulo = definicaoDe(chave).titulo;
  // no meio da frase: "pedidos de serviço completo", "de CAR" (sigla fica)
  const naFrase = /^[A-Z]{2,}\b/.test(titulo) ? titulo : titulo.charAt(0).toLowerCase() + titulo.slice(1);
  const um = candidatos.length === 1 ? candidatos[0] : null;
  const foto = FOTOS[chave];

  return (
    <div className="pagina fade gpe">
      <div className="gpe-centro">
        <span className="gpe-olho">{titulo}</span>
        <h1>Este serviço é um pedido do GPROL?</h1>
        <p className="sub">
          {um ? "Há um pedido" : `Há ${candidatos.length} pedidos`} de {naFrase} vendido{um ? "" : "s"} no GPROL esperando execução.
        </p>
        <div className="gpe-cartoes">
          <button type="button" className="gpe-cartao gprol" onClick={() => (um ? onEscolher(um) : setLista(true))}>
            <span className="gpe-arte" aria-hidden="true">
              <span className="gpe-pedido-mock">
                <span className="gpe-mock-selo">GPROL</span>
                <i /><i /><i />
              </span>
              <span className="gpe-fluxo"><i /><i /><i /></span>
              <span className="gpe-vertces-mock">Vertces</span>
            </span>
            <span className="gpe-texto">
              <b>Sim, é um pedido do GPROL</b>
              <small>{um ? <>{um.titulo || um.nome_servico}{local(um) ? <> · {local(um)}</> : null}</> : `Escolher entre os ${candidatos.length} pedidos`}</small>
              <span className="gpe-acao">{um ? "Executar este pedido" : "Ver os pedidos"} <Seta /></span>
            </span>
          </button>
          <button type="button" className="gpe-cartao zero" onClick={() => setSeguir(true)}>
            <span className="gpe-arte foto" aria-hidden="true" style={foto ? { backgroundImage: `url(${foto})` } : undefined} />
            <span className="gpe-texto">
              <b>Começar do zero</b>
              <small>Abrir um serviço novo, sem ligar a pedido do GPROL.</small>
              <span className="gpe-acao">Começar <Seta /></span>
            </span>
          </button>
        </div>
      </div>
      {lista && <ModalPedidos candidatos={candidatos} nome={nome} onEscolher={onEscolher} onFechar={() => setLista(false)} onZero={() => setSeguir(true)} />}
    </div>
  );
}

const sem = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** A lista dos pedidos num modal, com busca por nome, cliente, município ou etapa. */
function ModalPedidos({ candidatos, nome, onEscolher, onFechar, onZero }: {
  candidatos: PedidoGprol[]; nome: string;
  onEscolher: (p: PedidoGprol) => void; onFechar: () => void; onZero: () => void;
}) {
  const [busca, setBusca] = useState("");
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    campo.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onFechar]);
  const termos = sem(busca).split(/\s+/).filter(Boolean);
  const achados = candidatos.filter((p) => {
    const texto = sem([p.titulo, p.nome_servico, local(p)].filter(Boolean).join(" "));
    return termos.every((t) => texto.includes(t));
  });
  return (
    <div className="dialogo-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="dialogo gpe-modal" role="dialog" aria-modal="true" aria-labelledby="gpe-modal-t">
        <div className="gpe-modal-topo">
          <div>
            <span className="gpe-olho">Pedidos do GPROL · {nome}</span>
            <h2 id="gpe-modal-t">Qual pedido você vai executar?</h2>
          </div>
          <button type="button" className="gpe-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        <label className="gpe-busca">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3" /></svg>
          <input ref={campo} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por imóvel, cliente, município ou etapa" aria-label="Buscar pedido" />
          {busca && <button type="button" className="link" onClick={() => setBusca("")}>limpar</button>}
        </label>
        <span className="gpe-conta">{achados.length === candidatos.length ? `${candidatos.length} pedidos esperando` : `${achados.length} de ${candidatos.length}`}</span>
        <ul className="gpe-lista">
          {achados.map((p) => (
            <li key={p.id}>
              <button type="button" className="gpe-item" onClick={() => onEscolher(p)}>
                <span className="gpe-item-tx"><b>{p.titulo || p.nome_servico}</b><small>{local(p)}</small></span>
                <span className="gpe-item-ir">Executar <Seta /></span>
              </button>
            </li>
          ))}
          {!achados.length && <li className="gpe-vazio">Nenhum pedido com “{busca}”.</li>}
        </ul>
        <div className="gpe-modal-rodape">
          <button type="button" className="link" onClick={onZero}>Nenhum destes: começar do zero</button>
        </div>
      </div>
    </div>
  );
}
