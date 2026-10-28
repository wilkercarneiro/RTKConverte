// Tela inicial: saudação, retomar o que ficou pela metade, escolher o serviço
// e a lista de recentes.
//
// Os cartões saem de SERVICOS (src/lib/modalidades.ts), não de JSX escrito à
// mão: acrescentar uma modalidade é acrescentar uma entrada naquela lista, e ela
// aparece aqui e na página do cliente de uma vez.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { chaveDoServico, rotuloCurto } from "../lib/modalidades";
import { temPermissao } from "../lib/permissoes";
import type { ChaveServico } from "../lib/modalidades";
import { indexarDocumentos, progressoDe } from "../lib/progresso";
import type { DocsDoServico } from "../lib/progresso";
import type { Servico } from "../lib/types";
import { Icone, ICONE } from "./Icone";
import { NovoServico } from "./NovoServico";

interface Props {
  onNovo: (chave: ChaveServico) => void;
  onAbrir: (s: Servico) => void;
  onVerServicos: () => void;
  /** nome ou e-mail do operador logado, para a saudação */
  nome?: string;
}

function saudacao(): string {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function hoje(): string {
  const s = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  // "quarta-feira, 3 de setembro" → "Quarta, 3 de setembro"
  const limpo = s.replace(/-feira/, "");
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

/** Primeiro nome a partir do nome ou do e-mail ("daniel.santos@…" → "Daniel"). */
function primeiroNome(nome?: string): string | null {
  if (!nome) return null;
  const base = nome.split("@")[0].split(/[\s._-]+/)[0];
  if (!base) return null;
  return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
}

export function Inicio({ onNovo, onAbrir, onVerServicos, nome }: Props) {
  // null = carregando; erro separado: falha nunca aparece como "nenhum serviço"
  const [servicos, setServicos] = useState<Servico[] | null>(null);
  const [docs, setDocs] = useState<Record<string, DocsDoServico>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    setErro(null);
    Promise.all([
      supabase.from("servicos").select().order("created_at", { ascending: false }).limit(200),
      supabase.from("documentos_gerados").select("servico_id, tipo"),
    ]).then(([s, d]) => {
      if (!vivo) return;
      if (s.error) { setErro(s.error.message); return; }
      setServicos((s.data as Servico[]) ?? []);
      setDocs(indexarDocumentos((d.data as { servico_id: string; tipo: string }[]) ?? []));
    });
    return () => { vivo = false; };
  }, [tentativa]);

  const progresso = (s: Servico) => progressoDe(s, docs[s.id]);
  const emAndamento = useMemo(() => (servicos ?? []).filter((s) => !progresso(s).concluido), [servicos, docs]);
  const concluidosMes = useMemo(() => {
    const ini = new Date(); ini.setDate(1); ini.setHours(0, 0, 0, 0);
    return (servicos ?? []).filter((s) => progresso(s).concluido && new Date(s.created_at ?? 0) >= ini).length;
  }, [servicos, docs]);

  // Preditivo: quem abre o sistema quase sempre volta ao serviço que estava
  // fazendo. O mais recente que ainda não terminou ganha um atalho no topo.
  const retomar = emAndamento[0] ?? null;
  const recentes = (servicos ?? []).slice(0, 6);
  const quem = primeiroNome(nome);
  const criar = temPermissao("servicos.criar");

  return (
    <div className="inicio fade">
      <div className="inicio-cabeca">
        <div>
          <span className="olho-pagina">{hoje()}</span>
          <h1>{saudacao()}{quem ? `, ${quem}` : ""}.</h1>
          <p className="sub">
            {servicos === null ? "Carregando os seus serviços…"
              : emAndamento.length === 0 ? "Nenhum serviço em andamento. Que tal começar um?"
                : `${emAndamento.length} ${emAndamento.length === 1 ? "serviço espera" : "serviços esperam"} por você.`}
          </p>
        </div>
        <div className="inicio-numeros" aria-label="Resumo">
          <div><b>{servicos === null ? "–" : emAndamento.length}</b><span>em andamento</span></div>
          <div><b>{servicos === null ? "–" : concluidosMes}</b><span>concluídos no mês</span></div>
          <div><b>{servicos === null ? "–" : servicos.length >= 200 ? "200+" : servicos.length}</b><span>serviços no total</span></div>
        </div>
      </div>

      {erro && (
        <div className="aviso-erro-pagina" role="alert">
          <span>Não foi possível carregar os seus serviços. {erro}</span>
          <button onClick={() => setTentativa((n) => n + 1)}>Tentar de novo</button>
        </div>
      )}

      {retomar && (() => {
        const p = progresso(retomar);
        return (
          <div className="retomar">
            <div className="rt-icone" aria-hidden="true"><Icone d={ICONE.retomar} traco={2} /></div>
            <div className="rt-texto">
              <span className="rt-rotulo">Continuar de onde parou</span>
              <div className="rt-titulo">
                {retomar.denominacao ?? retomar.nome_arquivo_txt ?? retomar.id.slice(0, 8)}
                <span>
                  {retomar.municipio ? ` · ${retomar.municipio}-${retomar.uf ?? ""}` : ""}
                  {` · ${rotuloCurto[chaveDoServico(retomar)]}`}
                </span>
              </div>
            </div>
            <span className="rt-progresso">
              <span className="progresso-servico" title={`${p.etapas.filter(Boolean).length} de ${p.etapas.length} etapas`}>
                {p.etapas.map((feito, i) => <i key={i} className={feito ? "feito" : i === p.atual ? "atual" : ""} />)}
              </span>
              <span>falta {p.falta}</span>
            </span>
            <button className="principal" onClick={() => onAbrir(retomar)}>Abrir serviço</button>
          </div>
        );
      })()}

      {criar ? <NovoServico onNovo={onNovo} /> : (
        <p className="nota-permissao">Para abrir um serviço novo, peça a permissão “Criar serviços” a quem gerencia a equipe.</p>
      )}

      <div>
        <div className="secao-cabeca">
          <div className="rotulo-secao">Recentes</div>
          <button className="link" onClick={onVerServicos}>Ver todos os serviços</button>
        </div>
        {servicos === null && !erro ? (
          <div className="tabela-wrap" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="linha-esqueleto" />)}</div>
        ) : recentes.length === 0 ? (
          <div className="tabela-wrap vazio-acao">
            <b>Nenhum serviço ainda</b>
            <span>{criar ? "Escolha uma modalidade acima e envie o arquivo do levantamento." : "Os serviços da equipe aparecem aqui."}</span>
          </div>
        ) : (
          <div className="tabela-wrap">
            <table className="tabela-vertices dash-lista">
              <thead><tr><th>Imóvel</th><th className="col-sec">Cliente</th><th className="col-sec">Município</th><th>Modalidade</th><th>Andamento</th></tr></thead>
              <tbody>
                {recentes.map((s) => {
                  const chave = chaveDoServico(s);
                  return (
                    <tr key={s.id} className="linha-servico" tabIndex={0} role="button"
                      onClick={() => onAbrir(s)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(s); } }}>
                      <td><b>{s.denominacao ?? s.nome_arquivo_txt ?? "(sem denominação)"}</b></td>
                      <td className="sub col-sec">{s.detentor_nome ?? "—"}</td>
                      <td className="sub col-sec">{s.municipio ? `${s.municipio}-${s.uf ?? ""}` : "—"}</td>
                      <td><span className={`chip mod-${chave}`}>{rotuloCurto[chave]}</span></td>
                      <td>
                        {(() => {
                          const p = progresso(s);
                          return (
                            <span className="andamento">
                              <span className="progresso-servico">{p.etapas.map((f, i) => <i key={i} className={f ? "feito" : i === p.atual ? "atual" : ""} />)}</span>
                              <span>{p.concluido ? "concluído" : `falta ${p.falta}`}</span>
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
