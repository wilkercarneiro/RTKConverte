// Configurações → Plano e uso: o que o plano da empresa inclui, quanto já foi
// usado no mês (créditos e usuários) e o caminho para pedir mais. Tudo que é
// "pedir" abre um chamado no suporte já com o assunto escrito.
import { useEffect, useMemo, useState } from "react";
import type { EstadoEscritorio } from "../../lib/escritorio";
import { carregarCreditos, nomeDaChave } from "../../lib/creditos";
import type { Creditos } from "../../lib/creditos";
import { listarMembros, podeAdicionar } from "../../lib/equipe";
import { RECURSOS, temRecurso } from "../../lib/recursos";
import type { ChaveRecurso } from "../../lib/recursos";
import { temPermissao } from "../../lib/permissoes";
import { abrirSuporte } from "../suporte/SuporteChat";
import { Dica, Esqueleto } from "../ui";
import "./config.css";

const ok = "M20 6 9 17l-5-5";
const cadeado = "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z";
const Ico = ({ d }: { d: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

function Medidor({ usado, limite, rotulo }: { usado: number; limite: number | null; rotulo: string }) {
  const pct = limite ? Math.min(100, (usado / limite) * 100) : 0;
  const tom = limite == null ? "livre" : pct >= 100 ? "cheio" : pct >= 80 ? "quase" : "";
  return (
    <div className={`pu-medidor ${tom}`}>
      <div className="pu-medidor-topo"><span>{rotulo}</span><b>{usado}{limite != null ? ` de ${limite}` : ""}</b></div>
      <div className="pu-trilho"><i style={{ width: limite == null ? "100%" : `${pct}%` }} /></div>
      <small>{limite == null ? "sem limite no plano" : pct >= 100 ? "esgotado este mês" : `${limite - usado} disponível(is)`}</small>
    </div>
  );
}

export function PlanoUso({ escritorio }: { escritorio: EstadoEscritorio }) {
  const plano = escritorio.estado === "ok" ? escritorio.escritorio.plano : null;
  const empresa = escritorio.estado === "ok" ? escritorio.escritorio.nome : "";
  const [creditos, setCreditos] = useState<Creditos | null | undefined>(undefined);
  const [usuarios, setUsuarios] = useState<{ ativos: number; limite: number | null } | null>(null);

  useEffect(() => {
    carregarCreditos().then(setCreditos).catch(() => setCreditos(null));
    (temPermissao("equipe.gerenciar")
      ? podeAdicionar().then((p) => ({ ativos: p.ativos ?? 0, limite: p.limite ?? null }))
      : listarMembros().then((m) => ({ ativos: m.filter((x) => x.ativo).length, limite: null }))
    ).then(setUsuarios).catch(() => setUsuarios(null));
  }, []);

  const grupos = useMemo(() => {
    const g = new Map<string, typeof RECURSOS>();
    for (const r of RECURSOS) g.set(r.grupo, [...(g.get(r.grupo) ?? []), r]);
    return [...g];
  }, []);
  const incluidos = RECURSOS.filter((r) => temRecurso(r.chave as ChaveRecurso)).length;
  const mes = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const pedir = (assunto: string) => abrirSuporte({ novo: true, categoria: "financeiro", assunto });

  return (
    <>
      <section className="pu-heroi">
        <div>
          <span className="pu-olho">Plano da empresa</span>
          <h2>{plano ?? "Plano padrão"}</h2>
          <p>{empresa} · {incluidos} de {RECURSOS.length} recursos incluídos</p>
        </div>
        <button type="button" className="pu-cta" onClick={() => pedir(`Quero mudar o plano da ${empresa || "empresa"}`)}>Mudar de plano</button>
      </section>

      <section className="bloco">
        <header>
          <h3>Uso em {mes}<Dica>os créditos são gastos ao enviar o arquivo de um serviço novo; voltam a zero no dia 1º</Dica></h3>
          {creditos?.sou_dono && <button type="button" className="link" onClick={() => pedir("Quero comprar créditos extras de serviço")}>Comprar créditos extras</button>}
        </header>
        {creditos === undefined ? <Esqueleto linhas={2} rotulo="Carregando o uso do mês…" /> : (
          <div className="pu-medidores">
            {creditos && <Medidor rotulo="Serviços no mês (total)" usado={creditos.total.usado} limite={creditos.total.limite} />}
            {creditos && Object.entries(creditos.servicos).map(([chave, s]) => (
              <Medidor key={chave} rotulo={nomeDaChave(chave)} usado={s.usado} limite={s.limite} />
            ))}
            {usuarios && <Medidor rotulo="Usuários ativos" usado={usuarios.ativos} limite={usuarios.limite} />}
            {!creditos && !usuarios && <p className="sub">Sem limites de uso no plano.</p>}
          </div>
        )}
      </section>

      <section className="bloco">
        <header><h3>O que o plano inclui<Dica>recursos fora do plano podem ser liberados: peça ao suporte</Dica></h3></header>
        <div className="pu-grupos">
          {grupos.map(([grupo, rs]) => (
            <div key={grupo} className="pu-grupo">
              <h4>{grupo}</h4>
              <ul>
                {rs.map((r) => {
                  const tem = temRecurso(r.chave as ChaveRecurso);
                  return (
                    <li key={r.chave} className={tem ? "tem" : "nao"}>
                      <span className="pu-icone"><Ico d={tem ? ok : cadeado} /></span>
                      <span className="pu-nome" title={r.descricao}>{r.nome}</span>
                      {!tem && <button type="button" className="link" onClick={() => pedir(`Quero liberar: ${r.nome}`)}>Pedir</button>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
