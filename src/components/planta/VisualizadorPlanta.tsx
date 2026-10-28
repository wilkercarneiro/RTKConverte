// Visualizador da planta: abre o PDF dentro do sistema, com o botão EDITAR.
//
// Qualquer tela abre o visualizador com `abrirPlanta({...})` — o host único,
// montado no App, escuta o pedido. Assim a geração do SIGEF, a do memorial, a
// das glebas e o histórico usam o mesmo visualizador e o mesmo editor.
//
// O editor trabalha sobre a CENA embutida no PDF (planta_cena.ts). Ao concluir,
// o PDF é refeito aqui no navegador; baixar e salvar no histórico partem dele.
import { useCallback, useEffect, useState } from "react";
import { cenaParaPdf, lerCena, type Cena } from "../../../supabase/functions/_shared/planta_cena.ts";
import { textoWinAnsi } from "../../../supabase/functions/_shared/texto.ts";
import { supabase } from "../../lib/supabase";
import { EditorPlanta } from "./EditorPlanta";
import { temRecurso } from "../../lib/recursos";

export interface PedidoPlanta {
  /** URL assinada do PDF, ou os bytes (planta feita no navegador) */
  url?: string;
  bytes?: Uint8Array;
  /** nome do arquivo ao baixar, sem ".pdf" */
  nome: string;
  titulo?: string;
  /** com serviço, a planta editada pode ir para o histórico */
  servicoId?: string;
  versao?: number;
  /** caminho no bucket, quando se sabe — identifica o rascunho da edição */
  path?: string;
}

const EVENTO = "rtk:abrir-planta";
export function abrirPlanta(p: PedidoPlanta) {
  window.dispatchEvent(new CustomEvent<PedidoPlanta>(EVENTO, { detail: p }));
}

/** Monte uma vez (no App): é quem atende `abrirPlanta`. */
export function VisualizadorPlantaHost() {
  const [pedido, setPedido] = useState<PedidoPlanta | null>(null);
  useEffect(() => {
    const ouvir = (e: Event) => setPedido((e as CustomEvent<PedidoPlanta>).detail);
    window.addEventListener(EVENTO, ouvir);
    return () => window.removeEventListener(EVENTO, ouvir);
  }, []);
  if (!pedido) return null;
  return <VisualizadorPlanta key={pedido.url ?? pedido.nome} pedido={pedido} onFechar={() => setPedido(null)} />;
}

