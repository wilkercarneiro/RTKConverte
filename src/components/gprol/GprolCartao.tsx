// GPROL no Início. Conectado: uma faixa discreta com o estado do sincronismo.
// Desconectado: um convite com o que a empresa ganha ligando os dois sistemas,
// o botão de conectar (para quem configura a empresa) e o caminho para quem
// ainda não usa o GPROL. "Agora não" esconde o convite por 14 dias.
import { useEffect, useState } from "react";
import { gprol, useIntegracaoGprol } from "../../lib/gprol";
import { temPermissao } from "../../lib/permissoes";
import { temRecurso } from "../../lib/recursos";
import { guardar, lembrar } from "../../lib/ux";
import { quandoFoi } from "../Auditoria";
import { abrirSuporte } from "../suporte/SuporteChat";
import { avisar } from "../ui";
import "./gprol.css";

/** Planos e cadastro de empresa no GPROL. */
export const GPROL_PLANOS = "https://gprol.com.br/planos";
const ADIADO = "gprol.convite.adiado";

const BENEFICIOS = [
  { t: "Venda vira serviço sozinha", d: "O que o comercial fecha no GPROL chega aqui como “A executar”, com cliente, imóvel e município." },
  { t: "O funil anda sozinho", d: "Importou o TXT, gerou os documentos, entregou: o card avança no GPROL sem ninguém arrastar." },
  { t: "Documentos no CRM", d: "Memorial, planta e peças abrem direto no GPROL, sem baixar nem reenviar por WhatsApp." },
  { t: "Um cadastro de cliente", d: "Clientes com CPF/CNPJ ficam iguais nos dois; corrigiu num lado, corrige no outro." },
];

const I = {
  ok: "M20 6 9 17l-5-5",
  sinc: "M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5",
  seta: "M5 12h14M12 5l7 7-7 7",
  fechar: "M18 6 6 18M6 6l12 12",
};
const Ico = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

export function GprolCartao({ onConfigurar }: { onConfigurar: () => void }) {
  const { integracao, carregando } = useIntegracaoGprol();
  const [adiado, setAdiado] = useState(() => Number(lembrar(ADIADO) ?? 0) > Date.now());
  const [ocupado, setOcupado] = useState(false);
  const [pedidos, setPedidos] = useState<number | null>(null);
  const conectado = integracao?.status === "ativa";

  useEffect(() => {
    if (!conectado) return;
    let vivo = true;
    import("../../lib/supabase").then(({ supabase }) =>
      supabase.from("pedidos_externos").select("id", { count: "exact", head: true }).in("status", ["pendente", "em_execucao"])
        .then(({ count }) => { if (vivo) setPedidos(count ?? 0); }));
    return () => { vivo = false; };
  }, [conectado, integracao?.ultima_sincronizacao]);

  if (carregando) return null;

  if (conectado) {
    const i = integracao!;
    return (
      <div className={`gpc-faixa${i.ultimo_erro ? " alerta" : ""}`} role="status">
        <span className="gpc-pulso" aria-hidden="true"><i /></span>
        <span className="gpc-faixa-tx">
          <b>Conectado ao GPROL</b>
          {i.empresa_externa_nome && <span>{i.empresa_externa_nome}</span>}
          <span>{i.ultimo_erro ? "última sincronização com problema" : i.ultima_sincronizacao ? `sincronizado ${quandoFoi(i.ultima_sincronizacao)}` : "aguardando a primeira sincronização"}</span>
          {pedidos != null && pedidos > 0 && <span>{pedidos} {pedidos === 1 ? "pedido a executar" : "pedidos a executar"}</span>}
        </span>
        <button type="button" className="link" onClick={onConfigurar}>Ver integração</button>
      </div>
    );
  }

  if (adiado) return null;
  const liberado = temRecurso("integracao.gprol");
  const podeConectar = temPermissao("empresa.configurar");

  async function conectar() {
    setOcupado(true);
    try {
      const { url } = await gprol<{ url: string }>("conectar_iniciar");
      location.href = url;
    } catch (e) {
      avisar("erro", (e as Error).message);
      setOcupado(false);
    }
  }
  function agoraNao() {
    guardar(ADIADO, String(Date.now() + 14 * 86_400_000));
    setAdiado(true);
  }

  return (
    <section className="gpc" aria-labelledby="gpc-titulo">
      <button type="button" className="gpc-fechar" onClick={agoraNao} aria-label="Agora não" title="Agora não (volta em 14 dias)"><Ico d={I.fechar} /></button>
      <div className="gpc-texto">
        <span className="gpc-olho">Integração · GPROL</span>
        <h2 id="gpc-titulo">Do contrato à entrega, sem digitar nada duas vezes.</h2>
        <p>Conecte o Vertces ao GPROL, o CRM feito para escritórios de georreferenciamento, e o comercial, o técnico e o financeiro passam a olhar para o mesmo serviço.</p>
        <ul className="gpc-beneficios">
          {BENEFICIOS.map((b) => (
            <li key={b.t}><span className="gpc-check"><Ico d={I.ok} size={13} /></span><span><b>{b.t}</b><small>{b.d}</small></span></li>
          ))}
        </ul>
        <div className="gpc-acoes">
          {!liberado ? (
            <button type="button" className="gpc-principal" onClick={() => abrirSuporte({ novo: true, categoria: "financeiro", assunto: "Quero liberar a integração com o GPROL" })}>
              Liberar a integração no meu plano <Ico d={I.seta} />
            </button>
          ) : podeConectar ? (
            <button type="button" className="gpc-principal" onClick={conectar} disabled={ocupado}>
              {ocupado ? "Abrindo o GPROL…" : "Conectar ao GPROL"} <Ico d={I.seta} />
            </button>
          ) : (
            <span className="gpc-nota">Peça a quem administra a empresa (permissão “Dados da empresa”) para conectar.</span>
          )}
          <a className="gpc-secundario" href={GPROL_PLANOS} target="_blank" rel="noreferrer">Ainda não usa o GPROL? Conheça os planos</a>
        </div>
      </div>
      <div className="gpc-diagrama" aria-hidden="true">
        <div className="gpc-no vertces"><b>Vertces</b><small>TXT · planta · memorial</small></div>
        <div className="gpc-fluxo">
          <span className="gpc-seta ida"><i /><i /><i /></span>
          <span className="gpc-sinc"><Ico d={I.sinc} size={18} /></span>
          <span className="gpc-seta volta"><i /><i /><i /></span>
        </div>
        <div className="gpc-no gprol"><b>GPROL</b><small>funil · cliente · financeiro</small></div>
        <ul className="gpc-eventos">
          <li><i className="v" />Pedido “Georreferenciamento” chegou</li>
          <li><i className="a" />TXT importado · card avançou</li>
          <li><i className="g" />Memorial e planta no CRM</li>
        </ul>
      </div>
    </section>
  );
}
