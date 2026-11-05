// Configurações do painel: a senha padrão das contas novas, os pagamentos
// (Asaas) e o WhatsApp que manda as cobranças (Evolution API).
//
// As chaves vão para a edge function `cobranca`, que guarda numa tabela que
// ninguém lê pelo navegador: aqui só aparece o final da chave. Ao salvar a do
// Asaas, a função testa a chave e cria (ou religa) o webhook sozinha.
import { useEffect, useState } from "react";
import { lerSenhaPadrao, salvarSenhaPadrao } from "../../lib/admin";
import { estadoWhatsApp, qrcodeWhatsApp, salvarPagamentos, statusPagamentos, urlWebhook } from "../../lib/cobranca";
import type { StatusPagamentos } from "../../lib/cobranca";
import { fmtPreco } from "../../lib/creditos";
import { problemaDaSenha } from "../../../supabase/functions/_shared/cnpj.ts";
import { Carregando, quando, Topo } from "./comum";
import { confirmar, Dica, Rotulo } from "../ui";
import { Autocadastro } from "./Autocadastro";
import type { DadosAdmin } from "./PainelAdmin";

type Msg = { tipo: "ok" | "erro"; texto: string } | null;

export function ConfigAdmin({ d = null }: { d?: DadosAdmin | null }) {
  const [senha, setSenha] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => { lerSenhaPadrao().then(setSenha).catch((e) => setMsg({ tipo: "erro", texto: String(e.message ?? e) })); }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const p = problemaDaSenha(senha);
    if (p) { setMsg({ tipo: "erro", texto: p }); return; }
    try { await salvarSenhaPadrao(senha); setMsg({ tipo: "ok", texto: "Senha padrão salva. Vale para as próximas contas criadas." }); }
    catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
  }

  return (
    <>
      <Topo olho="Sistema" titulo="Configurações" />
      <div className="sa-config">
        <Pagamentos d={d} />
        <form className="sa-card" onSubmit={salvar}>
          <header><h3>Senha padrão das contas novas<Dica>
            Toda empresa e todo usuário cadastrados aqui entram com esta senha e o sistema pede uma senha própria no primeiro acesso.
            Ela também é a senha usada em “Redefinir senha”.
          </Dica></h3></header>
          {msg && <div className={`sa-aviso ${msg.tipo}`}>{msg.texto}</div>}
          <div className="sa-campos">
            <label>Senha padrão<input className="mono" value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
          </div>
          <div className="sa-rodape-form"><button type="submit" className="principal">Salvar</button></div>
        </form>
      </div>
    </>
  );
}

function Pagamentos({ d }: { d: DadosAdmin | null }) {
  const [st, setSt] = useState<StatusPagamentos | null | undefined>(undefined);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  useEffect(() => {
    statusPagamentos().then((s) => { setSt(s); setErroLeitura(null); })
      .catch((e) => { setSt(null); setErroLeitura(e instanceof Error ? e.message : String(e)); });
  }, []);

  if (st === undefined) return <section className="sa-card"><header><h3>Pagamentos e WhatsApp</h3></header><Carregando texto="Consultando o Asaas e o WhatsApp…" /></section>;
  if (st === null) {
    return (
      <section className="sa-card">
        <header><h3>Pagamentos e WhatsApp</h3></header>
        <div className="sa-aviso erro">Não foi possível falar com a função de cobrança ({erroLeitura}). Ela precisa estar publicada no servidor (edge function <code>cobranca</code>).</div>
      </section>
    );
  }
  return (
    <>
      <Asaas st={st} onSalvo={setSt} />
      <Autocadastro st={st} d={d} onSalvo={(a) => setSt({ ...st, autocadastro: a })} />
      <WhatsApp st={st} />
    </>
  );
}

