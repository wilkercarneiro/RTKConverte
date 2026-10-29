// Aba Créditos da empresa: o que foi negociado com ela.
//
//   - teto do mês, total e por serviço: "Plano" segue o plano; "Negociado"
//     troca o teto só para ela (vazio = sem teto)
//   - pacotes que ela pode comprar (nome, serviço, quantidade, preço)
//   - pedidos de compra (aprovar = o crédito passa a valer) e crédito avulso
//
// Regras no banco: supabase/migrations/0027_creditos.sql.
import { useCallback, useEffect, useState } from "react";
import {
  adicionarCreditos, creditosDaEmpresa, definirLimiteEmpresa, excluirPacote, resolverPedidoCredito, salvarPacote,
} from "../../lib/admin";
import type { CreditosEmpresa as Dados, Empresa, PacoteCredito } from "../../lib/admin";
import { fmtPreco, nomeDaChave } from "../../lib/creditos";
import { RECURSOS } from "../../lib/recursos";
import type { DadosAdmin } from "./PainelAdmin";
import { confirmar, Dica, Rotulo } from "../ui";
import { Carregando, Kpi, ICO, fmtData, fmtNum } from "./comum";

const ROTULO_STATUS = { pendente: "Aguardando", aprovado: "Aprovado", recusado: "Recusado", cancelado: "Cancelado" } as const;
const CLASSE_STATUS = { pendente: "suspenso", aprovado: "ativo", recusado: "cancelado", cancelado: "neutro" } as const;

