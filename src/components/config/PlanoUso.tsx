// Configurações → Plano e uso: o que o plano da empresa inclui, a mensalidade,
// quanto já foi usado de cada carteira de crédito (e de usuários) e o caminho
// para comprar mais. Comprar créditos abre a mesma gaveta do Início
// (ComprarCreditos); mudar de plano e liberar recurso abrem um chamado no
// suporte já com o assunto.
import { useEffect, useMemo, useState } from "react";
import type { EstadoEscritorio } from "../../lib/escritorio";
import { aVenda, carregarCreditos, diaMes, fmtPreco } from "../../lib/creditos";
import type { Creditos } from "../../lib/creditos";
import { minhaCobranca, ROTULO_SITUACAO } from "../../lib/cobranca";
import type { MinhaCobranca } from "../../lib/cobranca";
import { faixasEmTexto } from "../../../supabase/functions/_shared/precos.ts";
import { dataBr } from "../../../supabase/functions/_shared/mensagens_cobranca.ts";
import { listarMembros, podeAdicionar } from "../../lib/equipe";
import { RECURSOS, temRecurso } from "../../lib/recursos";
import type { ChaveRecurso } from "../../lib/recursos";
import { temPermissao } from "../../lib/permissoes";
import { abrirSuporte } from "../suporte/SuporteChat";
import { ComprarCreditos } from "../Creditos";
import { Dica, Esqueleto } from "../ui";
import "./config.css";

const ok = "M20 6 9 17l-5-5";
const cadeado = "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z";
const Ico = ({ d }: { d: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

function Medidor({ usado, limite, rotulo, extra = 0 }: { usado: number; limite: number | null; rotulo: string; extra?: number }) {
  const pct = limite ? Math.min(100, (usado / limite) * 100) : 0;
  const tom = limite == null ? "livre" : pct >= 100 && !extra ? "cheio" : pct >= 80 && !extra ? "quase" : "";
  const sobra = limite == null ? null : Math.max(0, limite - usado);
  return (
    <div className={`pu-medidor ${tom}`}>
      <div className="pu-medidor-topo"><span>{rotulo}</span><b>{usado}{limite != null ? ` de ${limite}` : ""}</b></div>
      <div className="pu-trilho"><i style={{ width: limite == null ? "100%" : `${pct}%` }} /></div>
      <small>
        {limite == null ? "sem limite no plano" : sobra === 0 ? "os do mês acabaram" : `${sobra} disponível(is) no mês`}
        {extra > 0 && ` · + ${extra} extra${extra === 1 ? "" : "s"} (não vencem)`}
      </small>
    </div>
  );
}

export function PlanoUso({ escritorio }: { escritorio: EstadoEscritorio }) {
  const plano = escritorio.estado === "ok" ? escritorio.escritorio.plano : null;
  const empresa = escritorio.estado === "ok" ? escritorio.escritorio.nome : "";
  const [creditos, setCreditos] = useState<Creditos | null | undefined>(undefined);
  const [usuarios, setUsuarios] = useState<{ ativos: number; limite: number | null } | null>(null);
  // gaveta de compra de créditos (a mesma do Início); o pedido feito nela recarrega o uso
  const [comprando, setComprando] = useState(false);
  const [cobranca, setCobranca] = useState<MinhaCobranca | null>(null);
  const recarregarCreditos = () => carregarCreditos().then(setCreditos).catch(() => setCreditos(null));

  useEffect(() => {
    carregarCreditos().then(setCreditos).catch(() => setCreditos(null));
    minhaCobranca().then(setCobranca).catch(() => setCobranca(null));
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
  const venda = (creditos?.carteiras ?? []).filter(aVenda);

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

      {cobranca && cobranca.situacao !== "sem_assinatura" && (
        <section className="bloco">
          <header><h3>Mensalidade<Dica>cobrada pelo Asaas; dá para pagar por Pix, boleto ou cartão</Dica></h3></header>
          <div className="pu-mensalidade">
            <div><span>Valor</span><b>{cobranca.valor !== null ? fmtPreco(Number(cobranca.valor)) : "—"}</b></div>
            <div><span>Situação</span><b className={`pu-sit ${cobranca.situacao}`}>{ROTULO_SITUACAO[cobranca.situacao]}</b></div>
            {cobranca.vencimento && <div><span>{cobranca.situacao === "em_dia" ? "Próximo vencimento" : "Vencimento"}</span><b>{dataBr(cobranca.vencimento)}</b></div>}
            {cobranca.link && cobranca.situacao !== "em_dia" && cobranca.sou_dono && (
              <a className="botao-download principal" href={cobranca.link} target="_blank" rel="noreferrer">Pagar agora</a>
            )}
          </div>
        </section>
      )}

      <section className="bloco">
        <header>
          <h3>Créditos{creditos ? ` · renovam em ${diaMes(creditos.periodo.renova_em)}` : ""}<Dica>cada envio de arquivo de um serviço novo usa 1 crédito. O CAR usa os créditos de CAR e, quando eles acabam, pode usar um geral com o seu aceite. Os créditos do mês renovam no dia da renovação; os extras não vencem.</Dica></h3>
          {creditos?.sou_dono && venda.length > 0 && <button type="button" className="link" onClick={() => setComprando(true)}>Comprar créditos</button>}
        </header>
        {comprando && creditos && <ComprarCreditos creditos={creditos} onFechar={() => setComprando(false)} onPedido={recarregarCreditos} />}
        {creditos === undefined ? <Esqueleto linhas={2} rotulo="Carregando o uso do mês…" /> : (
          <div className="pu-medidores">
            {creditos?.carteiras.filter((k) => k.por_mes !== 0 || k.extra > 0).map((k) => (
              <Medidor key={k.chave} rotulo={k.nome} usado={k.usado} limite={k.por_mes} extra={k.extra} />
            ))}
            {usuarios && <Medidor rotulo="Usuários ativos" usado={usuarios.ativos} limite={usuarios.limite} />}
            {!creditos && !usuarios && <p className="sub">Sem limites de uso no plano.</p>}
          </div>
        )}
        {venda.length > 0 && (
          <div className="pu-precos">
            {venda.map((k) => (
              <div key={k.chave}>
                <b>{k.nome} extras</b>
                <span>{faixasEmTexto(k.precos).join(" · ")}</span>
              </div>
            ))}
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
