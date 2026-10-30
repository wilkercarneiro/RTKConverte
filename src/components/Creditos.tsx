// Créditos de serviço na tela da empresa: o aviso de crédito gasto, o bloqueio
// quando acaba, o aceite do crédito geral no CAR e a gaveta de compra (com Pix
// na própria gaveta quando o Asaas está ligado). Regras em lib/creditos.ts e no
// banco (0027 + 0034).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  aVenda, assinarAvisoCredito, avisoCreditoAtual, cancelarPedido, carteiraGeral, carteiraPropria, diaMes, disponivel,
  fecharAvisoCredito, fmtPreco, naoExibirMaisAvisoCredito, nomeCredito, pedirCreditos, sobraDoMes,
} from "../lib/creditos";
import type { Carteira, Compra, Creditos } from "../lib/creditos";
import { cancelarCompra, comprarCreditos, conferirPagamentos, pixDaCompra, rotuloPagamento } from "../lib/cobranca";
import type { Pix } from "../lib/cobranca";
import { COMPRA_MAXIMA, cotar, faixasEmTexto, minimoDe } from "../../supabase/functions/_shared/precos.ts";
import type { DefinicaoServico } from "../lib/modalidades";
import { temRecurso } from "../lib/recursos";
import type { ChaveRecurso } from "../lib/recursos";
import { confirmar, Gaveta } from "./ui";

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

/** A carteira que a compra abre primeiro para este serviço: a própria (se vende), senão a geral. */
function carteiraParaComprar(c: Creditos, chave?: string): string | undefined {
  const propria = chave ? carteiraPropria(c, chave as never) : undefined;
  if (propria && aVenda(propria)) return propria.chave;
  return c.carteiras.find((k) => k.servicos === null && aVenda(k))?.chave ?? c.carteiras.find(aVenda)?.chave;
}

/** Uma carteira em números: "4 de 6 do mês + 3 extras". */
function Saldo({ k }: { k: Carteira }) {
  const mes = sobraDoMes(k);
  return (
    <span className="cr-saldo">
      <b>{mes === null ? "sem limite" : `${mes} de ${k.por_mes}`}</b>{mes !== null && " do mês"}
      {k.extra > 0 && <> + <b>{k.extra}</b> extra{k.extra === 1 ? "" : "s"}</>}
    </span>
  );
}

/** No lugar do envio do arquivo, quando nada mais paga este serviço. */
export function SemCreditos({ def, creditos, onVoltar, onAtualizar, voltarPara = "o Início" }: {
  def: DefinicaoServico; creditos: Creditos; onVoltar: () => void; onAtualizar: () => void;
  /** "o cliente", "o Início"…: a tela de onde a pessoa veio */
  voltarPara?: string;
}) {
  const [comprando, setComprando] = useState(false);
  const propria = carteiraPropria(creditos, def.chave);
  const geral = carteiraGeral(creditos);
  // a geral só aparece no CAR se ela tem algo (no Só CAR ela é zero)
  const relevantes = [propria, geral].filter((k): k is Carteira =>
    !!k && (k === propria || !propria || k.por_mes === null || k.por_mes > 0 || k.extra > 0));
  const pendentes = creditos.compras.filter((p) => p.status === "pendente").length;
  const podeComprar = !!carteiraParaComprar(creditos, def.chave);
  return (
    <div className="centro">
      <div className="sem-credito">
        <span className="olho-pagina">Créditos</span>
        <h2>Os créditos para {def.titulo} acabaram</h2>
        <div className="cr-carteiras">
          {relevantes.map((k) => (
            <div key={k.chave} className="cr-carteira esgotada">
              <span>{k.nome}</span>
              <Saldo k={k} />
            </div>
          ))}
        </div>
        <p className="sub">
          Cada envio de arquivo usa um crédito. Os créditos do mês renovam em {diaMes(creditos.periodo.renova_em)}
          {podeComprar ? "; para continuar agora, compre mais créditos." : "."}
        </p>
        {pendentes > 0 && <p className="nota-permissao">{pendentes === 1 ? "Há 1 compra" : `Há ${pendentes} compras`} esperando pagamento.</p>}
        <div className="acoes-linha">
          <button onClick={onVoltar}>Voltar para {voltarPara}</button>
          {podeComprar && <button className="principal" onClick={() => setComprando(true)}>Comprar créditos</button>}
        </div>
      </div>
      {comprando && <ComprarCreditos creditos={creditos} tipo={carteiraParaComprar(creditos, def.chave)} onFechar={() => setComprando(false)} onPedido={onAtualizar} />}
    </div>
  );
}

