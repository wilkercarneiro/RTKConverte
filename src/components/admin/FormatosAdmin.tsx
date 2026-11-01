// Formatos de arquivo (superadmin): o que o leitor universal aprendeu e o que
// ele não conseguiu ler. Perfil de uma empresa pode virar GLOBAL (todas passam a
// ler aquele aparelho sozinhas); arquivo recusado é baixado para virar caso de
// teste; a regressão reaplica cada perfil aos arquivos que ele já leu.
import { useCallback, useEffect, useState } from "react";
import { chamarFuncao, supabase } from "../../lib/supabase";
import { confirmar } from "../ui";
import { Carregando, ICO, Kpi, Topo, quando } from "./comum";

interface PerfilVisto {
  id: string; nome: string | null; origem: "regras" | "ia" | "operador"; global: boolean; escritorio: string | null;
  usos: number; sem_edicao: number; ultimo_uso: string | null; explicacao: string | null; created_at: string;
}
interface Recusado { id: string; escritorio: string | null; nome_arquivo: string; caminho: string | null; formato: string | null; motivo: string; resolvido: boolean; created_at: string }
interface FormatosVistos {
  perfis: PerfilVisto[];
  recusados: Recusado[];
  ia: { chamadas: number; aprovadas: number; custo_usd: number; por_modelo: Record<string, number> } | null;
  leituras: Record<string, number> | null;
}
interface Regressao { conferidos: number; divergentes: { servico_id: string; nome_arquivo: string; motivo?: string }[] }

const ORIGEM: Record<string, string> = { regras: "regras", ia: "IA", operador: "ajuste do operador", padrao: "formato da equipe", perfil: "perfil aprendido" };

