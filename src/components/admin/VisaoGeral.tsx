// Visão geral do SaaS: quantas empresas, quanto usam, quem precisa de atenção.
import { useEffect, useState } from "react";
import { pedidosPendentes, serieServicos, usoModalidades } from "../../lib/admin";
import type { PedidoPendente } from "../../lib/admin";
import { fmtPreco } from "../../lib/creditos";
import { recursoDe } from "../../lib/recursos";
import type { DadosAdmin } from "./PainelAdmin";
import { Dica } from "../ui";
import { Carregando, ICO, Kpi, PlanoTag, Topo, fmtNum, iniciais, quando, semUso } from "./comum";

export function VisaoGeral({ d }: { d: DadosAdmin }) {
  const [serie, setSerie] = useState<{ dia: string; total: number }[] | null>(null);
  const [uso, setUso] = useState<{ chave: string; total: number }[] | null>(null);
  const [pedidos, setPedidos] = useState<PedidoPendente[]>([]);

  useEffect(() => {
    serieServicos(30).then(setSerie).catch(() => setSerie([]));
    usoModalidades(null, 30).then(setUso).catch(() => setUso([]));
    pedidosPendentes().then(setPedidos);
  }, []);

  const ativas = d.empresas.filter((e) => e.status === "ativo");
  const suspensas = d.empresas.filter((e) => e.status === "suspenso").length;
  const usuarios = d.empresas.reduce((s, e) => s + e.usuarios, 0);
  const serv30 = d.empresas.reduce((s, e) => s + e.servicos_30d, 0);
  const paradas = ativas.filter(semUso);
  const novosContatos = d.contatos.filter((c) => c.status === "novo").length;
  const porPlano = [
    ...d.planos.map((p) => ({ id: p.id as string | null, nome: p.nome, cor: p.cor, n: ativas.filter((e) => e.plano_id === p.id).length })),
    { id: null, nome: "Sem plano", cor: "#B9C4BE", n: ativas.filter((e) => !e.plano_id).length },
  ].filter((x) => x.n > 0 || x.id);
  const maxPlano = Math.max(1, ...porPlano.map((p) => p.n));
  const recentes = [...d.empresas].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);
  // sem o Asaas, alguém aprova; com ele, a compra só espera o pagamento (não pede ação)
  const aprovar = pedidos.filter((p) => p.origem === "pedido");
  const nomeTipo = (t: string) => d.tipos.find((x) => x.chave === t)?.nome ?? t;
  // cobrança que pede atenção: empresa esperando a 1ª mensalidade ou com a mensalidade vencida
  const cobranca = d.empresas.filter((e) => e.status === "aguardando_pagamento" || e.cobranca === "atrasada");

  return (
    <>
      <Topo olho="Visão geral" titulo="Painel do Vertces" sub="Empresas, uso do sistema e o que pede atenção hoje." />

      <section className="sa-kpis sa-kpis-6" aria-label="Indicadores">
        <Kpi rotulo="Empresas ativas" valor={fmtNum(ativas.length)} icone={ICO.empresas}
          detalhe={`${d.empresas.length} cadastradas no total`} onClick={() => d.ir({ t: "admin", aba: "empresas" })} />
        <Kpi rotulo="Usuários" valor={fmtNum(usuarios)} icone={ICO.usuarios} tom="escuro" detalhe="contas ligadas às empresas" />
        <Kpi rotulo="Serviços em 30 dias" valor={fmtNum(serv30)} icone={ICO.servicos} detalhe="criados por todas as empresas" />
        <Kpi rotulo="Sem uso há 14 dias" valor={fmtNum(paradas.length)} icone={ICO.pausa} tom={paradas.length ? "alerta" : undefined}
          detalhe="ativas, sem acesso nem serviço" />
        <Kpi rotulo="Pedidos de reunião" valor={fmtNum(novosContatos)} icone={ICO.contatos} tom={novosContatos ? "alerta" : undefined}
          detalhe={suspensas ? `${suspensas} empresa(s) suspensa(s)` : "novos, vindos do site"} onClick={() => d.ir({ t: "admin", aba: "contatos" })} />
        <Kpi rotulo="Suporte" icone={ICO.suporte} valor={d.suporte ? fmtNum(d.suporte.esperando) : "—"}
          tom={d.suporte?.esperando ? "alerta" : undefined}
          detalhe={!d.suporte ? "central sem a migração 0029" : d.suporte.esperando
            ? `esperando resposta · ${d.suporte.abertos} aberto(s)` : d.suporte.abertos ? `nenhum esperando · ${d.suporte.abertos} aberto(s)` : "nenhum chamado aberto"}
          onClick={() => d.ir({ t: "admin", aba: "suporte" })} />
      </section>

      {aprovar.length > 0 && (
        <section className="sa-card" style={{ marginBottom: 18 }}>
          <header><h3>Pedidos de créditos aguardando<Dica>feitos sem o pagamento online: aprove na página da empresa, aba Créditos extras, depois de combinar o pagamento</Dica></h3></header>
          <div className="sa-lista">
            {aprovar.map((p) => (
              <button type="button" key={p.id} className="sa-item" onClick={() => d.ir({ t: "admin", aba: "empresas", id: p.escritorio_id })}>
                <span className="av">{iniciais(p.empresa)}</span>
                <span style={{ flex: 1, textAlign: "left" }}><b>{p.empresa}</b>
                  <span className="sub" style={{ display: "block", fontSize: 12 }}>{p.quantidade} · {nomeTipo(p.tipo)} · {fmtPreco(p.preco)} · {quando(p.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {cobranca.length > 0 && (
        <section className="sa-card" style={{ marginBottom: 18 }}>
          <header><h3>Mensalidades que pedem atenção<Dica>empresas esperando a 1ª mensalidade (sem acesso até pagar) ou com a mensalidade vencida</Dica></h3></header>
          <div className="sa-lista">
            {cobranca.map((e) => (
              <button type="button" key={e.id} className="sa-item" onClick={() => d.ir({ t: "admin", aba: "empresas", id: e.id })}>
                <span className="av">{iniciais(e.nome)}</span>
                <span style={{ flex: 1, textAlign: "left" }}><b>{e.nome}</b>
                  <span className="sub" style={{ display: "block", fontSize: 12 }}>
                    {e.status === "aguardando_pagamento" ? "esperando a 1ª mensalidade" : "mensalidade vencida"}
                    {e.mensalidade != null && ` · ${fmtPreco(Number(e.mensalidade))}`}
                    {e.vencimento && ` · vencimento ${new Date(`${e.vencimento}T12:00:00`).toLocaleDateString("pt-BR")}`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="sa-grade c3" style={{ marginBottom: 18 }}>
        <section className="sa-card">
          <header><h3>Serviços criados por dia<Dica>últimos 30 dias · todas as empresas</Dica></h3></header>
          {serie ? <Serie dados={serie} /> : <Carregando />}
        </section>
        <section className="sa-card">
          <header><h3>Empresas ativas por plano</h3></header>
          <div className="sa-barras">
            {porPlano.map((p) => (
              <div className="sa-barra" key={p.nome}>
                <span className="sa-plano"><i style={{ background: p.cor }} />{p.nome}</span>
                <span className="trilho" title={`${p.nome}: ${p.n}`}><i style={{ width: `${(p.n / maxPlano) * 100}%` }} /></span>
                <b>{p.n}</b>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="sa-grade c2">
        <section className="sa-card">
          <header><h3>Uso por serviço<Dica>serviços criados em 30 dias</Dica></h3></header>
          {!uso ? <Carregando /> : uso.length === 0 ? <div className="sa-vazio">Nenhum serviço criado nos últimos 30 dias.</div> : (
            <div className="sa-barras">
              {uso.map((u) => (
                <div className="sa-barra" key={u.chave}>
                  <span>{recursoDe(u.chave)?.nome ?? u.chave}</span>
                  <span className="trilho" title={`${recursoDe(u.chave)?.nome ?? u.chave}: ${u.total}`}><i style={{ width: `${(u.total / uso[0].total) * 100}%` }} /></span>
                  <b>{u.total}</b>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="sa-card">
          <header><h3>Pedem atenção<Dica>ativas sem uso há mais de 14 dias</Dica></h3></header>
          {paradas.length === 0 ? <div className="sa-vazio">Todas as empresas ativas usaram o sistema nas últimas duas semanas.</div> : (
            <div className="sa-lista">
              {paradas.slice(0, 6).map((e) => (
                <button key={e.id} type="button" onClick={() => d.ir({ t: "admin", aba: "empresas", id: e.id })}>
                  <span className="av">{iniciais(e.nome)}</span>
                  <span className="tx"><b>{e.nome}</b><span>último acesso {quando(e.ultimo_acesso)} · último serviço {quando(e.ultimo_servico)}</span></span>
                  <PlanoTag planoId={e.plano_id} planos={d.planos} />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="sa-card">
          <header><h3>Cadastradas por último</h3></header>
          <div className="sa-lista">
            {recentes.map((e) => (
              <button key={e.id} type="button" onClick={() => d.ir({ t: "admin", aba: "empresas", id: e.id })}>
                <span className="av">{iniciais(e.nome)}</span>
                <span className="tx"><b>{e.nome}</b><span>cadastrada {quando(e.created_at)} · {e.usuarios} usuário(s)</span></span>
                <PlanoTag planoId={e.plano_id} planos={d.planos} />
              </button>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

/** Colunas por dia, uma série só (a cor da marca); dica ao passar o mouse. */
function Serie({ dados }: { dados: { dia: string; total: number }[] }) {
  const [foco, setFoco] = useState<number | null>(null);
  const max = Math.max(1, ...dados.map((x) => x.total));
  const n = dados.length;
  const W = 600, H = 170, gap = 2;
  const larg = W / n - gap;
  const total = dados.reduce((s, x) => s + x.total, 0);
  const fmt = (dia: string) => new Date(`${dia}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  if (total === 0) return <div className="sa-vazio">Nenhum serviço criado no período.</div>;
  return (
    <div className="sa-serie" onMouseLeave={() => setFoco(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${total} serviços em ${n} dias`}>
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--borda)" />
        {dados.map((x, i) => {
          const h = (x.total / max) * (H - 8);
          const xi = i * (larg + gap);
          return (
            <g key={x.dia} onMouseEnter={() => setFoco(i)}>
              {/* alvo maior que a barra: a coluna inteira */}
              <rect x={xi} y={0} width={larg + gap} height={H} fill="transparent" />
              <rect x={xi} y={H - Math.max(h, x.total ? 2 : 0)} width={larg} height={Math.max(h, x.total ? 2 : 0)} rx={Math.min(4, larg / 2)}
                fill={foco === i ? "var(--floresta)" : "var(--primaria)"} />
            </g>
          );
        })}
      </svg>
      {foco !== null && (
        <span className="dica" style={{ left: `${((foco + 0.5) / n) * 100}%`, top: `${((H - (dados[foco].total / max) * (H - 8)) / H) * 180}px` }}>
          {fmt(dados[foco].dia)} · <b>{dados[foco].total}</b> serviço(s)
        </span>
      )}
      <div className="eixo"><span>{fmt(dados[0].dia)}</span><span>{total} no período</span><span>{fmt(dados[n - 1].dia)}</span></div>
    </div>
  );
}