function baixarBytes(bytes: Uint8Array, nome: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nome.replace(/[\\/:*?"<>|]/g, "-")}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** chave estável da planta (sem o token da URL assinada) */
function chaveDe(p: PedidoPlanta): string {
  const base = p.path ?? (p.url ? decodeURIComponent(p.url.split("?")[0].replace(/^.*\/object\/(sign|public)\//, "")) : p.nome);
  return `rtk.planta.rascunho:${base}`;
}

export function VisualizadorPlanta({ pedido, onFechar }: { pedido: PedidoPlanta; onFechar: () => void }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(pedido.bytes ?? null);
  const [original, setOriginal] = useState<Cena | null>(null);
  const [cena, setCena] = useState<Cena | null>(null);
  const [lendo, setLendo] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [modo, setModo] = useState<"ver" | "editar">("ver");
  const [editada, setEditada] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<string | null>(null);
  const [urlPdf, setUrlPdf] = useState<string | null>(null);

  // carrega o PDF e a cena dele
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        let b = pedido.bytes ?? null;
        if (!b && pedido.url) {
          const r = await fetch(pedido.url);
          if (!r.ok) throw new Error(`não foi possível baixar a planta (${r.status})`);
          b = new Uint8Array(await r.arrayBuffer());
        }
        if (!b) throw new Error("planta sem arquivo");
        if (!vivo) return;
        setBytes(b);
        const c = await lerCena(b).catch(() => null);
        if (!vivo) return;
        setOriginal(c);
        setCena(c);
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      } finally {
        if (vivo) setLendo(false);
      }
    })();
    return () => { vivo = false; };
  }, [pedido]);

  useEffect(() => {
    if (!bytes) return;
    const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    setUrlPdf(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes]);

  // Esc fecha (no visualizador; no editor o Esc é do editor)
  useEffect(() => {
    if (modo !== "ver") return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [modo, onFechar]);

  const concluir = useCallback(async (nova: Cena) => {
    setOcupado("Gerando o PDF editado…");
    setErro(null);
    try {
      const b = await cenaParaPdf(nova, textoWinAnsi);
      setCena(nova);
      setBytes(b);
      setEditada(true);
      setSalvo(null);
      setModo("ver");
    } catch (e) {
      setErro(`O PDF não pôde ser gerado: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOcupado(null);
    }
  }, []);

  const nomeArquivo = editada ? `${pedido.nome} (editada)` : pedido.nome;

  async function salvarNoHistorico() {
    if (!bytes || !pedido.servicoId) return;
    setOcupado("Salvando no histórico…");
    setErro(null);
    try {
      // Só a pasta entrada/ aceita escrita da tela (migration 0017); a planta
      // editada mora numa subpasta dela e entra no histórico pela tabela.
      const path = `${pedido.servicoId}/entrada/plantas-editadas/${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;
      const up = await supabase.storage.from("gerados").upload(path, bytes, { contentType: "application/pdf", upsert: true });
      if (up.error) throw up.error;
      let versao = pedido.versao ?? Number(/\/v(\d+)\//.exec(pedido.path ?? pedido.url ?? "")?.[1] ?? NaN);
      if (!Number.isFinite(versao)) {
        const { data } = await supabase.from("documentos_gerados").select("versao").eq("servico_id", pedido.servicoId)
          .order("versao", { ascending: false }).limit(1);
        versao = (data?.[0]?.versao as number | undefined) ?? 1;
      }
      const titulo = `${pedido.titulo ?? "Planta"} · editada`;
      const ins = await supabase.from("documentos_gerados").insert({ servico_id: pedido.servicoId, versao, tipo: "planta_pdf_editada", titulo, path });
      if (ins.error) throw ins.error;
      setSalvo(`Salva no histórico, na versão v${versao}.`);
      window.dispatchEvent(new Event("rtk:historico-atualizado"));
    } catch (e) {
      setErro(`Não foi possível salvar no histórico: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOcupado(null);
    }
  }

  if (modo === "editar" && cena && original) {
    return (
      <div className="vp vp-editor" role="dialog" aria-label="Editar planta">
        <EditorPlanta cena={cena} original={original} chaveRascunho={chaveDe(pedido)} onConcluir={concluir} onVoltar={() => setModo("ver")} />
        {ocupado && <div className="vp-ocupado">{ocupado}</div>}
        {erro && <div className="vp-erro-flutuante erro">{erro}</div>}
      </div>
    );
  }

  return (
    <div className="vp" role="dialog" aria-label="Visualizar planta">
      <div className="vp-barra">
        <div className="vp-titulo">
          <strong>{pedido.titulo ?? "Planta"}</strong>
          {editada && <span className="vp-chip">editada</span>}
          {cena?.nomeFolha && <span className="vp-folha">{cena.nomeFolha}</span>}
        </div>
        <span className="vp-espaco" />
        {salvo && <span className="vp-ok">{salvo}</span>}
        {temRecurso("planta.editor") && (
          <button type="button" className="principal" disabled={!cena || lendo || !!ocupado} onClick={() => setModo("editar")}
            title={cena ? "Mover, editar e recolorir tudo o que está na folha — menos o traçado do terreno" : "Esta planta foi gerada antes do editor: gere de novo para editar"}>
            Editar planta
          </button>
        )}
        {editada && pedido.servicoId && (
          <button type="button" disabled={!!ocupado || !!salvo} onClick={salvarNoHistorico} title="Guarda a planta editada no histórico do serviço">
            Salvar no histórico
          </button>
        )}
        <button type="button" disabled={!bytes} onClick={() => bytes && baixarBytes(bytes, nomeArquivo)}>Baixar PDF</button>
        <button type="button" className="fantasma vp-fechar" onClick={onFechar} title="Fechar (Esc)" aria-label="Fechar">✕</button>
      </div>
      {!lendo && !cena && !erro && (
        <div className="vp-aviso">Esta planta foi gerada antes do editor existir. Gere a planta de novo para poder editá-la.</div>
      )}
      <div className="vp-corpo">
        {lendo && <div className="vp-carregando">Abrindo a planta…</div>}
        {erro && <div className="erro vp-erro">{erro}</div>}
        {urlPdf && <iframe className="vp-pdf" title="Planta" src={`${urlPdf}#view=Fit`} />}
      </div>
      {ocupado && <div className="vp-ocupado">{ocupado}</div>}
    </div>
  );
}
