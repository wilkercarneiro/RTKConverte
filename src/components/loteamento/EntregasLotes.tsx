// Lote a lote (Entregas): o memorial, a planta A4 e a locação de CADA lote (e
// de cada área pública), numa pasta por lote dentro do zip. O servidor gera de
// 60 em 60 (teto da função `entregar`); a tela pede os pedaços em sequência,
// junta tudo num zip só e mostra o andamento.
import { useMemo, useState } from "react";
import JSZip from "jszip";
import { arquivoDaFuncao } from "../../lib/supabase";
import { baixarBlob } from "../../lib/entregas";
import { fmt } from "../../lib/loteamento/calculo.ts";
import type { Resultado } from "../../lib/loteamento/calculo.ts";
import { FORMATOS } from "../../lib/loteamento/saidas.ts";
import type { FormatoLocacao } from "../../lib/loteamento/saidas.ts";
import { MAX_ITENS_POR_PEDIDO, itensLoteALote } from "../../lib/loteamento/loteALote.ts";
import type { ItemLoteALote } from "../../lib/loteamento/loteALote.ts";
import { Dica } from "../ui";

interface Props {
  servicoId: string;
  res: Resultado;
  /** base do nome do zip (o nome do loteamento, sem acento) */
  base: string;
  /** grava o projeto antes (o servidor gera a partir do banco) */
  onSalvar: () => Promise<void>;
  /** carimbo da planta como a função recebe (empresa, RT, logo) */
  carimbo: () => Promise<Record<string, unknown>>;
  onExportou: () => void;
}

