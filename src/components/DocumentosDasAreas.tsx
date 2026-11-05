// Documentos de CADA ÁREA de uma divisão — desmembramento (a remanescente e
// cada área desmembrada) ou partilha (cada parte). Um lugar só, na etapa
// Documentos; o painel da prancheta tem o mesmo, compacto.
//
// Cada área vira um serviço completo próprio, no nome de quem a recebe
// (servicoDaArea + verticesDaParte, ligado em glebas.servico_parte_id): a
// primeira vez gasta 1 crédito (0036, a mesma regra do antigo "GEO de cada
// parte"); depois só gera de novo, sem crédito. Para cada área marcada:
//   1. cria o serviço quando falta (o imóvel recebe a numeração oficial antes,
//      se precisar — os marcos têm o mesmo código nos dois serviços);
//   2. leva ao serviço da área o que mudou na divisão (desenho, nome, quem
//      recebe) — ver mudancasNoCabecalho / mesmoDesenho;
//   3. chama a MESMA gerar-documentos da Conferência, com `tabular: true`:
//      memorial descritivo, memorial tabular, planta e planilha do SIGEF.
// Ao reabrir, mostra os documentos da última geração de cada serviço de área
// (documentos_gerados, URLs assinadas do bucket "gerados", como o histórico).
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { chamarFuncao, supabase } from "../lib/supabase";
import type { Gleba, Servico, Vertice } from "../lib/types";
import { verticesDaParte } from "../lib/divisao_servico";
import {
  ROTULO_PAPEL, ehDesmembramento, glebaComPapel, mesmoDesenho, mudancasNoCabecalho, papelDaArea, quemRecebe, servicoDaArea, type PapelArea,
} from "../lib/desmembramento";
import { areaHaDoAnel } from "../lib/glebas";
import { precisaNumerar } from "../lib/codigos_marcos";
import { avisarConsumo, carregarCreditos, custoDeVarios, textoSemCredito } from "../lib/creditos";
import { avisarHistoricoAtualizado, ultimaGeracao, type DocHistorico } from "../lib/historico";
import { confirmar, Dica } from "./ui";
import { ExportarArea } from "./ExportarArea";
import "./desmembramento.css";

/** Os quatro documentos de cada área, na ordem em que aparecem e entram no ZIP. */
type TipoDoc = "memorial" | "tabular" | "planta" | "planilha";
const DOCS: { tipo: TipoDoc; rotulo: string; ext: "DOCX" | "PDF" | "ODS" }[] = [
  { tipo: "memorial", rotulo: "Memorial descritivo", ext: "DOCX" },
  { tipo: "tabular", rotulo: "Memorial tabular", ext: "DOCX" },
  { tipo: "planta", rotulo: "Planta", ext: "PDF" },
  { tipo: "planilha", rotulo: "Planilha SIGEF", ext: "ODS" },
];

/** Um documento: a URL assinada para baixar e, quando veio do histórico, o caminho no Storage. */
interface Arquivo { url: string | null; path: string | null }
type DocsDaArea = Partial<Record<TipoDoc, Arquivo>> & { versao?: number };

/** O que a gerar-documentos devolve (só o que esta tela lê). */
interface GeradoArea {
  memorial_docx?: string;
  planilha_ods?: string;
  planta_pdf?: string | null;
  tabular_docx?: string | null;
  avisos?: string[];
}

export interface AreaDoc {
  /** id da gleba (ou a posição, antes de ter id) */
  chave: string;
  /** posição entre as glebas fechadas (a mesma de servico.divisao.remanescente) */
  i: number;
  gleba: Gleba;
  papel: PapelArea;
  nome: string;
  areaHa: number;
  quemRecebe: string;
  servicoId: string | null;
  docs: DocsDaArea | null;
}

export interface ContextoAreas {
  servico: Servico;
  vertices: Vertice[];
  glebas: Gleba[];
  setGlebas: Dispatch<SetStateAction<Gleba[]>>;
  /** grava a tela antes de gerar (as glebas e os vértices precisam estar no banco) */
  salvar: () => Promise<void>;
  /** numeração oficial dos marcos do imóvel sem gerar os documentos dele */
  numerarMarcos: () => Promise<Vertice[]>;
  avisar: (tom: "ok" | "alerta" | "erro", texto: string) => void;
  setErro: (e: string | null) => void;
  folha: "A1" | "A3";
  metragem: boolean;
}

const fmtHa = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const semBarra = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").trim();
const extDoPath = (p: string) => p.split(".").pop() ?? "";

