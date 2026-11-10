// Configurações → Convites (migração 0049): o link de cadastro para um cliente
// escolhido. Quem abre cria a conta, entra na hora sem pagar nada, e a
// mensalidade só começa a contar no dia em que gastar o 1º crédito.
//
// O convite é de uso único e vence (padrão 30 dias): o link público
// (/cadastro/?plano=…) continua cobrando no cadastro, e a condição só sai de um
// token gravado no banco, nunca de um parâmetro que qualquer um digita.
import { useCallback, useEffect, useState } from "react";
import { cancelarConvite, criarConvite, linkDoConvite, listarConvites } from "../../lib/admin";
import type { Convite } from "../../lib/admin";
import { fmtPreco } from "../../lib/creditos";
import type { DadosAdmin } from "./PainelAdmin";
import { confirmar, Dica, Rotulo } from "../ui";
import { copiar, fmtData } from "./comum";

const ROTULO: Record<Convite["situacao"], string> = { aberto: "Aberto", usado: "Usado", expirado: "Vencido", cancelado: "Cancelado" };
const CLASSE: Record<Convite["situacao"], string> = { aberto: "ativo", usado: "neutro", expirado: "suspenso", cancelado: "neutro" };

/** O texto que vai junto do link no WhatsApp. */
export function textoDoConvite(link: string, plano: string | null): string {
  return [
    `Segue o seu convite para o Vertces${plano ? ` (plano ${plano})` : ""}: ${link}`,
    "",
    "É só criar a conta pelo link e o acesso já fica liberado. Você não paga nada agora: a mensalidade só começa a contar no dia em que usar o primeiro crédito.",
  ].join("\n");
}

