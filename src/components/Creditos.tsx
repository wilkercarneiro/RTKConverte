// Créditos de serviço na tela da empresa: o aviso de crédito gasto, o bloqueio
// quando acaba e a gaveta de compra. Regras em lib/creditos.ts (e no banco, 0027).
import { useState, useSyncExternalStore } from "react";
import {
  assinarAvisoCredito, avisoCreditoAtual, cancelarPedido, fecharAvisoCredito, fmtPreco, naoExibirMaisAvisoCredito,
  nomeDaChave, pedirCreditos, restantes,
} from "../lib/creditos";
import type { Creditos } from "../lib/creditos";
import type { ChaveServico, DefinicaoServico } from "../lib/modalidades";
import { RECURSOS } from "../lib/recursos";
import { Gaveta } from "./ui";

/** Montar UMA vez (AppShell). Fica até a pessoa fechar. */
export function AvisoCreditoGlobal() {
  const aviso = useSyncExternalStore(assinarAvisoCredito, avisoCreditoAtual, avisoCreditoAtual);
  if (!aviso) return null;
  return (
    <div className="aviso-credito" role="status" aria-live="polite" key={aviso.id}>
      <span className="ac-icone" aria-hidden="true">◎</span>
      <div className="ac-corpo">
        <b>Crédito usado</b>
        <span>{aviso.texto}</span>
        <button type="button" className="link" onClick={naoExibirMaisAvisoCredito}>Não exibir mais esse aviso</button>
      </div>
      <button type="button" className="fantasma ac-x" onClick={fecharAvisoCredito} aria-label="Fechar aviso">✕</button>
    </div>
  );
}

/** No lugar do envio do arquivo, quando o serviço não tem mais crédito no mês. */
export function SemCreditos({ def, creditos, onVoltar, onAtualizar }: {
  def: DefinicaoServico; creditos: Creditos; onVoltar: () => void; onAtualizar: () => void;
}) {
  const [comprando, setComprando] = useState(false);
  const s = creditos.servicos[`servico.${def.chave}`];
  const pendentes = creditos.pedidos.filter((p) => p.status === "pendente").length;
  return (
    <div className="centro">
      <div className="sem-credito">
        <span className="olho-pagina">Créditos do mês</span>
        <h2>Os créditos de {def.titulo} acabaram</h2>
        <p className="sub">
          {s?.limite !== null && s?.limite !== undefined ? `O plano da empresa inclui ${s.limite} por mês e todos já foram usados. ` : ""}
          {creditos.total.limite !== null ? `No total, ${creditos.total.usado} de ${creditos.total.limite} serviços do mês foram usados. ` : ""}
          Cada envio de arquivo usa um crédito. Para continuar agora, compre mais créditos.
        </p>
        {pendentes > 0 && <p className="nota-permissao">{pendentes === 1 ? "Há 1 pedido" : `Há ${pendentes} pedidos`} de créditos esperando confirmação.</p>}
        <div className="acoes-linha">
          <button onClick={onVoltar}>Voltar ao início</button>
          <button className="principal" onClick={() => setComprando(true)}>Comprar mais créditos</button>
        </div>
      </div>
      {comprando && <ComprarCreditos creditos={creditos} chave={def.chave} onFechar={() => setComprando(false)} onPedido={onAtualizar} />}
    </div>
  );
}

/** Uma linha do Início: quanto sobra no mês, e o atalho da compra. */
export function CreditosResumo({ creditos, onAtualizar }: { creditos: Creditos; onAtualizar: () => void }) {
  const [comprando, setComprando] = useState(false);
  const { limite, usado, extra } = creditos.total;
  const extras = extra + Object.values(creditos.servicos).reduce((s, x) => s + x.extra, 0);
  const acabou = Object.values(creditos.servicos).some((x) => !x.disponivel);
  // plano sem teto, sem extra e nada acabando: não há o que mostrar
  if (limite === null && extras === 0 && !acabou && !Object.values(creditos.servicos).some((x) => x.limite !== null)) return null;
  return (
    <div className={`creditos-resumo${acabou ? " alerta" : ""}`}>
      <span>
        <b>Créditos do mês:</b>{" "}
        {limite !== null ? `${usado} de ${limite} usados` : `${usado} usados`}
        {extras > 0 && ` · ${extras} extra${extras === 1 ? "" : "s"}`}
        {acabou && " · algum serviço chegou ao limite"}
      </span>
      <button type="button" className="link" onClick={() => setComprando(true)}>Comprar mais créditos</button>
      {comprando && <ComprarCreditos creditos={creditos} onFechar={() => setComprando(false)} onPedido={onAtualizar} />}
    </div>
  );
}