const MUITAS = /Muitas solicitações/i;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function EntregasLotes({ servicoId, res, base, onSalvar, carimbo, onExportou }: Props) {
  const itens = useMemo(() => itensLoteALote(res), [res]);
  const grupos = useMemo(() => {
    const g = new Map<string, ItemLoteALote[]>();
    for (const it of itens) {
      const k = it.tipo === "lote" ? `Quadra ${it.quadra}` : "Áreas públicas";
      g.set(k, [...(g.get(k) ?? []), it]);
    }
    return [...g];
  }, [itens]);
  // marcados: todos os lotes de início (o caso comum é baixar tudo)
  const [marcados, setMarcados] = useState<Set<string> | null>(null);
  const sel = marcados ?? new Set(itens.filter((x) => x.tipo === "lote").map((x) => x.id));
  const [formato, setFormato] = useState<FormatoLocacao>("csv-nome-e-n");
  const [andamento, setAndamento] = useState<{ feito: number; total: number; pausa?: boolean } | null>(null);
  const [rapido, setRapido] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const trocar = (ids: string[], marcar: boolean) => {
    const s = new Set(sel);
    for (const id of ids) if (marcar) s.add(id); else s.delete(id);
    setMarcados(s);
  };
  const escolhidos = itens.filter((x) => sel.has(x.id));
  const ocupado = !!andamento || !!rapido;

  /**
   * Pede ao servidor. O limite de frequência da função (30 pedidos em 5 min) vale
   * também aqui: se ele pedir para esperar, a tela espera 30 s e continua — até
   * 5 min, o tempo de a janela do limite andar.
   */
  async function pedir(corpo: Record<string, unknown>, aoPausar?: () => void): Promise<{ blob: Blob; nome: string }> {
    for (let tentativa = 0; ; tentativa++) {
      try { return await arquivoDaFuncao("entregar", { servico_id: servicoId, formato, ...corpo }); }
      catch (e) {
        if (tentativa >= 10 || !(e instanceof Error) || !MUITAS.test(e.message)) throw e;
        aoPausar?.();
        await esperar(30000);
      }
    }
  }

  async function baixarTodos() {
    setErro(null);
    const total = escolhidos.length;
    if (!total) return;
    setAndamento({ feito: 0, total });
    try {
      await onSalvar();
      const c = await carimbo();
      const final = new JSZip();
      for (let i = 0; i < total; i += MAX_ITENS_POR_PEDIDO) {
        const lote = escolhidos.slice(i, i + MAX_ITENS_POR_PEDIDO);
        const { blob } = await pedir({ saida: "lotes", ids: lote.map((x) => x.id), carimbo: c }, () => setAndamento({ feito: i, total, pausa: true }));
        const parte = await JSZip.loadAsync(await blob.arrayBuffer());
        for (const [nome, arq] of Object.entries(parte.files)) if (!arq.dir) final.file(nome, await arq.async("uint8array"));
        setAndamento({ feito: Math.min(total, i + lote.length), total });
      }
      const zip = await final.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      baixarBlob(zip, total === 1 ? `${escolhidos[0].arquivo}_${base}.zip` : `LOTES_${base}.zip`);
      onExportou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setAndamento(null);
    }
  }

  async function baixarUm(it: ItemLoteALote) {
    setErro(null);
    setRapido(it.id);
    try {
      await onSalvar();
      const { blob, nome } = await pedir({ saida: "lote", id: it.id, carimbo: await carimbo() });
      baixarBlob(blob, nome);
      onExportou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setRapido(null);
    }
  }

  const nLotes = escolhidos.filter((x) => x.tipo === "lote").length, nAreas = escolhidos.length - nLotes;
  const rotuloBotao = !escolhidos.length ? "Marque os lotes"
    : `Baixar ${nLotes ? `os ${nLotes} lote${nLotes > 1 ? "s" : ""}` : ""}${nLotes && nAreas ? " e " : ""}${nAreas ? `${nAreas} área${nAreas > 1 ? "s" : ""}` : ""} (ZIP)`;
  const todos = escolhidos.length === itens.length;
  return (
    <section className="bloco lot-entrega-lotes">
      <header>
        <h3>Lote a lote<Dica>
          Para cada lote marcado, uma pasta (QUADRA_A/LOTE_01) com o <b>memorial descritivo</b> (DOCX), a <b>planta do lote em A4</b> (PDF: medidas,
          azimutes, vértices, confrontantes, tabela de coordenadas, situação e carimbo) e a <b>locação dos vértices</b> no formato da coletora — com
          os mesmos nomes de ponto da locação completa. As áreas públicas (verde, institucional) saem do mesmo jeito.
          Loteamento grande é gerado em partes de {MAX_ITENS_POR_PEDIDO} e chega num zip só.
        </Dica></h3>
        <span className="desc">{itens.filter((x) => x.tipo === "lote").length} lotes · {itens.filter((x) => x.tipo === "area").length} áreas públicas</span>
      </header>
      <div className="lot-lotes-topo">
        <button type="button" disabled={ocupado} onClick={() => setMarcados(todos ? new Set() : new Set(itens.map((x) => x.id)))}>
          {todos ? "Desmarcar todos" : "Marcar todos"}
        </button>
        <label className="lot-lotes-formato">Locação
          <select value={formato} disabled={ocupado} onChange={(e) => setFormato(e.target.value as FormatoLocacao)}>
            {FORMATOS.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </label>
        <button type="button" className="principal" disabled={ocupado || !escolhidos.length} onClick={baixarTodos}>
          {andamento ? <><span className="spinner" /> Gerando…</> : rotuloBotao}
        </button>
      </div>
      {andamento && (
        <div className="lot-lotes-andamento" role="status">
          <span>{andamento.pausa ? `O servidor pediu uma pausa — continuando em 30 s (${andamento.feito} de ${andamento.total} prontos)…` : `Gerando ${andamento.feito} de ${andamento.total}…`}</span>
          <div className="lot-progresso"><i style={{ width: `${(100 * andamento.feito) / Math.max(1, andamento.total)}%` }} /></div>
        </div>
      )}
      {erro && <div className="lot-alerta erro">{erro}</div>}
      <div className="lot-lotes-grupos">
        {grupos.map(([nome, its]) => {
          const ids = its.map((x) => x.id);
          const todosG = ids.every((id) => sel.has(id));
          return (
            <div key={nome} className="lot-lotes-grupo">
              <label className="lot-lotes-grupo-nome">
                <input type="checkbox" checked={todosG} disabled={ocupado} onChange={() => trocar(ids, !todosG)} />
                <b>{nome}</b><span>{its.length} · {fmt(its.reduce((s, x) => s + x.area, 0), 0)} m²</span>
              </label>
              <div className="lot-lotes-chips">
                {its.map((it) => (
                  <span key={it.id} className={`lot-chip${sel.has(it.id) ? " marcado" : ""}`} title={`${it.titulo} — ${fmt(it.area)} m²`}>
                    <label><input type="checkbox" checked={sel.has(it.id)} disabled={ocupado} onChange={(e) => trocar([it.id], e.target.checked)} />
                      {it.tipo === "lote" ? String(it.numero).padStart(2, "0") : it.titulo}</label>
                    <button type="button" className="lot-chip-baixar" disabled={ocupado} title={`Baixar só ${it.titulo.toLowerCase()} (memorial, planta e locação)`}
                      aria-label={`Baixar ${it.titulo}`} onClick={() => baixarUm(it)}>{rapido === it.id ? <span className="spinner" /> : "↓"}</button>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
