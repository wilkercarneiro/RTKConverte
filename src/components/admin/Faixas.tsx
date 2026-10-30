// Editor da tabela de preço do crédito extra por faixa (0034): "a partir de N
// créditos, R$ X cada". A primeira faixa é a compra mínima; sem faixa, a
// carteira não está à venda. Usado no plano (Planos) e na empresa (Plano e créditos).
import { faixasEmTexto, problemaDasFaixas } from "../../../supabase/functions/_shared/precos.ts";
import type { Faixa } from "../../lib/creditos";

/** Faixa em edição: os campos são texto até salvar. */
export interface FaixaTexto { a_partir_de: string; preco: string }

export const faixasParaTexto = (f: Faixa[]): FaixaTexto[] =>
  [...f].sort((a, b) => a.a_partir_de - b.a_partir_de).map((x) => ({ a_partir_de: String(x.a_partir_de), preco: Number(x.preco).toFixed(2).replace(".", ",") }));

/** "19,90", "1.234,50" ou "19.90" → número (vazio = NaN). */
export function reais(s: string): number {
  const t = s.trim().replace(/^R\$\s*/i, "");
  if (!t) return NaN;
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
}

export const textoParaFaixas = (f: FaixaTexto[]): Faixa[] =>
  f.filter((x) => x.a_partir_de.trim() !== "" || x.preco.trim() !== "")
    .map((x) => ({ a_partir_de: Math.floor(Number(x.a_partir_de)), preco: reais(x.preco) }))
    .sort((a, b) => a.a_partir_de - b.a_partir_de);

export const problemaDoTexto = (f: FaixaTexto[]): string | null => problemaDasFaixas(textoParaFaixas(f));

export const mesmasFaixas = (a: FaixaTexto[], b: FaixaTexto[]): boolean =>
  JSON.stringify(textoParaFaixas(a)) === JSON.stringify(textoParaFaixas(b));

export function EditorFaixas({ valor, onChange, rotulo }: { valor: FaixaTexto[]; onChange: (v: FaixaTexto[]) => void; rotulo: string }) {
  const erro = problemaDoTexto(valor);
  const faixas = erro ? [] : textoParaFaixas(valor);
  const mudar = (i: number, campo: keyof FaixaTexto, v: string) => onChange(valor.map((x, j) => (j === i ? { ...x, [campo]: v } : x)));
  return (
    <div className="sa-faixas" aria-label={rotulo}>
      {valor.map((f, i) => (
        <div className="sa-faixa" key={i}>
          <label>
            <span>{i === 0 ? "Mínimo" : "A partir de"}</span>
            <input type="number" min={1} max={1000} value={f.a_partir_de} aria-label={`${rotulo}: a partir de quantos créditos`}
              onChange={(e) => mudar(i, "a_partir_de", e.target.value)} />
          </label>
          <label>
            <span>R$ cada</span>
            <input inputMode="decimal" value={f.preco} aria-label={`${rotulo}: preço de cada crédito`} placeholder="0,00"
              onChange={(e) => mudar(i, "preco", e.target.value)} />
          </label>
          <button type="button" className="fantasma" aria-label="Tirar esta faixa" onClick={() => onChange(valor.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="link" onClick={() => {
        const ultima = textoParaFaixas(valor).at(-1);
        onChange([...valor, { a_partir_de: ultima ? String(ultima.a_partir_de + 10) : "2", preco: "" }]);
      }}>+ {valor.length ? "faixa de quantidade" : "pôr à venda"}</button>
      {erro ? <span className="erro-campo">{erro}</span>
        : faixas.length ? <small className="sub">{faixasEmTexto(faixas).join(" · ")}</small>
          : <small className="sub">Não está à venda.</small>}
    </div>
  );
}