export function CreditosEmpresa({ e, d }: { e: Empresa; d: DadosAdmin }) {
  const [c, setC] = useState<Dados | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const carregar = useCallback(() => creditosDaEmpresa(e.id).then(setC).catch((x) => setMsg({ tipo: "erro", texto: String(x.message ?? x) })), [e.id]);
  useEffect(() => { carregar(); }, [carregar]);

  async function agir(f: () => Promise<void>, ok?: string) {
    setMsg(null);
    try { await f(); await carregar(); if (ok) setMsg({ tipo: "ok", texto: ok }); }
    catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
  }

  if (!c) return msg ? <div className={`sa-aviso ${msg.tipo}`}>{msg.texto}</div> : <Carregando />;

  // os serviços que a empresa enxerga (os bloqueados não precisam de teto)
  const servicos = d.recursos.filter((r) => r.ativo && r.chave.startsWith("servico.") && c.servicos[r.chave]);
  const extras = c.total.extra + Object.values(c.servicos).reduce((s, x) => s + x.extra, 0);
  const pendentes = c.extras.filter((x) => x.status === "pendente");
  const mes = new Date(`${c.mes}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="sa-grade">
      {msg && <div className={`sa-aviso ${msg.tipo}`}>{msg.texto}</div>}

      <div className="sa-kpis">
        <Kpi rotulo={`Serviços em ${mes}`} valor={c.total.limite === null ? fmtNum(c.total.usado) : `${c.total.usado} / ${c.total.limite}`}
          icone={ICO.servicos} tom="escuro" detalhe={c.total.limite === null ? "sem teto mensal" : "usados / teto do mês"} />
        <Kpi rotulo="Créditos extras" valor={fmtNum(extras)} icone={ICO.planos} detalhe="comprados e ainda não usados" />
        <Kpi rotulo="Pedidos aguardando" valor={fmtNum(pendentes.length)} icone={ICO.contatos} />
      </div>

      <section className="sa-card">
        <header><h3>Teto do mês<Dica>“Plano” segue o plano da empresa. “Negociado” vale só para ela. Campo vazio = sem limite. O crédito é gasto quando o arquivo é enviado; apagar o serviço não devolve.</Dica></h3></header>
        <div className="sa-tabela-wrap">
          <table className="sa-tabela">
            <thead><tr><th>Serviço</th><th>No plano</th><th>Para esta empresa</th><th>Usados no mês</th><th>Extras</th></tr></thead>
            <tbody>
              <LinhaLimite chave="total" nome="Total (todos os serviços)" doPlano={c.plano?.total ?? null} c={c}
                salvar={(lim, seguir) => agir(() => definirLimiteEmpresa(e.id, "total", lim, seguir))} />
              {servicos.map((r) => (
                <LinhaLimite key={r.chave} chave={r.chave} nome={r.nome} doPlano={c.plano?.servicos[r.chave] ?? null} c={c}
                  salvar={(lim, seguir) => agir(() => definirLimiteEmpresa(e.id, r.chave, lim, seguir))} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Pacotes e={e} pacotes={c.pacotes} agir={agir} />

      <section className="sa-card">
        <header><h3>Pedidos e créditos extras<Dica>o pedido do cliente só vale depois de aprovado; combine o pagamento antes de aprovar</Dica></h3></header>
        <AdicionarCreditos onAdicionar={(chave, qtd, desc, preco) => agir(() => adicionarCreditos(e.id, chave, qtd, desc, preco), `${qtd} crédito(s) adicionado(s).`)} />
        {c.extras.length === 0 ? <div className="sa-vazio">Nenhum pedido ou crédito extra ainda.</div> : (
          <div className="sa-tabela-wrap">
            <table className="sa-tabela">
              <thead><tr><th>Quando</th><th>O quê</th><th>Valor</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {c.extras.map((x) => (
                  <tr key={x.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtData(x.created_at)}<div className="sub" style={{ fontSize: 12 }}>{x.origem === "manual" ? "dado pelo painel" : x.quem ?? "pedido"}</div></td>
                    <td><b>{x.quantidade} · {nomeDaChave(x.chave)}</b><div className="sub" style={{ fontSize: 12 }}>{x.descricao}{x.observacao ? ` — ${x.observacao}` : ""}</div></td>
                    <td>{fmtPreco(x.preco)}</td>
                    <td><span className={`sa-pill ${CLASSE_STATUS[x.status]}`}>{ROTULO_STATUS[x.status]}</span></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {x.status === "pendente" && <>
                        <button type="button" className="principal" onClick={() => agir(() => resolverPedidoCredito(x.id, true), "Pedido aprovado: os créditos já valem.")}>Aprovar</button>{" "}
                        <button type="button" className="fantasma" onClick={async () => {
                          if (await confirmar({ titulo: "Recusar o pedido?", texto: "A empresa vê o pedido como recusado.", confirmar: "Recusar", perigo: true })) {
                            await agir(() => resolverPedidoCredito(x.id, false), "Pedido recusado.");
                          }
                        }}>Recusar</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {c.historico.length > 0 && (
        <section className="sa-card">
          <header><h3>Créditos usados por mês</h3></header>
          <div className="sa-barras">
            {c.historico.map((h) => (
              <div className="sa-barra" key={h.mes}>
                <span>{new Date(`${h.mes}T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}</span>
                <span className="trilho"><i style={{ width: `${(h.total / Math.max(1, ...c.historico.map((x) => x.total))) * 100}%` }} /></span>
                <b>{h.total}</b>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function LinhaLimite({ chave, nome, doPlano, c, salvar }: {
  chave: string; nome: string; doPlano: number | null; c: Dados;
  salvar: (limite: number | null, seguirPlano: boolean) => Promise<void>;
}) {
  const negociado = chave in c.negociado;
  const [valor, setValor] = useState<string>(negociado ? String(c.negociado[chave] ?? "") : "");
  useEffect(() => { setValor(negociado ? String(c.negociado[chave] ?? "") : ""); }, [negociado, c.negociado, chave]);
  const s = chave === "total" ? c.total : c.servicos[chave];
  const gravar = () => salvar(valor === "" ? null : Math.max(0, Math.floor(Number(valor))), false);
  return (
    <tr>
      <td><b>{nome}</b></td>
      <td>{doPlano === null ? "sem limite" : `${doPlano}/mês`}</td>
      <td>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="sa-tri" role="group" aria-label={`Teto de ${nome}`}>
            <button type="button" className={!negociado ? "on" : ""} onClick={() => negociado && salvar(null, true)}>Plano</button>
            <button type="button" className={negociado ? "on lib" : ""} onClick={() => !negociado && salvar(doPlano, false)}>Negociado</button>
          </div>
          {negociado && (
            <input type="number" min={0} placeholder="sem limite" value={valor} style={{ width: 110 }}
              aria-label={`Teto negociado de ${nome}`}
              onChange={(x) => setValor(x.target.value)} onBlur={gravar}
              onKeyDown={(x) => { if (x.key === "Enter") { x.preventDefault(); gravar(); } }} />
          )}
        </div>
      </td>
      <td>{s ? (s.limite === null ? s.usado : `${s.usado} / ${s.limite}`) : "—"}</td>
      <td>{s?.extra ? s.extra : "—"}</td>
    </tr>
  );
}

function Pacotes({ e, pacotes, agir }: { e: Empresa; pacotes: PacoteCredito[]; agir: (f: () => Promise<void>, ok?: string) => Promise<void> }) {
  const vazio = { nome: "", chave: "total", quantidade: "10", preco: "" };
  const [f, setF] = useState<{ id?: string } & typeof vazio>(vazio);
  const servicos = useServicosDoCatalogo();

  async function gravar(ev: React.FormEvent) {
    ev.preventDefault();
    await agir(() => salvarPacote({
      id: f.id, escritorio_id: e.id, nome: f.nome, chave: f.chave, quantidade: Math.max(1, Number(f.quantidade)),
      preco: f.preco === "" ? null : Number(f.preco.replace(",", ".")),
    }), f.id ? "Pacote atualizado." : "Pacote criado. A empresa já vê na tela de compra.");
    setF(vazio);
  }

  return (
    <section className="sa-card">
      <header><h3>Pacotes desta empresa<Dica>o que aparece para ela em “Comprar mais créditos”. Sem pacote, ela pede uma quantidade e o valor é combinado.</Dica></h3></header>
      {pacotes.length > 0 && (
        <div className="sa-tabela-wrap" style={{ marginBottom: 14 }}>
          <table className="sa-tabela">
            <thead><tr><th>Pacote</th><th>Serviço</th><th>Créditos</th><th>Preço</th><th /></tr></thead>
            <tbody>
              {pacotes.map((p) => (
                <tr key={p.id} style={p.ativo ? undefined : { opacity: 0.55 }}>
                  <td><b>{p.nome}</b>{!p.ativo && <span className="sa-pill neutro" style={{ marginLeft: 6 }}>oculto</span>}</td>
                  <td>{nomeDaChave(p.chave)}</td>
                  <td>{p.quantidade}</td>
                  <td>{fmtPreco(p.preco)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button type="button" onClick={() => setF({ id: p.id, nome: p.nome, chave: p.chave, quantidade: String(p.quantidade), preco: p.preco === null ? "" : String(p.preco) })}>Editar</button>{" "}
                    <button type="button" onClick={() => agir(() => salvarPacote({ ...p, ativo: !p.ativo }))}>{p.ativo ? "Ocultar" : "Mostrar"}</button>{" "}
                    <button type="button" className="fantasma" onClick={async () => {
                      if (await confirmar({ titulo: `Excluir ${p.nome}?`, texto: "Pedidos já feitos com ele continuam no histórico.", confirmar: "Excluir", perigo: true })) await agir(() => excluirPacote(p.id));
                    }}>Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form onSubmit={gravar} className="sa-campos" style={{ alignItems: "end" }}>
        <label>Nome do pacote<input value={f.nome} onChange={(x) => setF({ ...f, nome: x.target.value })} placeholder="Ex.: 10 serviços extras" required /></label>
        <label>Serviço
          <select value={f.chave} onChange={(x) => setF({ ...f, chave: x.target.value })}>
            <option value="total">Qualquer serviço</option>
            {servicos.map((r) => <option key={r.chave} value={r.chave}>{r.nome}</option>)}
          </select>
        </label>
        <label>Créditos<input type="number" min={1} value={f.quantidade} onChange={(x) => setF({ ...f, quantidade: x.target.value })} required /></label>
        <label><Rotulo dica="vazio = a combinar">Preço (R$)</Rotulo><input inputMode="decimal" value={f.preco} onChange={(x) => setF({ ...f, preco: x.target.value })} placeholder="a combinar" /></label>
        <div className="sa-rodape-form" style={{ gridColumn: "1 / -1", marginTop: 0 }}>
          {f.id && <button type="button" onClick={() => setF(vazio)}>Cancelar edição</button>}
          <button type="submit" className="principal">{f.id ? "Salvar pacote" : "Criar pacote"}</button>
        </div>
      </form>
    </section>
  );
}

function AdicionarCreditos({ onAdicionar }: { onAdicionar: (chave: string, qtd: number, descricao: string, preco: number | null) => Promise<void> }) {
  const [f, setF] = useState({ chave: "total", quantidade: "", descricao: "", preco: "" });
  const servicos = useServicosDoCatalogo();
  return (
    <form className="sa-campos" style={{ alignItems: "end", marginBottom: 14 }} onSubmit={async (ev) => {
      ev.preventDefault();
      await onAdicionar(f.chave, Math.max(1, Number(f.quantidade)), f.descricao, f.preco === "" ? null : Number(f.preco.replace(",", ".")));
      setF({ chave: "total", quantidade: "", descricao: "", preco: "" });
    }}>
      <label>Adicionar créditos
        <select value={f.chave} onChange={(x) => setF({ ...f, chave: x.target.value })}>
          <option value="total">Qualquer serviço</option>
          {servicos.map((r) => <option key={r.chave} value={r.chave}>{r.nome}</option>)}
        </select>
      </label>
      <label>Quantidade<input type="number" min={1} value={f.quantidade} onChange={(x) => setF({ ...f, quantidade: x.target.value })} required /></label>
      <label>Motivo<input value={f.descricao} onChange={(x) => setF({ ...f, descricao: x.target.value })} placeholder="Cortesia, venda por fora…" /></label>
      <label><Rotulo dica="opcional, só para registro">Valor (R$)</Rotulo><input inputMode="decimal" value={f.preco} onChange={(x) => setF({ ...f, preco: x.target.value })} /></label>
      <div className="sa-rodape-form" style={{ gridColumn: "1 / -1", marginTop: 0 }}>
        <button type="submit" disabled={!(Number(f.quantidade) > 0)}>Adicionar créditos</button>
      </div>
    </form>
  );
}

const SERVICOS = RECURSOS.filter((r) => r.chave.startsWith("servico."));
const useServicosDoCatalogo = () => SERVICOS;
