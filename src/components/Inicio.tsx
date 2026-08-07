// Tela inicial: escolher o serviço + retomar o que ficou pela metade.
//
// Os cartões saem de SERVICOS (src/lib/modalidades.ts), não de JSX escrito à
// mão: acrescentar uma modalidade é acrescentar uma entrada naquela lista, e ela
// aparece aqui e na página do cliente de uma vez.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { SERVICOS, chaveDoServico, rotuloCurto } from "../lib/modalidades";
import type { ChaveServico } from "../lib/modalidades";
import type { Servico } from "../lib/types";

interface Props {
  onNovo: (chave: ChaveServico) => void;
  onAbrir: (s: Servico) => void;
}

// a planta 'do sistema' sai junto do memorial e da planilha — é a mesma etapa
const TIPOS_ETAPA1 = new Set(["memorial_docx", "planilha_ods", "planta_pdf_sistema"]);

export function Inicio({ onNovo, onAbrir }: Props) {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [docs, setDocs] = useState<{ servico_id: string; tipo: string }[]>([]);

  useEffect(() => {
    supabase.from("servicos").select().order("created_at", { ascending: false }).limit(50)
      .then(({ data }) => setServicos((data as Servico[]) ?? []));
    supabase.from("documentos_gerados").select("servico_id, tipo")
      .then(({ data }) => setDocs((data as { servico_id: string; tipo: string }[]) ?? []));
  }, []);

  // Preditivo: quem abre o sistema quase sempre volta ao serviço que estava
  // fazendo. O mais recente que ainda não terminou ganha um atalho no topo.
  const retomar = useMemo(() => {
    const feito = new Map<string, Set<string>>();
    for (const d of docs) {
      if (!feito.has(d.servico_id)) feito.set(d.servico_id, new Set());
      feito.get(d.servico_id)!.add(d.tipo);
    }
    return servicos.find((s) => {
      const t = feito.get(s.id) ?? new Set<string>();
      const temDocs = [...t].some((x) => TIPOS_ETAPA1.has(x));
      // a conferência termina na etapa 1; o resto só termina com as peças
      if (s.modalidade === "conferencia") return !temDocs;
      return !temDocs || ![...t].some((x) => x.startsWith("peca_"));
    }) ?? null;
  }, [servicos, docs]);

  const principais = SERVICOS.filter((s) => s.principal);
  const secundarios = SERVICOS.filter((s) => !s.principal);

  return (
    <div className="inicio">
      <div className="inicio-cabeca">
        <h1>O que vamos fazer?</h1>
        <p className="sub">Georreferenciamento · Memorial INCRA · Planilha SIGEF · Peças técnicas</p>
      </div>

      {retomar && (
        <div className="retomar">
          <div className="rt-texto">
            <span className="rt-rotulo">Continuar de onde parou</span>
            <b>{retomar.denominacao ?? retomar.nome_arquivo_txt ?? retomar.id.slice(0, 8)}</b>
            <span className="sub">
              {retomar.municipio ? `${retomar.municipio}-${retomar.uf ?? ""} · ` : ""}
              {rotuloCurto[chaveDoServico(retomar)]}
            </span>
          </div>
          <button className="principal" onClick={() => onAbrir(retomar)}>Abrir serviço →</button>
        </div>
      )}

      <div className="cartoes-servico">
        {principais.map((d) => (
          <button key={d.chave} className="cartao-servico" onClick={() => onNovo(d.chave)}>
            <span className="cs-icone" aria-hidden="true">{d.icone}</span>
            <b className="cs-titulo">{d.titulo}</b>
            <span className="cs-resumo">{d.resumo}</span>
            <span className="cs-lista">
              <em>Precisa de</em>
              {d.requisitos.join(" · ")}
            </span>
            <span className="cs-lista">
              <em>Entrega</em>
              {d.entrega.join(" · ")}
            </span>
            <span className="cs-cta">{d.cta} →</span>
          </button>
        ))}
      </div>

      <div className="atalhos-secundarios">
        {secundarios.map((d) => (
          <button key={d.chave} className="atalho" onClick={() => onNovo(d.chave)}>
            <span aria-hidden="true">{d.icone}</span>
            <b>{d.titulo}</b>
            <span className="sub">{d.resumo}</span>
            <span className="atalho-cta">{d.cta} →</span>
          </button>
        ))}
      </div>
    </div>
  );
}
