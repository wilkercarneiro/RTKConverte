// Preço do crédito extra por faixa de quantidade (migração 0034).
//
// Uma tabela é uma lista de faixas { a_partir_de, preco }: o preço unitário de
// uma compra é o da maior faixa que a quantidade alcança, e a primeira faixa é
// a compra mínima. Lista vazia = a carteira não está à venda.
//
//   [{2, 19.90}, {10, 15}, {51, 10}]  →  2–9: 19,90 · 10–50: 15,00 · 51+: 10,00
//
// A conta que vale é a do banco (cotacao_credito); esta é a mesma regra para a
// tela mostrar o total enquanto a pessoa digita. tests/precos.test.mjs confere
// as duas com os mesmos casos.

export interface Faixa { a_partir_de: number; preco: number }

export const COMPRA_MAXIMA = 1000;

const ordenadas = (f: Faixa[]) => [...f].sort((a, b) => a.a_partir_de - b.a_partir_de);

/** A compra mínima (null = não está à venda). */
export function minimoDe(faixas: Faixa[]): number | null {
  return faixas.length ? ordenadas(faixas)[0].a_partir_de : null;
}

/** Preço unitário para `quantidade` (null = abaixo do mínimo, acima do máximo ou sem tabela). */
export function precoUnitario(faixas: Faixa[], quantidade: number): number | null {
  if (!Number.isInteger(quantidade) || quantidade > COMPRA_MAXIMA) return null;
  let preco: number | null = null;
  for (const f of ordenadas(faixas)) if (f.a_partir_de <= quantidade) preco = Number(f.preco);
  return preco;
}

/** Unitário e total, arredondado em centavos como no banco. */
export function cotar(faixas: Faixa[], quantidade: number): { unitario: number; total: number } | null {
  const unitario = precoUnitario(faixas, quantidade);
  if (unitario === null) return null;
  return { unitario, total: Math.round(unitario * quantidade * 100) / 100 };
}

export const fmtReais = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "2 a 9 créditos: R$ 19,90 cada" … "51 ou mais: R$ 10,00 cada". */
export function faixasEmTexto(faixas: Faixa[]): string[] {
  const f = ordenadas(faixas);
  return f.map((x, i) => {
    const prox = f[i + 1];
    const qtd = !prox ? `${x.a_partir_de} ou mais` : prox.a_partir_de - 1 === x.a_partir_de ? `${x.a_partir_de}` : `${x.a_partir_de} a ${prox.a_partir_de - 1}`;
    return `${qtd}: ${fmtReais(Number(x.preco))} cada`;
  });
}

/** O que impede a tabela de ser gravada (null = ok). */
export function problemaDasFaixas(faixas: Faixa[]): string | null {
  const vistos = new Set<number>();
  for (const f of faixas) {
    if (!Number.isInteger(f.a_partir_de) || f.a_partir_de < 1 || f.a_partir_de > COMPRA_MAXIMA) return "A quantidade de cada faixa vai de 1 a 1000.";
    if (vistos.has(f.a_partir_de)) return `Duas faixas começam em ${f.a_partir_de} créditos.`;
    if (!Number.isFinite(f.preco) || f.preco < 0) return `Preço inválido na faixa de ${f.a_partir_de} créditos.`;
    vistos.add(f.a_partir_de);
  }
  return null;
}
