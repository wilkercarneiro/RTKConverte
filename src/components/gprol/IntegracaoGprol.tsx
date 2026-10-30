// Configurações → Integrações: conectar o escritório ao GPROL, ver o estado do
// sincronismo e desconectar. A conexão começa aqui e é autorizada no GPROL
// (o admin de lá entra com o login dele); a chave volta só para o servidor.
import { useEffect, useState } from "react";
import { carregarEscritorio } from "../../lib/escritorio";
import { esquecerConexaoGprol, gprol, MUDOU, sincronizarGprol, urlConfigurarGprol } from "../../lib/gprol";
import type { IntegracaoGprol as Integracao } from "../../lib/gprol";
import { avisar, confirmar, Dica, EstadoErro, Esqueleto } from "../ui";

interface Status {
  liberado: boolean;
  pode_configurar: boolean;
  integracao: Integracao | null;
  pendentes: number;
  pedidos_pendentes: number;
  erros: { id: number; tipo: string; erro: string; tentativas: number; atualizado_em: string }[];
}

const quando = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const ROTULO_TIPO: Record<string, string> = { servico: "serviço", pedido: "etapa do pedido", cliente: "cliente" };

export function IntegracaoGprol() {
  const [st, setSt] = useState<Status | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [vez, setVez] = useState(0);

  useEffect(() => {
    let vivo = true;
    setFalha(null);
    gprol<Status>("status").then((s) => { if (vivo) setSt(s); })
      .catch((e: Error) => { if (vivo) setFalha(e.message); });
    const f = () => setVez((v) => v + 1);
    addEventListener(MUDOU, f);
    return () => { vivo = false; removeEventListener(MUDOU, f); };
  }, [vez]);

  async function conectar() {
    setOcupado("conectar");
    try {
      const { url } = await gprol<{ url: string }>("conectar_iniciar");
      location.href = url;
    } catch (e) {
      avisar("erro", (e as Error).message);
      setOcupado(null);
    }
  }

  /** Abre no GPROL a mesma tela da conexão, agora para mudar a configuração. */
  async function configurar() {
    setOcupado("configurar");
    try {
      const e = await carregarEscritorio();
      if (e.estado !== "ok") throw new Error("Não foi possível identificar a empresa.");
      location.href = urlConfigurarGprol(e.escritorio.id, e.escritorio.nome);
    } catch (e) {
      avisar("erro", (e as Error).message);
      setOcupado(null);
    }
  }

  async function sincronizarAgora(acao: "sincronizar" | "tentar_de_novo") {
    setOcupado(acao);
    try {
      const r = await gprol<{ erro?: string; enviados?: number; recebidos?: number; ocupado?: boolean }>(acao);
      if (r.ocupado) avisar("ok", "Já está sincronizando. Em instantes os dados aparecem.");
      else if (r.erro) avisar("erro", r.erro);
      else avisar("ok", `Sincronizado: ${r.enviados ?? 0} enviado(s), ${r.recebidos ?? 0} recebido(s).`);
    } catch (e) {
      avisar("erro", (e as Error).message);
    } finally {
      setOcupado(null);
      dispatchEvent(new Event(MUDOU));
    }
  }

  async function desconectar() {
    if (!(await confirmar({
      titulo: "Desconectar do GPROL?",
      texto: "Os pedidos e serviços continuam aqui; só param de sincronizar. Para voltar, é só conectar de novo.",
      confirmar: "Desconectar", perigo: true,
    }))) return;
    setOcupado("desconectar");
    try {
      await gprol("desconectar");
      esquecerConexaoGprol();
      avisar("ok", "Desconectado do GPROL.");
    } catch (e) {
      avisar("erro", (e as Error).message);
    } finally {
      setOcupado(null);
      dispatchEvent(new Event(MUDOU));
    }
  }

  if (falha) return <section className="bloco"><EstadoErro mensagem={falha} onTentar={() => setVez((v) => v + 1)} titulo="Não foi possível carregar a integração" /></section>;
  if (!st) return <section className="bloco"><Esqueleto linhas={3} rotulo="Carregando a integração…" /></section>;

  const i = st.integracao;
  const conectado = i?.status === "ativa";

  return (
    <section className="bloco gp-integracao">
      <header>
        <h3>GPROL<Dica>CRM do mesmo ramo: clientes, serviços e etapas ficam iguais nos dois sistemas</Dica></h3>
        <span className={`chip ${conectado ? "ok-chip" : "gp-chip-off"}`}>{conectado ? "Conectado" : "Desconectado"}</span>
      </header>

      {conectado ? (
        <>
          <dl className="gp-dados">
            <div><dt>Empresa no GPROL</dt><dd>{i!.empresa_externa_nome || "—"}</dd></div>
            <div><dt>Conectado em</dt><dd>{quando(i!.conectado_em)}</dd></div>
            <div><dt>Última sincronização</dt><dd>{quando(i!.ultima_sincronizacao)}</dd></div>
            <div><dt>Pedidos a executar</dt><dd>{st.pedidos_pendentes}</dd></div>
          </dl>
          {i!.resumo && (
            <p className="sub gp-resumo">
              Na conexão: {i!.resumo.clientes_ligados ?? 0} cliente(s) com CPF/CNPJ ligado(s)
              {i!.resumo.clientes_criados ? `, ${i!.resumo.clientes_criados} criado(s) aqui` : ""}
              {i!.resumo.pedidos ? ` e ${i!.resumo.pedidos} pedido(s) recebido(s)` : ""}.
            </p>
          )}
          {i!.ultimo_erro && (
            <div className="gp-faixa alerta-faixa" role="alert">
              <b>Última sincronização com problema:</b> {i!.ultimo_erro}
            </div>
          )}
          {st.erros.length > 0 && (
            <div className="gp-erros">
              <div className="titulo-campo">{st.pendentes} mudança(s) esperando para ir ao GPROL</div>
              <ul>
                {st.erros.map((e) => (
                  <li key={e.id}><b>{ROTULO_TIPO[e.tipo] ?? e.tipo}</b> · {e.erro} <span className="sub">({e.tentativas} tentativa(s), {quando(e.atualizado_em)})</span></li>
                ))}
              </ul>
            </div>
          )}
          {st.pode_configurar && (
            <div className="gp-configurar">
              <div>
                <b>Configuração da sincronização</b>
                <span className="sub">Funil, etapas que o card percorre e quais tipos de serviço do GPROL viram qual serviço aqui. Abre no GPROL a mesma tela da conexão; o administrador de lá salva.</span>
              </div>
              <button className="principal" onClick={configurar} disabled={!!ocupado}>
                {ocupado === "configurar" ? "Abrindo o GPROL…" : "Configurar sincronização"}
              </button>
            </div>
          )}
          <div className="rodape-bloco gp-acoes">
            <button onClick={() => sincronizarAgora(st.erros.length ? "tentar_de_novo" : "sincronizar")} disabled={!!ocupado}>
              {ocupado === "sincronizar" || ocupado === "tentar_de_novo" ? "Sincronizando…" : st.erros.length ? "Tentar de novo agora" : "Sincronizar agora"}
            </button>
            {st.pode_configurar && (
              <button className="remover" onClick={desconectar} disabled={!!ocupado}>{ocupado === "desconectar" ? "Desconectando…" : "Desconectar"}</button>
            )}
          </div>
          <ComoFunciona />
        </>
      ) : (
        <>
          <p>
            Conecte o escritório à empresa de vocês no GPROL e os dois sistemas trabalham juntos:
          </p>
          <ComoFunciona />
          {i?.desconectado_em && <p className="sub">Desconectado em {quando(i.desconectado_em)}.</p>}
          {!st.liberado ? (
            <p className="nota-permissao">A integração com o GPROL não está no plano da sua empresa. Fale com o suporte do Vertces.</p>
          ) : !st.pode_configurar ? (
            <p className="nota-permissao">Só quem tem a permissão “Dados da empresa” conecta o GPROL.</p>
          ) : (
            <div className="rodape-bloco gp-acoes">
              <button className="principal" onClick={conectar} disabled={!!ocupado}>
                {ocupado === "conectar" ? "Abrindo o GPROL…" : "Conectar GPROL"}
              </button>
              <span className="sub">Você vai entrar no GPROL; o administrador de lá autoriza.</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ComoFunciona() {
  return (
    <ul className="gp-como">
      <li><b>Pedidos:</b> serviço vendido no GPROL aparece no Início como “A executar”. O crédito só é usado quando vocês executam.</li>
      <li><b>Etapas:</b> ao importar o TXT, gerar documentos e entregar, o card anda sozinho no funil do GPROL (só para frente).</li>
      <li><b>Documentos:</b> a equipe abre no GPROL os documentos gerados aqui, sem baixar nem reenviar.</li>
      <li><b>Clientes:</b> os clientes com CPF/CNPJ ficam iguais nos dois; edição feita num lado vai para o outro.</li>
      <li><b>Serviço feito direto aqui</b> aparece no GPROL ao gerar os primeiros documentos.</li>
    </ul>
  );
}

/**
 * Volta da tela de configuração do GPROL (`/app/?gprol_config=ok[&gprol_enviados=N]#/config`):
 * tira o parâmetro da barra, sincroniza já com o mapeamento novo e diz o que aconteceu.
 */
export function voltaDaConfiguracaoGprol(): string | null {
  const qs = new URLSearchParams(location.search);
  if (qs.get("gprol_config") !== "ok") return null;
  const enviados = qs.get("gprol_enviados");
  history.replaceState(null, "", `${location.pathname}#/config`);
  sincronizarGprol(0, true);
  if (enviados === null) return "Sincronização configurada no GPROL.";
  const n = Number(enviados) || 0;
  return n === 0
    ? "Sincronização configurada no GPROL. Nenhum serviço aberto novo para trazer."
    : `Sincronização configurada no GPROL. ${n} serviço(s) aberto(s) a caminho de “A executar”.`;
}

/** Volta da autorização no GPROL (`/app/?gprol_code=…&state=…`): conclui a conexão. */
export async function concluirConexaoGprol(): Promise<{ empresa?: string; resumo?: Integracao["resumo"] } | null> {
  const qs = new URLSearchParams(location.search);
  const code = qs.get("gprol_code"), state = qs.get("state");
  if (!code || !state) return null;
  // tira o código da barra de endereço antes de qualquer coisa (vale uma vez só)
  history.replaceState(null, "", `${location.pathname}#/config`);
  const r = await gprol<{ empresa?: string; resumo?: Integracao["resumo"] }>("conectar_concluir", { code, state });
  esquecerConexaoGprol();
  sincronizarGprol(0, true);
  return r;
}
