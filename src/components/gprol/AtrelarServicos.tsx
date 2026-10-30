// "Atrelar serviços" (página do cliente ligado ao GPROL): junta numa tela só o
// que o GPROL tem deste cliente e os serviços que já existem aqui.
//  - pedido "A executar" (por modalidade ainda não feita) ← serviço daqui da
//    mesma modalidade: grava servicos.pedido_externo_id (os gatilhos da 0028
//    recalculam o pedido e põem a etapa na fila do GPROL);
//  - serviço aberto no GPROL que ainda não veio ← qualquer serviço daqui solto:
//    ação `vincular` da função gprol (o GPROL passa a mandar esse serviço como
//    pedido, já ligado).
// Serviço derivado (gleba, parte da divisão) herda o pedido do principal e não
// aparece aqui.
import { useEffect, useMemo, useState } from "react";
import { gprol, modalidadesFeitas, MUDOU, ROTULO_ETAPA_PEDIDO, sincronizarGprol } from "../../lib/gprol";
import type { PedidoGprol } from "../../lib/gprol";
import { chaveDoServico, rotuloCurto } from "../../lib/modalidades";
import { servicoLiberado } from "../../lib/recursos";
import type { ChaveServico } from "../../lib/modalidades";
import { supabase } from "../../lib/supabase";
import type { Servico } from "../../lib/types";
import { avisar, confirmar, EstadoErro, Esqueleto, Gaveta } from "../ui";
import "./gprol.css";

interface ServicoAberto { id: string; nome: string; fazenda: string | null; titulo: string | null; etapa: string | null; ligado: boolean; criado_em: string }
type Daqui = Servico & { pedido_externo_id?: string | null };

/** Uma coisa do GPROL esperando um serviço daqui. */
type Alvo =
  | { chave: string; tipo: "pedido"; pedido: PedidoGprol; modalidade: ChaveServico }
  | { chave: string; tipo: "aberto"; aberto: ServicoAberto };

interface Dados {
  servicos: Daqui[];
  pedidos: PedidoGprol[];          // a executar deste cliente
  ligados: Record<string, PedidoGprol>; // pedido de cada serviço já atrelado
  feitas: Record<string, string[]>;
  abertos: ServicoAberto[] | null; // null = o GPROL não respondeu
  erroAbertos: string | null;
}

const nomeDe = (s: Daqui) => s.denominacao ?? s.nome_arquivo_txt ?? "(sem denominação)";
const dataCurta = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
const tituloPedido = (p: PedidoGprol) => p.titulo ?? p.nome_servico ?? "Pedido do GPROL";
const tituloAberto = (a: ServicoAberto) => a.titulo ?? a.nome;