/**
 * Os créditos próprios do serviço acabaram e só o geral paga: a pessoa decide.
 * "Avisar que vai ser usado ao cliente e se ele aceita" (pedido do Wilker, 0034).
 */
export function AceiteCreditoGeral({ def, creditos, onAceitar, onVoltar, onAtualizar, voltarPara = "o Início" }: {
  def: DefinicaoServico; creditos: Creditos; onAceitar: () => void; onVoltar: () => void; onAtualizar: () => void; voltarPara?: string;
}) {
  const [comprando, setComprando] = useState(false);
  const propria = carteiraPropria(creditos, def.chave);
  const geral = carteiraGeral(creditos);
  const resta = geral ? disponivel(geral) : null;
  const minimoPropria = propria && aVenda(propria) ? cotar(propria.precos, minimoDe(propria.precos)!) : null;
  return (
    <div className="centro">
      <div className="sem-credito cr-aceite">
        <span className="olho-pagina">Créditos</span>
        <h2>Seus {nomeCredito(propria)} acabaram</h2>
        <p>
          Este {def.titulo} pode usar <b>1 crédito geral</b>, se você aceitar.
          {resta === null ? " Seu plano não tem limite de créditos gerais." : ` Depois dele, ${resta - 1 === 1 ? "resta 1 crédito geral" : `restam ${Math.max(0, resta - 1)} créditos gerais`}.`}
        </p>
        <div className="cr-carteiras">
          {propria && <div className="cr-carteira esgotada"><span>{propria.nome}</span><Saldo k={propria} /></div>}
          {geral && <div className="cr-carteira"><span>{geral.nome}</span><Saldo k={geral} /></div>}
        </div>
        <div className="acoes-linha">
          <button onClick={onVoltar}>Voltar para {voltarPara}</button>
          {minimoPropria && creditos.sou_dono && (
            <button onClick={() => setComprando(true)}>Comprar {nomeCredito(propria)}</button>
          )}
          <button className="principal" onClick={onAceitar}>Usar 1 crédito geral</button>
        </div>
        {minimoPropria && (
          <p className="sub cr-nota">Os {nomeCredito(propria)} extras saem a partir de {fmtPreco(minimoPropria.unitario)} cada (mínimo de {minimoDe(propria!.precos)}).</p>
        )}
      </div>
      {comprando && <ComprarCreditos creditos={creditos} tipo={propria?.chave} onFechar={() => setComprando(false)} onPedido={onAtualizar} />}
    </div>
  );
}

/** Uma linha do Início: quanto sobra em cada carteira, e o atalho da compra. */
export function CreditosResumo({ creditos, onAtualizar }: { creditos: Creditos; onAtualizar: () => void }) {
  const [comprando, setComprando] = useState(false);
  const comLimite = creditos.carteiras.filter((k) => k.por_mes !== null && (k.por_mes > 0 || k.extra > 0 || k.usado > 0));
  const extras = creditos.carteiras.filter((k) => k.por_mes === null && k.extra > 0);
  // plano sem limite e sem extra: não há o que mostrar
  if (!comLimite.length && !extras.length) return null;
  // só conta o serviço que o plano libera (no Só CAR os outros não têm crédito, mas nem aparecem)
  const acabou = Object.entries(creditos.servicos).some(([k, x]) => !x.disponivel && temRecurso(k as ChaveRecurso));
  const pagando = creditos.compras.some((p) => p.status === "pendente" && p.origem === "compra");
  return (
    <>
      <div className={`creditos-resumo${acabou ? " alerta" : ""}`}>
        <span className="cr-linha">
          <b>Créditos</b>
          {[...comLimite, ...extras].map((k) => (
            <span key={k.chave} className="cr-pilula">
              {k.nome.replace(/^Créditos\s*/i, "").replace(/^./, (x) => x.toUpperCase())}: <Saldo k={k} />
            </span>
          ))}
          <span className="cr-renova">renovam em {diaMes(creditos.periodo.renova_em)}</span>
          {pagando && <span className="cr-renova">· compra esperando pagamento</span>}
        </span>
        {creditos.carteiras.some(aVenda) && <button type="button" className="link" onClick={() => setComprando(true)}>Comprar créditos</button>}
      </div>
      {/* fora da faixa: dentro dela a gaveta herdava a cor de alerta e a fonte menor */}
      {comprando && <ComprarCreditos creditos={creditos} onFechar={() => setComprando(false)} onPedido={onAtualizar} />}
    </>
  );
}

