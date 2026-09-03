// Tela inicial: saudação, retomar o que ficou pela metade, escolher o serviço
// e a lista de recentes.
//
// Os cartões saem de SERVICOS (src/lib/modalidades.ts), não de JSX escrito à
// mão: acrescentar uma modalidade é acrescentar uma entrada naquela lista, e ela
// aparece aqui e na página do cliente de uma vez.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { SERVICOS, chaveDoServico, rotuloCurto } from "../lib/modalidades";
import type { ChaveServico } from "../lib/modalidades";
import { indexarDocumentos, progressoDe } from "../lib/progresso";
import type { DocsDoServico } from "../lib/progresso";
import type { Servico } from "../lib/types";
import { Icone, ICONE } from "./Icone";

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
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [docs, setDocs] = useState<Record<string, DocsDoServico>>({});

  useEffect(() => {
    supabase.from("servicos").select().order("created_at", { ascending: false }).limit(50)
      .then(({ data }) => setServicos((data as Servico[]) ?? []));
    supabase.from("documentos_gerados").select("servico_id, tipo")
      .then(({ data }) => setDocs(indexarDocumentos((data as { servico_id: string; tipo: string }[]) ?? [])));
  }, []);

  const progresso = (s: Servico) => progressoDe(s, docs[s.id]);
  const emAndamento = useMemo(() => servicos.filter((s) => !progresso(s).concluido), [servicos, docs]);

  // Preditivo: quem abre o sistema quase sempre volta ao serviço que estava
  // fazendo. O mais recente que ainda não terminou ganha um atalho no topo.
  const retomar = emAndamento[0] ?? null;
  const recentes = servicos.slice(0, 5);

  const principais = SERVICOS.filter((s) => s.principal);
  const secundarios = SERVICOS.filter((s) => !s.principal);
  const quem = primeiroNome(nome);

  return (
    <div className="inicio fade">
      <div className="inicio-cabeca">
        <div>
          <h1>{saudacao()}{quem ? `, ${quem}` : ""}.</h1>
          <p className="sub">
            {hoje()} · {emAndamento.length === 0 ? "nenhum serviço em andamento"
              : `${emAndamento.length} ${emAndamento.length === 1 ? "serviço" : "serviços"} em andamento`}
          </p>
        </div>
      </div>

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
              <span style={{ marginLeft: 6 }}>falta {p.falta}</span>
            </span>
            <button className="principal" onClick={() => onAbrir(retomar)}>Abrir serviço</button>
          </div>
        );
      })()}

      <div>
        <div className="rotulo-secao">Novo serviço</div>
        <div className="cartoes-servico">
          {principais.map((d) => (
            <button key={d.chave} className="cartao-servico" onClick={() => onNovo(d.chave)}>
              <span className="cs-icone" aria-hidden="true"><Icone d={d.icone} /></span>
              <b className="cs-titulo">{d.titulo}</b>
              <span className="cs-resumo">{d.resumo}</span>
              <span className="cs-lista">
                <span><em>Entrega</em>{d.entrega.join(" · ")}</span>
              </span>
              <span className="cs-cta">{d.cta} →</span>
            </button>
          ))}
        </div>
        <div className="atalhos-secundarios">
          {secundarios.map((d) => (
            <button key={d.chave} className="atalho" onClick={() => onNovo(d.chave)}>
              <Icone d={d.icone} size={18} />
              <b>{d.titulo}</b>
              <span className="sub">{d.resumo}</span>
              <span className="atalho-cta">{d.cta} →</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="secao-cabeca">
          <div className="rotulo-secao">Recentes</div>
          <button className="link" onClick={onVerServicos}>Ver todos os serviços</button>
        </div>
        {recentes.length === 0 ? (
          <div className="tabela-wrap"><p className="vazio">Nenhum serviço ainda — comece por um dos cartões acima.</p></div>
        ) : (
          <div className="tabela-wrap">
            <table className="tabela-vertices dash-lista">
              <thead><tr><th>Imóvel</th><th>Cliente</th><th>Município</th><th>Modalidade</th><th>Falta</th></tr></thead>
              <tbody>
                {recentes.map((s) => {
                  const chave = chaveDoServico(s);
                  return (
                    <tr key={s.id} className="linha-servico" tabIndex={0} role="button"
                      onClick={() => onAbrir(s)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(s); } }}>
                      <td><b>{s.denominacao ?? s.nome_arquivo_txt ?? "(sem denominação)"}</b></td>
                      <td className="sub">{s.detentor_nome ?? "—"}</td>
                      <td className="sub">{s.municipio ? `${s.municipio}-${s.uf ?? ""}` : "—"}</td>
                      <td><span className={`chip mod-${chave}`}>{rotuloCurto[chave]}</span></td>
                      <td style={{ color: "var(--texto-3)", fontSize: 13 }}>{progresso(s).falta}</td>
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