const SERVICOS_CHAVES = RECURSOS.filter((r) => r.chave.startsWith("servico."));

export function ComprarCreditos({ creditos, chave, onFechar, onPedido }: {
  creditos: Creditos; chave?: ChaveServico; onFechar: () => void; onPedido: () => void;
}) {
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [livre, setLivre] = useState({ chave: chave ? `servico.${chave}` : "total", quantidade: "10", observacao: "" });

  // os pacotes que servem a este serviço primeiro
  const pacotes = [...creditos.pacotes].sort((a, b) =>
    Number(chave ? b.chave === `servico.${chave}` : 0) - Number(chave ? a.chave === `servico.${chave}` : 0));

  async function pedir(p: Parameters<typeof pedirCreditos>[0]) {
    setOcupado(true); setMsg(null);
    try {
      await pedirCreditos(p);
      setMsg({ tipo: "ok", texto: "Pedido enviado. Os créditos entram assim que o pagamento for confirmado pela equipe do Vertces." });
      onPedido();
    } catch (e) { setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) }); }
    finally { setOcupado(false); }
  }

  async function cancelar(id: string) {
    try { await cancelarPedido(id); onPedido(); }
    catch (e) { setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) }); }
  }

  return (
    <Gaveta olho="Créditos de serviço" titulo="Comprar mais créditos" onFechar={onFechar}>
      <div className="compra-creditos">
        {chave && (() => {
          const r = restantes(creditos, chave);
          return <p className="sub">{r === null ? "Este serviço não tem limite mensal." : `Restam ${r} crédito(s) para ${nomeDaChave(`servico.${chave}`)}.`}</p>;
        })()}
        {msg && <div className={msg.tipo === "ok" ? "aviso-ok-pagina" : "aviso-erro-pagina"} role={msg.tipo === "erro" ? "alert" : "status"}>{msg.texto}</div>}

        {!creditos.sou_dono ? (
          <p className="nota-permissao">Só o dono da empresa compra créditos. Avise quem é o responsável pela conta.</p>
        ) : (
          <>
            {pacotes.length > 0 && (
              <div className="pacotes">
                {pacotes.map((p) => (
                  <div key={p.id} className="pacote">
                    <div>
                      <b>{p.nome}</b>
                      <span className="sub">{p.quantidade} crédito(s) · {nomeDaChave(p.chave)}</span>
                    </div>
                    <span className="preco">{fmtPreco(p.preco)}</span>
                    <button className="principal" disabled={ocupado} onClick={() => pedir({ pacote: p.id })}>Comprar</button>
                  </div>
                ))}
              </div>
            )}

            <form className="pedido-livre" onSubmit={(e) => { e.preventDefault(); pedir({ chave: livre.chave, quantidade: Number(livre.quantidade), observacao: livre.observacao }); }}>
              <b>{pacotes.length ? "Outra quantidade" : "Quantos créditos você precisa?"}</b>
              <div className="pl-campos">
                <label>Serviço
                  <select value={livre.chave} onChange={(e) => setLivre({ ...livre, chave: e.target.value })}>
                    <option value="total">Qualquer serviço</option>
                    {SERVICOS_CHAVES.map((r) => <option key={r.chave} value={r.chave}>{r.nome}</option>)}
                  </select>
                </label>
                <label>Quantidade
                  <input type="number" min={1} max={10000} value={livre.quantidade} onChange={(e) => setLivre({ ...livre, quantidade: e.target.value })} required />
                </label>
              </div>
              <label>Observação (opcional)
                <input value={livre.observacao} onChange={(e) => setLivre({ ...livre, observacao: e.target.value })} placeholder="Ex.: preciso para esta semana" />
              </label>
              <p className="sub">O valor é combinado com a equipe do Vertces.</p>
              <button type="submit" disabled={ocupado || !(Number(livre.quantidade) > 0)}>Pedir créditos</button>
            </form>
          </>
        )}

        {creditos.pedidos.length > 0 && (
          <div className="pedidos-credito">
            <b>Seus pedidos</b>
            {creditos.pedidos.map((p) => (
              <div key={p.id} className="pedido">
                <span>{p.quantidade} · {nomeDaChave(p.chave)}<small>{new Date(p.created_at).toLocaleDateString("pt-BR")}</small></span>
                <span className={`chip st-${p.status}`}>{ROTULO_STATUS[p.status]}</span>
                {p.status === "pendente" && creditos.sou_dono && <button className="fantasma" onClick={() => cancelar(p.id)}>Cancelar</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Gaveta>
  );
}

const ROTULO_STATUS = { pendente: "Aguardando", aprovado: "Liberado", recusado: "Recusado", cancelado: "Cancelado" } as const;