/** As áreas de uma divisão, o estado da geração e as ações — um só, para as duas vistas. */
export function useDocumentosDasAreas(ctx: ContextoAreas) {
  const { servico, vertices, glebas, setGlebas, salvar, numerarMarcos, avisar, setErro, folha, metragem } = ctx;
  const desm = ehDesmembramento(servico.divisao);
  const unidade = desm ? "área" : "parte";
  const unidades = desm ? "áreas" : "partes";
  /** As mensagens de crédito falam de parte; no desmembramento é área. */
  const emAreas = useCallback((t: string) => (desm ? t.replace(/\b([Pp])artes?\b/g, (m, p: string) => (p === "P" ? "Área" : "área") + (m.endsWith("s") ? "s" : "")) : t), [desm]);

  // documentos da última geração de cada serviço de área (chave: id do serviço)
  const [docs, setDocs] = useState<Record<string, DocsDaArea>>({});
  // áreas marcadas (null = todas)
  const [escolha, setEscolha] = useState<Set<string> | null>(null);
  const [gerando, setGerando] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [zipando, setZipando] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);

  const partes = useMemo(() => glebas.filter((g) => g.anel.length >= 3), [glebas]);
  const areas: AreaDoc[] = useMemo(() => partes.map((g, i) => {
    const papel = papelDaArea(servico.divisao, i);
    const sid = g.servico_parte_id ?? null;
    return {
      chave: g.id ?? `i${i}`, i, gleba: g, papel,
      nome: (g.nome ?? "").trim() || `PARTE ${i + 1}`,
      areaHa: areaHaDoAnel(g.anel),
      quemRecebe: quemRecebe(servico, g, papel),
      servicoId: sid,
      docs: sid ? docs[sid] ?? null : null,
    };
  }), [partes, servico, docs]);

  const marcada = (a: AreaDoc) => (escolha ? escolha.has(a.chave) : true);
  const marcar = (a: AreaDoc, sim: boolean) => {
    const s = new Set(escolha ?? areas.map((x) => x.chave));
    if (sim) s.add(a.chave); else s.delete(a.chave);
    setEscolha(s);
  };
  const alvo = areas.filter(marcada);
  const novas = alvo.filter((a) => !a.servicoId);
  const comDocs = alvo.filter((a) => a.docs && DOCS.some((d) => a.docs![d.tipo]?.url || a.docs![d.tipo]?.path));

  /** Nome do arquivo baixado: "Memorial descritivo - FAZENDA X - ÁREA DESMEMBRADA 01.docx". */
  const nomeArquivo = (a: AreaDoc, rotulo: string, ext: string) =>
    semBarra(`${rotulo} - ${servicoDaArea(servico, a.gleba, a.papel).denominacao ?? a.nome}`) + `.${ext.toLowerCase()}`;

  // ---------------- documentos já gerados (ao abrir e depois de gerar) ----------------
  const ids = areas.map((a) => a.servicoId).filter((x): x is string => !!x);
  const chaveIds = [...ids].sort().join("|");
  useEffect(() => {
    // durante a geração, quem atualiza é a própria geração (evita trocar o novo pelo velho)
    if (gerando || !ids.length) return;
    let vivo = true;
    (async () => {
      const { data } = await supabase.from("documentos_gerados").select().in("servico_id", ids).order("versao", { ascending: false });
      const linhas = ((data ?? []) as (DocHistorico & { servico_id: string })[]);
      const porServico = new Map<string, DocHistorico[]>();
      for (const d of linhas) porServico.set(d.servico_id, [...(porServico.get(d.servico_id) ?? []), d]);
      const novo: Record<string, DocsDaArea> = {};
      await Promise.all(areas.filter((a) => a.servicoId && porServico.has(a.servicoId)).map(async (a) => {
        const ult = ultimaGeracao(porServico.get(a.servicoId!)!).documentos;
        if (!ult) return;
        const fontes: [TipoDoc, DocHistorico | null][] = [["memorial", ult.memorial], ["tabular", ult.tabular], ["planta", ult.planta], ["planilha", ult.planilha]];
        const d: DocsDaArea = { versao: ult.versao };
        await Promise.all(fontes.map(async ([tipo, linha]) => {
          if (!linha) return;
          const rotulo = DOCS.find((x) => x.tipo === tipo)!.rotulo;
          const { data: s } = await supabase.storage.from("gerados")
            .createSignedUrl(linha.path, 3600, { download: nomeArquivo(a, rotulo, extDoPath(linha.path)) });
          d[tipo] = { url: s?.signedUrl ?? null, path: linha.path };
        }));
        novo[a.servicoId!] = d;
      }));
      if (vivo && Object.keys(novo).length) setDocs((atual) => ({ ...atual, ...novo }));
    })().catch(() => { /* sem o histórico a lista mostra "serviço criado": gerar de novo traz os arquivos */ });
    return () => { vivo = false; };
  }, [chaveIds, gerando]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Liga a área na posição k ao serviço criado para ela (estado; o banco é gravado junto). */
  const ligarServico = (k: number, sid: string) => setGlebas((gs) => {
    let pos = -1;
    return gs.map((g) => {
      if (g.anel.length < 3) return g;
      pos++;
      return pos === k ? { ...g, servico_parte_id: sid } : g;
    });
  });

  /**
   * O serviço da área segue a divisão: cabeçalho (nome do imóvel e quem recebe)
   * e desenho (vértices). Devolve como desfazer o desenho, se a geração falhar
   * — o serviço da área não pode ficar com um desenho que não gerou.
   */
  async function acompanharDivisao(sid: string, a: AreaDoc, novos: Vertice[]): Promise<{ desfazer: (() => Promise<void>) | null; mudou: boolean }> {
    let mudou = false;
    const { data: sv } = await supabase.from("servicos").select("id, denominacao, detentor_nome, detentor_cpf").eq("id", sid).maybeSingle();
    const patch = mudancasNoCabecalho(sv as Partial<Servico> | null, servicoDaArea(servico, a.gleba, a.papel));
    if (patch) {
      const { error } = await supabase.from("servicos").update(patch).eq("id", sid);
      if (error) throw error;
      mudou = true;
    }
    const { data: atuais, error: eL } = await supabase.from("vertices").select().eq("servico_id", sid).order("ordem");
    if (eL) throw eL;
    const antes = (atuais ?? []) as Vertice[];
    if (!antes.length || mesmoDesenho(antes, novos)) return { desfazer: null, mudou };
    const { error: eD } = await supabase.from("vertices").delete().eq("servico_id", sid);
    if (eD) throw eD;
    const { error: eI } = await supabase.from("vertices").insert(novos);
    if (eI) {
      await supabase.from("vertices").insert(antes);
      throw eI;
    }
    return {
      mudou: true,
      desfazer: async () => {
        await supabase.from("vertices").delete().eq("servico_id", sid);
        await supabase.from("vertices").insert(antes);
      },
    };
  }

  async function gerar() {
    if (!alvo.length) { setErro(`Marque as ${unidades} que vão ter os documentos.`); return; }
    const numerar = precisaNumerar(vertices);
    // 1 crédito por área que ainda não tem o serviço; as outras só geram de novo
    if (novas.length) {
      const custo = custoDeVarios(await carregarCreditos().catch(() => null), "completo", novas.length);
      if (!custo.disponivel) { const d = emAreas(custo.detalhe); setErro(d); avisar("erro", d); return; }
      const ok = await confirmar({
        titulo: `Gerar os documentos de ${alvo.length === 1 ? `1 ${unidade}` : `${alvo.length} ${unidades}`} vai consumir ${custo.credito}`,
        texto: (
          <>
            <p>{novas.length === 1 ? `1 ${unidade} ainda não tem o serviço próprio: ela vira` : `${novas.length} ${unidades} ainda não têm o serviço próprio: cada uma vira`} um <b>serviço completo</b>, no nome de quem a recebe, com memorial descritivo, memorial tabular, planta e planilha — por isso a primeira vez gasta 1 crédito por {unidade}.
              {alvo.length - novas.length === 1 && " A outra só gera de novo, sem crédito."}
              {alvo.length - novas.length > 1 && ` As outras ${alvo.length - novas.length} só geram de novo, sem crédito.`}</p>
            <p>{emAreas(custo.detalhe)}</p>
            {numerar && (
              <p>Antes, os marcos do imóvel recebem a <b>numeração oficial do credenciado</b> — a mesma que os documentos do imóvel vão usar
                ao gerar, sem trocar depois.</p>
            )}
            <p className="sub">{novas.map((a) => a.nome).join(", ")}</p>
          </>
        ),
        confirmar: `Gerar e usar ${custo.credito}`,
        cancelar: "Voltar",
      });
      if (!ok) return;
    } else if (numerar) {
      // nenhum crédito, mas a numeração oficial é definitiva: pergunta antes
      const ok = await confirmar({
        titulo: `Numerar os marcos e gerar os documentos de ${alvo.length === 1 ? `1 ${unidade}` : `${alvo.length} ${unidades}`}`,
        texto: <p>A divisão tem marcos novos sem código: eles recebem agora a <b>numeração oficial do credenciado</b>, a mesma dos documentos do imóvel. Gerar os documentos das {unidades} que já têm o serviço não gasta crédito.</p>,
        confirmar: "Numerar e gerar",
        cancelar: "Voltar",
      });
      if (!ok) return;
    }

    setGerando(true);
    setErro(null);
    setAvisos([]);
    let feitas = 0, criadas = 0;
    const avisosGer: string[] = [];
    const atual = { nome: "" };
    try {
      await salvar();
      const vs = numerar ? await numerarMarcos() : vertices;
      // a divisa interna nomeia a área vizinha como ela é: a remanescente, com o proprietário
      const vizinhas = areas.map((a) => glebaComPapel(a.gleba, a.papel));
      for (const [j, a] of alvo.entries()) {
        atual.nome = a.nome;
        setProgresso(`Gerando ${j + 1} de ${alvo.length}…`);
        let sid = a.servicoId;
        let desfazer: (() => Promise<void>) | null = null;
        if (!sid) {
          const { data: novo, error } = await supabase.from("servicos").insert(servicoDaArea(servico, a.gleba, a.papel)).select().single();
          if (error) throw error;
          const criado = (novo as Servico).id;
          const { error: eV } = await supabase.from("vertices").insert(verticesDaParte(servico, vs, vizinhas, a.i, criado));
          if (eV) throw eV;
          if (a.gleba.id) await supabase.from("glebas").update({ servico_parte_id: criado }).eq("id", a.gleba.id);
          ligarServico(a.i, criado);
          sid = criado;
          criadas++;
        } else {
          desfazer = (await acompanharDivisao(sid, a, verticesDaParte(servico, vs, vizinhas, a.i, sid))).desfazer;
        }
        let r: GeradoArea;
        try {
          r = await chamarFuncao<GeradoArea>("gerar-documentos", { servico_id: sid, folha, metragem, tabular: true });
        } catch (e) {
          // o serviço da área volta ao desenho com que gerou da última vez
          if (desfazer) await desfazer().catch(() => undefined);
          throw e;
        }
        const id = sid;
        setDocs((d) => ({
          ...d,
          [id]: {
            memorial: { url: r.memorial_docx ?? null, path: null },
            tabular: { url: r.tabular_docx ?? null, path: null },
            planta: { url: r.planta_pdf ?? null, path: null },
            planilha: { url: r.planilha_ods ?? null, path: null },
          },
        }));
        for (const x of r.avisos ?? []) avisosGer.push(`${a.nome}: ${x}`);
        feitas++;
      }
      avisar("ok", `Documentos ${feitas === 1 ? `da ${unidade}` : `das ${feitas} ${unidades}`} gerados: memorial descritivo, memorial tabular, planta e planilha de cada uma${criadas ? ` (${criadas} serviço${criadas === 1 ? "" : "s"} novo${criadas === 1 ? "" : "s"})` : ""}.`);
      if (avisosGer.length) avisar("alerta", `${avisosGer.length} aviso(s) na geração — veja a lista abaixo das ${unidades}.`);
    } catch (e) {
      const m = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
      setErro(`${feitas ? `${feitas} ${feitas === 1 ? unidade : unidades} pronta(s); ` : ""}parou em ${atual.nome}: ${textoSemCredito(m)}`);
    } finally {
      setAvisos([...new Set(avisosGer)]);
      if (criadas) void avisarConsumo("completo");
      avisarHistoricoAtualizado();
      setProgresso(null);
      setGerando(false);
    }
  }

  /** Baixar tudo (ZIP): os documentos das áreas marcadas, uma pasta por área, montado aqui no navegador. */
  async function baixarZip() {
    const lista = comDocs;
    if (!lista.length) return;
    setZipando(true);
    setErro(null);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      let n = 0;
      for (const a of lista) {
        const pasta = zip.folder(semBarra(a.nome))!;
        for (const d of DOCS) {
          const arq = a.docs?.[d.tipo];
          if (!arq) continue;
          // URL nova a cada ZIP: a da tela pode ter vencido (vale 1 hora)
          const url = arq.path
            ? (await supabase.storage.from("gerados").createSignedUrl(arq.path, 600)).data?.signedUrl ?? arq.url
            : arq.url;
          if (!url) continue;
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`${a.nome}: ${d.rotulo} não baixou (${resp.status}). Gere os documentos de novo.`);
          pasta.file(nomeArquivo(a, d.rotulo, d.ext), await resp.blob());
          n++;
        }
      }
      if (!n) throw new Error("Nenhum arquivo para baixar: gere os documentos primeiro.");
      const blob = await zip.generateAsync({ type: "blob" });
      const el = document.createElement("a");
      el.href = URL.createObjectURL(blob);
      el.download = `${semBarra(`Documentos das ${unidades} - ${servico.denominacao || "imovel"}`)}.zip`;
      el.click();
      setTimeout(() => URL.revokeObjectURL(el.href), 2000);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setZipando(false);
    }
  }

  return {
    desm, unidade, unidades, areas, marcada, marcar, alvo, novas, comDocs,
    gerando, progresso, zipando, avisos, gerar, baixarZip,
  };
}

