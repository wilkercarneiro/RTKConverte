// Impressão digital da ESTRUTURA de um arquivo, sob uma receita: separador,
// decimal, nº de colunas, cabeçalho e a classe de cada coluna (E, N, lat, lon,
// número, texto, vazio) — nunca os valores. Dois arquivos do mesmo aparelho com
// a mesma configuração dão a mesma impressão digital, com pontos diferentes; é
// assim que um perfil aprendido reconhece o próximo arquivo.
import { LIMITES } from "../geo.ts";
import { dividirDelimitado, dividirEspacos } from "./executor.ts";
import { lerAngulo, lerNumero, limparToken } from "./numeros.ts";
import type { Receita } from "./receita.ts";
import { normalizarCab } from "./detector.ts";

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function classe(t: string, dec: "," | "."): string {
  const s = limparToken(t);
  if (!s) return "v";
  const v = lerNumero(s, dec);
  if (v !== null) {
    if (v >= LIMITES.eMin && v <= LIMITES.eMax) return "E";
    if (v >= 6100000 && v <= LIMITES.nMax) return "N";
    return "#";
  }
  const a = lerAngulo(s, "lat", dec);
  if (a && (a.gms || a.hemisferioExplicito)) return "G";
  return "t";
}

/** Classe majoritária de cada coluna nas linhas de dado. */
function classes(celulas: string[][], dec: "," | "."): string[] {
  const k = Math.max(0, ...celulas.map((c) => c.length));
  const out: string[] = [];
  for (let j = 0; j < k; j++) {
    const cont = new Map<string, number>();
    for (const c of celulas) { const x = classe(c[j] ?? "", dec); cont.set(x, (cont.get(x) ?? 0) + 1); }
    // nome com rótulo colado ("5ramon") e nome numérico ("5") são a mesma coluna
    const t = cont.get("t") ?? 0, num = cont.get("#") ?? 0;
    let melhor = "v", mv = -1;
    for (const [x, n] of cont) if (x !== "v" && n > mv) { melhor = x; mv = n; }
    if (melhor === "#" || melhor === "t") melhor = t > 0 && num > 0 ? "id" : melhor;
    out.push(mv <= 0 ? "v" : melhor);
  }
  return out;
}

export function assinatura(linhas: string[], r: Receita): string {
  const partes: string[] = [r.registro, r.tokenizacao, r.delimitador ?? "", r.decimal, String(r.colunas ?? "")];
  if (r.registro === "linha" && (r.tokenizacao === "delimitado" || r.tokenizacao === "espacos")) {
    const dividir = (l: string) => (r.tokenizacao === "espacos" ? dividirEspacos(l) : dividirDelimitado(l, r.delimitador!));
    const cab = r.pular_inicio > 0 ? linhas[r.pular_inicio - 1] ?? "" : "";
    partes.push(cab ? dividir(cab.replace(/^\s*[%#]\s*/, "")).map(normalizarCab).join("|") : "-");
    const dados = linhas.slice(r.pular_inicio).filter((l) => l.trim()).slice(0, 400)
      .map(dividir).filter((c) => r.colunas === null || c.length === r.colunas);
    const cls = classes(dados, r.decimal);
    const papelDa = new Map<number, string>();
    for (const [p, j] of Object.entries(r.campos)) if (j !== null) papelDa.set(j, p);
    partes.push(cls.map((c, j) => {
      const p = papelDa.get(j);
      if (!p) return c;
      // nome/código aceitam qualquer conteúdo; o resto tem de ter o valor certo
      return p === "nome" || p === "codigo" ? p : `${p}:${c === "id" || c === "t" ? "t" : c}`;
    }).join(","));
  } else if (r.tokenizacao === "regex") {
    partes.push(r.regex ?? "");
  } else if (r.tokenizacao === "largura_fixa") {
    partes.push((r.cortes ?? []).join(","));
  }
  return fnv1a(partes.join("§"));
}