export function Convites({ d }: { d: DadosAdmin | null }) {
  const planos = (d?.planos ?? []).filter((p) => p.ativo && Number(p.preco_mensal ?? 0) > 0);
  const [lista, setLista] = useState<Convite[] | null>(null);
  const [plano, setPlano] = useState(planos[0]?.id ?? "");
  const [nome, setNome] = useState("");
  const [dias, setDias] = useState("30");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const carregar = useCallback(async () => { setLista(await listarConvites()); }, []);
  useEffect(() => { carregar().catch((x) => setErro(String(x instanceof Error ? x.message : x))); }, [carregar]);
  useEffect(() => { if (!plano && planos[0]) setPlano(planos[0].id); }, [planos, plano]);

  async function gerar(ev: React.FormEvent) {
    ev.preventDefault();
    const n = Math.floor(Number(dias));
    if (!plano) { setErro("Escolha o plano."); return; }
    if (!(n >= 1 && n <= 90)) { setErro("Validade: de 1 a 90 dias."); return; }
    setOcupado(true); setErro(null);
    try {
      const r = await criarConvite(plano, nome.trim(), n);
      setNovo(r.id);
      setNome("");
      await carregar();
    } catch (x) { setErro(String(x instanceof Error ? x.message : x)); }
    finally { setOcupado(false); }
  }

  async function copiarLink(c: Convite) {
    if (await copiar(linkDoConvite(c.token))) { setCopiado(c.id); setTimeout(() => setCopiado(null), 2500); }
  }

  const abertos = (lista ?? []).filter((c) => c.situacao === "aberto");
  const outros = (lista ?? []).filter((c) => c.situacao !== "aberto").slice(0, 10);

  return (
    <section className="sa-card">
      <header>
        <h3>Convites: cobrança a partir do 1º crédito<Dica>
          Para os clientes que vocês escolherem. O cliente abre o link, cria a conta e entra na hora, sem pagar nada (nem adesão).
          No dia em que gastar o primeiro crédito, a mensalidade começa: a assinatura nasce no Asaas vencendo nesse dia, o link vai no WhatsApp dele
          e os créditos passam a renovar no mesmo dia do mês. Cada link vale para uma conta só e vence. Para quem você cadastra à mão, use
          Empresas → Nova empresa → “Liberar agora; cobrar a partir do 1º crédito usado”.
        </Dica></h3>
        {abertos.length > 0 && <span className="sa-pill ativo" style={{ marginLeft: "auto" }}>{abertos.length} aberto{abertos.length > 1 ? "s" : ""}</span>}
      </header>
      {erro && <div className="sa-aviso erro">{erro}</div>}
      <form className="sa-campos" style={{ marginTop: 12 }} onSubmit={gerar}>
        <label>Plano
          <select value={plano} onChange={(e) => setPlano(e.target.value)}>
            {planos.map((p) => <option key={p.id} value={p.id}>{p.nome} · {fmtPreco(Number(p.preco_mensal))}/mês</option>)}
          </select>
        </label>
        <label><Rotulo dica="só para vocês lembrarem; o cliente não vê">Para quem</Rotulo>
          <input value={nome} maxLength={120} placeholder="Ex.: João — Geo Sertão" onChange={(e) => setNome(e.target.value)} />
        </label>
        <label><Rotulo dica="depois disso o link não abre mais; de 1 a 90">Vale por (dias)</Rotulo>
          <input type="number" min={1} max={90} value={dias} onChange={(e) => setDias(e.target.value)} />
        </label>
        <div className="sa-rodape-form" style={{ gridColumn: "1 / -1", marginTop: 0 }}>
          <button type="submit" className="principal" disabled={ocupado || !planos.length}>{ocupado ? "Gerando…" : "Gerar link de convite"}</button>
        </div>
      </form>
      {!planos.length && <p className="sub" style={{ margin: "6px 0 0" }}>Nenhum plano ativo com mensalidade: defina o preço em Planos.</p>}

      {lista === null ? <p className="sub">Carregando os convites…</p> : (
        <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
          {abertos.map((c) => {
            const link = linkDoConvite(c.token);
            return (
              <div key={c.id} className={`sa-fatura${c.id === novo ? " sa-convite-novo" : ""}`}>
                <span><b>{c.nome || c.plano}</b><small className="sub" style={{ display: "block", fontSize: 12 }}>{c.nome ? `${c.plano} · ` : ""}vence {fmtData(c.expira_em)}</small></span>
                <a href={link} target="_blank" rel="noreferrer">{link}</a>
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => copiarLink(c)}>{copiado === c.id ? "Copiado ✓" : "Copiar"}</button>
                  <button type="button" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(textoDoConvite(link, c.plano))}`, "_blank", "noopener")}>WhatsApp</button>
                  <button type="button" className="fantasma" onClick={async () => {
                    if (!(await confirmar({ titulo: "Cancelar o convite?", texto: "O link para de funcionar. Quem já criou a conta por ele não é afetado.", confirmar: "Cancelar convite", perigo: true }))) return;
                    try { await cancelarConvite(c.id); await carregar(); } catch (x) { setErro(String(x instanceof Error ? x.message : x)); }
                  }}>Cancelar</button>
                </span>
              </div>
            );
          })}
          {!abertos.length && <p className="sub" style={{ margin: 0 }}>Nenhum convite aberto.</p>}
          {outros.length > 0 && (
            <details>
              <summary className="sub">Convites usados, vencidos e cancelados ({outros.length})</summary>
              <div className="sa-tabela-wrap" style={{ marginTop: 8 }}>
                <table className="sa-tabela">
                  <thead><tr><th>Para quem</th><th>Plano</th><th>Situação</th><th>Empresa</th></tr></thead>
                  <tbody>
                    {outros.map((c) => (
                      <tr key={c.id}>
                        <td>{c.nome ?? "—"}<div className="sub" style={{ fontSize: 12 }}>criado {fmtData(c.criado_em)}</div></td>
                        <td>{c.plano ?? "—"}</td>
                        <td><span className={`sa-pill ${CLASSE[c.situacao]}`}>{ROTULO[c.situacao]}</span>
                          {c.usado_em && <div className="sub" style={{ fontSize: 12 }}>{fmtData(c.usado_em)}</div>}</td>
                        <td>{c.empresa ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
