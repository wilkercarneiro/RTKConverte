// Lista de serviços — destino próprio da barra lateral.
//
// A coluna "Falta" e os pontos de progresso mudam com a modalidade: a
// conferência de área termina na etapa 1, então dizer que "falta gerar as
// peças" a ela seria mentira. Quem decide isso é `progressoDe`
// (src/lib/progresso.ts), a mesma função que o Início usa.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Servico } from "../lib/types";
import { chaveDoServico, rotuloCurto } from "../lib/modalidades";
import { indexarDocumentos, progressoDe } from "../lib/progresso";
import type { DocsDoServico } from "../lib/progresso";
import { Avisos, BotaoPerigo } from "./ui";
import { useAvisos } from "../lib/ux";
import { Icone, ICONE } from "./Icone";

export function Servicos({ onAbrir, onNovo }: { onAbrir: (s: Servico) => void; onNovo: () => void }) {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [docs, setDocs] = useState<Record<string, DocsDoServico>>({});
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
    setDocs(indexarDocumentos((ds as { servico_id: string; tipo: string }[]) ?? []));
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  const nome = (s: Servico) => s.denominacao ?? s.nome_arquivo_txt ?? s.id.slice(0, 8);

  async function excluir(s: Servico) {
    const { error } = await supabase.from("servicos").delete().eq("id", s.id);
    if (error) { avisar("erro", `Não foi possível excluir: ${error.message}`); return; }
    avisar("ok", `Serviço "${nome(s)}" excluído. Os arquivos gerados permanecem no Storage.`);
    carregar();
  }

  const filtrados = useMemo(() => servicos.filter((s) => {
    const alvo = `${s.denominacao ?? ""} ${s.detentor_nome ?? ""} ${s.nome_arquivo_txt ?? ""} ${s.municipio ?? ""}`.toLowerCase();
    return alvo.includes(filtro.toLowerCase());
  }), [servicos, filtro]);

  const emAndamento = useMemo(() => servicos.filter((s) => !progressoDe(s, docs[s.id]).concluido).length, [servicos, docs]);

  const dataFmt = (iso?: string) => {
    const d = new Date(iso ?? "");
    return isNaN(d.getTime()) ? "—" : `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  };

  return (
    <div className="pagina fade">
      <Avisos avisos={avisos} onFechar={fechar} />
      <div className="pagina-cabeca">
        <div>
          <h1>Serviços</h1>
          <p className="sub">{servicos.length} no total · {emAndamento} em andamento</p>
        </div>
        <div className="busca">
          <Icone d={ICONE.busca} size={16} traco={2} />
          <input placeholder="Imóvel, cliente ou município" aria-label="Buscar serviço"
            value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </div>
        <button className="principal" onClick={onNovo}>+ Novo serviço</button>
      </div>

      <div className="tabela-wrap">
        {carregando ? <p className="vazio"><span className="spinner" /> Carregando…</p>
          : filtrados.length === 0 ? (
            <p className="vazio">Nenhum serviço {filtro ? "encontrado para a busca" : "ainda — comece pelo Início"}.</p>
          ) : (
            <table className="tabela-vertices dash-lista">
              <thead>
                <tr><th>Imóvel</th><th>Cliente</th><th>Município</th><th>Modalidade</th><th>Progresso</th><th>Falta</th><th></th></tr>
              </thead>
              <tbody>
                {filtrados.map((s) => {
                  const chave = chaveDoServico(s);
                  const p = progressoDe(s, docs[s.id]);
                  return (
                    <tr key={s.id} className="linha-servico" tabIndex={0} role="button"
                      title={`criado em ${dataFmt(s.created_at)}`}
                      onClick={() => onAbrir(s)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAbrir(s); } }}>
                      <td>
                        <b>{s.denominacao ?? "(sem denominação)"}</b>
                        {s.nome_arquivo_txt ? <span className="mono" style={{ color: "var(--texto-3)" }}> · {s.nome_arquivo_txt}</span> : null}
                      </td>
                      <td className="sub">{s.detentor_nome ?? "—"}</td>
                      <td className="sub">{s.municipio ? `${s.municipio}-${s.uf ?? ""}` : "—"}</td>
                      <td><span className={`chip mod-${chave}`}>{rotuloCurto[chave]}</span></td>
                      <td>
                        <span className="progresso-servico" title={`${p.etapas.filter(Boolean).length} de ${p.etapas.length} etapas`}>
                          {p.etapas.map((feito, i) => <i key={i} className={feito ? "feito" : i === p.atual ? "atual" : ""} />)}
                        </span>
                      </td>
                      <td style={{ color: "var(--texto-3)", fontSize: 13 }}>{p.falta}</td>
                      <td className="acao">
                        <BotaoPerigo titulo={`Excluir "${nome(s)}"`} confirmacao="excluir mesmo"
                          onConfirmar={() => excluir(s)}>✕</BotaoPerigo>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}