async function carregar(clienteId: string): Promise<Dados> {
  const [{ data: ss, error: e1 }, { data: ps, error: e2 }] = await Promise.all([
    supabase.from("servicos").select("*").eq("cliente_id", clienteId).order("created_at", { ascending: false }),
    supabase.from("pedidos_externos").select("*").eq("cliente_id", clienteId).eq("origem", "gprol")
      .in("status", ["pendente", "em_execucao"]).order("recebido_em", { ascending: false }),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const servicos = ((ss as Daqui[]) ?? []).filter((s) => !s.origem_id);
  const pedidos = (ps as PedidoGprol[]) ?? [];
  const idsLigados = [...new Set(servicos.map((s) => s.pedido_externo_id).filter((x): x is string => !!x))];
  const ligados: Record<string, PedidoGprol> = {};
  if (idsLigados.length) {
    const { data } = await supabase.from("pedidos_externos").select("*").in("id", idsLigados);
    for (const p of (data as PedidoGprol[]) ?? []) ligados[p.id] = p;
  }
  const feitas = await modalidadesFeitas(pedidos.map((p) => p.id));
  let abertos: ServicoAberto[] | null = null;
  let erroAbertos: string | null = null;
  try {
    const r = await gprol<{ itens: ServicoAberto[] }>("servicos_gprol", { cliente_id: clienteId });
    abertos = (r.itens ?? []).filter((a) => !a.ligado);
  } catch (e) {
    erroAbertos = (e as Error).message;
  }
  return { servicos, pedidos, ligados, feitas, abertos, erroAbertos };
}

export function AtrelarServicos({ clienteId, nomeCliente, onFechar, onMudou, onExecutar }: {
  clienteId: string; nomeCliente: string; onFechar: () => void; onMudou: () => void;
  /** pedido sem serviço feito aqui: executa direto (mesma porta do "A executar") */
  onExecutar?: (p: PedidoGprol, chave: ChaveServico) => void;
}) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [vez, setVez] = useState(0);

  useEffect(() => {
    let vivo = true;
    setFalha(null);
    carregar(clienteId).then((d) => { if (vivo) setDados(d); }).catch((e: Error) => { if (vivo) setFalha(e.message); });
    return () => { vivo = false; };
  }, [clienteId, vez]);

  const soltos = useMemo(() => (dados?.servicos ?? []).filter((s) => !s.pedido_externo_id), [dados]);
  const atrelados = useMemo(() => (dados?.servicos ?? []).filter((s) => !!s.pedido_externo_id), [dados]);

  const alvos = useMemo<Alvo[]>(() => {
    if (!dados) return [];
    const lista: Alvo[] = [];
    for (const p of dados.pedidos) {
      const feitas = dados.feitas[p.id] ?? [];
      for (const m of p.modalidades as ChaveServico[]) {
        if (!feitas.includes(m)) lista.push({ chave: `p:${p.id}:${m}`, tipo: "pedido", pedido: p, modalidade: m });
      }
    }
    for (const a of dados.abertos ?? []) lista.push({ chave: `a:${a.id}`, tipo: "aberto", aberto: a });
    return lista;
  }, [dados]);

  /** Serviços daqui que servem para o alvo (pedido: só a mesma modalidade). */
  const candidatos = (a: Alvo) => soltos.filter((s) => a.tipo === "aberto" || chaveDoServico(s) === a.modalidade);

  // sugestão: alvo com um candidato só, que nenhum outro alvo também quer
  useEffect(() => {
    if (!dados) return;
    const sugestao: Record<string, string> = {};
    const usados = new Set<string>();
    for (const a of alvos) {
      if (a.tipo !== "pedido") continue;
      const c = candidatos(a);
      if (c.length === 1 && !usados.has(c[0].id)) { sugestao[a.chave] = c[0].id; usados.add(c[0].id); }
    }
    setEscolha(sugestao);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados, alvos]);

  const escolhidoEmOutro = (alvo: string, servicoId: string) =>
    Object.entries(escolha).some(([k, v]) => k !== alvo && v === servicoId);

  async function atrelar(a: Alvo) {
    const id = escolha[a.chave];
    const s = soltos.find((x) => x.id === id);
    if (!s) return;
    setOcupado(a.chave);
    try {
      if (a.tipo === "pedido") {
        const { error } = await supabase.from("servicos").update({ pedido_externo_id: a.pedido.id }).eq("id", s.id);
        if (error) throw error;
        sincronizarGprol(0, true);
      } else {
        if (!(await confirmar({
          titulo: `Atrelar “${nomeDe(s)}” a “${tituloAberto(a.aberto)}”?`,
          texto: "O serviço do GPROL passa a andar conforme este serviço avança, e os documentos gerados aqui abrem lá.",
          confirmar: "Atrelar",
        }))) return;
        await gprol("vincular", { servico_id: s.id, servico_gprol_id: a.aberto.id });
      }
      avisar("ok", `“${nomeDe(s)}” atrelado ao GPROL.`);
      dispatchEvent(new Event(MUDOU));
      onMudou();
      setVez((v) => v + 1);
    } catch (e) {
      avisar("erro", (e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function desatrelar(s: Daqui) {
    const p = s.pedido_externo_id ? dados?.ligados[s.pedido_externo_id] : null;
    if (!(await confirmar({
      titulo: `Desatrelar “${nomeDe(s)}”?`,
      texto: p ? `Ele deixa de mover “${tituloPedido(p)}” no GPROL. Nada é apagado; dá para atrelar de novo aqui.` : "Nada é apagado; dá para atrelar de novo aqui.",
      confirmar: "Desatrelar",
    }))) return;
    setOcupado(`d:${s.id}`);
    const { error } = await supabase.from("servicos").update({ pedido_externo_id: null }).eq("id", s.id);
    setOcupado(null);
    if (error) { avisar("erro", error.message); return; }
    avisar("ok", "Serviço desatrelado.");
    sincronizarGprol(0, true);
    dispatchEvent(new Event(MUDOU));
    onMudou();
    setVez((v) => v + 1);
  }

  const pedidosAlvo = alvos.filter((a) => a.tipo === "pedido");
  const abertosAlvo = alvos.filter((a) => a.tipo === "aberto");
  const semPar = soltos.filter((s) => !alvos.some((a) => candidatos(a).some((c) => c.id === s.id)));

  return (
    <Gaveta olho="GPROL" titulo="Atrelar serviços" onFechar={onFechar}
      rodape={<button onClick={onFechar}>Concluir</button>}>
      <p className="sub at-intro">
        Ligue os serviços que já existem aqui ao que o GPROL tem de <b>{nomeCliente}</b>. O card de lá passa a andar
        sozinho conforme o serviço avança, e os documentos gerados aqui abrem no GPROL — sem executar de novo nem gastar crédito.
      </p>

      {falha ? <EstadoErro mensagem={falha} onTentar={() => setVez((v) => v + 1)} titulo="Não foi possível carregar" />
        : !dados ? <Esqueleto linhas={4} rotulo="Buscando no GPROL…" />
        : (
          <>
            <section className="at-secao">
              <h4>Pedidos a executar<span className="cl-conta">{pedidosAlvo.length}</span></h4>
              {pedidosAlvo.length === 0
                ? <p className="sub at-vazio">Nenhum pedido deste cliente esperando execução.</p>
                : <ul className="at-lista">{pedidosAlvo.map((a) => (
                  <Linha key={a.chave} alvo={a} candidatos={candidatos(a)} escolhido={escolha[a.chave] ?? ""}
                    bloqueado={(id) => escolhidoEmOutro(a.chave, id)} ocupado={ocupado}
                    onEscolher={(id) => setEscolha((e) => ({ ...e, [a.chave]: id }))} onAtrelar={() => atrelar(a)}
                    onExecutar={onExecutar && a.tipo === "pedido" ? () => { onFechar(); onExecutar(a.pedido, a.modalidade); } : undefined} />
                ))}</ul>}
            </section>

            <section className="at-secao">
              <h4>Abertos no GPROL, ainda fora do Vertces<span className="cl-conta">{abertosAlvo.length}</span></h4>
              {dados.erroAbertos
                ? <p className="sub at-vazio at-erro">Não deu para consultar o GPROL agora: {dados.erroAbertos}</p>
                : abertosAlvo.length === 0
                  ? <p className="sub at-vazio">Todos os serviços abertos deste cliente no GPROL já estão aqui.</p>
                  : <ul className="at-lista">{abertosAlvo.map((a) => (
                    <Linha key={a.chave} alvo={a} candidatos={candidatos(a)} escolhido={escolha[a.chave] ?? ""}
                      bloqueado={(id) => escolhidoEmOutro(a.chave, id)} ocupado={ocupado}
                      onEscolher={(id) => setEscolha((e) => ({ ...e, [a.chave]: id }))} onAtrelar={() => atrelar(a)} />
                  ))}</ul>}
            </section>

            <section className="at-secao">
              <h4>Já atrelados<span className="cl-conta">{atrelados.length}</span></h4>
              {atrelados.length === 0
                ? <p className="sub at-vazio">Nenhum serviço deste cliente ligado ao GPROL ainda.</p>
                : <ul className="at-lista">{atrelados.map((s) => {
                  const p = dados.ligados[s.pedido_externo_id!];
                  const chave = chaveDoServico(s);
                  return (
                    <li key={s.id} className="at-linha at-feita">
                      <div className="at-gprol">
                        <span className="gp-marca">GPROL</span>
                        <b>{p ? tituloPedido(p) : "Pedido do GPROL"}</b>
                        <span className="sub">{p?.etapa ? `etapa ${p.etapa}` : ""}</span>
                      </div>
                      <div className="at-daqui">
                        <span className="at-seta" aria-hidden="true">⇄</span>
                        <span className={`chip mod-${chave}`}>{rotuloCurto[chave]}</span>
                        <span className="at-nome">{nomeDe(s)}</span>
                      </div>
                      <div className="at-acao">
                        {p && <span className={`chip gp-st-${p.status}`}>{ROTULO_ETAPA_PEDIDO[p.status]}</span>}
                        {/* serviço feito aqui e mandado ao GPROL: desatrelar criaria outro lá na próxima geração */}
                        {p?.origem === "gprol" && (
                          <button className="link gp-descartar" disabled={!!ocupado} onClick={() => desatrelar(s)}>Desatrelar</button>
                        )}
                      </div>
                    </li>
                  );
                })}</ul>}
            </section>

            {semPar.length > 0 && (
              <p className="sub at-rodape">
                {semPar.length === 1 ? "1 serviço daqui não tem par" : `${semPar.length} serviços daqui não têm par`} no GPROL:
                {" "}vão para lá sozinhos ao gerar os primeiros documentos.
              </p>
            )}
          </>
        )}
    </Gaveta>
  );
}

function Linha({ alvo, candidatos, escolhido, bloqueado, ocupado, onEscolher, onAtrelar, onExecutar }: {
  alvo: Alvo; candidatos: Daqui[]; escolhido: string; bloqueado: (id: string) => boolean; ocupado: string | null;
  onEscolher: (id: string) => void; onAtrelar: () => void; onExecutar?: () => void;
}) {
  const pedido = alvo.tipo === "pedido";
  const titulo = pedido ? tituloPedido(alvo.pedido) : tituloAberto(alvo.aberto);
  const etapa = pedido ? alvo.pedido.etapa : alvo.aberto.etapa;
  const detalhe = pedido
    ? [alvo.pedido.dados?.fazenda, alvo.pedido.dados?.local].filter(Boolean).join(" · ")
    : [alvo.aberto.fazenda, `aberto em ${dataCurta(alvo.aberto.criado_em)}`].filter(Boolean).join(" · ");
  const id = `at-${alvo.chave.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <li className="at-linha">
      <div className="at-gprol">
        <span className="gp-marca">GPROL</span>
        <b title={titulo}>{titulo}</b>
        <span className="sub">
          {pedido && <span className={`chip mod-${alvo.modalidade}`}>{rotuloCurto[alvo.modalidade]}</span>}
          {etapa ? ` etapa ${etapa}` : ""}{detalhe ? ` · ${detalhe}` : ""}
        </span>
      </div>
      <div className="at-daqui">
        <label htmlFor={id} className="at-rotulo">Serviço do Vertces</label>
        {candidatos.length === 0 ? (
          <span className="sub at-nenhum">
            {pedido
              ? `Nenhum serviço de ${rotuloCurto[alvo.modalidade]} deste cliente para atrelar: ainda não foi feito aqui.`
              : "Nenhum serviço deste cliente para atrelar."}
          </span>
        ) : (
          <select id={id} value={escolhido} onChange={(e) => onEscolher(e.target.value)} disabled={!!ocupado}>
            <option value="">Escolha o serviço…</option>
            {candidatos.map((s) => (
              <option key={s.id} value={s.id} disabled={bloqueado(s.id)}>
                {nomeDe(s)}{pedido ? "" : ` · ${rotuloCurto[chaveDoServico(s)]}`} · {dataCurta(s.created_at)}{bloqueado(s.id) ? " (escolhido em outro)" : ""}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="at-acao">
        {candidatos.length > 0 ? (
          <button className="principal" disabled={!escolhido || !!ocupado} onClick={onAtrelar}>
            {ocupado === alvo.chave ? "Atrelando…" : "Atrelar"}
          </button>
        ) : pedido && onExecutar ? (
          <button disabled={!!ocupado || !servicoLiberado(alvo.modalidade)} onClick={onExecutar}
            title={servicoLiberado(alvo.modalidade) ? "Abre o serviço novo já ligado a este pedido" : "Esta modalidade não está no plano"}>
            Executar agora
          </button>
        ) : null}
      </div>
    </li>
  );
}