export type EstadoAreas = ReturnType<typeof useDocumentosDasAreas>;

/**
 * A lista das áreas com o papel, a área, quem recebe e os documentos. `compacto`
 * é o atalho do painel da prancheta: marcar e gerar, e "Ver os documentos".
 */
export function DocumentosDasAreas({ estado, compacto = false, onVerDocumentos }: { estado: EstadoAreas; compacto?: boolean; onVerDocumentos?: () => void }) {
  const { areas, marcada, marcar, alvo, novas, comDocs, gerando, progresso, zipando, avisos, gerar, baixarZip, unidade, unidades } = estado;
  const qtd = alvo.length;
  return (
    <div className={`dm-docs${compacto ? " compacto" : ""}`}>
      <ul className="dm-lista">
        {areas.map((a) => {
          const pronta = !!a.docs && DOCS.some((d) => a.docs![d.tipo]?.url);
          return (
            <li key={a.chave} className={`dm-linha${pronta ? " pronta" : ""}`}>
              <label>
                <input type="checkbox" checked={marcada(a)} disabled={gerando} onChange={(e) => marcar(a, e.target.checked)} aria-label={`Gerar os documentos de ${a.nome}`} />
                <span className="dm-nome">
                  <b>{a.nome}</b>
                  <small><span className={`dm-chip ${a.papel}`}>{ROTULO_PAPEL[a.papel]}</span> {a.quemRecebe || "sem nome"}</small>
                </span>
              </label>
              <span className="dm-lado">
                <span className="dm-ha mono">{fmtHa(a.areaHa)} ha</span>
                <span className={`dm-estado${pronta ? " pronto" : ""}`}>
                  {pronta ? (a.docs?.versao ? `documentos da v${a.docs.versao}` : "documentos prontos") : a.servicoId ? "serviço criado" : "sem serviço · 1 crédito"}
                </span>
                {/* a área em KML, DXF, GPX, SHP… direto daqui (o serviço da área já tem o anel dela) */}
                {a.servicoId && pronta && <ExportarArea servicoId={a.servicoId} temPerimetro />}
                {a.servicoId && <a className="dm-abrir" href={`#/servico/${a.servicoId}`}>Abrir o serviço da {unidade} →</a>}
              </span>
              {!compacto && pronta && (
                <div className="dm-arquivos">
                  {DOCS.map((d) => {
                    const url = a.docs?.[d.tipo]?.url;
                    return url ? (
                      <a key={d.tipo} className="botao-download" href={url} target="_blank" rel="noreferrer">
                        <span className="ext">{d.ext}</span> {d.rotulo}
                      </a>
                    ) : null;
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!compacto && avisos.length > 0 && (
        <ul className="dm-avisos" aria-label="Avisos da geração">
          {avisos.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}
      <div className="dm-pe">
        <button type="button" className="principal" disabled={gerando || qtd === 0} onClick={() => void gerar()}>
          {gerando ? (progresso ?? "Gerando…") : `Gerar os documentos (${qtd} ${qtd === 1 ? unidade : unidades})`}
        </button>
        {!compacto && (
          <button type="button" disabled={zipando || gerando || comDocs.length === 0} onClick={() => void baixarZip()}
            title={comDocs.length ? `Os documentos das ${unidades} marcadas, uma pasta por ${unidade}` : `Gere os documentos das ${unidades} primeiro`}>
            {zipando ? "Montando o ZIP…" : "Baixar tudo (ZIP)"}
          </button>
        )}
        {compacto && onVerDocumentos && <button type="button" className="fantasma" onClick={onVerDocumentos}>Ver os documentos →</button>}
        <span className="sub">
          {novas.length ? `${novas.length} sem serviço: 1 crédito cada, confirmado antes.` : `Todas as ${unidades} marcadas já têm o serviço: gerar de novo não gasta crédito.`}
          {!compacto && <Dica>Cada {unidade} vira um serviço completo próprio, no nome de quem a recebe, com os mesmos marcos do imóvel e as divisas internas confrontando com a vizinha. A primeira vez de cada uma gasta 1 crédito; depois, gerar de novo é grátis — e leva ao serviço dela o que mudou na divisão (desenho, nome, quem recebe).</Dica>}
        </span>
      </div>
    </div>
  );
}