const ROTULO_STATUS = { pendente: "Aguardando", aprovado: "Liberado", recusado: "Recusado", cancelado: "Cancelado" } as const;

/** Compra em andamento: o Pix na tela e o pagamento conferido até confirmar. */
interface Pagando { credito_id: string; descricao: string; valor: number; link: string | null; pix: Pix | null }

export function ComprarCreditos({ creditos, tipo, onFechar, onPedido }: {
  creditos: Creditos; tipo?: string; onFechar: () => void; onPedido: () => void;
}) {
  const vendidas = creditos.carteiras.filter(aVenda);
  const [carteira, setCarteira] = useState(() => tipo && vendidas.some((k) => k.chave === tipo) ? tipo : vendidas[0]?.chave);
  const k = vendidas.find((x) => x.chave === carteira);
  const minimo = k ? minimoDe(k.precos) ?? 1 : 1;
  const [qtd, setQtd] = useState(() => String(minimo));
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pagando, setPagando] = useState<Pagando | null>(null);
  const [pago, setPago] = useState<string | null>(null);

  // trocar de carteira começa da compra mínima dela
  useEffect(() => { if (k) setQtd(String(minimoDe(k.precos) ?? 1)); }, [carteira]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = Math.floor(Number(qtd));
  const cot = k ? cotar(k.precos, n) : null;
  const erroQtd = !k ? null : !(n >= minimo) ? `A compra mínima é de ${minimo} créditos.` : n > COMPRA_MAXIMA ? `No máximo ${COMPRA_MAXIMA} por vez.` : null;
  const faixaAtual = k ? [...k.precos].sort((a, b) => b.a_partir_de - a.a_partir_de).find((f) => f.a_partir_de <= n) : undefined;
  const proxima = k ? [...k.precos].sort((a, b) => a.a_partir_de - b.a_partir_de).find((f) => f.a_partir_de > n) : undefined;

  // compra paga: a lista nova traz o status 'aprovado'
  const compraPaga = pagando && creditos.compras.find((c) => c.id === pagando.credito_id && c.status === "aprovado");
  useEffect(() => {
    if (compraPaga) { setPago(`${pagando!.descricao.replace(/^./, (x) => x.toUpperCase())} já estão na sua conta.`); setPagando(null); }
  }, [compraPaga]); // eslint-disable-line react-hooks/exhaustive-deps

  // enquanto o Pix está na tela, pergunta ao Asaas a cada 6 s (por 15 min)
  const inicio = useRef(0);
  useEffect(() => {
    if (!pagando) return;
    inicio.current = Date.now();
    const t = setInterval(async () => {
      if (Date.now() - inicio.current > 15 * 60_000) { clearInterval(t); return; }
      await conferirPagamentos().catch(() => null);
      onPedido();
    }, 6000);
    return () => clearInterval(t);
  }, [pagando?.credito_id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function comprar() {
    if (!k || erroQtd) return;
    setOcupado(true); setMsg(null); setPago(null);
    try {
      if (creditos.pagamento_online) {
        const r = await comprarCreditos(k.chave, n);
        setPagando({ credito_id: r.credito_id, descricao: r.descricao, valor: r.valor, link: r.link, pix: r.pix });
      } else {
        await pedirCreditos(k.chave, n);
        setMsg({ tipo: "ok", texto: "Pedido enviado. Os créditos entram assim que a equipe do Vertces confirmar o pagamento." });
      }
      onPedido();
    } catch (e) { setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) }); }
    finally { setOcupado(false); }
  }

  async function verPagamento(c: Compra) {
    setMsg(null);
    try {
      const r = await pixDaCompra(c.id);
      setPagando({ credito_id: c.id, descricao: c.descricao ?? `${c.quantidade} créditos`, valor: Number(c.valor ?? 0), link: r.link ?? c.link, pix: r.pix });
    } catch (e) { setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) }); }
  }

  async function cancelar(c: Compra) {
    if (!(await confirmar({ titulo: "Cancelar a compra?", texto: `${c.descricao ?? "A compra"} sai da lista${c.origem === "compra" ? " e a cobrança é cancelada" : ""}.`, confirmar: "Cancelar a compra", perigo: true }))) return;
    try {
      if (c.origem === "compra") {
        const r = await cancelarCompra(c.id);
        if (r.ja_paga) setPago("Essa compra acabou de ser paga: os créditos entraram.");
      } else await cancelarPedido(c.id);
      if (pagando?.credito_id === c.id) setPagando(null);
      onPedido();
    } catch (e) { setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) }); }
  }

  const compras = creditos.compras.filter((c) => c.origem !== "manual");

  return (
    <Gaveta olho="Créditos" titulo={pagando ? "Pagamento" : "Comprar créditos"} onFechar={onFechar}>
      <div className="compra-creditos">
        {msg && <div className={msg.tipo === "ok" ? "aviso-ok-pagina" : "aviso-erro-pagina"} role={msg.tipo === "erro" ? "alert" : "status"}>{msg.texto}</div>}
        {pago && <div className="cr-pago" role="status"><b>Pagamento confirmado ✓</b><span>{pago}</span></div>}

        {pagando ? (
          <PagamentoPix p={pagando} onVoltar={() => setPagando(null)} />
        ) : !creditos.sou_dono ? (
          <p className="nota-permissao">Só o dono da empresa compra créditos. Avise quem é o responsável pela conta.</p>
        ) : !vendidas.length ? (
          <p className="nota-permissao">O plano da sua empresa não tem créditos extras à venda. Fale com o suporte do Vertces.</p>
        ) : (
          <>
            {vendidas.length > 1 && (
              <div className="cr-escolha" role="radiogroup" aria-label="Que créditos comprar">
                {vendidas.map((x) => (
                  <button key={x.chave} type="button" role="radio" aria-checked={x.chave === carteira}
                    className={x.chave === carteira ? "ativo" : ""} onClick={() => setCarteira(x.chave)}>
                    <b>{x.nome}</b>
                    <small>{x.descricao}</small>
                    <small className="cr-tem">Você tem: {disponivel(x) === null ? "sem limite" : disponivel(x)}</small>
                  </button>
                ))}
              </div>
            )}
            {k && (
              <div className="cr-compra">
                <div className="cr-qtd">
                  <label htmlFor="cr-qtd">Quantos {nomeCredito(k)}?</label>
                  <div className="cr-passo">
                    <button type="button" aria-label="Menos um" disabled={n <= minimo} onClick={() => setQtd(String(Math.max(minimo, n - 1)))}>−</button>
                    <input id="cr-qtd" type="number" inputMode="numeric" min={minimo} max={COMPRA_MAXIMA} value={qtd} onChange={(e) => setQtd(e.target.value)} />
                    <button type="button" aria-label="Mais um" disabled={n >= COMPRA_MAXIMA} onClick={() => setQtd(String(Math.max(minimo, n + 1)))}>+</button>
                  </div>
                  {erroQtd && <span className="erro-campo">{erroQtd}</span>}
                </div>
                {k.precos.length > 1 ? (
                  <ul className="cr-faixas" aria-label="Preço por quantidade">
                    {faixasEmTexto(k.precos).map((t, i) => {
                      const f = [...k.precos].sort((a, b) => a.a_partir_de - b.a_partir_de)[i];
                      return (
                        <li key={t} className={f === faixaAtual ? "atual" : ""}>
                          <button type="button" className="link" onClick={() => setQtd(String(f.a_partir_de))}>{t}</button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="sub cr-unit">{fmtPreco(Number(k.precos[0].preco))} por crédito · mínimo de {minimo}</p>
                )}
                <div className="cr-total">
                  <span>Total</span>
                  <b>{cot ? fmtPreco(cot.total) : "—"}</b>
                  {cot && <small>{n} × {fmtPreco(cot.unitario)}</small>}
                  {proxima && cot && proxima.a_partir_de - n <= 5 && (
                    <small className="cr-dica">Com {proxima.a_partir_de} ou mais, cada um sai por {fmtPreco(Number(proxima.preco))}.</small>
                  )}
                </div>
                <button type="button" className="principal cr-pagar" disabled={ocupado || !!erroQtd || !cot} onClick={comprar}>
                  {ocupado ? "Gerando o pagamento…" : creditos.pagamento_online ? `Pagar ${cot ? fmtPreco(cot.total) : ""}` : "Pedir créditos"}
                </button>
                <p className="sub cr-nota">
                  {creditos.pagamento_online
                    ? "Pix, boleto ou cartão. Os créditos entram sozinhos quando o pagamento é confirmado e não vencem."
                    : "A equipe do Vertces confirma o pagamento e os créditos entram. Créditos extras não vencem."}
                </p>
              </div>
            )}
          </>
        )}

        {compras.length > 0 && !pagando && (
          <div className="pedidos-credito">
            <b>Suas compras</b>
            {compras.map((c) => (
              <div key={c.id} className="pedido">
                <span>{c.descricao ?? `${c.quantidade} créditos`}<small>{new Date(c.created_at).toLocaleDateString("pt-BR")} · {fmtPreco(c.valor)}</small></span>
                <span className={`chip st-${c.status}`}>{c.status === "pendente" && c.origem === "compra" ? rotuloPagamento(c.pagamento) : ROTULO_STATUS[c.status]}</span>
                {c.status === "pendente" && c.origem === "compra" && c.link && creditos.sou_dono && (
                  <button className="fantasma" onClick={() => verPagamento(c)}>Pagar</button>
                )}
                {c.status === "pendente" && creditos.sou_dono && <button className="fantasma" onClick={() => cancelar(c)}>Cancelar</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Gaveta>
  );
}

function PagamentoPix({ p, onVoltar }: { p: Pagando; onVoltar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const imagem = useMemo(() => (p.pix?.encodedImage ? `data:image/png;base64,${p.pix.encodedImage}` : null), [p.pix]);
  async function copiar() {
    if (!p.pix) return;
    try { await navigator.clipboard.writeText(p.pix.payload); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { /* sem permissão */ }
  }
  return (
    <div className="cr-pix">
      <div className="cr-pix-topo">
        <span>{p.descricao.replace(/^./, (x) => x.toUpperCase())}</span>
        <b>{fmtPreco(p.valor)}</b>
      </div>
      {imagem ? (
        <>
          <img src={imagem} alt="QR Code do Pix" width={208} height={208} />
          <button type="button" className="principal" onClick={copiar}>{copiado ? "Código copiado ✓" : "Copiar o Pix copia e cola"}</button>
        </>
      ) : (
        <p className="sub">O Pix não ficou pronto aqui. Abra a página de pagamento para pagar por Pix, boleto ou cartão.</p>
      )}
      {p.link && <a className="botao-download" href={p.link} target="_blank" rel="noreferrer">Abrir a página de pagamento (boleto ou cartão)</a>}
      <p className="cr-esperando" role="status"><span className="spinner" /> Esperando o pagamento. Os créditos entram sozinhos; pode fechar esta janela.</p>
      <button type="button" className="link" onClick={onVoltar}>← Voltar às compras</button>
    </div>
  );
}