function Asaas({ st, onSalvo }: { st: StatusPagamentos; onSalvo: (s: StatusPagamentos) => void }) {
  const a = st.asaas;
  const [ambiente, setAmbiente] = useState<"sandbox" | "producao">(a.ambiente ?? "sandbox");
  const [chave, setChave] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [ocupado, setOcupado] = useState(false);
  const w = a.webhook;
  const mudou = !!chave.trim() || (a.configurado && ambiente !== a.ambiente);
  // a lista de eventos mudou (0040: análise de risco do cartão): religar manda a lista nova ao Asaas
  const desatualizado = (w?.faltando ?? 0) > 0;

  async function salvar(ev: React.SyntheticEvent, religar = false) {
    ev.preventDefault();
    if (!a.configurado && !chave.trim()) { setMsg({ tipo: "erro", texto: "Cole a chave da API do Asaas." }); return; }
    setOcupado(true); setMsg(null);
    try {
      onSalvo(await salvarPagamentos({ asaas_chave: chave.trim() || undefined, asaas_ambiente: ambiente, religar_webhook: religar || !!w?.interrompido || desatualizado }));
      setChave("");
      setMsg({ tipo: "ok", texto: "Chave testada e salva. O webhook do Vertces está configurado no Asaas (com todos os eventos)." });
    } catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
    finally { setOcupado(false); }
  }

  async function desligar() {
    if (!(await confirmar({ titulo: "Desligar os pagamentos online?", texto: "As compras de crédito voltam a ser pedidos que você aprova, e o cadastro de empresa deixa de gerar cobrança. As cobranças já emitidas continuam no Asaas.", confirmar: "Desligar", perigo: true }))) return;
    setOcupado(true);
    try { onSalvo(await salvarPagamentos({ remover_asaas: true })); setMsg({ tipo: "ok", texto: "Pagamentos online desligados." }); }
    catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
    finally { setOcupado(false); }
  }

  return (
    <form className="sa-card" onSubmit={salvar}>
      <header>
        <h3>Pagamentos (Asaas)<Dica>A chave fica em Asaas → Integrações → Chave de API. Ao salvar, o Vertces testa a chave e cria sozinho o webhook que avisa os pagamentos.</Dica></h3>
        <span className={`sa-pill ${a.configurado && !a.erro ? "ativo" : a.configurado ? "cancelado" : "neutro"}`} style={{ marginLeft: "auto" }}>
          {!a.configurado ? "Desligado" : a.erro ? "Com erro" : a.ambiente === "producao" ? "Ligado · produção" : "Ligado · sandbox (teste)"}
        </span>
      </header>
      {msg && <div className={`sa-aviso ${msg.tipo}`}>{msg.texto}</div>}
      {a.configurado && (
        <div className="sa-cobranca" data-grade>
          <div><span>Chave</span><b className="mono">…{a.chave_final}</b></div>
          <div><span>Saldo no Asaas</span><b>{a.saldo == null ? "—" : fmtPreco(a.saldo)}</b></div>
          <div><span>Webhook</span><b>{!w ? "não criado" : w.erro ? "erro" : w.interrompido ? "fila interrompida" : w.ativo ? "ativo" : "desligado"}</b></div>
          <div><span>Último aviso recebido</span><b>{st.ultimo_evento ? quando(st.ultimo_evento.recebido_em) : "nenhum ainda"}</b>
            {st.ultimo_evento && <small className="sub">{st.ultimo_evento.evento}{st.ultimo_evento.resultado ? ` · ${st.ultimo_evento.resultado}` : ""}</small>}</div>
          <div><span>Cartão salvo (tokenização)</span><b>{a.tokenizacao === "liberada" ? "liberada" : a.tokenizacao === "bloqueada" ? "não liberada" : "—"}</b></div>
        </div>
      )}
      {a.configurado && a.tokenizacao === "bloqueada" && (
        <div className="sa-aviso info" style={{ marginTop: 12 }}>
          A conta do Asaas ainda não guarda cartões. O cartão que o cliente cadastra paga a mensalidade, mas a compra de créditos no cartão
          (na hora e a automática) fica desligada. Peça ao gerente de contas do Asaas a liberação da <b>tokenização de cartão de crédito</b>;
          liberada, este aviso some sozinho e quem cadastrar o cartão de novo passa a ter a compra automática.
        </div>
      )}
      {a.erro && <div className="sa-aviso erro" style={{ marginTop: 12 }}>{a.erro}</div>}
      {w && (w.interrompido || w.erro || (w.penalizados ?? 0) > 0) && (
        <div className="sa-aviso erro" style={{ marginTop: 12 }}>
          {w.erro ?? (w.interrompido ? "O Asaas interrompeu a fila do webhook (falhas seguidas). Clique em “Religar o webhook”; as cobranças pendentes também são conferidas quando a empresa abre a tela de pagamento." : `${w.penalizados} aviso(s) do Asaas falharam recentemente.`)}
        </div>
      )}
      {desatualizado && !w?.interrompido && (
        <div className="sa-aviso info" style={{ marginTop: 12 }}>
          O webhook ainda não recebe {w!.faltando} aviso(s) novo(s) do Asaas (análise de risco e recusa do cartão). Clique em “Religar o webhook”.
        </div>
      )}
      <div className="sa-campos" style={{ marginTop: 14 }}>
        <label>Ambiente
          <select value={ambiente} onChange={(e) => setAmbiente(e.target.value as "sandbox" | "producao")}>
            <option value="sandbox">Sandbox (teste, sem dinheiro de verdade)</option>
            <option value="producao">Produção</option>
          </select>
        </label>
        <label><Rotulo dica="só é enviada ao servidor; aqui aparece só o final">Chave da API {a.configurado ? "(para trocar)" : ""}</Rotulo>
          <input type="password" autoComplete="off" className="mono" placeholder={a.configurado ? `…${a.chave_final}` : "$aact_…"} value={chave} onChange={(e) => setChave(e.target.value)} />
        </label>
        <label className="largo"><Rotulo dica="é para onde o Asaas manda os avisos de pagamento; configurado sozinho">Webhook</Rotulo>
          <input className="mono" readOnly value={urlWebhook()} />
        </label>
      </div>
      <div className="sa-rodape-form">
        {a.configurado && <button type="button" className="fantasma" style={{ marginRight: "auto" }} disabled={ocupado} onClick={desligar}>Desligar</button>}
        {a.configurado && !mudou && !w?.interrompido && !desatualizado && (
          <button type="button" disabled={ocupado} onClick={(ev) => salvar(ev, true)}>Religar o webhook</button>
        )}
        <button type="submit" className="principal" disabled={ocupado || (a.configurado && !mudou && !w?.interrompido && !desatualizado)}>
          {ocupado ? "Testando…" : a.configurado ? ((w?.interrompido || desatualizado) && !mudou ? "Religar o webhook" : "Salvar e testar") : "Ligar os pagamentos"}
        </button>
      </div>
    </form>
  );
}

