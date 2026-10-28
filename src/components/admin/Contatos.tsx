// Pedidos de reunião vindos da página pública. O fechamento é por reunião:
// aqui o contato anda de "novo" até "fechado" e vira empresa no cadastro.
import { useMemo, useState } from "react";
import { mudarStatusContato } from "../../lib/admin";
import type { Contato } from "../../lib/admin";
import { soDigitos } from "../../../supabase/functions/_shared/cnpj.ts";
import type { DadosAdmin } from "./PainelAdmin";
import { Topo, fmtTel, quando } from "./comum";

const ETAPAS: { s: Contato["status"]; rot: string }[] = [
  { s: "novo", rot: "Novos" }, { s: "em_contato", rot: "Em contato" }, { s: "reuniao", rot: "Reunião marcada" },
  { s: "fechado", rot: "Fechados" }, { s: "descartado", rot: "Descartados" },
];

export function Contatos({ d }: { d: DadosAdmin }) {
  const [etapa, setEtapa] = useState<Contato["status"]>("novo");
  const [erro, setErro] = useState<string | null>(null);
  const lista = useMemo(() => d.contatos.filter((c) => c.status === etapa), [d.contatos, etapa]);

  async function mover(c: Contato, s: Contato["status"]) {
    setErro(null);
    try { await mudarStatusContato(c.id, s); await d.recarregar(); }
    catch (e) { setErro(String(e instanceof Error ? e.message : e)); }
  }

  return (
    <>
      <Topo olho="Clientes" titulo="Pedidos de reunião" sub="Quem pediu uma demonstração pela página do Vértice." />
      {erro && <div className="sa-aviso erro">{erro}</div>}
      <div className="sa-filtros">
        <div className="sa-segmento" role="group" aria-label="Etapa">
          {ETAPAS.map((x) => (
            <button key={x.s} type="button" className={etapa === x.s ? "ativo" : ""} onClick={() => setEtapa(x.s)}>
              {x.rot}<span className="n">{d.contatos.filter((c) => c.status === x.s).length}</span>
            </button>
          ))}
        </div>
      </div>
      <section className="sa-card" style={{ padding: "14px 10px" }}>
        <div className="sa-tabela-wrap">
          <table className="sa-tabela">
            <thead><tr><th>Contato</th><th>Empresa</th><th>Mensagem</th><th>Recebido</th><th>Etapa</th></tr></thead>
            <tbody>
              {lista.map((c) => {
                const tel = soDigitos(c.telefone);
                return (
                  <tr key={c.id}>
                    <td>
                      <b>{c.nome}</b>
                      <div style={{ fontSize: 12.5 }}>
                        <a href={`https://wa.me/${tel.length <= 11 ? "55" : ""}${tel}`} target="_blank" rel="noreferrer">{fmtTel(c.telefone)}</a>
                        {c.email && <> · <a href={`mailto:${c.email}`}>{c.email}</a></>}
                      </div>
                    </td>
                    <td>{c.empresa ?? "—"}<div className="sub" style={{ fontSize: 12 }}>{c.cidade_uf ?? ""}</div></td>
                    <td style={{ maxWidth: 340, whiteSpace: "pre-wrap" }}>{c.mensagem ?? <span className="sub">—</span>}</td>
                    <td>{quando(c.created_at)}</td>
                    <td>
                      <select value={c.status} onChange={(e) => mover(c, e.target.value as Contato["status"])} aria-label={`Etapa de ${c.nome}`}>
                        {ETAPAS.map((x) => <option key={x.s} value={x.s}>{x.rot}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
              {lista.length === 0 && <tr><td colSpan={5} className="sa-vazio">Nenhum contato nesta etapa.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