export function FormatosAdmin() {
  const [dados, setDados] = useState<FormatosVistos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [dias, setDias] = useState(30);
  const [regressao, setRegressao] = useState<Regressao | null>(null);
  const [rodando, setRodando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    const { data, error } = await supabase.rpc("sa_formatos_vistos", { p_dias: dias });
    if (error) { setErro(/sa_formatos_vistos/.test(error.message) ? "O banco ainda não tem a leitura universal (migração 0035)." : error.message); return; }
    setDados(data as FormatosVistos);
  }, [dias]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function acao(fn: string, args: Record<string, unknown>) {
    setErro(null);
    const { error } = await supabase.rpc(fn, args);
    if (error) setErro(error.message); else await carregar();
  }
  async function baixar(r: Recusado) {
    if (!r.caminho) return;
    const { data, error } = await supabase.storage.from("uploads-recusados").createSignedUrl(r.caminho, 120, { download: r.nome_arquivo });
    if (error || !data) { setErro(error?.message ?? "não foi possível gerar o link"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }
  async function rodarRegressao() {
    setRodando(true); setErro(null);
    try { setRegressao(await chamarFuncao<Regressao>("ler-arquivo", { acao: "regressao" })); }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setRodando(false); }
  }

  if (!dados && !erro) return <Carregando />;
  const ia = dados?.ia;
  const pendentes = dados?.recusados.filter((r) => !r.resolvido) ?? [];
  const leituras = Object.entries(dados?.leituras ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <Topo olho="Sistema" titulo="Formatos de arquivo" sub="O que o leitor de arquivos aprendeu, quanto a IA trabalhou e o que ainda não foi lido.">
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Período">
          <option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option><option value={365}>1 ano</option>
        </select>
      </Topo>
      {erro && <div className="sa-aviso erro">{erro}</div>}

      <section className="sa-kpis" aria-label="Indicadores da leitura">
        <Kpi rotulo="Formatos aprendidos" valor={dados?.perfis.length ?? 0} icone={ICO.recursos}
          detalhe={`${dados?.perfis.filter((p) => p.global).length ?? 0} global(is) · ${dados?.perfis.filter((p) => !p.global).length ?? 0} de empresas`} />
        <Kpi rotulo="Chamadas à IA" valor={ia?.chamadas ?? 0} icone={ICO.sistema} tom="escuro"
          detalhe={ia?.chamadas ? `${Math.round((ia.aprovadas / ia.chamadas) * 100)}% aprovadas · ${Object.entries(ia.por_modelo).map(([m, n]) => `${m}: ${n}`).join(" · ")}` : "nenhuma no período"} />
        <Kpi rotulo="Custo da IA" valor={`US$ ${(ia?.custo_usd ?? 0).toFixed(2)}`} icone={ICO.planos} detalhe={`nos últimos ${dias} dias`} />
        <Kpi rotulo="Arquivos não lidos" valor={pendentes.length} icone={ICO.alerta} tom={pendentes.length ? "alerta" : undefined} detalhe="esperando análise" />
      </section>

      {leituras.length > 0 && (
        <section className="sa-card" style={{ marginBottom: 18 }}>
          <h3>Como os arquivos foram lidos</h3>
          <p className="sub">{leituras.map(([o, n]) => `${ORIGEM[o] ?? o}: ${n}`).join(" · ")}</p>
        </section>
      )}

      <section className="sa-card" style={{ marginBottom: 18, padding: "14px 10px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "0 6px 10px" }}>
          <h3 style={{ margin: 0 }}>Formatos aprendidos</h3>
          <span className="esticar" style={{ flex: 1 }} />
          <button type="button" onClick={rodarRegressao} disabled={rodando}>{rodando ? "Conferindo…" : "Conferir perfis contra os arquivos já lidos"}</button>
        </div>
        {regressao && (
          <div className={`sa-aviso ${regressao.divergentes.length ? "erro" : ""}`} style={{ margin: "0 6px 10px" }}>
            {regressao.divergentes.length
              ? `${regressao.divergentes.length} de ${regressao.conferidos} arquivo(s) hoje seriam lidos diferente: ${regressao.divergentes.slice(0, 5).map((d) => d.nome_arquivo).join(", ")}`
              : `Os ${regressao.conferidos} arquivo(s) já lidos por perfis continuam saindo idênticos.`}
          </div>
        )}
        <div className="sa-tabela-wrap">
          <table className="sa-tabela">
            <thead><tr><th>Formato</th><th>Empresa</th><th>Aprendido por</th><th>Usos</th><th>Último uso</th><th /></tr></thead>
            <tbody>
              {dados?.perfis.map((p) => (
                <tr key={p.id}>
                  <td style={{ maxWidth: 420 }}>
                    <b>{p.nome ?? "(sem nome)"}</b>
                    {p.explicacao && <div className="sub" style={{ fontSize: 12.5, whiteSpace: "normal" }}>{p.explicacao}</div>}
                  </td>
                  <td>{p.global ? <b>todas (global)</b> : p.escritorio ?? "—"}</td>
                  <td>{ORIGEM[p.origem] ?? p.origem}</td>
                  <td>{p.usos}<div className="sub" style={{ fontSize: 12 }}>{p.sem_edicao} sem ajuste</div></td>
                  <td>{quando(p.ultimo_uso)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {!p.global && <button type="button" onClick={async () => {
                      if (await confirmar({ titulo: "Tornar este formato global?", texto: "Todas as empresas passam a ler arquivos deste aparelho sozinhas, sem IA.", confirmar: "Tornar global" })) void acao("sa_promover_perfil", { p_perfil: p.id });
                    }}>Tornar global</button>}{" "}
                    <button type="button" className="remover" onClick={async () => {
                      if (await confirmar({ titulo: "Excluir este formato aprendido?", texto: "O próximo arquivo deste formato volta a passar pelas regras ou pela IA.", confirmar: "Excluir" })) void acao("sa_excluir_perfil", { p_perfil: p.id });
                    }}>excluir</button>
                  </td>
                </tr>
              ))}
              {dados && dados.perfis.length === 0 && <tr><td colSpan={6} className="sa-vazio">Nenhum formato novo aprendido ainda — os arquivos chegaram no formato da equipe ou em formatos que as regras já leem.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sa-card" style={{ padding: "14px 10px" }}>
        <h3 style={{ margin: "0 6px 10px" }}>Arquivos que não foram lidos</h3>
        <div className="sa-tabela-wrap">
          <table className="sa-tabela">
            <thead><tr><th>Arquivo</th><th>Empresa</th><th>Motivo</th><th>Quando</th><th /></tr></thead>
            <tbody>
              {dados?.recusados.map((r) => (
                <tr key={r.id} style={r.resolvido ? { opacity: 0.55 } : undefined}>
                  <td><b>{r.nome_arquivo}</b><div className="sub" style={{ fontSize: 12 }}>{r.formato ?? ""}</div></td>
                  <td>{r.escritorio ?? "—"}</td>
                  <td style={{ maxWidth: 420, whiteSpace: "pre-wrap", fontSize: 12.5 }}>{r.motivo}</td>
                  <td>{quando(r.created_at)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.caminho && <button type="button" onClick={() => baixar(r)}>baixar</button>}{" "}
                    <button type="button" className="fantasma" onClick={() => acao("sa_resolver_recusado", { p_id: r.id, p_resolvido: !r.resolvido })}>{r.resolvido ? "reabrir" : "resolvido"}</button>
                  </td>
                </tr>
              ))}
              {dados && dados.recusados.length === 0 && <tr><td colSpan={5} className="sa-vazio">Nenhum arquivo recusado no período.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