/**
 * O número que manda as cobranças: a instância da Evolution já está configurada
 * no servidor; aqui só se lê o QR Code no celular. Enquanto o QR está na tela,
 * pergunta o estado a cada 3 s e troca o QR a cada 30 s (ele expira).
 */
function WhatsApp({ st }: { st: StatusPagamentos }) {
  const [estado, setEstado] = useState<string | null | undefined>(st.whatsapp.estado);
  const [qr, setQr] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [ocupado, setOcupado] = useState(false);
  const conectado = estado === "open";

  async function gerar() {
    setOcupado(true); setMsg(null);
    try {
      const r = await qrcodeWhatsApp();
      setEstado(r.estado);
      if (r.qrcode) setQr(r.qrcode);
      else { setQr(null); setMsg({ tipo: "ok", texto: "O WhatsApp das cobranças já está conectado." }); }
    } catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
    finally { setOcupado(false); }
  }

  useEffect(() => {
    if (!qr) return;
    const t = setInterval(async () => {
      const r = await estadoWhatsApp().catch(() => null);
      if (!r) return;
      setEstado(r.estado);
      if (r.estado === "open") { setQr(null); setMsg({ tipo: "ok", texto: "WhatsApp conectado. As cobranças já saem por este número." }); }
    }, 3000);
    const renovar = setInterval(() => { qrcodeWhatsApp().then((r) => r.qrcode && setQr(r.qrcode)).catch(() => null); }, 30_000);
    return () => { clearInterval(t); clearInterval(renovar); };
  }, [!!qr]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="sa-card">
      <header>
        <h3>WhatsApp das cobranças<Dica>Manda o link de pagamento da empresa nova, o aviso de acesso liberado, o de mensalidade vencida e a confirmação de créditos comprados.</Dica></h3>
        <span className={`sa-pill ${!st.whatsapp.configurado ? "neutro" : conectado ? "ativo" : "cancelado"}`} style={{ marginLeft: "auto" }}>
          {!st.whatsapp.configurado ? "Não configurado" : conectado ? "Conectado" : "Desconectado"}
        </span>
      </header>
      {msg && <div className={`sa-aviso ${msg.tipo}`}>{msg.texto}</div>}
      {qr && (
        <div className="sa-qr">
          <img src={qr} alt="QR Code do WhatsApp" width={240} height={240} />
          <p>No celular: WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> e aponte para o código.</p>
        </div>
      )}
      <div className="sa-rodape-form">
        <button type="button" className="principal" disabled={ocupado} onClick={gerar}>
          {ocupado ? "Gerando…" : qr ? "Gerar outro QR Code" : "QR Code"}
        </button>
      </div>
    </section>
  );
}
