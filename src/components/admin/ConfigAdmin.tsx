// Configurações do painel: a senha padrão das contas novas, os pagamentos
// (Asaas) e o WhatsApp que manda as cobranças (Evolution API).
//
// As chaves vão para a edge function `cobranca`, que guarda numa tabela que
// ninguém lê pelo navegador: aqui só aparece o final da chave. Ao salvar a do
// Asaas, a função testa a chave e cria (ou religa) o webhook sozinha.
import { useEffect, useState } from "react";
import { lerSenhaPadrao, salvarSenhaPadrao } from "../../lib/admin";
import { salvarPagamentos, statusPagamentos, testarWhatsApp, urlWebhook } from "../../lib/cobranca";
import type { StatusPagamentos } from "../../lib/cobranca";
import { fmtPreco } from "../../lib/creditos";
import { problemaDaSenha } from "../../../supabase/functions/_shared/cnpj.ts";
import { Carregando, quando, Topo } from "./comum";
import { confirmar, Dica, Rotulo } from "../ui";

type Msg = { tipo: "ok" | "erro"; texto: string } | null;

export function ConfigAdmin() {
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
        <Pagamentos />
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

function Pagamentos() {
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
      <WhatsApp st={st} onSalvo={setSt} />
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

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!a.configurado && !chave.trim()) { setMsg({ tipo: "erro", texto: "Cole a chave da API do Asaas." }); return; }
    setOcupado(true); setMsg(null);
    try {
      onSalvo(await salvarPagamentos({ asaas_chave: chave.trim() || undefined, asaas_ambiente: ambiente, religar_webhook: !!w?.interrompido }));
      setChave("");
      setMsg({ tipo: "ok", texto: "Chave testada e salva. O webhook do Vertces está configurado no Asaas." });
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
        <div className="sa-cobranca">
          <div><span>Chave</span><b className="mono">…{a.chave_final}</b></div>
          <div><span>Saldo no Asaas</span><b>{a.saldo == null ? "—" : fmtPreco(a.saldo)}</b></div>
          <div><span>Webhook</span><b>{!w ? "não criado" : w.erro ? "erro" : w.interrompido ? "fila interrompida" : w.ativo ? "ativo" : "desligado"}</b></div>
          <div><span>Último aviso recebido</span><b>{st.ultimo_evento ? quando(st.ultimo_evento.recebido_em) : "nenhum ainda"}</b>
            {st.ultimo_evento && <small className="sub">{st.ultimo_evento.evento}{st.ultimo_evento.resultado ? ` · ${st.ultimo_evento.resultado}` : ""}</small>}</div>
        </div>
      )}
      {a.erro && <div className="sa-aviso erro" style={{ marginTop: 12 }}>{a.erro}</div>}
      {w && (w.interrompido || w.erro || (w.penalizados ?? 0) > 0) && (
        <div className="sa-aviso erro" style={{ marginTop: 12 }}>
          {w.erro ?? (w.interrompido ? "O Asaas interrompeu a fila do webhook (falhas seguidas). Clique em “Religar o webhook”; as cobranças pendentes também são conferidas quando a empresa abre a tela de pagamento." : `${w.penalizados} aviso(s) do Asaas falharam recentemente.`)}
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
        <button type="submit" className="principal" disabled={ocupado || (a.configurado && !mudou && !w?.interrompido)}>
          {ocupado ? "Testando…" : a.configurado ? (w?.interrompido && !mudou ? "Religar o webhook" : "Salvar e testar") : "Ligar os pagamentos"}
        </button>
      </div>
    </form>
  );
}

function WhatsApp({ st, onSalvo }: { st: StatusPagamentos; onSalvo: (s: StatusPagamentos) => void }) {
  const z = st.whatsapp;
  const [f, setF] = useState({ url: z.url ?? "", instancia: z.instancia ?? "", chave: "", url_app: st.url_app });
  const [tel, setTel] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [ocupado, setOcupado] = useState(false);
  const conectado = z.estado === "open";

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    setOcupado(true); setMsg(null);
    try {
      onSalvo(await salvarPagamentos({
        whatsapp_url: f.url, whatsapp_instancia: f.instancia, whatsapp_chave: f.chave || undefined, url_app: f.url_app,
      }));
      setF({ ...f, chave: "" });
      setMsg({ tipo: "ok", texto: "WhatsApp salvo." });
    } catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
    finally { setOcupado(false); }
  }

  async function testar() {
    setOcupado(true); setMsg(null);
    try { await testarWhatsApp(tel); setMsg({ tipo: "ok", texto: "Mensagem de teste enviada." }); }
    catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
    finally { setOcupado(false); }
  }

  return (
    <form className="sa-card" onSubmit={salvar}>
      <header>
        <h3>WhatsApp das cobranças<Dica>A Evolution API manda o link de pagamento da empresa nova, o aviso de acesso liberado e a confirmação de créditos comprados. Sem ela, o painel mostra a mensagem pronta para você mandar.</Dica></h3>
        <span className={`sa-pill ${!z.configurado ? "neutro" : conectado ? "ativo" : "cancelado"}`} style={{ marginLeft: "auto" }}>
          {!z.configurado ? "Não configurado" : conectado ? "Conectado" : z.estado ? `Instância: ${z.estado}` : "Sem resposta"}
        </span>
      </header>
      {msg && <div className={`sa-aviso ${msg.tipo}`}>{msg.texto}</div>}
      {z.configurado && !conectado && <div className="sa-aviso erro">A instância não está conectada ao WhatsApp: leia o QR Code na Evolution e salve de novo.</div>}
      <div className="sa-campos">
        <label>Endereço da Evolution API<input className="mono" placeholder="https://evolution.seudominio.com.br" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></label>
        <label>Instância<input placeholder="vertces" value={f.instancia} onChange={(e) => setF({ ...f, instancia: e.target.value })} /></label>
        <label><Rotulo dica="só é enviada ao servidor">Chave (apikey) {z.configurado ? "(para trocar)" : ""}</Rotulo>
          <input type="password" autoComplete="off" className="mono" value={f.chave} onChange={(e) => setF({ ...f, chave: e.target.value })} />
        </label>
        <label><Rotulo dica="o endereço que vai nas mensagens para a empresa entrar">Endereço do sistema</Rotulo>
          <input className="mono" value={f.url_app} onChange={(e) => setF({ ...f, url_app: e.target.value })} />
        </label>
      </div>
      <div className="sa-rodape-form">
        {z.configurado && (
          <span className="sa-teste-zap">
            <input inputMode="tel" placeholder="(71) 99999-0000" value={tel} onChange={(e) => setTel(e.target.value)} aria-label="Telefone para o teste" />
            <button type="button" disabled={ocupado || tel.replace(/\D/g, "").length < 10} onClick={testar}>Enviar teste</button>
          </span>
        )}
        <button type="submit" className="principal" disabled={ocupado || !f.url || !f.instancia || (!z.configurado && !f.chave)}>{ocupado ? "Salvando…" : "Salvar"}</button>
      </div>
    </form>
  );
}
