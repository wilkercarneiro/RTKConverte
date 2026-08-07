// Lista de serviços — antes era a segunda aba do dashboard.
//
// A coluna "Falta" e a barra de progresso mudam com a modalidade: a conferência
// de área termina na etapa 1, então dizer que "falta gerar as peças" a ela seria
// mentira. Quem decide isso é `vaiAoSigef` (src/lib/modalidades.ts), a mesma
// função que a tela do serviço usa para esconder os blocos do SIGEF.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Servico } from "../lib/types";
import { chaveDoServico, rotuloCurto, vaiAoSigef } from "../lib/modalidades";
import { Avisos, BotaoPerigo } from "./ui";
import { useAvisos } from "../lib/ux";

interface Progresso { docs: boolean; planta: boolean; pecas: boolean }
const TIPOS_ETAPA1 = new Set(["memorial_docx", "planilha_ods", "planta_pdf_sistema"]);

export function Servicos({ onAbrir, onNovo }: { onAbrir: (s: Servico) => void; onNovo: () => void }) {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [progressos, setProgressos] = useState<Record<string, Progresso>>({});
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState("");
  const { avisos, avisar, fechar } = useAvisos();

  async function carregar() {
    setCarregando(true);
    const [{ data: ss }, { data: ds }] = await Promise.all([
      supabase.from("servicos").select().order("created_at", { ascending: false }).limit(200),
      supabase.from("documentos_gerados").select("servico_id, tipo"),
    ]);
    setServicos((ss as Servico[]) ?? []);
    const mapa: Record<string, Progresso> = {};
    for (const d of (ds ?? []) as { servico_id: string; tipo: string }[]) {
      if (!mapa[d.servico_id]) mapa[d.servico_id] = { docs: false, planta: false, pecas: false };
      const p = mapa[d.servico_id];
      if (TIPOS_ETAPA1.has(d.tipo)) p.docs = true;
      else if (d.tipo === "planta_pdf") p.planta = true;
      else p.pecas = true;
    }
    setProgressos(mapa);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  async function excluir(s: Servico) {
    const { error } = await supabase.from("servicos").delete().eq("id", s.id);
    if (error) { avisar("erro", `Não foi possível excluir: ${error.message}`); return; }
    avisar("ok", `Serviço "${nome(s)}" excluído. Os arquivos gerados permanecem no Storage.`);
    carregar();
  }

  const nome = (s: Servico) => s.denominacao ?? s.nome_arquivo_txt ?? s.id.slice(0, 8);

  const filtrados = useMemo(() => servicos.filter((s) => {
    const alvo = `${s.denominacao ?? ""} ${s.detentor_nome ?? ""} ${s.nome_arquivo_txt ?? ""} ${s.municipio ?? ""}`.toLowerCase();
    return alvo.includes(filtro.toLowerCase());
  }), [servicos, filtro]);

  /** O que falta neste serviço, em uma frase curta. */
  function faltando(s: Servico): string {
    const p = progressos[s.id];
    if (!p?.docs) return "gerar memorial e planilha";
    // a conferência de área não vai ao SIGEF: com os documentos, acabou
    if (!vaiAoSigef(s)) return "concluído";
    if (!p.planta) return "gerar a planta do SIGEF";
    if (!p.pecas) return "gerar as peças técnicas";
    return "concluído";
  }

  const dataFmt = (iso?: string) => {
    const d = new Date((iso as unknown as string) ?? "");
    return isNaN(d.getTime()) ? "—" : `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  };

  return (
    <div className="pagina">
      <Avisos avisos={avisos} onFechar={fechar} />
      <section className="bloco">
        <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h3>📋 Serviços</h3>
          <span className="desc">{servicos.length} no total</span>
          <span className="esticar" style={{ flex: 1 }} />
          <input placeholder="🔎 buscar…" style={{ width: 240 }} aria-label="Buscar serviço"
            value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          <button className="principal" onClick={onNovo}>+ Novo serviço</button>
        </header>

        {carregando ? <p style={{ color: "var(--texto-2)" }}><span className="spinner" /> Carregando…</p>
          : filtrados.length === 0 ? (
            <p style={{ color: "var(--texto-2)" }}>Nenhum serviço {filtro ? "encontrado para a busca" : "ainda — comece pelo Início"}.</p>
          ) : (
            <div className="tabela-wrap" style={{ maxHeight: 560 }}>
              <table className="tabela-vertices dash-lista">
                <thead>
                  <tr><th>Modalidade</th><th>Imóvel / arquivo</th><th>Cliente</th><th>Município</th><th>Progresso</th><th>Falta</th><th>Criado em</th><th></th></tr>
                </thead>
                <tbody>
                  {filtrados.map((s) => {
                    const chave = chaveDoServico(s);
                    const p = progressos[s.id] ?? { docs: false, planta: false, pecas: false };
                    const etapas = vaiAoSigef(s) ? [p.docs, p.planta, p.pecas] : [p.docs];
                    return (
                      <tr key={s.id} className="linha-servico" tabIndex={0} role="button"
                        onClick={() => onAbrir(s)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAbrir(s); } }}>
                        <td><span className={`chip mod-${chave}`}>{rotuloCurto[chave]}</span></td>
                        <td>
                          <b>{s.denominacao ?? "(sem denominação)"}</b>
                          {s.nome_arquivo_txt ? <span className="mono" style={{ color: "var(--texto-2)" }}> · {s.nome_arquivo_txt}</span> : null}
                        </td>
                        <td>{s.detentor_nome ?? "—"}</td>
                        <td>{s.municipio ? `${s.municipio}-${s.uf ?? ""}` : "—"}</td>
                        <td>
                          <span className="progresso-servico" title={`${etapas.filter(Boolean).length} de ${etapas.length} etapas`}>
                            {etapas.map((feito, i) => <i key={i} className={feito ? "feito" : ""} />)}
                          </span>
                        </td>
                        <td style={{ color: "var(--texto-2)", fontSize: 12 }}>{faltando(s)}</td>
                        <td style={{ color: "var(--texto-2)" }}>{dataFmt((s as unknown as { created_at: string }).created_at)}</td>
                        <td>
                          <BotaoPerigo titulo={`Excluir "${nome(s)}"`} confirmacao="excluir mesmo"
                            onConfirmar={() => excluir(s)}>✕</BotaoPerigo>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  );
}
